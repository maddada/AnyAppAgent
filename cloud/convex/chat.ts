// The phone's side of an app's chat: watch it live, send a message, stop, answer a permission or a
// page, stop a helper. Every action the box must take goes through the thread's inbox, and wakes
// the box if it sleeps.
import { v } from 'convex/values';
import type { ChatItem, WorkerInfo } from '../../shared/protocol';
import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { mutation, query, type MutationCtx } from './_generated/server';
import { imageArg, pendingUserItem, requireGithub } from './apps';
import { onCloudChange } from './lib/credits';
import { ownApp, requireUser, threadOf } from './lib/session';

function withAppId(item: ChatItem, appId: string): ChatItem {
  // The box numbers its app its own way: every id the phone uses to reach the app is Convex's.
  return {
    ...item,
    appId,
    ...(item.worker ? { worker: { ...item.worker, appId } } : {}),
    ...(item.page ? { page: { ...item.page, appId } } : {}),
  };
}

/** The main chat (no workerId) or one helper's chat, ordered by seq. */
export const messages = query({
  args: { appId: v.string(), workerId: v.optional(v.string()), limit: v.optional(v.number()) },
  handler: async (ctx, { appId, workerId, limit }) => {
    const user = await requireUser(ctx);
    const app = await ownApp(ctx, user._id, appId);
    const thread = await threadOf(ctx, app._id);
    const rows = await ctx.db
      .query('messages')
      .withIndex('by_thread_seq', (q) => q.eq('threadId', thread._id).eq('workerId', workerId))
      .order('desc')
      .take(Math.min(limit ?? 300, 1000));
    return rows.reverse().map((m) => withAppId(m.item as ChatItem, app._id));
  },
});

export const helpers = query({
  args: { appId: v.string() },
  handler: async (ctx, { appId }) => {
    const user = await requireUser(ctx);
    const app = await ownApp(ctx, user._id, appId);
    const thread = await threadOf(ctx, app._id);
    const rows = await ctx.db.query('workers').withIndex('by_thread_worker', (q) => q.eq('threadId', thread._id)).collect();
    return rows.map((w) => ({ ...(w.info as WorkerInfo), appId: app._id }));
  },
});

/** What the chat shows about the box ("Waking up your app's machine"), and whether it is busy. */
export const box = query({
  args: { appId: v.string() },
  handler: async (ctx, { appId }) => {
    const user = await requireUser(ctx);
    const app = await ownApp(ctx, user._id, appId);
    const thread = await threadOf(ctx, app._id);
    return { state: thread.boxState, note: thread.boxNote ?? null, busy: Boolean(thread.busy) };
  },
});

async function enqueue(ctx: MutationCtx, thread: Doc<'threads'>, kind: Doc<'inbox'>['kind'], payload: unknown): Promise<Id<'inbox'>> {
  const id = await ctx.db.insert('inbox', { threadId: thread._id, kind, payload });
  await ctx.db.patch(thread._id, { lastActiveAt: Date.now() });
  await ctx.scheduler.runAfter(0, internal.boxes.ensure, { threadId: thread._id });
  return id;
}

export const send = mutation({
  args: { appId: v.string(), text: v.string(), images: v.optional(v.array(imageArg)) },
  handler: async (ctx, { appId, text, images }) => {
    const user = await requireUser(ctx);
    const app = await ownApp(ctx, user._id, appId);
    const thread = await threadOf(ctx, app._id);
    const body = text.trim().slice(0, 8000);
    if (!body && !images?.length) throw new Error('Write a message first.');
    requireGithub(user);
    await onCloudChange(ctx, user);
    const inboxId = await enqueue(ctx, thread, 'prompt', { text: body, images: images ?? [] });
    await pendingUserItem(ctx, thread._id, app._id, inboxId, body, images);
    await ctx.db.patch(app._id, { lastMessagePreview: body.slice(0, 120), updatedAt: Date.now() });
  },
});

export const cancel = mutation({
  args: { appId: v.string() },
  handler: async (ctx, { appId }) => {
    const user = await requireUser(ctx);
    const app = await ownApp(ctx, user._id, appId);
    const thread = await threadOf(ctx, app._id);
    // Messages not taken yet are dropped here: the box never sees them.
    const waiting = await ctx.db.query('inbox').withIndex('by_thread_untaken', (q) => q.eq('threadId', thread._id).eq('takenAt', undefined)).collect();
    for (const w of waiting) {
      if (w.kind !== 'prompt') continue;
      await ctx.db.patch(w._id, { takenAt: Date.now() });
      const pending = await ctx.db.query('messages').withIndex('by_thread_item', (q) => q.eq('threadId', thread._id).eq('itemId', `inbox-${w._id}`)).first();
      if (pending) await ctx.db.patch(pending._id, { item: { ...pending.item, queued: false, dropped: true }, updatedAt: Date.now() });
    }
    await enqueue(ctx, thread, 'cancel', {});
  },
});

export const answerPermission = mutation({
  args: { appId: v.string(), requestId: v.string(), optionId: v.string() },
  handler: async (ctx, { appId, requestId, optionId }) => {
    const user = await requireUser(ctx);
    const app = await ownApp(ctx, user._id, appId);
    await enqueue(ctx, await threadOf(ctx, app._id), 'permission', { requestId, optionId });
  },
});

export const stopHelper = mutation({
  args: { appId: v.string(), workerId: v.string() },
  handler: async (ctx, { appId, workerId }) => {
    const user = await requireUser(ctx);
    const app = await ownApp(ctx, user._id, appId);
    await enqueue(ctx, await threadOf(ctx, app._id), 'stop-helper', { workerId });
  },
});

export const rebuild = mutation({
  args: { appId: v.string() },
  handler: async (ctx, { appId }) => {
    const user = await requireUser(ctx);
    const app = await ownApp(ctx, user._id, appId);
    await enqueue(ctx, await threadOf(ctx, app._id), 'rebuild', {});
  },
});
