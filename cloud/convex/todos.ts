// The person's own to-do list per cloud app (the agent never sees it), in TodoItem's shape.
import { v } from 'convex/values';
import type { TodoItem } from '../../shared/protocol';
import type { Doc } from './_generated/dataModel';
import { mutation, query } from './_generated/server';
import { ownApp, requireUser } from './lib/session';

const iso = (t: number) => new Date(t).toISOString();
const item = (r: Doc<'todos'>): TodoItem => ({ id: r._id, text: r.text, done: r.done, createdAt: iso(r._creationTime), updatedAt: iso(r.at) });

export const list = query({
  args: { appId: v.string() },
  handler: async (ctx, { appId }) => {
    const user = await requireUser(ctx);
    const app = await ownApp(ctx, user._id, appId);
    return (await ctx.db.query('todos').withIndex('by_app', (q) => q.eq('appId', app._id)).collect()).map(item);
  },
});

export const add = mutation({
  args: { appId: v.string(), text: v.string() },
  handler: async (ctx, { appId, text }) => {
    const user = await requireUser(ctx);
    const app = await ownApp(ctx, user._id, appId);
    const t = text.trim().replace(/\s+/g, ' ').slice(0, 200);
    if (!t) throw new Error('Write the to-do first.');
    const id = await ctx.db.insert('todos', { appId: app._id, text: t, done: false, at: Date.now() });
    return item((await ctx.db.get(id))!);
  },
});

async function ownTodo(ctx: Parameters<typeof requireUser>[0], appId: string, todoId: string) {
  const user = await requireUser(ctx);
  const app = await ownApp(ctx, user._id, appId);
  const id = ctx.db.normalizeId('todos', todoId);
  const row = id ? await ctx.db.get(id) : null;
  if (!row || row.appId !== app._id) throw new Error('That to-do is gone.');
  return row;
}

export const setDone = mutation({
  args: { appId: v.string(), todoId: v.string(), done: v.boolean() },
  handler: async (ctx, { appId, todoId, done }) => {
    const row = await ownTodo(ctx, appId, todoId);
    await ctx.db.patch(row._id, { done, at: Date.now() });
    return item((await ctx.db.get(row._id))!);
  },
});

export const remove = mutation({
  args: { appId: v.string(), todoId: v.string() },
  handler: async (ctx, { appId, todoId }) => {
    const row = await ownTodo(ctx, appId, todoId);
    await ctx.db.delete(row._id);
  },
});
