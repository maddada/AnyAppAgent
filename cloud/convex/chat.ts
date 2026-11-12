// The phone's side of a thread: send a message, watch the chat live. The spike has one thread per
// person; milestone 1 adds apps and one thread per app.
import { getAuthUserId } from '@convex-dev/auth/server';
import { v } from 'convex/values';
import { mutation, query, type QueryCtx } from './_generated/server';
import type { Id } from './_generated/dataModel';

async function threadOf(ctx: QueryCtx, userId: Id<'users'>) {
  return ctx.db
    .query('threads')
    .withIndex('by_user', (q) => q.eq('userId', userId))
    .first();
}

export const me = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const user = await ctx.db.get(userId);
    return { id: userId, email: user?.email ?? null, name: user?.name ?? null, anonymous: Boolean(user?.isAnonymous) };
  },
});

export const messages = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const thread = await threadOf(ctx, userId);
    if (!thread) return [];
    const rows = await ctx.db
      .query('messages')
      .withIndex('by_thread_seq', (q) => q.eq('threadId', thread._id))
      .order('asc')
      .take(200);
    return Promise.all(
      rows.map(async (m) => ({
        id: m._id,
        seq: m.seq,
        role: m.role,
        text: m.text,
        apkUrl: m.apkFileId ? await ctx.storage.getUrl(m.apkFileId) : null,
        usage: m.usage ?? null,
        at: m._creationTime,
      })),
    );
  },
});

export const send = mutation({
  args: { text: v.string() },
  handler: async (ctx, { text }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error('Not signed in');
    const body = text.trim().slice(0, 4000);
    if (!body) throw new Error('Empty message');
    let thread = await threadOf(ctx, userId);
    const threadId = thread?._id ?? (await ctx.db.insert('threads', { userId, appName: 'Spike', boxState: 'none', lastActiveAt: Date.now() }));
    if (thread) await ctx.db.patch(thread._id, { lastActiveAt: Date.now() });
    const last = await ctx.db
      .query('messages')
      .withIndex('by_thread_seq', (q) => q.eq('threadId', threadId))
      .order('desc')
      .first();
    await ctx.db.insert('messages', { threadId, seq: (last?.seq ?? 0) + 1, role: 'user', text: body });
    await ctx.db.insert('inbox', { threadId, kind: 'prompt', text: body });
    return threadId;
  },
});
