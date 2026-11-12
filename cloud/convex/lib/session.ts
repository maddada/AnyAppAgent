// Who is calling, and may they touch this app.
import { getAuthUserId } from '@convex-dev/auth/server';
import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';

export class Refused extends Error {}

export async function requireUser(ctx: QueryCtx): Promise<Doc<'users'>> {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Refused('Sign in first.');
  const user = await ctx.db.get(userId);
  if (!user) throw new Refused('Sign in first.');
  if (user.blocked) throw new Refused('This account is blocked. Write to us if you think that is a mistake.');
  return user;
}

export async function ownApp(ctx: QueryCtx, userId: Id<'users'>, appId: string): Promise<Doc<'apps'>> {
  const id = ctx.db.normalizeId('apps', appId);
  const app = id ? await ctx.db.get(id) : null;
  if (!app || app.userId !== userId || app.deletedAt) throw new Refused('That app is not here any more.');
  return app;
}

export async function threadOf(ctx: QueryCtx, appId: Id<'apps'>): Promise<Doc<'threads'>> {
  const t = await ctx.db.query('threads').withIndex('by_app', (q) => q.eq('appId', appId)).first();
  if (!t) throw new Refused('That app has no chat yet.');
  return t;
}
