// App signing keys (docs/CLOUD.md section 6). The runner makes a new app's key before the agent
// starts on it and hands it here once; it is kept sealed (envelope), never deleted. A build is
// signed with a one-time ticket: the runner asks for that build's ticket, gets the key once, signs
// on a tmpfs as another Unix user than the agent's, and reports what it signed (the signing log).
import { v } from 'convex/values';
import { internalMutation, internalQuery, query } from './_generated/server';
import { ownApp, requireUser } from './lib/session';
import { envelopeOpen, envelopeSeal, type Envelope } from './lib/crypto';
import { importPrivate, openWith, sealTo, type Sealed } from './lib/transport';

/** Convex's transport key (KEYS_TRANSPORT_PRIVATE, PKCS#8 base64; its public half in KEYS_TRANSPORT_PUBLIC). */
async function transportKey() {
  const k = process.env.KEYS_TRANSPORT_PRIVATE;
  if (!k) throw new Error('KEYS_TRANSPORT_PRIVATE is not set');
  return importPrivate(k);
}
const sealedArg = v.object({ epk: v.string(), iv: v.string(), ct: v.string() });

const aadOf = (appId: string, packageName: string) => `appkey:${appId}:${packageName}`;
const TICKET_MS = 10 * 60_000;

export const keyOf = internalQuery({
  args: { appId: v.id('apps') },
  handler: async (ctx, { appId }) => ctx.db.query('keys').withIndex('by_app', (q) => q.eq('appId', appId)).first(),
});

/**
 * Stores a new app's key, sealed by the runner to Convex's transport key (its PKCS12 bytes as
 * base64, password and alias inside). Refused when the app has one already.
 */
export const storeKey = internalMutation({
  args: { threadId: v.id('threads'), box: sealedArg, certSha256: v.string() },
  handler: async (ctx, { threadId, box, certSha256 }) => {
    const inner = JSON.parse(new TextDecoder().decode(await openWith(await transportKey(), box as Sealed, `appkey-upload:${threadId}`))) as { p12: string; storePassword: string; keyAlias: string };
    const a = { threadId, certSha256, ...inner };
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

/**
 * A one-time ticket for one build: the key, opened once, sealed to the one-time key the runner
 * made for this request, so only that runner process can read it.
 */
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
    // The envelope leaves here still sealed; the HTTP action opens it and seals it to the runner
    // (Convex allows no key generation in a mutation).
    return {
      envelope: { wrappedDataKey: key.wrappedDataKey, iv: key.iv, ciphertext: key.ciphertext, kekVersion: key.kekVersion },
      aad: aadOf(app._id, app.packageName),
      certSha256: key.certSha256,
    };
  },
});

/** The ticket for the runner: the key opened from its envelope and sealed to the runner's one-time key. */
export async function sealTicket(t: { envelope: Envelope; aad: string; certSha256: string }, threadId: string, build: number, runnerKey: string) {
  const plain = await envelopeOpen(t.envelope, t.aad);
  const box = await sealTo(runnerKey, plain, `ticket:${threadId}:${build}`);
  plain.fill(0);
  return { box, certSha256: t.certSha256 };
}

/** The signing log: what was signed for which build (shown in the app's Settings). */
export const signed = internalMutation({
  args: { threadId: v.id('threads'), build: v.number(), files: v.array(v.object({ what: v.string(), sha256: v.string() })) },
  handler: async (ctx, { threadId, build, files }) => {
    const t = (await ctx.db.get(threadId))!;
    for (const f of files) await ctx.db.insert('signings', { appId: t.appId, build, sha256: f.sha256, what: f.what.slice(0, 40), at: Date.now() });
  },
});


/** The signing log for the app's owner (shown in the app's sheet): which builds were signed, by which key. */
export const log = query({
  args: { appId: v.string() },
  handler: async (ctx, { appId }) => {
    const user = await requireUser(ctx);
    const app = await ownApp(ctx, user._id, appId);
    const key = await ctx.db.query('keys').withIndex('by_app', (q) => q.eq('appId', app._id)).first();
    const rows = await ctx.db.query('signings').withIndex('by_app', (q) => q.eq('appId', app._id)).order('desc').take(60);
    const builds = new Map<number, { build: number; at: number; files: number }>();
    for (const r of rows) {
      const b = builds.get(r.build) ?? { build: r.build, at: r.at, files: 0 };
      b.files++;
      builds.set(r.build, b);
    }
    return { certSha256: key?.certSha256 ?? null, keySince: key?.at ?? null, builds: [...builds.values()].slice(0, 10) };
  },
});
