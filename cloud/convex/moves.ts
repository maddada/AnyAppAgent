// Moving an app between a PC and the cloud, both ways (docs/CLOUD.md section 3, "Moving an app",
// milestone 8). A move is one `moves` row with its steps; the PC (through its PC link, `move`
// scope) does the work and reports each step, so a move that stops halfway is resumed from the row,
// and nothing is given up on either side until the other side has the code, the key and the chat.
//
// To the cloud: the app gets a Convex row (same package name, `place: "pc"` until the move ends),
// its private repo anyapp-cloud-<slug> is made with the person's GitHub user token, the PC pushes
// the code with a one-repo token, uploads the key sealed to Convex's transport key, copies the
// chat and to-dos, and finishes with its highest build number: the row becomes `place: "cloud"`.
// To the PC: the PC clones the repo, takes the key sealed to a key it made for this request, the
// chat and to-dos, and finishes: the row becomes `place: "pc"` and its box goes.
import { v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import { internal } from './_generated/api';
import { internalMutation, internalQuery, type MutationCtx } from './_generated/server';
import { freeSlug, requireGithub, slugify } from './apps';
import type { ChatItem, TodoItem } from '../../shared/protocol';

export type MoveKind = 'toCloud' | 'toPc';
const PACKAGE_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
const iso = (t: number) => new Date(t).toISOString();

async function liveMove(ctx: MutationCtx, appId: Id<'apps'>) {
  return ctx.db
    .query('moves')
    .withIndex('by_app', (q) => q.eq('appId', appId))
    .filter((q) => q.eq(q.field('state'), 'running'))
    .first();
}

/** The move, checked: it belongs to this PC's owner and is still running. */
export async function moveOf(ctx: MutationCtx, moveId: string, userId: Id<'users'>): Promise<Doc<'moves'>> {
  const id = ctx.db.normalizeId('moves', moveId);
  const m = id ? await ctx.db.get(id) : null;
  if (!m || m.userId !== userId) throw new Error('That move is not here.');
  if (m.state !== 'running') throw new Error(m.state === 'done' ? 'That move is finished already.' : 'That move was stopped. Start it again.');
  return m;
}

async function threadFor(ctx: MutationCtx, app: Doc<'apps'>): Promise<Id<'threads'>> {
  const t = await ctx.db.query('threads').withIndex('by_app', (q) => q.eq('appId', app._id)).first();
  if (t) return t._id;
  return ctx.db.insert('threads', { appId: app._id, userId: app.userId, boxState: 'none', lastActiveAt: Date.now(), seq: 1 });
}

/**
 * Starts (or resumes) moving a PC app to the cloud. The same PC app moving again resumes its
 * running move; a package the cloud already makes is refused.
 */
export const startToCloud = internalMutation({
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
    const user = (await ctx.db.get(a.userId))!;
    requireGithub(user);
    if (!PACKAGE_RE.test(a.packageName)) throw new Error('That app has no valid package name.');
    const mine = (await ctx.db.query('apps').withIndex('by_package', (q) => q.eq('packageName', a.packageName)).collect()).filter((r) => !r.deletedAt);
    if (mine.some((r) => r.userId !== a.userId)) throw new Error('Another account has an app with this package name.');
    let app = mine.find((r) => r.userId === a.userId) ?? null;
    if (app?.place === 'cloud') throw new Error('This app is in the cloud already.');
    if (app) {
      const running = await liveMove(ctx, app._id);
      if (running && running.kind === 'toCloud' && running.pcLinkId === a.linkId) return { moveId: running._id, appId: app._id, resumed: true };
      if (running) throw new Error('This app is already moving.');
      await ctx.db.patch(app._id, { pcLinkId: a.linkId, pcAppId: a.pcAppId, name: a.name.slice(0, 40), buildHigh: Math.max(app.buildHigh, a.buildHigh), updatedAt: Date.now() });
    } else {
      const slug = await freeSlug(ctx, a.userId, slugify(a.slug || a.name));
      const appId = await ctx.db.insert('apps', {
        userId: a.userId,
        name: a.name.trim().slice(0, 40) || 'My app',
        slug,
        packageName: a.packageName,
        place: 'pc',
        pcLinkId: a.linkId,
        pcAppId: a.pcAppId,
        buildHigh: a.buildHigh,
        preset: a.preset ?? 'react-native',
        iconVersion: 0,
        status: 'idle',
        updatedAt: Date.now(),
      });
      app = (await ctx.db.get(appId))!;
    }
    await threadFor(ctx, app);
    const moveId = await ctx.db.insert('moves', { appId: app._id, userId: a.userId, pcLinkId: a.linkId, kind: 'toCloud', steps: {}, state: 'running', startedAt: Date.now() });
    return { moveId, appId: app._id, resumed: false };
  },
});

/** Starts (or resumes) moving a cloud app to this PC. Refused while the app is in a change. */
export const startToPc = internalMutation({
  args: { userId: v.id('users'), linkId: v.id('pcLinks'), appId: v.string() },
  handler: async (ctx, a) => {
    const id = ctx.db.normalizeId('apps', a.appId);
    const app = id ? await ctx.db.get(id) : null;
    if (!app || app.userId !== a.userId || app.deletedAt) throw new Error('That app is not here any more.');
    if (app.place !== 'cloud') throw new Error('This app is not in the cloud.');
    if (!app.repo || app.buildHigh < 1) throw new Error('This app has no version yet. Move it once it has one.');
    const running = await liveMove(ctx, app._id);
    if (running && running.kind === 'toPc' && running.pcLinkId === a.linkId) return { moveId: running._id, ...(await describe(ctx, app)) };
    if (running) throw new Error('This app is already moving.');
    const thread = await ctx.db.query('threads').withIndex('by_app', (q) => q.eq('appId', app._id)).first();
    if (thread) {
      const open = await ctx.db.query('changes').withIndex('by_thread_state', (q) => q.eq('threadId', thread._id).eq('state', 'running')).first();
      const queued = await ctx.db.query('changes').withIndex('by_thread_state', (q) => q.eq('threadId', thread._id).eq('state', 'queued')).first();
      if (open || queued || thread.busy) throw new Error('This app is working on a change. Move it when the change is done.');
    }
    const moveId = await ctx.db.insert('moves', { appId: app._id, userId: a.userId, pcLinkId: a.linkId, kind: 'toPc', steps: {}, state: 'running', startedAt: Date.now() });
    return { moveId, ...(await describe(ctx, app)) };
  },
});

async function describe(ctx: MutationCtx, app: Doc<'apps'>) {
  const key = await ctx.db.query('keys').withIndex('by_app', (q) => q.eq('appId', app._id)).first();
  return {
    appId: app._id,
    name: app.name,
    slug: app.slug,
    packageName: app.packageName,
    preset: app.preset ?? 'react-native',
    repo: app.repo!,
    buildHigh: app.buildHigh,
    latestApk: app.latestApk ?? null,
    certSha256: key?.certSha256 ?? null,
  };
}

/** The app a move is for (the http actions use it for repo tokens and keys). */
export const appOfMove = internalMutation({
  args: { moveId: v.string(), userId: v.id('users') },
  handler: async (ctx, { moveId, userId }) => {
    const m = await moveOf(ctx, moveId, userId);
    const app = (await ctx.db.get(m.appId))!;
    return { move: m, app };
  },
});

export const markStep = internalMutation({
  args: { moveId: v.id('moves'), step: v.union(v.literal('code'), v.literal('key'), v.literal('chat')), commit: v.optional(v.string()) },
  handler: async (ctx, { moveId, step, commit }) => {
    const m = (await ctx.db.get(moveId))!;
    await ctx.db.patch(moveId, { steps: { ...m.steps, [step]: Date.now() } });
    if (step === 'code' && commit) await ctx.db.patch(m.appId, { pushedCommit: commit });
  },
});

/**
 * The PC's chat (main chat only; helpers' own chats stay on the PC) and to-dos, in batches. The
 * items keep their ids and seq, so a resumed move writes each once.
 */
export const putChat = internalMutation({
  args: { moveId: v.string(), userId: v.id('users'), items: v.array(v.any()), todos: v.optional(v.array(v.any())), last: v.boolean() },
  handler: async (ctx, { moveId, userId, items, todos, last }) => {
    const m = await moveOf(ctx, moveId, userId);
    if (m.kind !== 'toCloud') throw new Error('Not a move to the cloud.');
    const app = (await ctx.db.get(m.appId))!;
    const threadId = await threadFor(ctx, app);
    let high = 0;
    for (const raw of items.slice(0, 200) as ChatItem[]) {
      if (!raw || typeof raw.id !== 'string' || typeof raw.seq !== 'number' || raw.workerId) continue;
      const item = { ...raw, appId: app._id };
      const row = await ctx.db.query('messages').withIndex('by_thread_item', (q) => q.eq('threadId', threadId).eq('itemId', item.id)).first();
      if (row) await ctx.db.patch(row._id, { item, seq: item.seq, updatedAt: Date.now() });
      else await ctx.db.insert('messages', { threadId, itemId: item.id, seq: item.seq, item, updatedAt: Date.now() });
      high = Math.max(high, item.seq);
    }
    const thread = (await ctx.db.get(threadId))!;
    if (high >= thread.seq) await ctx.db.patch(threadId, { seq: high + 1 });
    if (last) {
      if (todos) {
        for (const old of await ctx.db.query('todos').withIndex('by_app', (q) => q.eq('appId', app._id)).collect()) await ctx.db.delete(old._id);
        for (const t of (todos as TodoItem[]).slice(0, 200)) {
          if (t && typeof t.text === 'string') await ctx.db.insert('todos', { appId: app._id, text: t.text.slice(0, 500), done: Boolean(t.done), at: Date.parse(t.createdAt ?? '') || Date.now() });
        }
      }
      await ctx.db.patch(m._id, { steps: { ...m.steps, chat: Date.now() } });
    }
    return { written: items.length };
  },
});

/** The chat and to-dos a PC takes when the app moves to it. */
export const chatForPc = internalQuery({
  args: { appId: v.id('apps') },
  handler: async (ctx, { appId }) => {
    const thread = await ctx.db.query('threads').withIndex('by_app', (q) => q.eq('appId', appId)).first();
    const rows = thread ? await ctx.db.query('messages').withIndex('by_thread_seq', (q) => q.eq('threadId', thread._id).eq('workerId', undefined)).collect() : [];
    const items = rows.filter((r) => !r.itemId.startsWith('inbox-')).map((r) => r.item as ChatItem);
    const todos = (await ctx.db.query('todos').withIndex('by_app', (q) => q.eq('appId', appId)).collect()).map((t) => ({ id: t._id, text: t.text, done: t.done, createdAt: iso(t.at) }));
    return { items, todos };
  },
});

/**
 * Ends a move once the other side has everything: to the cloud, the row becomes the cloud's (its
 * next build above the PC's highest); to the PC, the row becomes "pc" and its box goes.
 */
export const finish = internalMutation({
  args: { moveId: v.string(), userId: v.id('users'), buildHigh: v.optional(v.number()), pcAppId: v.optional(v.string()) },
  handler: async (ctx, { moveId, userId, buildHigh, pcAppId }) => {
    const m = await moveOf(ctx, moveId, userId);
    const missing = (['code', 'key', 'chat'] as const).filter((s) => !m.steps[s]);
    if (missing.length) throw new Error(`The move is not done yet: ${missing.join(', ')} still to go.`);
    const app = (await ctx.db.get(m.appId))!;
    const now = Date.now();
    if (m.kind === 'toCloud') {
      const high = Math.max(app.buildHigh, buildHigh ?? 0);
      await ctx.db.patch(app._id, { place: 'cloud', buildHigh: high, status: 'idle', updatedAt: now });
      await ctx.db.patch(m._id, { state: 'done', endedAt: now, steps: { ...m.steps, buildNumber: high } });
    } else {
      await ctx.db.patch(app._id, { place: 'pc', pcLinkId: m.pcLinkId, ...(pcAppId ? { pcAppId } : {}), updatedAt: now });
      await ctx.db.patch(m._id, { state: 'done', endedAt: now, steps: { ...m.steps, buildNumber: app.buildHigh } });
      const thread = await ctx.db.query('threads').withIndex('by_app', (q) => q.eq('appId', app._id)).first();
      if (thread) await ctx.scheduler.runAfter(0, internal.boxes.retire, { threadId: thread._id });
    }
    return { appId: app._id, place: m.kind === 'toCloud' ? 'cloud' : 'pc' };
  },
});

/** A move the PC gives up on (the person cancelled, or a step failed for good): nothing is deleted. */
export const fail = internalMutation({
  args: { moveId: v.string(), userId: v.id('users'), error: v.string() },
  handler: async (ctx, { moveId, userId, error }) => {
    const m = await moveOf(ctx, moveId, userId);
    await ctx.db.patch(m._id, { state: 'failed', error: error.slice(0, 300), endedAt: Date.now() });
  },
});

export const keyRowOf = internalQuery({
  args: { appId: v.id('apps') },
  handler: async (ctx, { appId }) => ctx.db.query('keys').withIndex('by_app', (q) => q.eq('appId', appId)).first(),
});
