// Operator functions, internal only (run with the dev deploy key: `node scripts/dev.mjs run ...`).
import { v } from 'convex/values';
import { internalMutation, internalQuery } from './_generated/server';

/** An upload URL for the runner bundle (scripts/dev.mjs bundle). */
export const bundleUploadUrl = internalMutation({
  args: {},
  handler: async (ctx) => ctx.storage.generateUploadUrl(),
});

/** Points boxes at a new runner bundle; the old file is deleted. */
export const setRunnerBundle = internalMutation({
  args: { fileId: v.id('_storage'), version: v.string() },
  handler: async (ctx, { fileId, version }) => {
    const row = await ctx.db.query('meta').withIndex('by_key', (q) => q.eq('key', 'runnerBundle')).first();
    if (row) {
      const old = (row.value as { fileId: string }).fileId;
      if (old !== fileId) await ctx.storage.delete(old as never).catch(() => {});
      await ctx.db.patch(row._id, { value: { fileId, version } });
    } else await ctx.db.insert('meta', { key: 'runnerBundle', value: { fileId, version } });
  },
});

/** A short view of a thread for scripts (no secrets: the token hash is left out). */
export const threadView = internalQuery({
  args: { appId: v.id('apps') },
  handler: async (ctx, { appId }) => {
    const t = await ctx.db.query('threads').withIndex('by_app', (q) => q.eq('appId', appId)).first();
    if (!t) return null;
    const box = t.boxId ? await ctx.db.get(t.boxId) : null;
    const { runnerTokenHash, ...rest } = t;
    return { thread: { ...rest, hasRunnerToken: Boolean(runnerTokenHash) }, box };
  },
});

/** Deletes every row of one table (dev only: the spike's leftovers). */
export const wipe = internalMutation({
  args: { table: v.string() },
  handler: async (ctx, { table }) => {
    if (process.env.KIWI_ALLOW_WIPE !== '1') throw new Error('wipe is off (KIWI_ALLOW_WIPE)');
    const rows = await ctx.db.query(table as never).take(500);
    for (const r of rows) await ctx.db.delete((r as { _id: never })._id);
    return rows.length;
  },
});

/** An app's builds with their file URLs, signings and the key's certificate (scripts only). */
export const buildsOf = internalQuery({
  args: { appId: v.id('apps') },
  handler: async (ctx, { appId }) => {
    const builds = await ctx.db.query('builds').withIndex('by_app_number', (q) => q.eq('appId', appId)).collect();
    const signings = await ctx.db.query('signings').withIndex('by_app', (q) => q.eq('appId', appId)).collect();
    const key = await ctx.db.query('keys').withIndex('by_app', (q) => q.eq('appId', appId)).first();
    return Promise.all(
      builds.map(async (b) => ({
        number: b.number,
        delivery: b.delivery,
        commit: b.commit ?? null,
        pushed: b.pushed,
        certSha256: key?.certSha256 ?? null,
        files: await Promise.all(b.files.map(async (f) => ({ abi: f.abi, sizeBytes: f.sizeBytes, sha256: f.sha256, url: await ctx.storage.getUrl(f.fileId) }))),
        otaUrl: b.otaFileId ? await ctx.storage.getUrl(b.otaFileId) : null,
        signings: signings.filter((s) => s.build === b.number).map((s) => ({ what: s.what, sha256: s.sha256 })),
      })),
    );
  },
});
