// The phone's side of cloud apps: the grid, making an app, removing one. Every row comes back in
// shared/protocol.ts's App shape, with Convex's id as the app id.
import { v } from 'convex/values';
import type { App } from '../../shared/protocol';
import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { mutation, query, type MutationCtx, type QueryCtx } from './_generated/server';
import { CLOUD_PACKAGE_PREFIX } from './config';
import { onCloudChange } from './lib/credits';
import { ownApp, requireUser } from './lib/session';

const JAVA_KEYWORDS = new Set(
  'abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while true false null var record yield'.split(' '),
);

/** The same slug rule as the PC (server/src/apps.ts slugify), so a package name looks the same. */
export function slugify(name: string): string {
  let slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 30);
  if (slug === '') slug = 'app';
  if (/^[0-9]/.test(slug)) slug = `app${slug}`.slice(0, 30);
  if (JAVA_KEYWORDS.has(slug)) slug = `${slug}app`;
  return slug;
}

const iso = (t: number) => new Date(t).toISOString();

export async function toApp(ctx: QueryCtx, a: Doc<'apps'>): Promise<App & { cloud: { place: 'cloud' | 'pc'; repo?: string; iconUrl?: string } }> {
  const iconUrl = a.iconFileId ? (await ctx.storage.getUrl(a.iconFileId)) ?? undefined : undefined;
  return {
    id: a._id,
    name: a.name,
    slug: a.slug,
    packageName: a.packageName,
    preset: a.preset ?? 'react-native',
    status: a.status,
    ...(a.error ? { error: a.error } : {}),
    iconVersion: a.iconVersion,
    ...(a.latestBuild ? { latestBuild: a.latestBuild } : {}),
    ...(a.latestApk ? { latestApk: a.latestApk } : {}),
    ...(a.repo ? { repoUrl: `https://github.com/${a.repo}` } : {}),
    ...(a.lastMessagePreview ? { lastMessagePreview: a.lastMessagePreview } : {}),
    ...(a.replying !== undefined ? { replying: a.replying } : {}),
    ...(a.activeHelpers !== undefined ? { activeHelpers: a.activeHelpers } : {}),
    ...(a.waitingForAnswer ? { waitingForAnswer: true } : {}),
    signing: 'own',
    ...(a.usage ? { usage: a.usage } : {}),
    ...(a.health ? { health: a.health } : {}),
    createdAt: iso(a._creationTime),
    updatedAt: iso(a.updatedAt),
    cloud: { place: a.place, ...(a.repo ? { repo: a.repo } : {}), ...(iconUrl ? { iconUrl } : {}) },
  };
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    let user;
    try {
      user = await requireUser(ctx);
    } catch {
      return [];
    }
    const rows = await ctx.db.query('apps').withIndex('by_user', (q) => q.eq('userId', user._id)).collect();
    return Promise.all(rows.filter((a) => !a.deletedAt && a.place === 'cloud').map((a) => toApp(ctx, a)));
  },
});

export const get = query({
  args: { appId: v.string() },
  handler: async (ctx, { appId }) => {
    const user = await requireUser(ctx);
    return toApp(ctx, await ownApp(ctx, user._id, appId));
  },
});

async function freeSlug(ctx: QueryCtx, userId: Id<'users'>, base: string) {
  let slug = base;
  for (let n = 2; ; n++) {
    const taken = await ctx.db.query('apps').withIndex('by_user_slug', (q) => q.eq('userId', userId).eq('slug', slug)).first();
    if (!taken) return slug;
    slug = `${base}${n}`.slice(0, 32);
  }
}

/** A user ChatItem written by Convex while the box takes the message (replaced by the runner's own). */
export async function pendingUserItem(ctx: MutationCtx, threadId: Id<'threads'>, appId: Id<'apps'>, inboxId: Id<'inbox'>, text: string, images?: unknown[]) {
  const thread = (await ctx.db.get(threadId))!;
  const last = await ctx.db
    .query('messages')
    .withIndex('by_thread_seq', (q) => q.eq('threadId', threadId).eq('workerId', undefined))
    .order('desc')
    .first();
  const seq = Math.max(thread.seq, (last?.seq ?? 0) + 1);
  const now = Date.now();
  const itemId = `inbox-${inboxId}`;
  await ctx.db.insert('messages', {
    threadId,
    itemId,
    seq,
    item: { id: itemId, appId, seq, kind: 'user', text, queued: true, ...(images?.length ? { images } : {}), createdAt: iso(now), updatedAt: iso(now) },
    updatedAt: now,
  });
  await ctx.db.patch(threadId, { seq: seq + 1, lastActiveAt: now });
}

export const imageArg = v.object({ fileId: v.id('_storage'), mimeType: v.string(), width: v.optional(v.number()), height: v.optional(v.number()) });

export const create = mutation({
  args: {
    name: v.string(),
    prompt: v.string(),
    preset: v.optional(v.union(v.literal('react-native'), v.literal('kotlin'))),
    askMore: v.optional(v.boolean()),
    images: v.optional(v.array(imageArg)),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const name = args.name.trim().slice(0, 40);
    const prompt = args.prompt.trim().slice(0, 8000);
    if (!name) throw new Error('Give the app a name.');
    if (!prompt && !args.images?.length) throw new Error('Say what the app should do.');
    await onCloudChange(ctx, user);
    const slug = await freeSlug(ctx, user._id, slugify(name));
    const now = Date.now();
    const appId = await ctx.db.insert('apps', {
      userId: user._id,
      name,
      slug,
      packageName: `${CLOUD_PACKAGE_PREFIX}${slug}`,
      place: 'cloud',
      buildHigh: 0,
      preset: args.preset ?? 'react-native',
      iconVersion: 0,
      status: 'creating',
      prompt,
      lastMessagePreview: prompt.slice(0, 120),
      updatedAt: now,
    });
    const threadId = await ctx.db.insert('threads', { appId, userId: user._id, boxState: 'none', lastActiveAt: now, seq: 1 });
    const inboxId = await ctx.db.insert('inbox', {
      threadId,
      kind: 'prompt',
      payload: {
        create: { name, slug, packageName: `${CLOUD_PACKAGE_PREFIX}${slug}`, preset: args.preset ?? 'react-native', askMore: Boolean(args.askMore) },
        text: prompt,
        images: args.images ?? [],
      },
    });
    await pendingUserItem(ctx, threadId, appId, inboxId, prompt, args.images);
    await ctx.scheduler.runAfter(0, internal.boxes.ensure, { threadId });
    return appId;
  },
});

export const remove = mutation({
  args: { appId: v.string() },
  handler: async (ctx, { appId }) => {
    const user = await requireUser(ctx);
    const app = await ownApp(ctx, user._id, appId);
    await ctx.db.patch(app._id, { deletedAt: Date.now(), updatedAt: Date.now() });
    const thread = await ctx.db.query('threads').withIndex('by_app', (q) => q.eq('appId', app._id)).first();
    if (thread) await ctx.scheduler.runAfter(0, internal.boxes.retire, { threadId: thread._id });
  },
});

/** An upload URL for a chat picture (the phone uploads, then sends its storage id). */
export const imageUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    return ctx.storage.generateUploadUrl();
  },
});
