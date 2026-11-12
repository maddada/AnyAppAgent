// The box's side (docs/CLOUD.md section 3, "The runner"): the runner signs in with its thread's
// runner token, takes work from the inbox, posts the ServerEvents it would have broadcast on the
// PC's WebSocket, uploads build files and records builds. Called only from http.ts after the token
// is checked.
import { v } from 'convex/values';
import type { App, ChatItem, WorkerInfo } from '../../shared/protocol';
import type { Doc, Id } from './_generated/dataModel';
import { internalMutation, internalQuery, type MutationCtx, type QueryCtx } from './_generated/server';

const now = () => Date.now();

export const byToken = internalQuery({
  args: { hash: v.string() },
  handler: async (ctx, { hash }) => {
    const t = await ctx.db.query('threads').withIndex('by_runner_token', (q) => q.eq('runnerTokenHash', hash)).first();
    if (!t || t.boxState === 'deleted') return null;
    return { threadId: t._id, appId: t.appId, userId: t.userId };
  },
});

/** What the runner needs to know at start: the app it works on and the account's AI mode. */
export const hello = internalMutation({
  args: { threadId: v.id('threads') },
  handler: async (ctx, { threadId }) => {
    const t = (await ctx.db.get(threadId))!;
    const app = (await ctx.db.get(t.appId))!;
    const user = (await ctx.db.get(t.userId))!;
    await ctx.db.patch(threadId, { runnerSeenAt: now(), boxNote: undefined });
    const key = await ctx.db.query('keys').withIndex('by_app', (q) => q.eq('appId', app._id)).first();
    return {
      certSha256: key?.certSha256 ?? null,
      threadId,
      appId: app._id,
      name: app.name,
      slug: app.slug,
      packageName: app.packageName,
      preset: app.preset ?? 'react-native',
      repo: app.repo ?? null,
      buildHigh: app.buildHigh,
      aiMode: user.aiMode ?? 'credit',
      agentSessionId: t.agentSessionId ?? null,
    };
  },
});

const LEASE_MS = 45_000;

async function offerable(ctx: QueryCtx, threadId: Id<'threads'>) {
  const rows = await ctx.db.query('inbox').withIndex('by_thread_untaken', (q) => q.eq('threadId', threadId).eq('takenAt', undefined)).take(20);
  const t = now();
  return rows.find((r) => !r.leasedUntil || r.leasedUntil < t) ?? null;
}

/** Is there work? A cheap read for the long poll. */
export const hasWork = internalQuery({
  args: { threadId: v.id('threads') },
  handler: async (ctx, { threadId }) => Boolean(await offerable(ctx, threadId)),
});

/** The runner has these inbox rows: they are never offered again. */
export const ack = internalMutation({
  args: { threadId: v.id('threads'), ids: v.array(v.string()) },
  handler: async (ctx, { threadId, ids }) => {
    for (const raw of ids) {
      const id = ctx.db.normalizeId('inbox', raw);
      const row = id ? await ctx.db.get(id) : null;
      if (row && row.threadId === threadId && !row.takenAt) await ctx.db.patch(row._id, { takenAt: now() });
    }
  },
});

export const seen = internalMutation({
  args: { threadId: v.id('threads') },
  handler: async (ctx, { threadId }) => {
    await ctx.db.patch(threadId, { runnerSeenAt: now() });
  },
});

/**
 * Offers the oldest waiting inbox row for LEASE_MS; the runner acknowledges it (/runner/ack) as
 * soon as it has it. Pictures come with download URLs.
 */
export const take = internalMutation({
  args: { threadId: v.id('threads') },
  handler: async (ctx, { threadId }) => {
    await ctx.db.patch(threadId, { runnerSeenAt: now() });
    const item = await offerable(ctx, threadId);
    if (!item) return null;
    await ctx.db.patch(item._id, { leasedUntil: now() + LEASE_MS });
    await ctx.db.patch(threadId, { lastActiveAt: now() });
    const payload = { ...(item.payload ?? {}) };
    if (Array.isArray(payload.images)) {
      payload.images = await Promise.all(
        payload.images.map(async (im: { fileId: Id<'_storage'> }) => ({ ...im, url: await ctx.storage.getUrl(im.fileId) })),
      );
    }
    return { id: item._id, kind: item.kind, payload, at: item._creationTime };
  },
});

async function upsertItem(ctx: MutationCtx, threadId: Id<'threads'>, item: ChatItem, workerId?: string) {
  const row = await ctx.db.query('messages').withIndex('by_thread_item', (q) => q.eq('threadId', threadId).eq('itemId', item.id)).first();
  const at = now();
  if (row) await ctx.db.patch(row._id, { item, seq: item.seq, updatedAt: at });
  else await ctx.db.insert('messages', { threadId, itemId: item.id, ...(workerId ? { workerId } : {}), seq: item.seq, item, updatedAt: at });
}

const APP_FIELDS = ['status', 'error', 'latestBuild', 'latestApk', 'lastMessagePreview', 'replying', 'activeHelpers', 'waitingForAnswer', 'usage', 'health'] as const;

/** Runner event types on top of shared/protocol.ts's ServerEvent (cloud only). */
type RunnerEvent =
  | { type: 'chat.item'; item: ChatItem }
  | { type: 'worker.item'; item: ChatItem }
  | { type: 'worker.updated'; worker: WorkerInfo }
  | { type: 'app.updated'; app: App }
  | { type: 'apk.ready'; app: App }
  // A message the runner took is now in its own chat: the pending row Convex wrote goes.
  | { type: 'inbox.done'; inboxId: string }
  // The runner is working (holds the box awake) or idle, and its agent session.
  | { type: 'runner.state'; busy: boolean; agentSessionId?: string }
  | { type: string; [k: string]: unknown };

export const events = internalMutation({
  args: { threadId: v.id('threads'), events: v.array(v.any()) },
  handler: async (ctx, { threadId, events }) => {
    const t = (await ctx.db.get(threadId))!;
    for (const e of events as RunnerEvent[]) {
      switch (e.type) {
        case 'chat.item':
          await upsertItem(ctx, threadId, (e as { item: ChatItem }).item);
          break;
        case 'worker.item': {
          const item = (e as { item: ChatItem }).item;
          await upsertItem(ctx, threadId, item, item.workerId);
          break;
        }
        case 'worker.updated': {
          const w = (e as { worker: WorkerInfo }).worker;
          const row = await ctx.db.query('workers').withIndex('by_thread_worker', (q) => q.eq('threadId', threadId).eq('workerId', w.id)).first();
          if (row) await ctx.db.patch(row._id, { info: w });
          else await ctx.db.insert('workers', { threadId, workerId: w.id, info: w });
          break;
        }
        case 'app.updated':
        case 'apk.ready': {
          const a = (e as { app: App }).app;
          const patch: Partial<Doc<'apps'>> = { updatedAt: now() };
          for (const k of APP_FIELDS) if (k in a) (patch as Record<string, unknown>)[k] = (a as unknown as Record<string, unknown>)[k];
          if (typeof a.iconVersion === 'number') patch.iconVersion = a.iconVersion;
          await ctx.db.patch(t.appId, patch);
          break;
        }
        case 'inbox.done': {
          const id = String((e as { inboxId: string }).inboxId);
          const row = await ctx.db.query('messages').withIndex('by_thread_item', (q) => q.eq('threadId', threadId).eq('itemId', `inbox-${id}`)).first();
          if (row) await ctx.db.delete(row._id);
          break;
        }
        case 'runner.state': {
          const s = e as { busy: boolean; agentSessionId?: string };
          await ctx.db.patch(threadId, { busy: Boolean(s.busy), ...(s.agentSessionId ? { agentSessionId: s.agentSessionId } : {}) });
          break;
        }
        default:
          // todos.updated, care.updated and the rest: the cloud keeps those itself.
          break;
      }
    }
    await ctx.db.patch(threadId, { lastActiveAt: now(), runnerSeenAt: now() });
  },
});

/** Keeps the files of the last 3 builds per app; older ones are deleted (their URLs stop working). */
const KEEP_BUILDS = 3;

export const recordBuild = internalMutation({
  args: {
    threadId: v.id('threads'),
    number: v.number(),
    delivery: v.union(v.literal('apk'), v.literal('quick')),
    files: v.array(v.object({ abi: v.string(), fileId: v.id('_storage'), sizeBytes: v.number(), sha256: v.string() })),
    otaFileId: v.optional(v.id('_storage')),
    runtime: v.optional(v.string()),
    info: v.any(),
    commit: v.optional(v.string()),
    pushed: v.boolean(),
    seconds: v.optional(v.number()),
  },
  handler: async (ctx, { threadId, ...b }) => {
    const t = (await ctx.db.get(threadId))!;
    const app = (await ctx.db.get(t.appId))!;
    await ctx.db.insert('builds', { appId: app._id, ...b });
    await ctx.db.patch(app._id, {
      buildHigh: Math.max(app.buildHigh, b.number),
      latestApk: b.info,
      latestBuild: b.info,
      ...(b.commit && b.pushed ? { pushedCommit: b.commit } : {}),
      updatedAt: now(),
    });
    const all = await ctx.db.query('builds').withIndex('by_app_number', (q) => q.eq('appId', app._id)).order('desc').collect();
    for (const old of all.slice(KEEP_BUILDS)) {
      for (const f of old.files) await ctx.storage.delete(f.fileId).catch(() => {});
      if (old.otaFileId) await ctx.storage.delete(old.otaFileId).catch(() => {});
      await ctx.db.patch(old._id, { files: [], otaFileId: undefined });
    }
  },
});

export const uploadUrl = internalMutation({
  args: {},
  handler: async (ctx) => ctx.storage.generateUploadUrl(),
});
