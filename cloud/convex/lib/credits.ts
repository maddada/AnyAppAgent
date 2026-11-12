// Credits bookkeeping shared by mutations (docs/CLOUD.md section 5): the subscription row, the
// free monthly grant, balances. Every change to a grant writes its ledger row and the balance in
// the same mutation. Milestone 6 adds plans, Stripe, spending and expiry on top.
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { FREE_MONTHLY_MILLICREDITS } from '../config';

/** "2026-11" for a time, UTC. */
export function monthKey(at: number): string {
  const d = new Date(at);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** The first moment of the next UTC month after `at`, plus `months - 1` more months. */
export function monthEnd(at: number, months = 1): number {
  const d = new Date(at);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1);
}

export async function subscriptionOf(ctx: QueryCtx, userId: Id<'users'>) {
  return ctx.db.query('subscriptions').withIndex('by_user', (q) => q.eq('userId', userId)).first();
}

export async function balanceOf(ctx: QueryCtx, userId: Id<'users'>): Promise<number> {
  const b = await ctx.db.query('balances').withIndex('by_user', (q) => q.eq('userId', userId)).first();
  return b?.millicredits ?? 0;
}

export async function addToBalance(ctx: MutationCtx, userId: Id<'users'>, delta: number) {
  const b = await ctx.db.query('balances').withIndex('by_user', (q) => q.eq('userId', userId)).first();
  if (b) await ctx.db.patch(b._id, { millicredits: b.millicredits + delta });
  else await ctx.db.insert('balances', { userId, millicredits: delta });
}

/** Writes a grant, its ledger row and the balance. */
export async function grant(
  ctx: MutationCtx,
  userId: Id<'users'>,
  g: { source: Doc<'grants'>['source']; millicredits: number; expiresAt: number; period?: string; stripePaymentId?: string; note?: string },
) {
  const now = Date.now();
  // A change that ran into the overdraft left the balance below zero: the new credit pays that first.
  const before = await balanceOf(ctx, userId);
  const debt = before < 0 ? Math.min(-before, g.millicredits) : 0;
  const grantId = await ctx.db.insert('grants', {
    userId,
    source: g.source,
    millicredits: g.millicredits,
    remaining: g.millicredits - debt,
    grantedAt: now,
    expiresAt: g.expiresAt,
    ...(g.period ? { period: g.period } : {}),
    ...(g.stripePaymentId ? { stripePaymentId: g.stripePaymentId } : {}),
  });
  await ctx.db.insert('ledger', { userId, kind: 'grant', millicredits: g.millicredits, grantId, at: now, ...(g.note ? { note: g.note } : {}) });
  if (debt > 0) await ctx.db.insert('ledger', { userId, kind: 'adjust', millicredits: 0, grantId, at: now, note: `${debt} millicredits of overdraft paid from this grant` });
  await addToBalance(ctx, userId, g.millicredits);
  return grantId;
}

/**
 * Takes credits, closest to expiry first (this month's free credit, then last month's plan
 * credit, then this month's, then extra credit), writing a spend row per grant touched. What the
 * grants cannot cover is spent from the overdraft: the balance goes below zero and the next grant
 * pays it back. Returns the balance after.
 */
export async function spend(ctx: MutationCtx, userId: Id<'users'>, millicredits: number, why: { changeId?: Id<'changes'>; usageIds?: Id<'usage'>[]; note?: string }) {
  if (millicredits <= 0) return balanceOf(ctx, userId);
  const now = Date.now();
  let left = millicredits;
  const grants = await ctx.db.query('grants').withIndex('by_user_expires', (q) => q.eq('userId', userId).gt('expiresAt', now)).collect();
  for (const g of grants) {
    if (left <= 0) break;
    if (g.remaining <= 0) continue;
    const take = Math.min(g.remaining, left);
    await ctx.db.patch(g._id, { remaining: g.remaining - take });
    await ctx.db.insert('ledger', { userId, kind: 'spend', millicredits: -take, grantId: g._id, at: now, ...(why.changeId ? { changeId: why.changeId } : {}), ...(why.usageIds ? { usageIds: why.usageIds } : {}), ...(why.note ? { note: why.note } : {}) });
    left -= take;
  }
  if (left > 0) {
    await ctx.db.insert('ledger', { userId, kind: 'spend', millicredits: -left, at: now, note: 'overdraft', ...(why.changeId ? { changeId: why.changeId } : {}), ...(why.usageIds ? { usageIds: why.usageIds } : {}) });
  }
  await addToBalance(ctx, userId, -millicredits);
  return balanceOf(ctx, userId);
}

/** Grants past their date with credits left: an expire row each, the balance lowered in the same mutation. */
export async function expireGrants(ctx: MutationCtx, now: number, limit = 200) {
  const due = await ctx.db.query('grants').withIndex('by_expires', (q) => q.lte('expiresAt', now)).take(limit);
  let n = 0;
  for (const g of due) {
    if (g.remaining <= 0) continue;
    await ctx.db.insert('ledger', { userId: g.userId, kind: 'expire', millicredits: -g.remaining, grantId: g._id, at: now });
    await addToBalance(ctx, g.userId, -g.remaining);
    await ctx.db.patch(g._id, { remaining: 0 });
    n++;
  }
  return n;
}

/**
 * Called on every cloud change: marks the account as using the cloud, makes its subscription row
 * (Free) the first time, and gives this month's free credit if it was not given yet. One free
 * allowance per GitHub account: another account on the same GitHub that got this month's free
 * credit means none here.
 */
export async function onCloudChange(ctx: MutationCtx, user: Doc<'users'>) {
  const now = Date.now();
  if (!user.cloudSince) await ctx.db.patch(user._id, { cloudSince: now });
  let sub = await subscriptionOf(ctx, user._id);
  if (!sub) {
    const id = await ctx.db.insert('subscriptions', {
      userId: user._id,
      plan: 'free',
      interval: 'month',
      status: 'active',
      periodStart: now,
      periodEnd: monthEnd(now),
      cancelAtPeriodEnd: false,
      boxSecondsThisMonth: 0,
      firstAppDone: false,
    });
    sub = (await ctx.db.get(id))!;
  }
  const period = monthKey(now);
  const have = await ctx.db
    .query('grants')
    .withIndex('by_user_source_period', (q) => q.eq('userId', user._id).eq('source', 'free').eq('period', period))
    .first();
  if (have) return sub;
  if (user.githubUserId !== undefined) {
    const twins = await ctx.db.query('users').withIndex('by_github_user', (q) => q.eq('githubUserId', user.githubUserId)).collect();
    for (const t of twins) {
      if (t._id === user._id) continue;
      const theirs = await ctx.db
        .query('grants')
        .withIndex('by_user_source_period', (q) => q.eq('userId', t._id).eq('source', 'free').eq('period', period))
        .first();
      if (theirs) return sub;
    }
  }
  await grant(ctx, user._id, { source: 'free', millicredits: FREE_MONTHLY_MILLICREDITS, expiresAt: monthEnd(now), period, note: 'free monthly credit' });
  return sub;
}
