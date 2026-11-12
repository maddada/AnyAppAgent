// "My PC is off, do this change in the cloud" (docs/CLOUD.md section 3, milestone 9). With the
// switch "Use the cloud when my PC is off" on and the PC linked, the companion keeps each app ready
// in the cloud: after every new version it pushes the code to the app's private repo
// anyapp-cloud-<slug> (a one-repo token) and uploads the app's key once. The Convex row stays
// `place: "pc"` (`keptReady`). When the PC is not reachable, the phone offers "Do it in the cloud":
// the change runs in a box on the PC app's package and key, its rows say "Made in the cloud", and
// the row holds `pcOff` until the PC comes back and pulls it back (commits, chat, build number).
// One place at a time: while a change made in the cloud is not pulled back, the PC pulls it back
// before it takes a change of its own.
import { v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import { internal } from './_generated/api';
import { internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from './_generated/server';
import { freeSlug, imageArg, pendingUserItem, requireGithub, slugify } from './apps';
import { joinOrOpenChange } from './billing';
import { estimateFor } from './estimates';
import { onCloudChange } from './lib/credits';
import { requireUser } from './lib/session';
import type { ChatItem } from '../../shared/protocol';

const PACKAGE_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;

async function rowFor(ctx: QueryCtx, userId: Id<'users'>, packageName: string): Promise<Doc<'apps'> | null> {
  const rows = await ctx.db.query('apps').withIndex('by_package', (q) => q.eq('packageName', packageName)).collect();
  return rows.find((r) => r.userId === userId && !r.deletedAt) ?? null;
}

async function threadFor(ctx: MutationCtx, app: Doc<'apps'>): Promise<Id<'threads'>> {
  const t = await ctx.db.query('threads').withIndex('by_app', (q) => q.eq('appId', app._id)).first();
  if (t) return t._id;
  return ctx.db.insert('threads', { appId: app._id, userId: app.userId, boxState: 'none', lastActiveAt: Date.now(), seq: 1 });
}

// ---------- the PC keeps its apps ready (PC link, `move` scope)

/** The PC registers (or refreshes) one app it keeps ready. A row with a change made in the cloud
 * still to pull back says so: the PC pulls it back first. */
export const ready = internalMutation({
  args: {
    userId: v.id('users'),
    linkId: v.id('pcLinks'),
    pcAppId: v.string(),
    name: v.string(),
    slug: v.string(),
    packageName: v.string(),
    preset: v.optional(v.union(v.literal('react-native'), v.literal('kotlin'), v.literal('expo-exact'))),
    buildHigh: v.number(),
  },
  handler: async (ctx, a) => {
    if (!PACKAGE_RE.test(a.packageName)) throw new Error('That app has no valid package name.');
    const user = (await ctx.db.get(a.userId))!;
    if (!user.pcOffSwitch) return { off: true as const };
    requireGithub(user);
    const others = (await ctx.db.query('apps').withIndex('by_package', (q) => q.eq('packageName', a.packageName)).collect()).filter((r) => !r.deletedAt && r.userId !== a.userId);
    if (others.length) throw new Error('Another account has an app with this package name.');
    let app = await rowFor(ctx, a.userId, a.packageName);
    if (app?.place === 'cloud') return { off: false as const, inCloud: true as const, appId: app._id };
    if (app) {
      await ctx.db.patch(app._id, { keptReady: true, pcLinkId: a.linkId, pcAppId: a.pcAppId, name: a.name.slice(0, 40), ...(app.pcOff ? {} : { buildHigh: Math.max(app.buildHigh, a.buildHigh) }), updatedAt: Date.now() });
    } else {
      const slug = await freeSlug(ctx, a.userId, slugify(a.slug || a.name));
      const id = await ctx.db.insert('apps', {
        userId: a.userId,
        name: a.name.trim().slice(0, 40) || 'My app',
        slug,
        packageName: a.packageName,
        place: 'pc',
        keptReady: true,
        pcLinkId: a.linkId,
        pcAppId: a.pcAppId,
        buildHigh: a.buildHigh,
        preset: a.preset ?? 'react-native',
        iconVersion: 0,
        status: 'idle',
        updatedAt: Date.now(),
      });
      app = (await ctx.db.get(id))!;
    }
    await threadFor(ctx, app);
    const key = await ctx.db.query('keys').withIndex('by_app', (q) => q.eq('appId', app._id)).first();
    const fresh = (await ctx.db.get(app._id))!;
    return { off: false as const, appId: fresh._id, hasKey: Boolean(key), pushedCommit: fresh.pushedCommit ?? null, pcOff: fresh.pcOff ?? null };
  },
});

export const rowOfPcApp = internalQuery({
  args: { userId: v.id('users'), appId: v.string() },
  handler: async (ctx, { userId, appId }) => {
    const id = ctx.db.normalizeId('apps', appId);
    const app = id ? await ctx.db.get(id) : null;
    if (!app || app.userId !== userId || app.deletedAt || app.place !== 'pc') throw new Error('That app is not kept ready here.');
    return app;
  },
});

export const setPushed = internalMutation({
  args: { appId: v.id('apps'), commit: v.string() },
  handler: async (ctx, { appId, commit }) => {
    await ctx.db.patch(appId, { pushedCommit: commit, readyAt: Date.now() });
  },
});

// ---------- the change while the PC is off (the phone, signed in)

/** For a PC app's chat on the phone: can a change run in the cloud now, and about how much. */
export const offer = query({
  args: { packageName: v.string() },
  handler: async (ctx, { packageName }) => {
    let user;
    try {
      user = await requireUser(ctx);
    } catch {
      return null;
    }
    const app = await rowFor(ctx, user._id, packageName);
    if (!app || app.place !== 'pc' || !app.keptReady) return { ready: false as const, switchOn: Boolean(user.pcOffSwitch) };
    const key = await ctx.db.query('keys').withIndex('by_app', (q) => q.eq('appId', app._id)).first();
    if (!key || !app.pushedCommit) return { ready: false as const, switchOn: Boolean(user.pcOffSwitch) };
    const e = await estimateFor(ctx, user, app);
    return { ready: true as const, switchOn: Boolean(user.pcOffSwitch), appId: app._id, estimate: e.next, pcOff: app.pcOff ?? null };
  },
});

/** "Do it in the cloud": the change runs in a box on the PC app's package and key. */
export const change = mutation({
  args: { packageName: v.string(), text: v.string(), images: v.optional(v.array(imageArg)) },
  handler: async (ctx, { packageName, text, images }) => startChange(ctx, await requireUser(ctx), packageName, text, images),
});

/** Dev only (KIWI_ALLOW_WIPE=1): the same change for a test account, from a proof script. */
export const devChange = internalMutation({
  args: { userId: v.id('users'), packageName: v.string(), text: v.string() },
  handler: async (ctx, { userId, packageName, text }) => {
    if (process.env.KIWI_ALLOW_WIPE !== '1') throw new Error('devChange is off (KIWI_ALLOW_WIPE)');
    return startChange(ctx, (await ctx.db.get(userId))!, packageName, text);
  },
});

async function startChange(ctx: MutationCtx, user: Doc<'users'>, packageName: string, text: string, images?: { fileId: Id<'_storage'>; mimeType: string; width?: number; height?: number }[]) {
  if (!user.pcOffSwitch) throw new Error('Turn on "Use the cloud when my PC is off" in your account first.');
  requireGithub(user);
  const app = await rowFor(ctx, user._id, packageName);
  if (!app || app.place !== 'pc' || !app.keptReady || !app.pushedCommit) throw new Error('This app is not ready in the cloud yet. It is, once your PC has made a version with the switch on.');
  const moving = await ctx.db.query('moves').withIndex('by_app', (q) => q.eq('appId', app._id)).filter((q) => q.eq(q.field('state'), 'running')).first();
  if (moving) throw new Error('This app is moving. Try again when it is done.');
  const body = text.trim().slice(0, 8000);
  if (!body && !images?.length) throw new Error('Write a message first.');
  const threadId = await threadFor(ctx, app);
  await onCloudChange(ctx, user);
  const changeId = await joinOrOpenChange(ctx, user, app, threadId);
  const thread = (await ctx.db.get(threadId))!;
  if (!app.pcOff) {
    // From the next row on: above the thread's counter and above every row already in the chat.
    const last = await ctx.db.query('messages').withIndex('by_thread_seq', (q) => q.eq('threadId', threadId).eq('workerId', undefined)).order('desc').first();
    await ctx.db.patch(app._id, { pcOff: { since: Date.now(), fromSeq: Math.max(thread.seq, (last?.seq ?? 0) + 1) } });
  }
  const inboxId = await ctx.db.insert('inbox', { threadId, changeId, kind: 'prompt', payload: { text: body, images: images ?? [], pcOff: true } });
  await pendingUserItem(ctx, threadId, app._id, inboxId, body, images);
  await ctx.scheduler.runAfter(0, internal.boxes.ensure, { threadId });
  return app._id;
}

// ---------- pulling back (the PC, when it is on again)

/** The kept-ready apps of this PC with changes made in the cloud to pull back. */
export const toPullBack = internalQuery({
  args: { userId: v.id('users'), linkId: v.id('pcLinks') },
  handler: async (ctx, { userId }) => {
    const rows = await ctx.db.query('apps').withIndex('by_user', (q) => q.eq('userId', userId)).collect();
    const out = [];
    for (const a of rows) {
      if (a.deletedAt || a.place !== 'pc' || !a.pcOff) continue;
      const thread = await ctx.db.query('threads').withIndex('by_app', (q) => q.eq('appId', a._id)).first();
      const open = thread ? await ctx.db.query('changes').withIndex('by_thread_state', (q) => q.eq('threadId', thread._id).eq('state', 'running')).first() : null;
      const queued = thread ? await ctx.db.query('changes').withIndex('by_thread_state', (q) => q.eq('threadId', thread._id).eq('state', 'queued')).first() : null;
      out.push({ appId: a._id, pcAppId: a.pcAppId ?? null, packageName: a.packageName, repo: a.repo ?? null, buildHigh: a.buildHigh, busy: Boolean(open || queued || thread?.busy), latestApk: a.latestApk ?? null });
    }
    return out;
  },
});

/** The chat rows the cloud made while the PC was off (they come back marked "Made in the cloud"). */
export const pullBackChat = internalQuery({
  args: { appId: v.id('apps') },
  handler: async (ctx, { appId }) => {
    const app = (await ctx.db.get(appId))!;
    const thread = await ctx.db.query('threads').withIndex('by_app', (q) => q.eq('appId', appId)).first();
    if (!thread || !app.pcOff) return { items: [] as ChatItem[] };
    const rows = await ctx.db.query('messages').withIndex('by_thread_seq', (q) => q.eq('threadId', thread._id).eq('workerId', undefined).gte('seq', app.pcOff!.fromSeq)).collect();
    // Rows of this change only: from its first row on, and made since it started.
    const since = app.pcOff.since - 5_000;
    return {
      items: rows
        .filter((r) => !r.itemId.startsWith('inbox-'))
        .map((r) => r.item as ChatItem)
        .filter((i) => !i.createdAt || Date.parse(i.createdAt) >= since),
    };
  },
});

/** The PC has the commits, the chat and the build number: the cloud lets go (its box goes). */
export const pulledBack = internalMutation({
  args: { appId: v.id('apps'), commit: v.string() },
  handler: async (ctx, { appId, commit }) => {
    const app = (await ctx.db.get(appId))!;
    await ctx.db.patch(appId, { pcOff: undefined, pushedCommit: commit, updatedAt: Date.now() });
    const thread = await ctx.db.query('threads').withIndex('by_app', (q) => q.eq('appId', app._id)).first();
    if (thread) await ctx.scheduler.runAfter(0, internal.boxes.retire, { threadId: thread._id });
    return { buildHigh: app.buildHigh };
  },
});
