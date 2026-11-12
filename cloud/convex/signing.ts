// App signing keys (docs/CLOUD.md section 6). The runner makes a new app's key before the agent
// starts on it and hands it here once; it is kept sealed (envelope), never deleted. A build is
// signed with a one-time ticket: the runner asks for that build's ticket, gets the key once, signs
// on a tmpfs as another Unix user than the agent's, and reports what it signed (the signing log).
import { v } from 'convex/values';
import { internalMutation, internalQuery } from './_generated/server';
import { envelopeOpen, envelopeSeal } from './lib/crypto';

const aadOf = (appId: string, packageName: string) => `appkey:${appId}:${packageName}`;
const TICKET_MS = 10 * 60_000;

export const keyOf = internalQuery({
  args: { appId: v.id('apps') },
  handler: async (ctx, { appId }) => ctx.db.query('keys').withIndex('by_app', (q) => q.eq('appId', appId)).first(),
});

/** Stores a new app's key (PKCS12 bytes, base64, and its password). Refused when it has one. */
export const storeKey = internalMutation({
  args: { threadId: v.id('threads'), p12: v.string(), storePassword: v.string(), keyAlias: v.string(), certSha256: v.string() },
  handler: async (ctx, a) => {
    const t = (await ctx.db.get(a.threadId))!;
    const app = (await ctx.db.get(t.appId))!;
    const have = await ctx.db.query('keys').withIndex('by_app', (q) => q.eq('appId', app._id)).first();
    if (have) {
      if (have.certSha256 === a.certSha256) return { certSha256: have.certSha256, stored: false };
      throw new Error('This app already has a signing key; a key is never replaced.');
    }
    if (!/^[0-9a-f]{64}$/.test(a.certSha256)) throw new Error('bad certificate hash');
    const payload = new TextEncoder().encode(JSON.stringify({ p12: a.p12, storePassword: a.storePassword, keyAlias: a.keyAlias }));
    const e = await envelopeSeal(payload, aadOf(app._id, app.packageName));
    payload.fill(0);
    await ctx.db.insert('keys', { appId: app._id, userId: app.userId, packageName: app.packageName, certSha256: a.certSha256, ...e, at: Date.now() });
    return { certSha256: a.certSha256, stored: true };
  },
});

/** A one-time ticket for one build: the key, opened once, to the box that asks for that build. */
export const ticket = internalMutation({
  args: { threadId: v.id('threads'), build: v.number() },
  handler: async (ctx, { threadId, build }) => {
    const t = (await ctx.db.get(threadId))!;
    const app = (await ctx.db.get(t.appId))!;
    const key = await ctx.db.query('keys').withIndex('by_app', (q) => q.eq('appId', app._id)).first();
    if (!key) throw new Error('This app has no signing key yet.');
    // One ticket per build number: a second ask for the same build is refused.
    const used = await ctx.db.query('signingTickets').withIndex('by_thread', (q) => q.eq('threadId', threadId)).filter((q) => q.eq(q.field('build'), build)).first();
    if (used) throw new Error(`Build ${build} was already given its key.`);
    await ctx.db.insert('signingTickets', { threadId, appId: app._id, build, usedAt: Date.now(), expiresAt: Date.now() + TICKET_MS });
    const plain = await envelopeOpen(key, aadOf(app._id, app.packageName));
    const k = JSON.parse(new TextDecoder().decode(plain)) as { p12: string; storePassword: string; keyAlias: string };
    plain.fill(0);
    return { ...k, certSha256: key.certSha256 };
  },
});

/** The signing log: what was signed for which build (shown in the app's Settings). */
export const signed = internalMutation({
  args: { threadId: v.id('threads'), build: v.number(), files: v.array(v.object({ what: v.string(), sha256: v.string() })) },
  handler: async (ctx, { threadId, build, files }) => {
    const t = (await ctx.db.get(threadId))!;
    for (const f of files) await ctx.db.insert('signings', { appId: t.appId, build, sha256: f.sha256, what: f.what.slice(0, 40), at: Date.now() });
  },
});

