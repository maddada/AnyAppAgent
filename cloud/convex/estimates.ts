// Estimates in credits before every change (docs/CLOUD.md section 2, "Estimates before every
// change"): under the message box, on a plan card, and per app. From this app's past changes when
// it has some, else section 7's defaults. Milestone 6 adds everyone's medians per level.
import { v } from 'convex/values';
import type { CreditEstimate } from '../../shared/protocol';
import type { Doc, Id } from './_generated/dataModel';
import { query, type QueryCtx } from './_generated/server';
import { CREDIT_COST_MICROS, FIRST_APP_CAP_MILLICREDITS } from './config';
import { subscriptionOf } from './lib/credits';
import { ownApp, requireUser } from './lib/session';

/** Section 7's typical changes, in millicredits: what an estimate says before there is history. */
export const DEFAULTS = {
  small: { low: 800, mid: 1000, high: 1500 },
  fewFiles: { low: 1800, mid: 2200, high: 2800 },
  acrossAreas: { low: 2800, mid: 3300, high: 4000 },
  newApp: { low: 3500, mid: 4300, high: 5200 },
};

function percentile(sorted: number[], p: number) {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[i]!;
}

/** Rounded to a tenth of a credit, as the person sees credits. */
const tenth = (m: number) => Math.round(m / 100) * 100;

async function pastChanges(ctx: QueryCtx, appId: Id<'apps'>): Promise<number[]> {
  const rows = await ctx.db.query('changes').withIndex('by_app_at', (q) => q.eq('appId', appId)).order('desc').take(10);
  return rows.filter((c) => c.state === 'done').map((c) => c.actual.millicredits).sort((a, b) => a - b);
}

function estimate(sorted: number[], fallback: { low: number; mid: number; high: number }, ownKey: boolean): CreditEstimate {
  const e =
    sorted.length >= 3
      ? { millicredits: tenth(percentile(sorted, 0.5)), low: tenth(percentile(sorted, 0.25)), high: tenth(percentile(sorted, 0.75)), basis: 'app' as const }
      : { millicredits: fallback.mid, low: fallback.low, high: fallback.high, basis: 'default' as const };
  if (!ownKey) return e;
  // On their own key: what the AI likely costs them there (our credit basis is cost, so the same number in dollars).
  return { millicredits: 0, low: 0, high: 0, basis: e.basis, ownKeyCents: Math.max(1, Math.round((e.millicredits * CREDIT_COST_MICROS) / 1000 / 10_000)) };
}

/** Everyone's medians (a daily job writes them to meta "medians"): the basis for a new app's estimate. */
async function everyone(ctx: QueryCtx): Promise<{ newApp?: number[]; change?: number[] } | null> {
  const row = await ctx.db.query('meta').withIndex('by_key', (q) => q.eq('key', 'medians')).first();
  return (row?.value as { newApp?: number[]; change?: number[] }) ?? null;
}

function fromEveryone(q: number[] | undefined, ownKey: boolean): CreditEstimate | null {
  if (!q || q.length !== 3) return null;
  const e: CreditEstimate = { low: tenth(q[0]!), millicredits: tenth(q[1]!), high: tenth(q[2]!), basis: 'everyone' };
  return ownKey ? { millicredits: 0, low: 0, high: 0, basis: 'everyone', ownKeyCents: Math.max(1, Math.round((e.millicredits * CREDIT_COST_MICROS) / 1000 / 10_000)) } : e;
}

/** The estimates for one app (the message box, a plan card, the app's month), for queries and the credit gate. */
export async function estimateFor(ctx: QueryCtx, user: Doc<'users'>, app: Doc<'apps'>) {
  {
    const sub = await subscriptionOf(ctx, user._id);
    const ownKey = sub?.plan === 'ownKey';
    const past = await pastChanges(ctx, app._id);
    const firstApp = !(sub?.firstAppDone ?? false) && app.buildHigh === 0;
    const all = await everyone(ctx);
    const next =
      past.length >= 3
        ? estimate(past, DEFAULTS.small, ownKey)
        : (fromEveryone(app.buildHigh === 0 ? all?.newApp : all?.change, ownKey) ?? estimate([], app.buildHigh === 0 ? DEFAULTS.newApp : DEFAULTS.small, ownKey));
    // The first new app uses at most 3 credits (section 2).
    if (firstApp && !ownKey) Object.assign(next, { millicredits: Math.min(next.millicredits, FIRST_APP_CAP_MILLICREDITS), low: Math.min(next.low, FIRST_APP_CAP_MILLICREDITS), high: Math.min(next.high, FIRST_APP_CAP_MILLICREDITS) });
    // A plan card stands for a bigger change: across areas, or a new app.
    const plan = estimate([], app.buildHigh === 0 ? DEFAULTS.newApp : DEFAULTS.acrossAreas, ownKey);
    if (firstApp && !ownKey) Object.assign(plan, { millicredits: FIRST_APP_CAP_MILLICREDITS, low: FIRST_APP_CAP_MILLICREDITS, high: FIRST_APP_CAP_MILLICREDITS });
    // This month: what it used, and what it likely uses at this pace (its last 30 days).
    const since = Date.now() - 30 * 24 * 3600_000;
    const monthStart = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1);
    const recent = await ctx.db.query('changes').withIndex('by_app_at', (q) => q.eq('appId', app._id).gt('startedAt', since)).collect();
    const used = recent.filter((c) => c.startedAt >= monthStart).reduce((n, c) => n + c.actual.millicredits, 0);
    const pace = recent.reduce((n, c) => n + c.actual.millicredits, 0);
    return { next, plan, month: { usedMillicredits: tenth(used), paceMillicredits: tenth(pace), changes: recent.length }, firstApp };
  }
}

export const forApp = query({
  args: { appId: v.string() },
  handler: async (ctx, { appId }) => {
    const user = await requireUser(ctx);
    const app: Doc<'apps'> = await ownApp(ctx, user._id, appId);
    return estimateFor(ctx, user, app);
  },
});
