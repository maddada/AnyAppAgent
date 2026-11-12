// Milestone 3: GitHub (docs/CLOUD.md section 3). GitHub itself is a fake fetch here; the real one
// is proven by scripts/m3-proof.mjs.
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { api, internal } from '../convex/_generated/api';
import type { Id } from '../convex/_generated/dataModel';
import schema from '../convex/schema';

const modules = import.meta.glob('../convex/**/*.*s');

type Route = (url: string, init: RequestInit) => { status: number; body: unknown } | undefined;
function fakeFetch(routes: Route[]) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push(`${init.method ?? 'GET'} ${url}`);
    for (const r of routes) {
      const hit = r(url, init);
      if (hit) return new Response(JSON.stringify(hit.body), { status: hit.status, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('{"message":"not found"}', { status: 404 });
  });
  return calls;
}

const token = (body: Record<string, unknown>): Route => (url) => (url.startsWith('https://github.com/login/oauth/access_token') ? { status: 200, body } : undefined);
const userRoute: Route = (url) => (url === 'https://api.github.com/user' ? { status: 200, body: { login: 'octo', id: 77 } } : undefined);
const installsRoute: Route = (url) => (url === 'https://api.github.com/user/installations' ? { status: 200, body: { installations: [{ id: 555, app_id: 9, app_slug: 'kiwimake-cloud-dev' }] } } : undefined);

beforeEach(() => {
  vi.stubEnv('KEYS_KEK', btoa(String.fromCharCode(...new Uint8Array(32).fill(3))));
  vi.stubEnv('GITHUB_APP_ID', '9');
  vi.stubEnv('GITHUB_APP_SLUG', 'kiwimake-cloud-dev');
  vi.stubEnv('GITHUB_APP_CLIENT_ID', 'Iv1.client');
  vi.stubEnv('GITHUB_APP_CLIENT_SECRET', 'secret');
});
afterEach(() => {
  vi.unstubAllGlobals();
});

async function setup() {
  const t = convexTest(schema, modules);
  const userId = await t.run((ctx) => ctx.db.insert('users', { email: 'a@example.com' }));
  return { t, userId, as: t.withIdentity({ subject: `${userId}|s` }) };
}

describe('connecting GitHub', () => {
  test('the link carries a state; the callback turns the code into sealed tokens for that person', async () => {
    const { t, userId, as } = await setup();
    const link = await as.mutation(api.github.connectUrl, {});
    expect(link.url).toMatch(/^https:\/\/github\.com\/apps\/kiwimake-cloud-dev\/installations\/new\?state=/);
    const state = new URL(link.url).searchParams.get('state')!;
    fakeFetch([token({ access_token: 'ghu_access', refresh_token: 'ghr_refresh', expires_in: 28800, refresh_token_expires_in: 15811200 }), userRoute, installsRoute]);
    const res = await t.fetch(`/github/callback?code=abc&state=${state}&installation_id=555&setup_action=install`);
    const html = await res.text();
    expect(html).toContain('GitHub is connected');
    expect(html).toContain('anyappagent://github?ok=1');
    const user = (await t.run((ctx) => ctx.db.get(userId)))!;
    expect(user).toMatchObject({ githubLogin: 'octo', githubUserId: 77, githubInstallationId: '555' });
    const secrets = await t.run((ctx) => ctx.db.query('secrets').collect());
    expect(secrets.map((s) => s.kind).sort()).toEqual(['githubAccess', 'githubRefresh']);
    expect(JSON.stringify(secrets)).not.toContain('ghu_access');
    expect(JSON.stringify(secrets)).not.toContain('ghr_refresh');
    // The state works once.
    const again = await t.fetch(`/github/callback?code=abc&state=${state}`);
    expect(await again.text()).toContain('expired');
  });

  test('a made-up state is refused and stores nothing', async () => {
    const { t } = await setup();
    fakeFetch([]);
    const res = await t.fetch('/github/callback?code=abc&state=nope');
    expect(await res.text()).toContain('expired');
    expect(await t.run((ctx) => ctx.db.query('secrets').collect())).toEqual([]);
  });
});

async function connected(t: ReturnType<typeof convexTest>, userId: Id<'users'>, expiresAt: number) {
  const { seal } = await import('../convex/lib/crypto');
  await t.mutation(internal.github.saveToken, {
    userId,
    login: 'octo',
    githubUserId: 77,
    installationId: '555',
    access: await seal('ghu_old', `github:access:${userId}`),
    refresh: await seal('ghr_old', `github:refresh:${userId}`),
    expiresAt,
  });
}

describe('the user token', () => {
  test('refreshed when it is about to expire', async () => {
    const { t, userId } = await setup();
    await connected(t, userId, Date.now() + 60_000);
    const calls = fakeFetch([token({ access_token: 'ghu_new', refresh_token: 'ghr_new', expires_in: 28800 }), userRoute, installsRoute]);
    expect(await t.action(internal.github.userToken, { userId })).toBe('ghu_new');
    expect(calls.some((c) => c.includes('login/oauth/access_token'))).toBe(true);
    // Fresh now: no second refresh.
    const calls2 = fakeFetch([]);
    expect(await t.action(internal.github.userToken, { userId })).toBe('ghu_new');
    expect(calls2).toEqual([]);
  });

  test('a refused refresh marks GitHub disconnected, and cloud changes wait', async () => {
    const { t, userId, as } = await setup();
    await connected(t, userId, Date.now() - 1);
    fakeFetch([token({ error: 'bad_refresh_token' })]);
    expect(await t.action(internal.github.userToken, { userId })).toBeNull();
    expect((await t.run((ctx) => ctx.db.get(userId)))!.githubDisconnectedAt).toBeDefined();
    await expect(as.mutation(api.apps.create, { name: 'A', prompt: 'x' })).rejects.toThrow(/disconnected/);
  });
});

describe('cloud changes need GitHub', () => {
  test('no GitHub: making an app is refused', async () => {
    const { as } = await setup();
    await expect(as.mutation(api.apps.create, { name: 'A', prompt: 'x' })).rejects.toThrow(/Connect GitHub first/);
  });

  test('disconnect: tokens go, apps stay, messages wait for a reconnect', async () => {
    const { t, userId, as } = await setup();
    await connected(t, userId, Date.now() + 3600_000);
    fakeFetch([]);
    const appId = await as.mutation(api.apps.create, { name: 'Notes', prompt: 'notes' });
    await as.mutation(api.github.disconnect, {});
    expect(await t.run((ctx) => ctx.db.query('secrets').collect())).toEqual([]);
    expect(await as.query(api.apps.list, {})).toHaveLength(1);
    await expect(as.mutation(api.chat.send, { appId, text: 'more' })).rejects.toThrow(/disconnected/);
    expect((await as.query(api.accounts.me, {}))!.cloud).toMatchObject({ added: false, github: { login: 'octo', connected: false } });
  });
});

describe('the app repo', () => {
  test('anyapp-cloud-<slug>, private, the next free name when taken', async () => {
    const { t, userId, as } = await setup();
    await connected(t, userId, Date.now() + 3600_000);
    fakeFetch([]);
    const appId = (await as.mutation(api.apps.create, { name: 'Tip Split', prompt: 'tips' })) as Id<'apps'>;
    const bodies: unknown[] = [];
    let n = 0;
    fakeFetch([
      (url, init) => {
        if (url !== 'https://api.github.com/user/repos') return undefined;
        bodies.push(JSON.parse(String(init.body)));
        return n++ === 0 ? { status: 422, body: { message: 'name already exists' } } : { status: 201, body: { full_name: 'octo/anyapp-cloud-tipsplit-2' } };
      },
    ]);
    expect(await t.action(internal.github.createAppRepo, { appId })).toBe('octo/anyapp-cloud-tipsplit-2');
    expect(bodies).toMatchObject([{ name: 'anyapp-cloud-tipsplit', private: true }, { name: 'anyapp-cloud-tipsplit-2', private: true }]);
    expect((await t.run((ctx) => ctx.db.get(appId)))!.repo).toBe('octo/anyapp-cloud-tipsplit-2');
    expect((await as.query(api.apps.get, { appId })).repoUrl).toBe('https://github.com/octo/anyapp-cloud-tipsplit-2');
  });
});
