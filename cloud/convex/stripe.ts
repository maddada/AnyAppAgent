// Money in (docs/CLOUD.md section 5): plans as Stripe subscriptions, extra credit as a one-off
// Checkout, both on Stripe's hosted pages (test mode until launch: STRIPE_SECRET_KEY must be a
// sk_test_ key on the dev deployment). Stripe's webhook (/stripe/webhook, signed) turns payments
// into grants: invoice.paid gives a plan's monthly credits (a yearly plan's later months come
// from an hourly job), checkout.session.completed gives extra credit. Card fees are inside our
// prices; nothing is added at checkout.
import { getAuthUserId } from '@convex-dev/auth/server';
import { v } from 'convex/values';
import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { action, httpAction, internalMutation, internalQuery, type MutationCtx } from './_generated/server';
import { EXTRA_PACK, PLANS, type Interval, type PlanId } from './config';
import { grant, monthEnd, monthKey, subscriptionOf } from './lib/credits';
import { hmacSha256B64, sameHex } from './lib/crypto';

const API = 'https://api.stripe.com/v1';

function secretKey(): string {
  const k = process.env.STRIPE_SECRET_KEY ?? '';
  if (!k) throw new Error('Payments are not set up yet.');
  // Test mode only until launch: a live key is refused here.
  if (!k.startsWith('sk_test_') && process.env.STRIPE_ALLOW_LIVE !== '1') throw new Error('Only a Stripe test key may be used here.');
  return k;
}

/** Stripe's form encoding, nested keys as a[b][c]. */
export function form(obj: Record<string, unknown>, prefix = ''): string[] {
  const out: string[] = [];
  for (const [k, val] of Object.entries(obj)) {
    if (val === undefined || val === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(val)) val.forEach((x, i) => out.push(...(typeof x === 'object' ? form(x as Record<string, unknown>, `${key}[${i}]`) : [`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(x))}`])));
    else if (typeof val === 'object') out.push(...form(val as Record<string, unknown>, key));
    else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(val))}`);
  }
  return out;
}

async function stripe<T = any>(method: 'GET' | 'POST', path: string, body?: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${secretKey()}`, ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
    body: body ? form(body).join('&') : undefined,
  });
  const json = (await res.json()) as T & { error?: { message?: string } };
  if (!res.ok) throw new Error(`Stripe: ${json.error?.message ?? res.status}`);
  return json;
}

export const userRow = internalQuery({
  args: { userId: v.id('users') },
  handler: async (ctx, { userId }) => ctx.db.get(userId),
});

export const setCustomer = internalMutation({
  args: { userId: v.id('users'), customerId: v.string() },
  handler: async (ctx, { userId, customerId }) => {
    await ctx.db.patch(userId, { stripeCustomerId: customerId });
  },
});

/**
 * A Stripe Checkout page for a plan or for extra credit. Returns its URL; the phone opens it in
 * the browser and comes back through /billing/done.
 */
export const checkout = action({
  args: { kind: v.union(v.literal('plan'), v.literal('extra')), plan: v.optional(v.union(v.literal('starter'), v.literal('pro'), v.literal('max'), v.literal('ownKey'))), interval: v.optional(v.union(v.literal('month'), v.literal('year'))) },
  handler: async (ctx, a): Promise<{ url: string }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error('Sign in first.');
    const user = (await ctx.runQuery(internal.stripe.userRow, { userId }))!;
    let customer = user.stripeCustomerId;
    if (!customer) {
      const c = await stripe<{ id: string }>('POST', '/customers', { ...(user.email ? { email: user.email } : {}), metadata: { userId } });
      customer = c.id;
      await ctx.runMutation(internal.stripe.setCustomer, { userId, customerId: customer });
    }
    const site = process.env.CONVEX_SITE_URL;
    const done = { success_url: `${site}/billing/done?ok=1`, cancel_url: `${site}/billing/done?ok=0` };
    if (a.kind === 'extra') {
      const s = await stripe<{ url: string }>('POST', '/checkout/sessions', {
        mode: 'payment',
        customer,
        ...done,
        line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: EXTRA_PACK.cents, product_data: { name: `Kiwimake extra credit (${EXTRA_PACK.millicredits / 1000} credits)` } } }],
        metadata: { kind: 'extra', userId },
        payment_intent_data: { metadata: { kind: 'extra', userId } },
      });
      return { url: s.url };
    }
    const plan = a.plan ?? 'starter';
    const interval: Interval = a.interval ?? 'month';
    const p = PLANS[plan];
    const s = await stripe<{ url: string }>('POST', '/checkout/sessions', {
      mode: 'subscription',
      customer,
      ...done,
      line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: p.cents[interval], recurring: { interval }, product_data: { name: `Kiwimake ${p.name}${interval === 'year' ? ', yearly' : ''}` } } }],
      metadata: { kind: 'plan', userId, plan, interval },
      subscription_data: { metadata: { userId, plan, interval } },
    });
    return { url: s.url };
  },
});

/** The page Stripe sends the browser to after paying (or cancelling): back to Kiwimake. */
export const done = httpAction(async (_ctx, req) => {
  const ok = new URL(req.url).searchParams.get('ok') === '1';
  const back = `anyappagent://plan?paid=${ok ? 1 : 0}`;
  return new Response(
    `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>${ok ? 'Thank you' : 'Not paid'}</title>
<style>body{font-family:system-ui,sans-serif;background:#F3EEE6;color:#22201C;padding:32px;max-width:520px;margin:auto}@media (prefers-color-scheme:dark){body{background:#1C1B19;color:#EDE8E0}}
a.b{display:inline-block;margin-top:20px;padding:12px 18px;border-radius:10px;background:#2F6B4F;color:#fff;text-decoration:none}.r{text-align:right}</style>
<h1>${ok ? 'Thank you' : 'Nothing was paid'}</h1><p>${ok ? 'Your credits arrive in Kiwimake in a moment.' : 'You can choose again in Kiwimake whenever you like.'}</p><div class="r"><a class="b" href="${back}">Back to Kiwimake</a></div>
<script>setTimeout(function(){location.href=${JSON.stringify(back)}},800)</script>`,
    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );
});

// ---------- the webhook

/** Stripe-Signature: t=<seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>">. */
export async function verifyStripe(body: string, header: string, secret: string, now = Date.now()): Promise<boolean> {
  const parts = Object.fromEntries(header.split(',').map((kv) => kv.split('=') as [string, string]));
  const t = Number(parts.t);
  if (!t || Math.abs(now / 1000 - t) > 300) return false;
  const want = await hmacSha256Hex(secret, `${t}.${body}`);
  return header
    .split(',')
    .filter((kv) => kv.startsWith('v1='))
    .some((kv) => sameHex(kv.slice(3), want));
}

async function hmacSha256Hex(secret: string, data: string) {
  const b64 = await hmacSha256B64(new TextEncoder().encode(secret), data);
  return [...Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const webhook = httpAction(async (ctx, req) => {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return new Response('not configured', { status: 503 });
  const body = await req.text();
  if (!(await verifyStripe(body, req.headers.get('stripe-signature') ?? '', secret))) return new Response('bad signature', { status: 400 });
  const event = JSON.parse(body) as { id: string; type: string; data: { object: any } };
  const fresh = await ctx.runMutation(internal.webhooks.once, { source: 'stripe', eventId: event.id });
  if (!fresh) return new Response('ok (seen)', { status: 200 });
  await ctx.runMutation(internal.stripe.apply, { type: event.type, object: event.data.object });
  return new Response('ok', { status: 200 });
});

async function subByStripe(ctx: MutationCtx, stripeSubscriptionId: string) {
  return ctx.db.query('subscriptions').withIndex('by_stripe_id', (q) => q.eq('stripeSubscriptionId', stripeSubscriptionId)).first();
}

async function grantPlanMonth(ctx: MutationCtx, sub: Doc<'subscriptions'>, at: number, paymentId?: string) {
  const plan = PLANS[sub.plan];
  if (!plan.monthlyMillicredits) return;
  const period = monthKey(at);
  const have = await ctx.db.query('grants').withIndex('by_user_source_period', (q) => q.eq('userId', sub.userId).eq('source', 'plan').eq('period', period)).first();
  if (have) return;
  // One month of rollover: a plan's credits last until the end of the next month.
  await grant(ctx, sub.userId, { source: 'plan', millicredits: plan.monthlyMillicredits, expiresAt: monthEnd(at, 2), period, ...(paymentId ? { stripePaymentId: paymentId } : {}), note: `${plan.name} for ${period}` });
}

/** One Stripe event, applied (deduplicated in the webhook). */
export const apply = internalMutation({
  args: { type: v.string(), object: v.any() },
  handler: async (ctx, { type, object: o }) => {
    const now = Date.now();
    if (type === 'checkout.session.completed') {
      const m = (o.metadata ?? {}) as Record<string, string>;
      const userId = ctx.db.normalizeId('users', m.userId ?? '');
      if (!userId) return;
      if (m.kind === 'extra' && o.payment_status === 'paid') {
        const pid = String(o.payment_intent ?? o.id);
        if (await ctx.db.query('grants').withIndex('by_stripe_payment', (q) => q.eq('stripePaymentId', pid)).first()) return;
        await grant(ctx, userId, { source: 'extra', millicredits: EXTRA_PACK.millicredits, expiresAt: now + EXTRA_PACK.validDays * 86400_000, stripePaymentId: pid, note: 'extra credit' });
        return;
      }
      if (m.kind === 'plan' && o.subscription) {
        await upsertPlan(ctx, userId, String(o.subscription), m.plan as PlanId, (m.interval as Interval) ?? 'month', now);
      }
      return;
    }
    if (type === 'invoice.paid') {
      const subId = String(o.subscription ?? o.parent?.subscription_details?.subscription ?? '');
      if (!subId) return;
      const meta = (o.subscription_details?.metadata ?? o.parent?.subscription_details?.metadata ?? o.lines?.data?.[0]?.metadata ?? {}) as Record<string, string>;
      let sub = await subByStripe(ctx, subId);
      if (!sub) {
        const userId = ctx.db.normalizeId('users', meta.userId ?? '');
        if (!userId) return;
        sub = await upsertPlan(ctx, userId, subId, meta.plan as PlanId, (meta.interval as Interval) ?? 'month', now);
      }
      const line = o.lines?.data?.[0]?.period;
      const start = line?.start ? line.start * 1000 : now;
      const end = line?.end ? line.end * 1000 : monthEnd(now);
      await ctx.db.patch(sub._id, { status: 'active', periodStart: start, periodEnd: end, ...(sub.interval === 'year' ? { nextGrantAt: monthAfter(start) } : {}) });
      await grantPlanMonth(ctx, (await ctx.db.get(sub._id))!, now, String(o.id));
      return;
    }
    if (type === 'invoice.payment_failed') {
      const sub = await subByStripe(ctx, String(o.subscription ?? ''));
      if (sub) await ctx.db.patch(sub._id, { status: 'pastDue' });
      return;
    }
    if (type === 'customer.subscription.updated' || type === 'customer.subscription.deleted') {
      const sub = await subByStripe(ctx, String(o.id));
      if (!sub) return;
      const status = type === 'customer.subscription.deleted' || o.status === 'canceled' ? 'cancelled' : o.status === 'past_due' || o.status === 'unpaid' ? 'pastDue' : 'active';
      await ctx.db.patch(sub._id, {
        status,
        cancelAtPeriodEnd: Boolean(o.cancel_at_period_end),
        ...(status === 'cancelled' ? { plan: 'free' as const, stripeSubscriptionId: undefined, nextGrantAt: undefined } : {}),
      });
      if (status === 'cancelled') {
        const user = await ctx.db.get(sub.userId);
        if (user?.aiMode === 'ownAnthropic') await ctx.db.patch(sub.userId, { aiMode: 'credit' });
      }
    }
  },
});

/** The same date a month later (a yearly plan's next monthly grant). */
function monthAfter(at: number) {
  const d = new Date(at);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes());
}

async function upsertPlan(ctx: MutationCtx, userId: Id<'users'>, stripeSubscriptionId: string, plan: PlanId, interval: Interval, now: number): Promise<Doc<'subscriptions'>> {
  const sub = await subscriptionOf(ctx, userId);
  const fields = { plan: PLANS[plan] ? plan : ('starter' as const), interval, stripeSubscriptionId, status: 'active' as const, cancelAtPeriodEnd: false };
  if (sub) {
    await ctx.db.patch(sub._id, fields);
    if (fields.plan === 'ownKey') await ctx.db.patch(userId, { aiMode: 'ownAnthropic' });
    return (await ctx.db.get(sub._id))!;
  }
  const id = await ctx.db.insert('subscriptions', { userId, ...fields, periodStart: now, periodEnd: monthEnd(now), boxSecondsThisMonth: 0, firstAppDone: false });
  if (fields.plan === 'ownKey') await ctx.db.patch(userId, { aiMode: 'ownAnthropic' });
  return (await ctx.db.get(id))!;
}

/** Hourly: a yearly plan's monthly credits on each monthly date while it is active. */
export const yearlyGrants = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const due = await ctx.db.query('subscriptions').withIndex('by_next_grant', (q) => q.lte('nextGrantAt', now)).take(100);
    for (const sub of due) {
      if (sub.status !== 'active' || sub.interval !== 'year' || !sub.nextGrantAt) continue;
      await grantPlanMonth(ctx, sub, now);
      await ctx.db.patch(sub._id, { nextGrantAt: monthAfter(sub.nextGrantAt), boxSecondsThisMonth: 0 });
    }
  },
});
