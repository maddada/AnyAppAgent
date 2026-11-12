// Credits and metering (docs/CLOUD.md section 5). A change is one message's work: it is opened when
// the person sends (after the credit gate), priced turn by turn from the runner's usage (each
// model at its list price) and the box's running time, spent from the person's grants closest to
// expiry first, and settled when the runner says it is idle (rounded up to a tenth of a credit).
// On the Own key plan the AI is on their key: only machine time counts, against 30 hours a month.
// The person only ever sees credits.
import { v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import { internalMutation, internalQuery, query, type MutationCtx } from './_generated/server';
import {
  BOX_MICROS_PER_HOUR,
  FIRST_APP_CAP_MILLICREDITS,
  microsToMillicredits,
  MODEL_PRICES,
  OVERDRAFT_MILLICREDITS,
  OWN_KEY_EXTRA_MILLICREDITS_PER_HOUR,
  OWN_KEY_FAIR_USE_SECONDS,
  roundUpToTenth,
} from './config';
import { estimateFor } from './estimates';
import { balanceOf, expireGrants, spend, subscriptionOf } from './lib/credits';
import { ownApp, requireUser } from './lib/session';

type Tokens = { inputTokens: number; outputTokens: number; cacheWriteTokens: number; cacheReadTokens: number };

/** A turn's AI at list price, in micros. An unknown model is priced as Opus (never under). */
export function priceTokens(model: string | undefined, t: Tokens): number {
  const p = MODEL_PRICES[model ?? ''] ?? MODEL_PRICES['claude-opus-5-5']!;
  return Math.ceil((t.inputTokens * p[0] + t.outputTokens * p[1] + t.cacheWriteTokens * p[2] + t.cacheReadTokens * p[3]) / 1e6);
}

export const machineMicros = (seconds: number) => Math.ceil((seconds * BOX_MICROS_PER_HOUR) / 3600);

/** Whether this person's AI runs on their own key (the Own key plan, with a key saved). */
async function ownKeyPlan(ctx: MutationCtx, userId: Id<'users'>) {
  const sub = await subscriptionOf(ctx, userId);
  return sub?.plan === 'ownKey' && sub.status === 'active';
}

/**
 * The credit gate and a new change, in the mutation that sends the message: refused when the
 * available credits do not cover the high end of the estimate (the first app asks only for 3).
 */
export async function openChange(ctx: MutationCtx, user: Doc<'users'>, app: Doc<'apps'>, threadId: Id<'threads'>): Promise<Id<'changes'>> {
  const e = await estimateFor(ctx, user, app);
  const own = await ownKeyPlan(ctx, user._id);
  const sub = await subscriptionOf(ctx, user._id);
  const balance = await balanceOf(ctx, user._id);
  const need = own
    ? (sub?.boxSecondsThisMonth ?? 0) >= OWN_KEY_FAIR_USE_SECONDS
      ? OWN_KEY_EXTRA_MILLICREDITS_PER_HOUR / 2
      : 0
    : e.firstApp
      ? FIRST_APP_CAP_MILLICREDITS
      : e.next.high;
  if (need > 0 && balance < need) {
    const short = Math.round(need / 100) / 10;
    throw new Error(
      own
        ? 'Your 30 machine hours this month are used up. Extra credit pays for more.'
        : `This change needs about ${short} ${short === 1 ? 'credit' : 'credits'} and you have ${Math.max(0, Math.round(balance / 100) / 10)}. Get extra credit or a plan to go on.`,
    );
  }
  return ctx.db.insert('changes', {
    appId: app._id,
    threadId,
    userId: user._id,
    messageItemId: '',
    estimate: { costMicros: 0, millicredits: e.next.millicredits, low: e.next.low, high: e.next.high, levels: [] },
    actual: { machineMicros: 0, aiMicros: 0, millicredits: 0 },
    aiPaidBy: own ? 'ownKey' : 'credit',
    ...(e.firstApp && !own ? { firstApp: true } : {}),
    state: 'queued',
    startedAt: Date.now(),
  });
}

/** The change the runner is working on now: the newest running one, else the newest queued, else the last. */
async function currentChange(ctx: MutationCtx, threadId: Id<'threads'>): Promise<Doc<'changes'> | null> {
  const running = await ctx.db.query('changes').withIndex('by_thread_state', (q) => q.eq('threadId', threadId).eq('state', 'running')).order('desc').first();
  if (running) return running;
  const queued = await ctx.db.query('changes').withIndex('by_thread_state', (q) => q.eq('threadId', threadId).eq('state', 'queued')).order('asc').first();
  if (queued) {
    await ctx.db.patch(queued._id, { state: 'running', startedAt: Date.now() });
    return (await ctx.db.get(queued._id))!;
  }
  return ctx.db.query('changes').filter((q) => q.eq(q.field('threadId'), threadId)).order('desc').first();
}

/** Charges millicredits to a change: the first app's cap, then the grants (or the overdraft). */
async function charge(ctx: MutationCtx, change: Doc<'changes'>, millicredits: number, extra: { aiMicros?: number; machineMicros?: number; usageIds?: Id<'usage'>[] }) {
  let take = millicredits;
  if (change.firstApp) {
    const room = Math.max(0, FIRST_APP_CAP_MILLICREDITS - change.actual.millicredits);
    if (take > room) {
      await ctx.db.insert('ledger', { userId: change.userId, kind: 'adjust', millicredits: 0, changeId: change._id, at: Date.now(), note: `first app: ${take - room} millicredits over the cap, on us` });
      take = room;
    }
  }
  await ctx.db.patch(change._id, {
    actual: {
      aiMicros: change.actual.aiMicros + (extra.aiMicros ?? 0),
      machineMicros: change.actual.machineMicros + (extra.machineMicros ?? 0),
      millicredits: change.actual.millicredits + take,
    },
  });
  const balance = await spend(ctx, change.userId, take, { changeId: change._id, ...(extra.usageIds ? { usageIds: extra.usageIds } : {}) });
  // The hard stop: past the balance plus a small overdraft, the runner stops the change.
  if (balance < -OVERDRAFT_MILLICREDITS && change.state === 'running') {
    await ctx.db.patch(change._id, { state: 'stopped' });
    await ctx.db.insert('inbox', { threadId: change.threadId, kind: 'cancel', payload: { reason: 'credits' } });
    const thread = await ctx.db.get(change.threadId);
    if (thread) {
      const at = Date.now();
      const id = `credits-${change._id}`;
      await ctx.db.insert('messages', {
        threadId: change.threadId,
        itemId: id,
        seq: thread.seq,
        item: { id, appId: change.appId, seq: thread.seq, kind: 'error', text: 'Stopped: you are out of credits. Get extra credit or a plan, then ask again.', createdAt: new Date(at).toISOString(), updatedAt: new Date(at).toISOString() },
        updatedAt: at,
      });
      await ctx.db.patch(change.threadId, { seq: thread.seq + 1 });
    }
  }
}

/** Rounds a change up to a tenth of a credit (spent at once), never past the first app's cap. */
async function roundUp(ctx: MutationCtx, changeId: Id<'changes'>) {
  const c = (await ctx.db.get(changeId))!;
  let up = roundUpToTenth(c.actual.millicredits) - c.actual.millicredits;
  if (c.firstApp) up = Math.min(up, Math.max(0, FIRST_APP_CAP_MILLICREDITS - c.actual.millicredits));
  if (up <= 0) return;
  await spend(ctx, c.userId, up, { changeId, note: 'rounded up to a tenth of a credit' });
  await ctx.db.patch(changeId, { actual: { ...c.actual, millicredits: c.actual.millicredits + up } });
}

/** One finished agent turn's usage (a runner "usage" event): priced, tagged, charged. */
export async function recordUsage(
  ctx: MutationCtx,
  threadId: Id<'threads'>,
  u: { model?: string; effort?: string; tag?: Record<string, string>; usage: Tokens },
) {
  const change = await currentChange(ctx, threadId);
  if (!change) return;
  const costMicros = priceTokens(u.model, u.usage);
  const credit = change.aiPaidBy === 'credit';
  const millicredits = credit ? microsToMillicredits(costMicros) : 0;
  const usageId = await ctx.db.insert('usage', {
    userId: change.userId,
    appId: change.appId,
    threadId,
    changeId: change._id,
    kind: 'inference',
    ...(u.tag?.workerId ? { workerId: u.tag.workerId } : {}),
    level: u.tag?.level ?? (u.tag?.role === 'orchestrator' ? 'orchestrator' : undefined),
    ...(u.model ? { model: u.model } : {}),
    ...(u.effort ? { effort: u.effort } : {}),
    tokens: { inputTokens: u.usage.inputTokens, outputTokens: u.usage.outputTokens, cacheWriteTokens: u.usage.cacheWriteTokens, cacheReadTokens: u.usage.cacheReadTokens },
    costMicros,
    millicredits,
    settled: true,
    at: Date.now(),
  });
  await charge(ctx, change, millicredits, { aiMicros: costMicros, usageIds: [usageId] });
  // A turn that ends after the change was settled (the orchestrator's last words): round again.
  if (change.state === 'done') await roundUp(ctx, change._id);
}

/** The runner says it is idle: every running change is settled (machine time, rounding up). */
export async function settleChanges(ctx: MutationCtx, threadId: Id<'threads'>) {
  const running = await ctx.db.query('changes').withIndex('by_thread_state', (q) => q.eq('threadId', threadId).eq('state', 'running')).collect();
  const now = Date.now();
  for (const c of running) {
    const seconds = Math.max(0, Math.round((now - c.startedAt) / 1000));
    const micros = machineMicros(seconds);
    const usageId = await ctx.db.insert('usage', {
      userId: c.userId,
      appId: c.appId,
      threadId,
      changeId: c._id,
      kind: 'machine',
      seconds,
      size: '4x8',
      costMicros: micros,
      millicredits: 0,
      settled: true,
      at: now,
    });
    let millicredits = 0;
    if (c.aiPaidBy === 'credit') {
      millicredits = microsToMillicredits(micros);
    } else {
      // Own key plan: machine time counts against the fair use; past it, half a credit an hour.
      const sub = await subscriptionOf(ctx, c.userId);
      if (sub) {
        const before = sub.boxSecondsThisMonth;
        const after = before + seconds;
        await ctx.db.patch(sub._id, { boxSecondsThisMonth: after });
        const over = Math.max(0, after - Math.max(before, OWN_KEY_FAIR_USE_SECONDS));
        millicredits = Math.ceil((over * OWN_KEY_EXTRA_MILLICREDITS_PER_HOUR) / 3600);
      }
    }
    await ctx.db.patch(usageId, { millicredits });
    const fresh = (await ctx.db.get(c._id))!;
    await charge(ctx, fresh, millicredits, { machineMicros: micros, usageIds: [usageId] });
    await roundUp(ctx, c._id);
    const settled = (await ctx.db.get(c._id))!;
    await ctx.db.patch(c._id, { state: settled.state === 'stopped' ? 'stopped' : 'done', endedAt: now });
    if (settled.firstApp) {
      const sub = await subscriptionOf(ctx, c.userId);
      if (sub && !sub.firstAppDone) await ctx.db.patch(sub._id, { firstAppDone: true });
    }
  }
}

/** The runner made the change's message its own chat item: the usage line can find its change. */
export async function linkMessage(ctx: MutationCtx, inboxId: string, itemId: string) {
  const id = ctx.db.normalizeId('inbox', inboxId);
  const row = id ? await ctx.db.get(id) : null;
  if (row?.changeId) await ctx.db.patch(row.changeId, { messageItemId: itemId });
}

// ---------- crons

/** Daily: grants past their date. */
export const expire = internalMutation({
  args: {},
  handler: async (ctx) => expireGrants(ctx, Date.now()),
});

/** Daily: everyone's 25th, 50th and 75th percentile per change kind (last 30 days), for estimates. */
export const medians = internalMutation({
  args: {},
  handler: async (ctx) => {
    const since = Date.now() - 30 * 24 * 3600_000;
    const done = (await ctx.db.query('changes').collect()).filter((c) => c.state === 'done' && c.startedAt > since && c.aiPaidBy === 'credit');
    const q = (xs: number[]) => {
      const s = [...xs].sort((a, b) => a - b);
      const at = (p: number) => s[Math.min(s.length - 1, Math.round((s.length - 1) * p))]!;
      return s.length >= 3 ? [at(0.25), at(0.5), at(0.75)] : undefined;
    };
    const value = { newApp: q(done.filter((c) => c.firstApp).map((c) => c.actual.millicredits)), change: q(done.filter((c) => !c.firstApp).map((c) => c.actual.millicredits)), at: Date.now(), n: done.length };
    const row = await ctx.db.query('meta').withIndex('by_key', (x) => x.eq('key', 'medians')).first();
    if (row) await ctx.db.patch(row._id, { value });
    else await ctx.db.insert('meta', { key: 'medians', value });
    return value;
  },
});

// ---------- for the phone

/** A cloud app's changes with what each used (the per-app credits line and the chat's usage lines). */
export const changesOf = query({
  args: { appId: v.string() },
  handler: async (ctx, { appId }) => {
    const user = await requireUser(ctx);
    const app = await ownApp(ctx, user._id, appId);
    const rows = await ctx.db.query('changes').withIndex('by_app_at', (q) => q.eq('appId', app._id)).order('desc').take(50);
    return rows.map((c) => ({ id: c._id, state: c.state, millicredits: c.actual.millicredits, estimate: c.estimate?.millicredits ?? null, at: c.startedAt, ownKey: c.aiPaidBy === 'ownKey' }));
  },
});

/** Dev and checks: what a thread's changes cost us and used (never shown to the person). */
export const costOf = internalQuery({
  args: { appId: v.id('apps') },
  handler: async (ctx, { appId }) => {
    const rows = await ctx.db.query('changes').withIndex('by_app_at', (q) => q.eq('appId', appId)).collect();
    const usage = await ctx.db.query('usage').withIndex('by_app_level', (q) => q.eq('appId', appId)).collect();
    return {
      changes: rows.map((c) => ({ state: c.state, firstApp: Boolean(c.firstApp), estimate: c.estimate, actual: c.actual, seconds: c.endedAt ? Math.round((c.endedAt - c.startedAt) / 1000) : null })),
      byLevel: Object.entries(
        usage.reduce<Record<string, number>>((acc, u) => {
          const k = `${u.kind}:${u.level ?? '-'}:${u.model ?? '-'}`;
          acc[k] = (acc[k] ?? 0) + u.costMicros;
          return acc;
        }, {}),
      ),
    };
  },
});

