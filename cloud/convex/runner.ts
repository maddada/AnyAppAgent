// The box's side: take work from the inbox, post chat rows and builds. Called only from the runner
// HTTP actions in http.ts, after the runner token is checked.
import { v } from 'convex/values';
import { internalMutation } from './_generated/server';

export const take = internalMutation({
  args: {},
  handler: async (ctx) => {
    const item = await ctx.db
      .query('inbox')
      .withIndex('by_untaken', (q) => q.eq('takenAt', undefined))
      .first();
    if (!item) return null;
    await ctx.db.patch(item._id, { takenAt: Date.now() });
    return { id: item._id, threadId: item.threadId, kind: item.kind, text: item.text };
  },
});

export const post = internalMutation({
  args: {
    threadId: v.id('threads'),
    role: v.union(v.literal('agent'), v.literal('build'), v.literal('status')),
    text: v.string(),
    apkFileId: v.optional(v.id('_storage')),
    usage: v.optional(
      v.object({
        inputTokens: v.number(),
        outputTokens: v.number(),
        cacheReadTokens: v.number(),
        cacheWriteTokens: v.number(),
        costMicros: v.number(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const last = await ctx.db
      .query('messages')
      .withIndex('by_thread_seq', (q) => q.eq('threadId', args.threadId))
      .order('desc')
      .first();
    await ctx.db.insert('messages', { ...args, seq: (last?.seq ?? 0) + 1 });
    await ctx.db.patch(args.threadId, { lastActiveAt: Date.now() });
  },
});
