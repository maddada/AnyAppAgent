// Milestone 7: the PC link (docs/CLOUD.md section 3). Both ways of making one (the phone hands its
// PC a link; the desktop signs in through the browser with a device code), the PC handing its
// sign-in to its phone, unlinking from either side, and the scopes checked in Convex.
import { convexTest } from 'convex-test';
import { describe, expect, test } from 'vitest';
import { api, internal } from '../convex/_generated/api';
import schema from '../convex/schema';
import { hasScope } from '../convex/pclinks';

const modules = import.meta.glob('../convex/**/*.*s');

async function setup() {
  const t = convexTest(schema, modules);
  const userId = await t.run((ctx) => ctx.db.insert('users', { email: 'a@example.com' }));
  return { t, userId, as: t.withIdentity({ subject: `${userId}|s` }) };
}

const post = (t: ReturnType<typeof convexTest>, path: string, body: unknown, token?: string) =>
  t.fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });

describe('a link from the phone', () => {
  test('the phone makes a link for its PC; the PC says hello with it and sees who it acts for', async () => {
    const { t, as } = await setup();
    const { token } = await as.mutation(api.accounts.createPcLink, { deviceName: 'MADDA-PC', linkedFrom: 'phone', fromName: 'Pixel 8' });
    expect(token).toMatch(/^kpc_/);
    const links = await t.run((ctx) => ctx.db.query('pcLinks').collect());
    expect(links).toHaveLength(1);
    expect(links[0]!.tokenHash).not.toContain(token.slice(4));
    const hello = await post(t, '/pc/hello', {}, token);
    expect(hello.status).toBe(200);
    expect(await hello.json()).toMatchObject({ deviceName: 'MADDA-PC', linkedFrom: 'phone', linkedFromName: 'Pixel 8', scopes: ['share', 'web', 'move'], account: { email: 'a@example.com' } });
    const me = await as.query(api.accounts.me, {});
    expect(me!.pcs).toEqual([expect.objectContaining({ name: 'MADDA-PC', linkedFrom: 'phone', fromName: 'Pixel 8' })]);
    expect(me!.pcs[0]!.lastSeenAt).toBeGreaterThan(0);
  });

  test('linking the same PC again replaces its older link', async () => {
    const { t, as } = await setup();
    const first = await as.mutation(api.accounts.createPcLink, { deviceName: 'MADDA-PC', linkedFrom: 'phone' });
    await as.mutation(api.accounts.createPcLink, { deviceName: 'MADDA-PC', linkedFrom: 'phone' });
    expect((await as.query(api.accounts.me, {}))!.pcs).toHaveLength(1);
    expect((await post(t, '/pc/hello', {}, first.token)).status).toBe(401);
  });

  test('unlinked from the phone: the PC is refused at once; unlinked from the PC: gone from the account', async () => {
    const { t, as } = await setup();
    const a = await as.mutation(api.accounts.createPcLink, { deviceName: 'PC-A', linkedFrom: 'phone' });
    const b = await as.mutation(api.accounts.createPcLink, { deviceName: 'PC-B', linkedFrom: 'phone' });
    await as.mutation(api.accounts.revokePcLink, { id: a.id });
    expect((await post(t, '/pc/hello', {}, a.token)).status).toBe(401);
    expect((await post(t, '/pc/unlink', {}, b.token)).status).toBe(200);
    expect((await post(t, '/pc/hello', {}, b.token)).status).toBe(401);
    expect((await as.query(api.accounts.me, {}))!.pcs).toEqual([]);
  });

  test('a made-up or missing token is refused, and a blocked account links nothing', async () => {
    const { t, userId, as } = await setup();
    expect((await post(t, '/pc/hello', {})).status).toBe(401);
    expect((await post(t, '/pc/hello', {}, 'kpc_madeup')).status).toBe(401);
    const { token } = await as.mutation(api.accounts.createPcLink, { deviceName: 'PC', linkedFrom: 'phone' });
    await t.run((ctx) => ctx.db.patch(userId, { blocked: true }));
    expect((await post(t, '/pc/hello', {}, token)).status).toBe(401);
  });
});

describe('the desktop signs in through the browser', () => {
  test('start, the page, approve once signed in, then the poll collects the link once', async () => {
    const { t, as } = await setup();
    const start = await post(t, '/pc/link/start', { deviceName: 'MADDA-PC' });
    const s = (await start.json()) as { code: string; shown: string; poll: string; url: string };
    expect(s.code).toMatch(/^[A-Z2-9]{8}$/);
    expect(s.shown).toBe(`${s.code.slice(0, 4)}-${s.code.slice(4)}`);
    expect(s.url).toContain(`/pc/link?l=${s.code}`);

    const page = await t.fetch(`/pc/link?l=${s.code}`);
    expect(page.headers.get('Content-Type')).toContain('text/html');
    const html = await page.text();
    expect(html).toContain('Check that your PC shows this code');
    expect(html).not.toContain(String.fromCharCode(0x2014));

    expect(await as.query(api.pclinks.request, { code: s.shown })).toMatchObject({ state: 'waiting', deviceName: 'MADDA-PC', code: s.shown });
    expect(await (await post(t, '/pc/link/poll', { code: s.code, poll: s.poll })).json()).toEqual({ state: 'pending' });
    // A wrong poll secret never collects it, even once approved.
    await expect(t.mutation(api.pclinks.approve, { code: s.code })).rejects.toThrow(/Sign in/);
    expect(await as.mutation(api.pclinks.approve, { code: s.code })).toMatchObject({ deviceName: 'MADDA-PC', email: 'a@example.com' });
    expect((await post(t, '/pc/link/poll', { code: s.code, poll: 'wrong' })).status).toBe(410);

    const done = (await (await post(t, '/pc/link/poll', { code: s.code, poll: s.poll })).json()) as { state: string; token: string };
    expect(done.state).toBe('linked');
    expect(done.token).toMatch(/^kpc_/);
    expect(await (await post(t, '/pc/hello', {}, done.token)).json()).toMatchObject({ deviceName: 'MADDA-PC', linkedFrom: 'pc', account: { email: 'a@example.com' } });
    // Used up: a second poll gets nothing, the page says the code is gone.
    expect((await post(t, '/pc/link/poll', { code: s.code, poll: s.poll })).status).toBe(410);
    expect(await as.query(api.pclinks.request, { code: s.code })).toEqual({ state: 'gone' });
  });

  test('a code runs out after 10 minutes', async () => {
    const { t, as } = await setup();
    const s = (await (await post(t, '/pc/link/start', { deviceName: 'PC' })).json()) as { code: string; poll: string };
    await t.run(async (ctx) => {
      const r = (await ctx.db.query('pcLinkRequests').first())!;
      await ctx.db.patch(r._id, { expiresAt: Date.now() - 1 });
    });
    await expect(as.mutation(api.pclinks.approve, { code: s.code })).rejects.toThrow(/run out/);
    expect((await post(t, '/pc/link/poll', { code: s.code, poll: s.poll })).status).toBe(410);
  });
});

describe('the PC hands its sign-in to its phone', () => {
  test('a PC that signed in itself gets a one-time code; a code works once', async () => {
    const { t, userId, as } = await setup();
    const s = (await (await post(t, '/pc/link/start', { deviceName: 'PC' })).json()) as { code: string; poll: string };
    await as.mutation(api.pclinks.approve, { code: s.code });
    const { token } = (await (await post(t, '/pc/link/poll', { code: s.code, poll: s.poll })).json()) as { token: string };
    const res = await post(t, '/pc/handoff', {}, token);
    expect(res.status).toBe(200);
    const { code } = (await res.json()) as { code: string };
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code));
    const codeHash = [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
    expect(await t.mutation(internal.pclinks.useHandoff, { codeHash })).toBe(userId);
    expect(await t.mutation(internal.pclinks.useHandoff, { codeHash })).toBeNull();
  });

  test('a PC the phone linked never turns its link into a full sign-in', async () => {
    const { t, as } = await setup();
    const { token } = await as.mutation(api.accounts.createPcLink, { deviceName: 'PC', linkedFrom: 'phone' });
    expect((await post(t, '/pc/handoff', {}, token)).status).toBe(409);
  });
});

describe('scopes', () => {
  test('each PC route names its scope and Convex checks it', () => {
    expect(hasScope({ scopes: ['share', 'web', 'move'] }, 'move')).toBe(true);
    expect(hasScope({ scopes: ['share'] }, 'move')).toBe(false);
    expect(hasScope({ scopes: [] }, null)).toBe(true);
  });
});
