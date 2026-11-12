// Milestone 8: moving apps between a PC and the cloud (docs/CLOUD.md section 3, "Moving an app").
// The PC side is played here through its PC link; GitHub is a fake fetch. Both ways, resuming a
// move, the checks (code on GitHub, the key, the chat), and nothing given up before the end.
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { api, internal } from '../convex/_generated/api';
import type { Id } from '../convex/_generated/dataModel';
import schema from '../convex/schema';
import { seal } from '../convex/lib/crypto';
import { newTransportKey, openWith, sealTo } from '../convex/lib/transport';

const modules = import.meta.glob('../convex/**/*.*s');
const enc = new TextEncoder();
const dec = new TextDecoder();
const SHA = 'a'.repeat(40);
const CERT = 'c'.repeat(64);

let transport: Awaited<ReturnType<typeof newTransportKey>>;
let pushed: string | null = null;
beforeEach(async () => {
  vi.stubEnv('KEYS_KEK', btoa(String.fromCharCode(...new Uint8Array(32).fill(4))));
  vi.stubEnv('RUNNER_POLL_MS', '0');
  vi.stubEnv('INSTABOX_API_KEY', 'test');
  transport = await newTransportKey();
  vi.stubEnv('KEYS_TRANSPORT_PRIVATE', transport.privatePkcs8);
  vi.stubEnv('KEYS_TRANSPORT_PUBLIC', transport.publicRaw);
  vi.stubEnv('GITHUB_APP_ID', '9');
  vi.stubEnv('GITHUB_APP_CLIENT_ID', 'Iv1.client');
  vi.stubEnv('GITHUB_APP_CLIENT_SECRET', 'secret');
  const rsa = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', rsa.privateKey));
  vi.stubEnv('GITHUB_APP_PRIVATE_KEY', `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...der))}\n-----END PRIVATE KEY-----`);
  pushed = null;
  // GitHub: making a repo, a one-repo token, and the repo's main after the PC pushed.
  vi.stubGlobal('fetch', async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input instanceof Request ? input.url : input);
    const ok = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    if (url === 'https://api.github.com/user/repos' && init.method === 'POST') {
      const name = JSON.parse(String(init.body)).name as string;
      return ok(201, { full_name: `octo/${name}` });
    }
    if (/\/app\/installations\/555\/access_tokens$/.test(url)) return ok(201, { token: 'ghs_onerepo', expires_at: new Date(Date.now() + 3600_000).toISOString() });
    if (/\/repos\/octo\/[^/]+\/commits\/main$/.test(url)) return pushed ? ok(200, { sha: pushed }) : ok(409, { message: 'Git Repository is empty.' });
    return ok(404, { message: 'not found' });
  });
});
afterEach(() => vi.unstubAllGlobals());

async function setup() {
  const t = convexTest(schema, modules);
  const userId = await t.run((ctx) => ctx.db.insert('users', { email: 'a@example.com' }));
  await t.mutation(internal.github.saveToken, {
    userId,
    login: 'octo',
    githubUserId: 77,
    installationId: '555',
    access: await seal('ghu_live', `github:access:${userId}`),
    expiresAt: Date.now() + 8 * 3600_000,
  });
  const as = t.withIdentity({ subject: `${userId}|s` });
  const { token } = await as.mutation(api.accounts.createPcLink, { deviceName: 'MADDA-PC', linkedFrom: 'phone' });
  const pc = async (path: string, body: unknown = {}) => {
    const res = await t.fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
    return { status: res.status, body: (await res.json()) as Record<string, any> };
  };
  return { t, userId, as, pc, token };
}

const chatItem = (seq: number, text: string) => ({ id: `item-${seq}`, appId: 'pc-uuid', seq, kind: seq % 2 ? 'user' : 'assistant', text, createdAt: '2026-11-01T10:00:00Z', updatedAt: '2026-11-01T10:00:00Z' });

async function moveToCloud(pc: Awaited<ReturnType<typeof setup>>['pc']) {
  const start = await pc('/pc/move/to-cloud', { pcAppId: 'pc-uuid', name: 'Tea Timer', slug: 'teatimer', packageName: 'com.anyapp.teatimer', preset: 'react-native', buildHigh: 7 });
  expect(start.status).toBe(200);
  const { moveId } = start.body;
  expect(start.body.repo).toBe('octo/anyapp-cloud-teatimer');
  // Code: a one-repo token, the push, then Convex checks main has that commit.
  const tok = await pc('/pc/move/repo-token', { moveId });
  expect(tok.body).toMatchObject({ token: 'ghs_onerepo', repo: 'octo/anyapp-cloud-teatimer' });
  expect((await pc('/pc/move/code', { moveId, commit: SHA })).status).toBe(409);
  pushed = SHA;
  expect((await pc('/pc/move/code', { moveId, commit: SHA })).status).toBe(200);
  // Key: sealed to Convex's transport key for this move only.
  const { publicRaw } = (await pc('/pc/move/transport-key')).body;
  const inner = JSON.stringify({ p12: btoa('PKCS12-bytes'), storePassword: 'store-pass-plain', keyAlias: 'app' });
  const wrongBox = await sealTo(publicRaw, enc.encode(inner), 'appkey-move:other');
  expect((await pc('/pc/move/key', { moveId, box: wrongBox, certSha256: CERT })).status).toBe(409);
  const box = await sealTo(publicRaw, enc.encode(inner), `appkey-move:${moveId}`);
  expect((await pc('/pc/move/key', { moveId, box, certSha256: CERT })).body).toMatchObject({ stored: true });
  return { moveId, inner };
}

describe('to the cloud', () => {
  test('repo, code, key, chat and to-dos, then the cloud takes over with the same package', async () => {
    const { t, as, pc } = await setup();
    const { moveId } = await moveToCloud(pc);
    // Not finished before the chat is there; the app is not in the cloud's list yet.
    expect((await pc('/pc/move/finish', { moveId, buildHigh: 7 })).body.error).toMatch(/chat still to go/);
    expect(await as.query(api.apps.list, {})).toEqual([]);
    await pc('/pc/move/chat', { moveId, items: [chatItem(1, 'Make a tea timer'), chatItem(2, 'Done: a tea timer.')], last: false });
    await pc('/pc/move/chat', { moveId, items: [chatItem(3, 'Add a green tea preset')], todos: [{ id: 't1', text: 'Try oolong', done: false, createdAt: '2026-11-02T09:00:00Z' }], last: true });
    const done = await pc('/pc/move/finish', { moveId, buildHigh: 7 });
    expect(done.body).toMatchObject({ place: 'cloud' });
    const apps = await as.query(api.apps.list, {});
    expect(apps).toHaveLength(1);
    expect(apps[0]).toMatchObject({ name: 'Tea Timer', packageName: 'com.anyapp.teatimer', cloud: { place: 'cloud', repo: 'octo/anyapp-cloud-teatimer' } });
    const appId = apps[0]!.id as Id<'apps'>;
    const row = (await t.run((ctx) => ctx.db.get(appId)))!;
    expect(row).toMatchObject({ buildHigh: 7, pushedCommit: SHA, pcAppId: 'pc-uuid' });
    // The chat reads as the cloud app's (ids rewritten), to-dos too; the key is sealed in an envelope.
    const msgs = await as.query(api.chat.messages, { appId });
    expect(msgs.map((m: { text?: string }) => m.text)).toEqual(['Make a tea timer', 'Done: a tea timer.', 'Add a green tea preset']);
    expect(msgs.every((m: { appId: string }) => m.appId === appId)).toBe(true);
    expect(await t.run((ctx) => ctx.db.query('todos').collect())).toEqual([expect.objectContaining({ text: 'Try oolong', done: false })]);
    const key = (await t.run((ctx) => ctx.db.query('keys').first()))!;
    expect(JSON.stringify(key)).not.toContain('store-pass-plain');
    // The runner's hello for the new box restores from GitHub with the next build above 7.
    const thread = (await t.run((ctx) => ctx.db.query('threads').first()))!;
    expect(await t.mutation(internal.runner.hello, { threadId: thread._id })).toMatchObject({ restore: true, buildHigh: 7, certSha256: CERT, packageName: 'com.anyapp.teatimer' });
  });

  test('a move that stopped halfway is resumed from its row; a second app with the package is refused', async () => {
    const { pc } = await setup();
    const first = await pc('/pc/move/to-cloud', { pcAppId: 'pc-uuid', name: 'Tea Timer', slug: 'teatimer', packageName: 'com.anyapp.teatimer', buildHigh: 3 });
    const again = await pc('/pc/move/to-cloud', { pcAppId: 'pc-uuid', name: 'Tea Timer', slug: 'teatimer', packageName: 'com.anyapp.teatimer', buildHigh: 3 });
    expect(again.body).toMatchObject({ moveId: first.body.moveId, resumed: true, repo: first.body.repo });
    expect(again.body.steps).toEqual({});
  });

  test('a link without the move scope, or another account, gets nowhere', async () => {
    const { t, pc, token } = await setup();
    const link = (await t.run((ctx) => ctx.db.query('pcLinks').first()))!;
    await t.run((ctx) => ctx.db.patch(link._id, { scopes: ['share'] }));
    expect((await pc('/pc/move/to-cloud', { pcAppId: 'x', name: 'X', slug: 'x', packageName: 'com.anyapp.x', buildHigh: 1 })).status).toBe(403);
    expect(token).toMatch(/^kpc_/);
  });
});

describe('to the PC', () => {
  test('the key comes down sealed to the PC, then the chat; the row becomes the PC app and its box goes', async () => {
    const { t, as, pc } = await setup();
    const { moveId: up, inner } = await moveToCloud(pc);
    await pc('/pc/move/chat', { moveId: up, items: [chatItem(1, 'Make a tea timer'), chatItem(2, 'Done.')], todos: [{ text: 'Try oolong', done: true }], last: true });
    const appId = (await pc('/pc/move/finish', { moveId: up, buildHigh: 7 })).body.appId as string;
    await t.run(async (ctx) => {
      const th = (await ctx.db.query('threads').first())!;
      await ctx.db.patch(th._id, { busy: true });
    });
    expect((await pc('/pc/move/to-pc', { appId })).body.error).toMatch(/working on a change/);
    await t.run(async (ctx) => {
      const th = (await ctx.db.query('threads').first())!;
      await ctx.db.patch(th._id, { busy: false });
    });
    const start = await pc('/pc/move/to-pc', { appId });
    expect(start.body).toMatchObject({ name: 'Tea Timer', slug: 'teatimer', packageName: 'com.anyapp.teatimer', repo: 'octo/anyapp-cloud-teatimer', buildHigh: 7, certSha256: CERT });
    const moveId = start.body.moveId as string;
    // The cloud refuses changes while it moves.
    await expect(as.mutation(api.chat.send, { appId, text: 'one more thing' })).rejects.toThrow(/moving/);
    const pcKey = await newTransportKey();
    const down = await pc('/pc/move/key-down', { moveId, pcKey: pcKey.publicRaw });
    expect(dec.decode(await openWith(pcKey.key, down.body.box, `appkey-down:${moveId}`))).toBe(inner);
    const chat = (await pc('/pc/move/chat-down', { moveId })).body;
    expect(chat.items.map((i: { text: string }) => i.text)).toEqual(['Make a tea timer', 'Done.']);
    expect(chat.todos).toEqual([expect.objectContaining({ text: 'Try oolong', done: true })]);
    expect((await pc('/pc/move/finish', { moveId, pcAppId: 'pc-new' })).body.error).toMatch(/still to go/);
    for (const step of ['code', 'key', 'chat']) await pc('/pc/move/step', { moveId, step });
    expect((await pc('/pc/move/finish', { moveId, pcAppId: 'pc-new' })).body).toMatchObject({ place: 'pc' });
    expect(await as.query(api.apps.list, {})).toEqual([]);
    expect((await t.run((ctx) => ctx.db.get(appId as Id<'apps'>)))!).toMatchObject({ place: 'pc', pcAppId: 'pc-new' });
    await expect(as.mutation(api.chat.send, { appId, text: 'hello' })).rejects.toThrow(/made on your PC/);
  });
});
