// Milestone 6: credits and metering (docs/CLOUD.md section 5), with a fake Stripe.
import { convexTest } from 'convex-test';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { api, internal } from '../convex/_generated/api';
import type { Id } from '../convex/_generated/dataModel';
import schema from '../convex/schema';
import { hmacSha256B64, sha256Hex } from '../convex/lib/crypto';
import { priceTokens } from '../convex/billing';

const modules = import.meta.glob('../convex/**/*.*s');

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-12T10:00:00Z'));
  vi.stubEnv('RUNNER_POLL_MS', '0');
  vi.stubEnv('KEYS_KEK', btoa(String.fromCharCode(...new Uint8Array(32).fill(4))));
});

const OPUS = 'claude-opus-5-5';
/** About $0.20 of Opus at list price: 10k cache write, 500k cache read, 3k out. */
const TURN = { inputTokens: 0, outputTokens: 3000, cacheWriteTokens: 10_000, cacheReadTokens: 500_000 };

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
  const takeAll = async () => {
    for (;;) {
      const j = await (await post('/runner/take')).json();
      if (!j.item) return;
      await post('/runner/ack', { ids: [j.item.id] });
    }
  };
  const balance = async () => (await as.query(api.accounts.me, {}))!.credits;
  return { t, as, userId, appId, thread, post, takeAll, balance };
}

describe('metering a change', () => {
  test('usage priced per model, machine time, rounded up to a tenth; the chat shows credits, not tokens', async () => {
    const { t, as, appId, post, takeAll, balance } = await setup();
    expect(priceTokens(OPUS, TURN)) .toBe(3000 * 20 + 10_000 * 5 + 500_000 * 0.2);
    // The first app is capped at 3 credits: finish it cheaply first.
    await takeAll();
    const now = new Date().toISOString();
    await post('/runner/events', {
      events: [
        { type: 'chat.item', item: { id: 'u1', appId: 'x', seq: 1, kind: 'user', text: 'tips', usage: TURN, createdAt: now, updatedAt: now } },
        { type: 'inbox.done', inboxId: (await t.run((ctx) => ctx.db.query('inbox').first()))!._id, itemId: 'u1' },
        { type: 'usage', model: OPUS, effort: 'high', tag: { role: 'orchestrator' }, usage: TURN },
      ],
    });
    vi.setSystemTime(new Date(Date.now() + 120_000));
    await post('/runner/events', { events: [{ type: 'runner.state', busy: false }] });
    // $0.21 of AI is 1.05 credits, 120 s of machine about 0.006: 1.1 after rounding up.
    const chat = await as.query(api.chat.messages, { appId });
    const user = chat.find((c) => c.id === 'u1')!;
    expect(user.usage).toBeUndefined();
    expect(user.cost).toMatchObject({ millicredits: 1100 });
    expect(await balance()).toBeCloseTo(1.9, 5);
    const usage = await t.run((ctx) => ctx.db.query('usage').collect());
    expect(usage.map((u) => [u.kind, u.level, u.model])).toEqual([
      ['inference', 'orchestrator', OPUS],
      ['machine', undefined, undefined],
    ]);
    const sub = await t.run((ctx) => ctx.db.query('subscriptions').first());
    expect(sub!.firstAppDone).toBe(true);
  });

  test('the first app stops taking credits at 3; the rest is on us', async () => {
    const { t, post, takeAll, balance } = await setup();
    await takeAll();
    const big = { ...TURN, outputTokens: 30_000 }; // about $0.75 each
    await post('/runner/events', { events: [1, 2, 3, 4, 5].map(() => ({ type: 'usage', model: OPUS, tag: { role: 'helper', level: 'deep' }, usage: big })) });
    await post('/runner/events', { events: [{ type: 'runner.state', busy: false }] });
    const change = (await t.run((ctx) => ctx.db.query('changes').first()))!;
    expect(change.actual.millicredits).toBe(3000);
    expect(await balance()).toBe(0);
    const adjust = await t.run((ctx) => ctx.db.query('ledger').filter((q) => q.eq(q.field('kind'), 'adjust')).collect());
    expect(adjust.length).toBeGreaterThan(0);
  });
});

describe('the credit gate and the stop', () => {
  test('no credits left: a change is refused before anything runs', async () => {
    const { t, as, appId, takeAll } = await setup();
    await takeAll();
    await t.run(async (ctx) => {
      for (const g of await ctx.db.query('grants').collect()) await ctx.db.patch(g._id, { remaining: 0 });
      const b = (await ctx.db.query('balances').first())!;
      await ctx.db.patch(b._id, { millicredits: 0 });
      const sub = (await ctx.db.query('subscriptions').first())!;
      await ctx.db.patch(sub._id, { firstAppDone: true });
      await ctx.db.patch(appId, { buildHigh: 1 });
    });
    await expect(as.mutation(api.chat.send, { appId, text: 'more' })).rejects.toThrow(/needs about 1.5 credits and you have 0/);
  });

  test('past the balance plus half a credit, the runner is told to stop and the chat says why', async () => {
    const { t, as, appId, post, takeAll } = await setup();
    await t.run(async (ctx) => {
      const sub = (await ctx.db.query('subscriptions').first())!;
      await ctx.db.patch(sub._id, { firstAppDone: true });
      const c = (await ctx.db.query('changes').first())!;
      await ctx.db.patch(c._id, { firstApp: undefined });
    });
    await takeAll();
    const big = { ...TURN, outputTokens: 60_000 }; // about $1.40 = 7 credits
    await post('/runner/events', { events: [{ type: 'usage', model: OPUS, usage: big }] });
    const change = (await t.run((ctx) => ctx.db.query('changes').first()))!;
    expect(change.state).toBe('stopped');
    const take = await (await post('/runner/take')).json();
    expect(take.item).toMatchObject({ kind: 'cancel', payload: { reason: 'credits' } });
    const chat = await as.query(api.chat.messages, { appId });
    expect(chat.some((c) => c.kind === 'error' && /out of credits/.test(c.text ?? ''))).toBe(true);
  });
});

describe('grants', () => {
  test('spent closest to expiry first; expired credit goes; an overdraft is paid by the next grant', async () => {
    const { t, userId } = await setup();
    const { grant, spend, expireGrants, balanceOf } = await import('../convex/lib/credits');
    await t.run(async (ctx) => {
      await grant(ctx, userId, { source: 'extra', millicredits: 20_000, expiresAt: Date.now() + 365 * 86400_000 });
      await spend(ctx, userId, 4000, {});
    });
    const grants = await t.run((ctx) => ctx.db.query('grants').collect());
    const free = grants.find((g) => g.source === 'free')!;
    const extra = grants.find((g) => g.source === 'extra')!;
    expect(free.remaining).toBe(0);
    expect(extra.remaining).toBe(19_000);
    // Into the overdraft, then a grant pays it back.
    await t.run(async (ctx) => {
      await spend(ctx, userId, 19_400, {});
      expect(await balanceOf(ctx, userId)).toBe(-400);
      await grant(ctx, userId, { source: 'refund', millicredits: 1000, expiresAt: Date.now() + 86400_000 });
      expect(await balanceOf(ctx, userId)).toBe(600);
    });
    // Expiry.
    vi.setSystemTime(new Date(Date.now() + 2 * 86400_000));
    expect(await t.run((ctx) => expireGrants(ctx, Date.now()))).toBe(1);
    expect(await t.run((ctx) => balanceOf(ctx, userId))).toBe(0);
  });
});

describe('Stripe (a fake)', () => {
  const SECRET = 'whsec_test_secret';
  beforeEach(() => vi.stubEnv('STRIPE_WEBHOOK_SECRET', SECRET));
  async function send(t: ReturnType<typeof convexTest>, event: unknown, secret = SECRET) {
    const body = JSON.stringify(event);
    const ts = Math.floor(Date.now() / 1000);
    const b64 = await hmacSha256B64(new TextEncoder().encode(secret), `${ts}.${body}`);
    const hex = [...Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))].map((b) => b.toString(16).padStart(2, '0')).join('');
    return t.fetch('/stripe/webhook', { method: 'POST', headers: { 'stripe-signature': `t=${ts},v1=${hex}` }, body });
  }

  test('extra credit: 20 credits for 12 months, once per payment; a forged event is refused', async () => {
    const { t, userId, balance } = await setup();
    const ev = { id: 'evt_1', type: 'checkout.session.completed', data: { object: { id: 'cs_1', mode: 'payment', payment_status: 'paid', payment_intent: 'pi_1', metadata: { kind: 'extra', userId } } } };
    expect((await send(t, ev, 'whsec_wrong')).status).toBe(400);
    expect((await send(t, ev)).status).toBe(200);
    expect((await send(t, { ...ev, id: 'evt_1b' })).status).toBe(200);
    expect(await balance()).toBe(23);
  });

  test('a monthly plan: each paid invoice gives its credits (one month of rollover); cancelled goes back to Free', async () => {
    const { t, userId, balance } = await setup();
    await send(t, { id: 'e1', type: 'checkout.session.completed', data: { object: { mode: 'subscription', subscription: 'sub_1', metadata: { kind: 'plan', userId, plan: 'starter', interval: 'month' } } } });
    await send(t, { id: 'e2', type: 'invoice.paid', data: { object: { id: 'in_1', subscription: 'sub_1', lines: { data: [{ period: { start: Date.now() / 1000, end: Date.now() / 1000 + 30 * 86400 } }] } } } });
    expect(await balance()).toBe(33);
    const g = (await t.run((ctx) => ctx.db.query('grants').filter((q) => q.eq(q.field('source'), 'plan')).first()))!;
    expect(new Date(g.expiresAt).toISOString()).toBe('2027-01-01T00:00:00.000Z');
    await send(t, { id: 'e3', type: 'customer.subscription.deleted', data: { object: { id: 'sub_1', status: 'canceled' } } });
    const sub = (await t.run((ctx) => ctx.db.query('subscriptions').first()))!;
    expect(sub).toMatchObject({ plan: 'free', status: 'cancelled' });
  });

  test('a yearly plan: credits given monthly, by the hourly job', async () => {
    const { t, userId, balance } = await setup();
    await send(t, { id: 'y1', type: 'checkout.session.completed', data: { object: { mode: 'subscription', subscription: 'sub_y', metadata: { kind: 'plan', userId, plan: 'pro', interval: 'year' } } } });
    await send(t, { id: 'y2', type: 'invoice.paid', data: { object: { id: 'in_y', subscription: 'sub_y', lines: { data: [{ period: { start: Date.now() / 1000, end: Date.now() / 1000 + 365 * 86400 } }] } } } });
    expect(await balance()).toBe(73);
    vi.setSystemTime(new Date('2026-12-12T11:00:00Z'));
    await t.mutation(internal.stripe.yearlyGrants, {});
    expect(await balance()).toBe(143);
    await t.mutation(internal.stripe.yearlyGrants, {});
    expect(await balance()).toBe(143);
  });
});

describe('the Own key plan', () => {
  test('AI on their key uses no credits; machine time counts toward 30 hours', async () => {
    const { t, userId, post, takeAll, balance } = await setup();
    await t.run(async (ctx) => {
      const sub = (await ctx.db.query('subscriptions').first())!;
      await ctx.db.patch(sub._id, { plan: 'ownKey', firstAppDone: true });
      await ctx.db.patch(userId, { aiMode: 'ownAnthropic' });
      const c = (await ctx.db.query('changes').first())!;
      await ctx.db.patch(c._id, { aiPaidBy: 'ownKey', firstApp: undefined });
    });
    const before = await balance();
    await takeAll();
    await post('/runner/events', { events: [{ type: 'usage', model: OPUS, usage: TURN }] });
    vi.setSystemTime(new Date(Date.now() + 600_000));
    await post('/runner/events', { events: [{ type: 'runner.state', busy: false }] });
    expect(await balance()).toBe(before);
    const sub = (await t.run((ctx) => ctx.db.query('subscriptions').first()))!;
    expect(sub.boxSecondsThisMonth).toBe(600);
  });
});
