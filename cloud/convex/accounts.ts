// The Kiwimake account (docs/CLOUD.md section 3, "One account, two places"): who is signed in,
// which places make their apps (the cloud, linked PCs), their credits. The account exists without
// GitHub, a plan or a PC.
import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { EXTRA_PACK, FREE_MONTHLY_MILLICREDITS, PLANS } from './config';
import { randomToken, seal, sha256Hex } from './lib/crypto';
import { balanceOf, subscriptionOf } from './lib/credits';
import { requireUser } from './lib/session';

export const me = query({
  args: {},
  handler: async (ctx) => {
    let user;
    try {
      user = await requireUser(ctx);
    } catch {
      return null;
    }
    const sub = await subscriptionOf(ctx, user._id);
    const links = await ctx.db.query('pcLinks').withIndex('by_user', (q) => q.eq('userId', user._id)).collect();
    return {
      id: user._id,
      name: user.name ?? null,
      email: user.email ?? null,
      anonymous: Boolean(user.isAnonymous),
      cloud: {
        added: Boolean(user.githubLogin && !user.githubDisconnectedAt),
        since: user.cloudSince ?? null,
        github: user.githubLogin ? { login: user.githubLogin, connected: !user.githubDisconnectedAt } : null,
      },
      pcOffSwitch: Boolean(user.pcOffSwitch),
      plan: sub ? { id: sub.plan, name: PLANS[sub.plan].name, interval: sub.interval, status: sub.status, renewsAt: sub.periodEnd, cancelAtPeriodEnd: sub.cancelAtPeriodEnd } : { id: 'free', name: 'Free' },
      credits: (await balanceOf(ctx, user._id)) / 1000,
      pcs: links.filter((l) => !l.revokedAt).map((l) => ({ id: l._id, name: l.deviceName, linkedFrom: l.linkedFrom, lastSeenAt: l.lastSeenAt ?? null })),
    };
  },
});

/** "Use the cloud when my PC is off". */
export const setPcOffSwitch = mutation({
  args: { on: v.boolean() },
  handler: async (ctx, { on }) => {
    const user = await requireUser(ctx);
    await ctx.db.patch(user._id, { pcOffSwitch: on });
  },
});

/**
 * A PC link (section 3, "The PC link"), made by a signed-in phone or desktop for one PC. The token
 * is returned once and stored only as its hash. Milestone 7 adds the pairing hand-over around it.
 */
export const createPcLink = mutation({
  args: { deviceName: v.string(), linkedFrom: v.union(v.literal('phone'), v.literal('pc')) },
  handler: async (ctx, { deviceName, linkedFrom }) => {
    const user = await requireUser(ctx);
    const token = `kpc_${randomToken()}`;
    const id = await ctx.db.insert('pcLinks', {
      userId: user._id,
      tokenHash: await sha256Hex(token),
      deviceName: deviceName.trim().slice(0, 60) || 'My PC',
      scopes: ['share', 'web', 'move'],
      linkedFrom,
      createdAt: Date.now(),
    });
    return { id, token };
  },
});

export const revokePcLink = mutation({
  args: { id: v.id('pcLinks') },
  handler: async (ctx, { id }) => {
    const user = await requireUser(ctx);
    const link = await ctx.db.get(id);
    if (!link || link.userId !== user._id) throw new Error('That PC is not linked.');
    await ctx.db.patch(id, { revokedAt: Date.now() });
  },
});

/** The plans and the extra credit pack, for "Your plan" (prices in cents, credits a month). */
export const plans = query({
  args: {},
  handler: async () => ({
    plans: (['starter', 'pro', 'max', 'ownKey'] as const).map((id) => ({
      id,
      name: PLANS[id].name,
      monthCents: PLANS[id].cents.month,
      yearCents: PLANS[id].cents.year,
      credits: PLANS[id].monthlyMillicredits / 1000,
    })),
    extra: { cents: EXTRA_PACK.cents, credits: EXTRA_PACK.millicredits / 1000, months: 12 },
    free: { credits: FREE_MONTHLY_MILLICREDITS / 1000 },
  }),
});

/** The person's own Anthropic key (the Own key plan), sealed; only its last 4 characters show. */
export const setOwnKey = mutation({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    const user = await requireUser(ctx);
    const k = key.trim();
    if (!/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(k)) throw new Error('That does not look like an Anthropic API key. It starts with sk-ant-.');
    const box = await seal(k, `anthropic:${user._id}`);
    const old = await ctx.db.query('secrets').withIndex('by_user_kind', (q) => q.eq('userId', user._id).eq('kind', 'anthropic')).first();
    const row = { userId: user._id, kind: 'anthropic' as const, iv: box.iv, ciphertext: box.ciphertext, last4: k.slice(-4) };
    if (old) await ctx.db.replace(old._id, row);
    else await ctx.db.insert('secrets', row);
    return { last4: row.last4 };
  },
});

export const removeOwnKey = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const old = await ctx.db.query('secrets').withIndex('by_user_kind', (q) => q.eq('userId', user._id).eq('kind', 'anthropic')).first();
    if (old) await ctx.db.delete(old._id);
  },
});

export const ownKey = query({
  args: {},
  handler: async (ctx) => {
    let user;
    try {
      user = await requireUser(ctx);
    } catch {
      return null;
    }
    const row = await ctx.db.query('secrets').withIndex('by_user_kind', (q) => q.eq('userId', user._id).eq('kind', 'anthropic')).first();
    return row ? { last4: row.last4 ?? '' } : null;
  },
});
