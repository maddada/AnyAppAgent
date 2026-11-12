// Milestone 9: changes while the PC is off (docs/CLOUD.md section 3). The PC keeps its apps ready
// (code and key in the cloud), the phone runs a change in the cloud on the PC app's package and key,
// and the PC pulls it back. The PC is played through its PC link; GitHub is a fake fetch.
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


async function keepReady(pc: Awaited<ReturnType<typeof setup>>["pc"]) {
  const r = await pc("/pc/ready", { pcAppId: "pc-uuid", name: "Tea Timer", slug: "teatimer", packageName: "com.anyapp.teatimer", preset: "react-native", buildHigh: 4 });
  expect(r.status).toBe(200);
  expect(r.body).toMatchObject({ off: false, hasKey: false, pushedCommit: null, pcOff: null, repo: "octo/anyapp-cloud-teatimer" });
  const appId = r.body.appId as string;
  expect((await pc("/pc/ready/repo-token", { appId })).body).toMatchObject({ token: "ghs_onerepo" });
  pushed = SHA;
  expect((await pc("/pc/ready/code", { appId, commit: SHA })).status).toBe(200);
  const { publicRaw } = (await pc("/pc/move/transport-key")).body;
  const box = await sealTo(publicRaw, enc.encode(JSON.stringify({ p12: btoa("PKCS12"), storePassword: "store-pass-plain", keyAlias: "app" })), `appkey-ready:${appId}`);
  expect((await pc("/pc/ready/key", { appId, box, certSha256: CERT })).body).toMatchObject({ stored: true });
  return appId;
}

describe("keeping PC apps ready", () => {
  test("nothing goes up while the switch is off; with it on, the row stays the PC's and is not in the cloud list", async () => {
    const { t, as, pc } = await setup();
    expect((await pc("/pc/ready", { pcAppId: "pc-uuid", name: "Tea Timer", slug: "teatimer", packageName: "com.anyapp.teatimer", buildHigh: 4 })).body).toEqual({ off: true });
    await as.mutation(api.accounts.setPcOffSwitch, { on: true });
    const appId = await keepReady(pc);
    expect(await as.query(api.apps.list, {})).toEqual([]);
    expect((await t.run((ctx) => ctx.db.get(appId as Id<"apps">)))!).toMatchObject({ place: "pc", keptReady: true, pushedCommit: SHA, buildHigh: 4 });
    // Refreshing it is the same row; its key is never replaced by another.
    expect((await pc("/pc/ready", { pcAppId: "pc-uuid", name: "Tea Timer", slug: "teatimer", packageName: "com.anyapp.teatimer", buildHigh: 5 })).body).toMatchObject({ appId, hasKey: true, pushedCommit: SHA });
  });
});

describe("a change while the PC is off", () => {
  test("offered with its estimate, runs in the cloud on the PC app's row, then comes back", async () => {
    const { t, as, pc } = await setup();
    expect(await as.query(api.pcoff.offer, { packageName: "com.anyapp.teatimer" })).toMatchObject({ ready: false });
    await as.mutation(api.accounts.setPcOffSwitch, { on: true });
    const appId = await keepReady(pc);
    const offer = await as.query(api.pcoff.offer, { packageName: "com.anyapp.teatimer" });
    expect(offer).toMatchObject({ ready: true, appId, pcOff: null });
    expect(offer!.estimate.millicredits).toBeGreaterThan(0);
    await as.mutation(api.pcoff.change, { packageName: "com.anyapp.teatimer", text: "Add a green tea preset" });
    const row = (await t.run((ctx) => ctx.db.get(appId as Id<"apps">)))!;
    expect(row.place).toBe("pc");
    expect(row.pcOff).toBeTruthy();
    const inbox = await t.run((ctx) => ctx.db.query("inbox").collect());
    expect(inbox).toEqual([expect.objectContaining({ kind: "prompt", payload: expect.objectContaining({ text: "Add a green tea preset", pcOff: true }) })]);
    // The runner's hello restores it from GitHub on the PC app's package and key.
    const thread = (await t.run((ctx) => ctx.db.query("threads").first()))!;
    expect(await t.mutation(internal.runner.hello, { threadId: thread._id })).toMatchObject({ restore: true, packageName: "com.anyapp.teatimer", certSha256: CERT });
    // The cloud is busy with it: the PC waits; then the PC pulls it back.
    expect((await pc("/pc/pull-back/list")).body.apps).toEqual([expect.objectContaining({ appId, busy: true, packageName: "com.anyapp.teatimer" })]);
    await t.run(async (ctx) => {
      for (const c of await ctx.db.query("changes").collect()) await ctx.db.patch(c._id, { state: "done" });
      await ctx.db.insert("messages", { threadId: thread._id, itemId: "agent-1", seq: 50, item: { id: "agent-1", appId, seq: 50, kind: "assistant", text: "Added a green tea preset.", createdAt: "", updatedAt: "" }, updatedAt: Date.now() });
      await ctx.db.patch(appId as Id<"apps">, { buildHigh: 5 });
    });
    const list = (await pc("/pc/pull-back/list")).body.apps;
    expect(list).toEqual([expect.objectContaining({ appId, busy: false, buildHigh: 5 })]);
    const chat = (await pc("/pc/pull-back/chat", { appId })).body.items.map((i: { text?: string }) => i.text);
    expect(chat).toContain("Added a green tea preset.");
    expect((await pc("/pc/pull-back/done", { appId, commit: SHA })).body).toEqual({ buildHigh: 5 });
    expect((await t.run((ctx) => ctx.db.get(appId as Id<"apps">)))!.pcOff).toBeUndefined();
    expect((await pc("/pc/pull-back/list")).body.apps).toEqual([]);
  });

  test("refused without the switch, or before the app is ready in the cloud", async () => {
    const { as } = await setup();
    await expect(as.mutation(api.pcoff.change, { packageName: "com.anyapp.teatimer", text: "x" })).rejects.toThrow(/Turn on/);
    await as.mutation(api.accounts.setPcOffSwitch, { on: true });
    await expect(as.mutation(api.pcoff.change, { packageName: "com.anyapp.teatimer", text: "x" })).rejects.toThrow(/not ready in the cloud/);
  });
});
