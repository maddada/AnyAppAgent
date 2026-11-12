// The PC link (docs/CLOUD.md section 3, "The PC link", milestone 7): one PC acting for its owner in
// Convex, and nothing else. Made two ways: a signed-in phone hands its paired PC a link
// (accounts.createPcLink), or the desktop signs in through a browser page (a device code below).
// The PC can then hand its sign-in to its paired phone (a one-time code, the "pc-handoff" sign-in
// in auth.ts). Every route a PC calls checks the link's scopes here.
import { v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import { internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from './_generated/server';
import { requireUser } from './lib/session';

export type PcScope = 'share' | 'web' | 'move';
export const ALL_SCOPES: PcScope[] = ['share', 'web', 'move'];

/** A browser sign-in code lives 10 minutes; a phone hand-over code two. */
export const REQUEST_MS = 10 * 60_000;
export const HANDOFF_MS = 2 * 60_000;
/** Browser sign-ins started a minute, for everyone (the start needs no account). */
export const START_PER_MINUTE = 30;
/** lastSeenAt is written at most once a minute. */
const SEEN_EVERY_MS = 60_000;

/** No 0/O, 1/I/L: read off one screen and checked on another. */
const CODE_LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function linkCode(): string {
  const a = crypto.getRandomValues(new Uint8Array(8));
  return [...a].map((b) => CODE_LETTERS[b % CODE_LETTERS.length]).join('');
}
export const showCode = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`;
export const cleanCode = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, '');

export type PcAuth = {
  linkId: Id<'pcLinks'>;
  userId: Id<'users'>;
  scopes: PcScope[];
  deviceName: string;
  linkedFrom: 'phone' | 'pc';
  linkedFromName: string | null;
  account: { email: string | null; name: string | null; anonymous: boolean };
};

async function authOf(ctx: QueryCtx, link: Doc<'pcLinks'> | null): Promise<PcAuth | null> {
  if (!link || link.revokedAt) return null;
  const user = await ctx.db.get(link.userId);
  if (!user || user.blocked) return null;
  return {
    linkId: link._id,
    userId: link.userId,
    scopes: link.scopes,
    deviceName: link.deviceName,
    linkedFrom: link.linkedFrom,
    linkedFromName: link.linkedFromName ?? null,
    account: { email: user.email ?? null, name: user.name ?? null, anonymous: Boolean(user.isAnonymous) },
  };
}

/** The live link for a token's hash, or null (unknown, revoked, or its account blocked). */
export const byHash = internalQuery({
  args: { hash: v.string() },
  handler: async (ctx, { hash }) => authOf(ctx, await ctx.db.query('pcLinks').withIndex('by_hash', (q) => q.eq('tokenHash', hash)).unique()),
});

/** Scopes are checked in Convex, on every route a PC calls (http.ts pcRoute). */
export function hasScope(auth: Pick<PcAuth, 'scopes'>, scope: PcScope | null): boolean {
  return scope === null || auth.scopes.includes(scope);
}

export const seen = internalMutation({
  args: { linkId: v.id('pcLinks') },
  handler: async (ctx, { linkId }) => {
    const link = await ctx.db.get(linkId);
    if (link && !link.revokedAt && (link.lastSeenAt ?? 0) < Date.now() - SEEN_EVERY_MS) await ctx.db.patch(linkId, { lastSeenAt: Date.now() });
  },
});

/** The PC unlinks itself (the desktop's Unlink). The phone uses accounts.revokePcLink. */
export const revoke = internalMutation({
  args: { linkId: v.id('pcLinks') },
  handler: async (ctx, { linkId }) => {
    const link = await ctx.db.get(linkId);
    if (link && !link.revokedAt) await ctx.db.patch(linkId, { revokedAt: Date.now() });
  },
});

/** The same PC linking again replaces its older link, so the account lists each PC once. */
export async function revokeTwins(ctx: MutationCtx, userId: Id<'users'>, deviceName: string, keep: Id<'pcLinks'>) {
  const links = await ctx.db.query('pcLinks').withIndex('by_user', (q) => q.eq('userId', userId)).collect();
  for (const l of links) if (l._id !== keep && !l.revokedAt && l.deviceName === deviceName) await ctx.db.patch(l._id, { revokedAt: Date.now() });
}

// ---- The desktop signs in through the browser (a device code) ----

export const startRequest = internalMutation({
  args: { code: v.string(), pollHash: v.string(), deviceName: v.string() },
  handler: async (ctx, { code, pollHash, deviceName }) => {
    // Old codes go as new ones come (no cron needed for a table this small).
    const old = await ctx.db.query('pcLinkRequests').withIndex('by_expiry', (q) => q.lt('expiresAt', Date.now() - REQUEST_MS)).take(20);
    for (const r of old) await ctx.db.delete(r._id);
    // Anyone may start one (it needs no account yet): at most 30 a minute for everyone together.
    const recent = await ctx.db.query('pcLinkRequests').withIndex('by_expiry', (q) => q.gt('expiresAt', Date.now() + REQUEST_MS - 60_000)).take(START_PER_MINUTE);
    if (recent.length >= START_PER_MINUTE) return { ok: false as const };
    await ctx.db.insert('pcLinkRequests', { code, pollHash, deviceName: deviceName.trim().slice(0, 60) || 'My PC', expiresAt: Date.now() + REQUEST_MS });
    return { ok: true as const };
  },
});

const requestOf = (ctx: QueryCtx, code: string) =>
  ctx.db
    .query('pcLinkRequests')
    .withIndex('by_code', (q) => q.eq('code', cleanCode(code)))
    .unique();

/** What the browser page shows: which PC asks, and whether it is still waiting. */
export const request = query({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const r = await requestOf(ctx, code);
    if (!r || r.consumedAt || r.expiresAt < Date.now()) return { state: 'gone' as const };
    return { state: r.approvedAt ? ('approved' as const) : ('waiting' as const), deviceName: r.deviceName, code: showCode(r.code) };
  },
});

/** The signed-in person in the browser says yes to linking that PC. */
export const approve = mutation({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const user = await requireUser(ctx);
    const r = await requestOf(ctx, code);
    if (!r || r.consumedAt || r.expiresAt < Date.now()) throw new Error('That code has run out. Start again on your PC.');
    if (r.approvedAt && r.userId !== user._id) throw new Error('That code was already used.');
    await ctx.db.patch(r._id, { userId: user._id, approvedAt: r.approvedAt ?? Date.now() });
    return { deviceName: r.deviceName, email: user.email ?? null };
  },
});

/**
 * The companion's poll: "pending" until the page approves, then the link is made once (the http
 * action made the token and passes only its hash) and the request is used up.
 */
export const pollRequest = internalMutation({
  args: { code: v.string(), pollHash: v.string(), tokenHash: v.string() },
  handler: async (ctx, { code, pollHash, tokenHash }) => {
    const r = await requestOf(ctx, code);
    if (!r || r.pollHash !== pollHash || r.consumedAt || r.expiresAt < Date.now()) return { state: 'gone' as const };
    if (!r.approvedAt || !r.userId) return { state: 'pending' as const };
    const linkId = await ctx.db.insert('pcLinks', {
      userId: r.userId,
      tokenHash,
      deviceName: r.deviceName,
      scopes: ALL_SCOPES,
      linkedFrom: 'pc',
      createdAt: Date.now(),
      lastSeenAt: Date.now(),
    });
    await revokeTwins(ctx, r.userId, r.deviceName, linkId);
    await ctx.db.patch(r._id, { consumedAt: Date.now() });
    return { state: 'linked' as const };
  },
});

// ---- The PC hands its sign-in to its paired phone ----

/**
 * Only a PC that signed in itself (in the browser) hands the sign-in on: a PC the phone linked has
 * that phone signed in already, so a link made by a phone can never become a full sign-in.
 */
export const handoff = internalMutation({
  args: { linkId: v.id('pcLinks'), codeHash: v.string() },
  handler: async (ctx, { linkId, codeHash }) => {
    const link = await ctx.db.get(linkId);
    if (!link || link.revokedAt) return { ok: false as const, why: 'This PC is not linked.' };
    if (link.linkedFrom !== 'pc') return { ok: false as const, why: 'This PC was linked from a phone, so that phone is signed in already.' };
    await ctx.db.insert('pcHandoffs', { codeHash, userId: link.userId, pcLinkId: linkId, expiresAt: Date.now() + HANDOFF_MS });
    return { ok: true as const };
  },
});

/** The "pc-handoff" sign-in (auth.ts): a code works once, for two minutes, while its link lives. */
export const useHandoff = internalMutation({
  args: { codeHash: v.string() },
  handler: async (ctx, { codeHash }) => {
    const h = await ctx.db.query('pcHandoffs').withIndex('by_hash', (q) => q.eq('codeHash', codeHash)).unique();
    if (!h || h.usedAt || h.expiresAt < Date.now()) return null;
    await ctx.db.patch(h._id, { usedAt: Date.now() });
    const link = await ctx.db.get(h.pcLinkId);
    if (!link || link.revokedAt) return null;
    return h.userId;
  },
});
