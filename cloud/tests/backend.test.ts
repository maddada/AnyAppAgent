// Milestone 1: the Convex backend (docs/CLOUD.md section 10). Runs the real functions against
// convex-test's in-memory backend; nothing reaches Instabox (box actions are scheduled, not run).
import { convexTest } from 'convex-test';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { api, internal } from '../convex/_generated/api';
import type { Id } from '../convex/_generated/dataModel';
import schema from '../convex/schema';
import { hmacSha256B64, sha256Hex } from '../convex/lib/crypto';

const modules = import.meta.glob('../convex/**/*.*s');

async function setup() {
  const t = convexTest(schema, modules);
  const userId = await t.run((ctx) => ctx.db.insert('users', { email: 'a@example.com', name: 'A' }));
  const as = t.withIdentity({ subject: `${userId}|session1` });
  return { t, userId, as };
}

async function makeApp(as: ReturnType<typeof convexTest>, name = 'Prayer Alarm') {
  return (await as.mutation(api.apps.create, { name, prompt: 'Prayer times for Ajman with an alarm' })) as Id<'apps'>;
}

async function threadOf(t: ReturnType<typeof convexTest>, appId: Id<'apps'>) {
  return t.run(async (ctx) => (await ctx.db.query('threads').withIndex('by_app', (q) => q.eq('appId', appId)).first())!);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv('RUNNER_POLL_MS', '0');
});

describe('apps', () => {
  test('making an app writes the app, its thread, the first prompt and a pending chat row', async () => {
    const { t, as } = await setup();
    const appId = await makeApp(as);
    const apps = await as.query(api.apps.list, {});
    expect(apps).toHaveLength(1);
    expect(apps[0]).toMatchObject({ id: appId, name: 'Prayer Alarm', slug: 'prayeralarm', packageName: 'com.anyappcloud.prayeralarm', status: 'creating', cloud: { place: 'cloud' } });
    const thread = await threadOf(t, appId);
    expect(thread.boxState).toBe('none');
    const inbox = await t.run((ctx) => ctx.db.query('inbox').collect());
    expect(inbox).toHaveLength(1);
    expect(inbox[0].payload.create.packageName).toBe('com.anyappcloud.prayeralarm');
    const chat = await as.query(api.chat.messages, { appId });
    expect(chat).toHaveLength(1);
    expect(chat[0]).toMatchObject({ kind: 'user', text: 'Prayer times for Ajman with an alarm', queued: true, appId });
  });

  test('a second app with the same name gets the next free slug and package', async () => {
    const { as } = await setup();
    await makeApp(as);
    await makeApp(as);
    const apps = await as.query(api.apps.list, {});
    expect(apps.map((a) => a.packageName).sort()).toEqual(['com.anyappcloud.prayeralarm', 'com.anyappcloud.prayeralarm2']);
  });

  test('another person cannot see or touch the app', async () => {
    const { t, as } = await setup();
    const appId = await makeApp(as);
    const otherId = await t.run((ctx) => ctx.db.insert('users', { email: 'b@example.com' }));
    const other = t.withIdentity({ subject: `${otherId}|s` });
    expect(await other.query(api.apps.list, {})).toEqual([]);
    await expect(other.query(api.chat.messages, { appId })).rejects.toThrow(/not here/);
    await expect(other.mutation(api.chat.send, { appId, text: 'hi' })).rejects.toThrow(/not here/);
  });

  test('signed out: the grid is empty and sending is refused', async () => {
    const { t, as } = await setup();
    const appId = await makeApp(as);
    expect(await t.query(api.apps.list, {})).toEqual([]);
    await expect(t.mutation(api.chat.send, { appId, text: 'hi' })).rejects.toThrow(/Sign in/);
  });
});

describe('credits on the first cloud change', () => {
  test('a Free subscription and 3 free credits, once a month', async () => {
    const { t, as, userId } = await setup();
    expect((await as.query(api.accounts.me, {}))!.credits).toBe(0);
    const appId = await makeApp(as);
    await as.mutation(api.chat.send, { appId, text: 'make it green' });
    const me = await as.query(api.accounts.me, {});
    expect(me!.credits).toBe(3);
    expect(me!.plan.id).toBe('free');
    const grants = await t.run((ctx) => ctx.db.query('grants').collect());
    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatchObject({ userId, source: 'free', millicredits: 3000, remaining: 3000 });
    const ledger = await t.run((ctx) => ctx.db.query('ledger').collect());
    expect(ledger).toMatchObject([{ kind: 'grant', millicredits: 3000 }]);
    // Next month: a new grant.
    vi.setSystemTime(new Date(Date.now() + 40 * 24 * 3600_000));
    await as.mutation(api.chat.send, { appId, text: 'and blue' });
    expect(await t.run((ctx) => ctx.db.query('grants').collect())).toHaveLength(2);
  });

  test('one free allowance per GitHub account', async () => {
    const { t, as, userId } = await setup();
    const twinId = await t.run(async (ctx) => {
      await ctx.db.patch(userId, { githubUserId: 42 });
      return ctx.db.insert('users', { email: 'twin@example.com', githubUserId: 42 });
    });
    await makeApp(as);
    const twin = t.withIdentity({ subject: `${twinId}|s` });
    await makeApp(twin);
    expect((await twin.query(api.accounts.me, {}))!.credits).toBe(0);
    expect((await as.query(api.accounts.me, {}))!.credits).toBe(3);
  });
});

describe('the runner', () => {
  async function withRunner() {
    const s = await setup();
    const appId = await makeApp(s.as);
    const thread = await threadOf(s.t, appId);
    const token = 'runner-token-for-tests-0123456789';
    await s.t.run((ctx) => ctx.db.patch(thread._id, { boxState: 'running', runnerTokenHash: '' }));
    await s.t.mutation(internal.boxes.setRunnerHash, { threadId: thread._id, hash: await sha256Hex(token) });
    const post = (path: string, body: unknown = {}, tok = token) =>
      s.t.fetch(path, { method: 'POST', headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { ...s, appId, thread, token, post };
  }

  test('a row whose answer was lost is offered again after its lease; an acknowledged one never', async () => {
    const { post } = await withRunner();
    const first = await (await post('/runner/take')).json();
    expect(first.item.kind).toBe('prompt');
    // The answer never reached the box (it paused mid-poll): nothing else is offered meanwhile.
    vi.setSystemTime(new Date(Date.now() + 10_000));
    expect((await (await post('/runner/take')).json()).item).toBeNull();
    vi.setSystemTime(new Date(Date.now() + 60_000));
    const again = await (await post('/runner/take')).json();
    expect(again.item.id).toBe(first.item.id);
    await post('/runner/ack', { ids: [again.item.id] });
    vi.setSystemTime(new Date(Date.now() + 120_000));
    expect((await (await post('/runner/take')).json()).item).toBeNull();
  });

  test('a wrong token is refused', async () => {
    const { post } = await withRunner();
    const res = await post('/runner/hello', {}, 'not-the-token-xxxxxxxxxxxxxxx');
    expect(res.status).toBe(401);
  });

  test('hello, take, events: the phone sees the runner’s chat', async () => {
    const { as, appId, post } = await withRunner();
    const hello = await (await post('/runner/hello')).json();
    expect(hello).toMatchObject({ appId, slug: 'prayeralarm', packageName: 'com.anyappcloud.prayeralarm', aiMode: 'credit', buildHigh: 0 });
    const take = await (await post('/runner/take')).json();
    expect(take.item).toMatchObject({ kind: 'prompt', payload: { text: 'Prayer times for Ajman with an alarm', create: { slug: 'prayeralarm' } } });
    const now = new Date().toISOString();
    const user = { id: 'u1', appId: 'local', seq: 1, kind: 'user', text: 'Prayer times for Ajman with an alarm', createdAt: now, updatedAt: now };
    const reply = { id: 'a1', appId: 'local', seq: 2, kind: 'assistant', text: 'On it', streaming: true, createdAt: now, updatedAt: now };
    let res = await post('/runner/events', {
      events: [
        { type: 'inbox.done', inboxId: take.item.id },
        { type: 'chat.item', item: user },
        { type: 'chat.item', item: reply },
        { type: 'app.updated', app: { id: 'local', status: 'working', replying: true } },
        { type: 'runner.state', busy: true, agentSessionId: 'sess-1' },
      ],
    });
    expect(res.status).toBe(200);
    // The streamed text grows: the same item id is updated in place.
    res = await post('/runner/events', { events: [{ type: 'chat.item', item: { ...reply, text: 'On it. Done.', streaming: false } }] });
    const chat = await as.query(api.chat.messages, { appId });
    expect(chat.map((c) => [c.id, c.kind, c.text])).toEqual([
      ['u1', 'user', 'Prayer times for Ajman with an alarm'],
      ['a1', 'assistant', 'On it. Done.'],
    ]);
    expect(chat.every((c) => c.appId === appId)).toBe(true);
    const app = await as.query(api.apps.get, { appId });
    expect(app).toMatchObject({ status: 'working', replying: true });
    expect(await as.query(api.chat.box, { appId })).toMatchObject({ state: 'running', busy: true });
  });

  test('helpers: their rows and their own chats', async () => {
    const { as, appId, post } = await withRunner();
    const now = new Date().toISOString();
    const worker = { id: 'w1', appId: 'local', title: 'Make the button green', state: 'working', changesApp: true, createdAt: now, updatedAt: now };
    await post('/runner/events', {
      events: [
        { type: 'worker.updated', worker },
        { type: 'worker.item', item: { id: 'wi1', appId: 'local', seq: 1, kind: 'assistant', text: 'Looking', workerId: 'w1', createdAt: now, updatedAt: now } },
      ],
    });
    expect(await as.query(api.chat.helpers, { appId })).toMatchObject([{ id: 'w1', appId, title: 'Make the button green' }]);
    expect(await as.query(api.chat.messages, { appId, workerId: 'w1' })).toMatchObject([{ id: 'wi1', text: 'Looking' }]);
    // The main chat still has only the pending prompt.
    expect(await as.query(api.chat.messages, { appId })).toHaveLength(1);
  });

  test('builds: the newest is the app’s APK, only the last 3 keep their files', async () => {
    const { t, as, appId, post } = await withRunner();
    for (let n = 1; n <= 4; n++) {
      const fileId = await t.run((ctx) => ctx.storage.store(new Blob([`apk ${n}`])));
      const res = await post('/runner/build', {
        number: n,
        delivery: 'apk',
        files: [{ abi: 'x86_64', fileId, sizeBytes: 5, sha256: 'x' }],
        info: { number: n, status: 'succeeded', startedAt: new Date().toISOString() },
        pushed: true,
        commit: `c${n}`,
      });
      expect(res.status).toBe(200);
    }
    const app = await as.query(api.apps.get, { appId });
    expect(app.latestApk).toMatchObject({ number: 4 });
    const builds = await t.run((ctx) => ctx.db.query('builds').collect());
    expect(builds.find((b) => b.number === 1)!.files).toEqual([]);
    expect(builds.find((b) => b.number === 4)!.files).toHaveLength(1);
    const row = await t.run((ctx) => ctx.db.get(appId));
    expect(row).toMatchObject({ buildHigh: 4, pushedCommit: 'c4' });
  });

  test('Stop drops messages the box has not taken', async () => {
    const { t, as, appId, post } = await withRunner();
    await post('/runner/take');
    await as.mutation(api.chat.send, { appId, text: 'second' });
    await as.mutation(api.chat.cancel, { appId });
    const chat = await as.query(api.chat.messages, { appId });
    expect(chat.find((c) => c.text === 'second')).toMatchObject({ dropped: true, queued: false });
    const take = await (await post('/runner/take')).json();
    expect(take.item.kind).toBe('cancel');
    await post('/runner/ack', { ids: [take.item.id] });
    const left = await t.run((ctx) => ctx.db.query('inbox').filter((q) => q.eq(q.field('takenAt'), undefined)).collect());
    expect(left).toHaveLength(0);
  });

  test('removing the app stops its runner token from working', async () => {
    const { t, as, appId, post, thread } = await withRunner();
    await as.mutation(api.apps.remove, { appId });
    expect(await as.query(api.apps.list, {})).toEqual([]);
    // The retire action is scheduled; its mutation half clears the token.
    await t.mutation(internal.boxes.patchThread, { threadId: thread._id, patch: { boxState: 'deleted', runnerTokenHash: undefined } });
    expect((await post('/runner/hello')).status).toBe(401);
  });
});

describe('box lifecycle decisions', () => {
  test('ensure: none starts a box, paused wakes it, a live runner is left alone', async () => {
    const { t, as } = await setup();
    const appId = await makeApp(as);
    const thread = await threadOf(t, appId);
    await t.mutation(internal.boxes.ensure, { threadId: thread._id });
    expect((await t.run((ctx) => ctx.db.get(thread._id)))!.boxState).toBe('starting');
    await t.run((ctx) => ctx.db.patch(thread._id, { boxState: 'paused' }));
    await t.mutation(internal.boxes.ensure, { threadId: thread._id });
    expect((await t.run((ctx) => ctx.db.get(thread._id)))!).toMatchObject({ boxState: 'starting', boxNote: 'Waking up your app’s machine' });
    await t.run((ctx) => ctx.db.patch(thread._id, { boxState: 'running', runnerSeenAt: Date.now() }));
    await t.mutation(internal.boxes.ensure, { threadId: thread._id });
    expect((await t.run((ctx) => ctx.db.get(thread._id)))!.boxState).toBe('running');
  });

  test('ensure: at 5 boxes a person waits for one', async () => {
    const { t, as, userId } = await setup();
    const appId = await makeApp(as);
    const thread = await threadOf(t, appId);
    await t.run(async (ctx) => {
      await ctx.db.patch(thread._id, { boxState: 'none' });
      for (let i = 0; i < 5; i++) await ctx.db.insert('boxes', { threadId: thread._id, userId, provider: 'instabox', name: `b${i}`, size: '4x8', startedAt: 0, secondsBilled: 0 });
    });
    await t.mutation(internal.boxes.ensure, { threadId: thread._id });
    const after = (await t.run((ctx) => ctx.db.get(thread._id)))!;
    expect(after.boxState).toBe('none');
    expect(after.boxNote).toMatch(/all 5 machines/);
  });

  test('the tick: idle running boxes pause, long-paused ones are snapshotted, busy ones hold a lease', async () => {
    const { t, as } = await setup();
    const a = await threadOf(t, await makeApp(as, 'One'));
    const b = await threadOf(t, await makeApp(as, 'Two'));
    const c = await threadOf(t, await makeApp(as, 'Three'));
    const old = Date.now() - 2 * 3600_000;
    await t.run(async (ctx) => {
      await ctx.db.patch(a._id, { boxState: 'running', lastActiveAt: old });
      await ctx.db.patch(b._id, { boxState: 'paused', lastActiveAt: old });
      await ctx.db.patch(c._id, { boxState: 'running', lastActiveAt: old, busy: true });
    });
    const due = await t.query(internal.boxes.due, {});
    expect(due.pause).toEqual([a._id]);
    expect(due.snapshot).toEqual([b._id]);
    expect(due.lease).toEqual([]); // c has no box row yet
  });

  test('the provider says a box paused or vanished: the thread follows', async () => {
    const { t, as, userId } = await setup();
    const thread = await threadOf(t, await makeApp(as));
    const boxId = await t.run(async (ctx) => {
      const id = await ctx.db.insert('boxes', { threadId: thread._id, userId, provider: 'instabox', providerId: 'm_1', name: 'b', size: '4x8', startedAt: 0, secondsBilled: 0 });
      await ctx.db.patch(thread._id, { boxState: 'running', boxId: id });
      return id;
    });
    await t.mutation(internal.boxes.providerSays, { providerId: 'm_1', state: 'paused' });
    expect((await t.run((ctx) => ctx.db.get(thread._id)))!.boxState).toBe('paused');
    await t.mutation(internal.boxes.providerSays, { providerId: 'm_1', state: 'deleted' });
    const after = (await t.run((ctx) => ctx.db.get(thread._id)))!;
    expect(after.boxState).toBe('none');
    expect((await t.run((ctx) => ctx.db.get(boxId)))!.deletedAt).toBeDefined();
  });
});

describe('Instabox webhooks', () => {
  test('a signed delivery is applied once; a bad signature is refused', async () => {
    const { t, as, userId } = await setup();
    const thread = await threadOf(t, await makeApp(as));
    await t.run(async (ctx) => {
      const id = await ctx.db.insert('boxes', { threadId: thread._id, userId, provider: 'instabox', providerId: 'm_9', name: 'b', size: '4x8', startedAt: 0, secondsBilled: 0 });
      await ctx.db.patch(thread._id, { boxState: 'running', boxId: id });
    });
    const key = new Uint8Array(32).fill(7);
    vi.stubEnv('INSTABOX_WEBHOOK_SECRET', `whsec_${btoa(String.fromCharCode(...key))}`);
    const body = JSON.stringify({ id: 'ev1', type: 'sandbox.suspended', createdAt: new Date().toISOString(), orgId: 'o', data: { sandbox: { id: 'm_9' }, state: 'suspended' } });
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = await hmacSha256B64(key, `ev1.${ts}.${body}`);
    const send = (s: string) => t.fetch('/instabox/webhook', { method: 'POST', headers: { 'webhook-id': 'ev1', 'webhook-timestamp': ts, 'webhook-signature': `v1,${s}` }, body });
    expect((await send('bad')).status).toBe(401);
    expect((await send(sig)).status).toBe(200);
    expect((await t.run((ctx) => ctx.db.get(thread._id)))!.boxState).toBe('paused');
    expect(await (await send(sig)).json()).toMatchObject({ duplicate: true });
    vi.stubEnv('INSTABOX_WEBHOOK_SECRET', '');
  });
});

describe('PC links', () => {
  test('made once, stored as a hash, revocable', async () => {
    const { t, as } = await setup();
    const { id, token } = await as.mutation(api.accounts.createPcLink, { deviceName: 'Desk PC', linkedFrom: 'phone' });
    expect(token).toMatch(/^kpc_/);
    const row = (await t.run((ctx) => ctx.db.get(id)))!;
    expect(row.tokenHash).toBe(await sha256Hex(token));
    expect(JSON.stringify(row)).not.toContain(token);
    expect((await as.query(api.accounts.me, {}))!.pcs).toMatchObject([{ name: 'Desk PC' }]);
    await as.mutation(api.accounts.revokePcLink, { id });
    expect((await as.query(api.accounts.me, {}))!.pcs).toEqual([]);
  });
});
