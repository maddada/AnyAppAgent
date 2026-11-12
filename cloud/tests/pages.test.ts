// Pages in the cloud and the estimates (milestone 4).
import { convexTest } from 'convex-test';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { api, internal } from '../convex/_generated/api';
import type { Id } from '../convex/_generated/dataModel';
import schema from '../convex/schema';
import { sha256Hex } from '../convex/lib/crypto';

const modules = import.meta.glob('../convex/**/*.*s');

beforeEach(() => {
  vi.stubEnv('KEYS_KEK', btoa(String.fromCharCode(...new Uint8Array(32).fill(5))));
  vi.stubEnv('RUNNER_POLL_MS', '0');
});

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

const PAGE = 'a'.repeat(32);
const HTML = '<!doctype html><html><head><title>Plan</title><script>window.ghostex&&ghostex.__state(null);</script></head><body>Plan</body></html>';

describe('pages in the cloud', () => {
  test('the runner uploads a page; the owner opens it with a ticket; answers go to the box', async () => {
    const { t, as, appId, post } = await setup();
    expect((await post('/runner/page', { pageId: PAGE, info: { id: PAGE, title: 'The plan', questions: ['Build it?'] }, html: HTML })).status).toBe(200);
    const { path } = await as.mutation(api.pages.open, { appId, pageId: PAGE });
    expect(path).toMatch(new RegExp(`^/page/${PAGE}/[0-9a-z]+\.[A-Za-z0-9_-]{32}$`));
    const page = await t.fetch(path);
    expect(page.status).toBe(200);
    expect(page.headers.get('Content-Security-Policy')).toContain('sandbox allow-scripts');
    const html = await page.text();
    expect(html).toContain('ghostex.__state({"answered":false');
    // A forged ticket opens nothing.
    expect((await t.fetch(path.replace(/.$/, path.endsWith('a') ? 'b' : 'a'))).status).toBe(404);
    // Draft, then answers.
    expect((await t.fetch(`${path}/draft`, { method: 'POST', body: JSON.stringify({ draft: { x: 1 }, editedAt: 5 }) })).status).toBe(200);
    expect(await (await t.fetch(`${path}/draft`)).json()).toMatchObject({ draft: { x: 1 } });
    const ans = await t.fetch(`${path}/answers`, { method: 'POST', body: JSON.stringify({ answers: { build: 'Build it' } }) });
    expect(await ans.json()).toMatchObject({ ok: true, delivered: true });
    expect((await t.fetch(`${path}/answers`, { method: 'POST', body: JSON.stringify({ answers: {} }) })).status).toBe(409);
    expect(await (await t.fetch(path)).text()).toContain('"answered":true');
    // The box gets them through its inbox (after the first prompt).
    await post('/runner/take').then((r) => r.json()).then((j) => post('/runner/ack', { ids: [j.item.id] }));
    const next = await (await post('/runner/take')).json();
    expect(next.item).toMatchObject({ kind: 'page-answers', payload: { pageId: PAGE, answers: { build: 'Build it' } } });
  });

  test('another person cannot get a ticket', async () => {
    const { t, appId, post } = await setup();
    await post('/runner/page', { pageId: PAGE, info: { id: PAGE, title: 'x' }, html: HTML });
    const otherId = await t.run((ctx) => ctx.db.insert('users', { email: 'b@example.com' }));
    await expect(t.withIdentity({ subject: `${otherId}|s` }).mutation(api.pages.open, { appId, pageId: PAGE })).rejects.toThrow(/not here/);
  });
});

describe('estimates', () => {
  test('a new app: the first app is capped at 3 credits; later changes from defaults', async () => {
    const { t, as, appId } = await setup();
    const e = await as.query(api.estimates.forApp, { appId });
    expect(e.firstApp).toBe(true);
    expect(e.next).toMatchObject({ millicredits: 3000, high: 3000, basis: 'default' });
    await t.run(async (ctx) => {
      await ctx.db.patch(appId, { buildHigh: 3 });
      const sub = await ctx.db.query('subscriptions').first();
      await ctx.db.patch(sub!._id, { firstAppDone: true });
    });
    const later = await as.query(api.estimates.forApp, { appId });
    expect(later.next).toMatchObject({ millicredits: 1000, low: 800, high: 1500 });
    expect(later.plan).toMatchObject({ low: 2800, high: 4000 });
  });

  test("this app's own past changes win once it has three", async () => {
    const { t, as, appId, thread } = await setup();
    await t.run(async (ctx) => {
      await ctx.db.patch(appId, { buildHigh: 3 });
      const user = (await ctx.db.query('users').first())!;
      for (const m of [1200, 1500, 2100]) {
        await ctx.db.insert('changes', { appId, threadId: thread._id, userId: user._id, messageItemId: String(m), actual: { machineMicros: 0, aiMicros: 0, millicredits: m }, aiPaidBy: 'credit', state: 'done', startedAt: Date.now() });
      }
    });
    const e = await as.query(api.estimates.forApp, { appId });
    expect(e.next).toMatchObject({ basis: 'app', millicredits: 1500 });
    expect(e.month.usedMillicredits).toBe(4800);
  });
});
