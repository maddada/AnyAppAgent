// Milestone 5: keys and secrets (docs/CLOUD.md section 6): envelopes, the key transport between
// Convex and a box, one-time signing tickets, the signing log, the person's secrets sealed.
import { convexTest } from 'convex-test';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { api, internal } from '../convex/_generated/api';
import type { Id } from '../convex/_generated/dataModel';
import schema from '../convex/schema';
import { envelopeOpen, envelopeSeal, openSecret, seal, sealSecret, sha256Hex } from '../convex/lib/crypto';
import { newTransportKey, openWith, sealTo } from '../convex/lib/transport';

const modules = import.meta.glob('../convex/**/*.*s');
const enc = new TextEncoder();
const dec = new TextDecoder();

let transport: Awaited<ReturnType<typeof newTransportKey>>;
beforeEach(async () => {
  vi.stubEnv('KEYS_KEK', btoa(String.fromCharCode(...new Uint8Array(32).fill(9))));
  vi.stubEnv('RUNNER_POLL_MS', '0');
  transport = await newTransportKey();
  vi.stubEnv('KEYS_TRANSPORT_PRIVATE', transport.privatePkcs8);
  vi.stubEnv('KEYS_TRANSPORT_PUBLIC', transport.publicRaw);
});

describe('envelopes', () => {
  test('a fresh data key per item, wrapped by the master key; the row is bound to its owner', async () => {
    const a = await envelopeSeal(enc.encode('the key'), 'appkey:A:com.x');
    const b = await envelopeSeal(enc.encode('the key'), 'appkey:A:com.x');
    expect(a.kekVersion).toBe(1);
    expect(a.wrappedDataKey).not.toBe(b.wrappedDataKey);
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(dec.decode(await envelopeOpen(a, 'appkey:A:com.x'))).toBe('the key');
    // Copied to another app: it does not open.
    await expect(envelopeOpen(a, 'appkey:B:com.x')).rejects.toThrow();
    // Another master key: nothing opens.
    vi.stubEnv('KEYS_KEK', btoa(String.fromCharCode(...new Uint8Array(32).fill(1))));
    await expect(envelopeOpen(a, 'appkey:A:com.x')).rejects.toThrow();
  });

  test('secrets: envelopes, and an older row sealed directly still opens', async () => {
    const env = await sealSecret('sk-ant-secret', 'anthropic:u1');
    expect(env.wrappedDataKey).toBeTruthy();
    expect(await openSecret(env, 'anthropic:u1')).toBe('sk-ant-secret');
    const legacy = await seal('ghu_old', 'github:access:u1');
    expect(await openSecret(legacy, 'github:access:u1')).toBe('ghu_old');
  });
});

describe('the key transport', () => {
  test('sealed to a key, opened only with it and only for the same purpose', async () => {
    const box = await sealTo(transport.publicRaw, enc.encode('p12 bytes'), 'appkey-upload:t1');
    expect(dec.decode(await openWith(transport.key, box, 'appkey-upload:t1'))).toBe('p12 bytes');
    await expect(openWith(transport.key, box, 'appkey-upload:t2')).rejects.toThrow();
    const other = await newTransportKey();
    await expect(openWith(other.key, box, 'appkey-upload:t1')).rejects.toThrow();
  });
});

describe('keys and tickets', () => {
  async function setup() {
    const t = convexTest(schema, modules);
    const userId = await t.run((ctx) => ctx.db.insert('users', { email: 'a@example.com', githubLogin: 'a', githubInstallationId: '1' }));
    const as = t.withIdentity({ subject: `${userId}|s` });
    const appId = (await as.mutation(api.apps.create, { name: 'Tip Split', prompt: 'tips' })) as Id<'apps'>;
    const thread = (await t.run((ctx) => ctx.db.query('threads').withIndex('by_app', (q) => q.eq('appId', appId)).first()))!;
    const token = 'runner-token-for-tests-0123456789';
    await t.mutation(internal.boxes.setRunnerHash, { threadId: thread._id, hash: await sha256Hex(token) });
    await t.run((ctx) => ctx.db.patch(thread._id, { boxState: 'running' }));
    const post = (path: string, body: unknown = {}) => t.fetch(path, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { t, as, appId, thread, post };
  }
  const CERT = 'c'.repeat(64);

  test('a new key goes up sealed, is kept in an envelope, never replaced; each build gets one ticket', async () => {
    const { t, as, appId, thread, post } = await setup();
    const { publicRaw } = await (await post('/runner/transport-key')).json();
    expect(publicRaw).toBe(transport.publicRaw);
    const inner = JSON.stringify({ p12: btoa('PKCS12'), storePassword: 'pw', keyAlias: 'app' });
    const box = await sealTo(publicRaw, enc.encode(inner), `appkey-upload:${thread._id}`);
    expect(await (await post('/runner/key', { box, certSha256: CERT })).json()).toMatchObject({ stored: true });
    const row = (await t.run((ctx) => ctx.db.query('keys').first()))!;
    expect(row).toMatchObject({ kekVersion: 1, certSha256: CERT });
    expect(JSON.stringify(row)).not.toContain('pw');
    // A box sealed for another thread does not open here.
    const wrong = await sealTo(publicRaw, enc.encode(inner), 'appkey-upload:other');
    expect((await post('/runner/key', { box: wrong, certSha256: CERT })).status).toBe(500);
    // A different key for the same app is refused.
    const second = await sealTo(publicRaw, enc.encode(inner), `appkey-upload:${thread._id}`);
    expect((await post('/runner/key', { box: second, certSha256: 'd'.repeat(64) })).status).toBe(500);

    // The ticket: sealed to the runner's one-time key; once per build.
    const once = await newTransportKey();
    const res = await (await post('/runner/sign-ticket', { build: 1, runnerKey: once.publicRaw })).json();
    const got = JSON.parse(dec.decode(await openWith(once.key, res.box, `ticket:${thread._id}:1`)));
    expect(got).toMatchObject({ storePassword: 'pw', keyAlias: 'app' });
    expect((await post('/runner/sign-ticket', { build: 1, runnerKey: once.publicRaw })).status).toBe(500);

    // The signing log, for the owner.
    await post('/runner/signed', { build: 1, files: [{ what: 'apk universal', sha256: 'a' }, { what: 'apk x86_64', sha256: 'b' }] });
    const log = await as.query(api.signing.log, { appId });
    expect(log).toMatchObject({ certSha256: CERT, builds: [{ build: 1, files: 2 }] });
  });
});
