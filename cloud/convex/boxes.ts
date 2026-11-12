// One box per thread (docs/CLOUD.md section 3): made from the image when a thread first needs it,
// paused 5 minutes after the last work, snapshotted and deleted after an hour paused, restored
// from that snapshot on the next message (or made fresh from the image, the code coming back from
// GitHub). Convex drives it all through the BoxProvider interface; a cron ticks every minute and
// Instabox's webhooks tell us at once when a box changes by itself.
import { v } from 'convex/values';
import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { internalAction, internalMutation, internalQuery, type MutationCtx } from './_generated/server';
import { BOX } from './config';
import { randomToken, sha256Hex } from './lib/crypto';
import { boxProvider } from './lib/instabox';
import { ProviderError } from './lib/provider';

const now = () => Date.now();

/** How the box runs the runner: a fixed script, its arguments carry no secret; the runner token comes on stdin. */
export const BOOT_SCRIPT = String.raw`set -euo pipefail
site=$1; bundle=$2; version=$3; mode=$4; entry=$5; [ -n "$entry" ] || entry=runner.mjs
case "$entry" in runner.mjs|stub-runner.mjs) ;; *) echo "bad runner entry"; exit 2;; esac
base=/data/kiwi
# On a tmpfs: a box restored from a snapshot or started again never sees an old pid.
pidf=/dev/shm/kiwi-runner.pid
mkdir -p "$base"
if [ -f "$pidf" ] && grep -qs runner.mjs "/proc/$(cat "$pidf")/cmdline"; then echo running; exit 0; fi
if [ "$mode" = check ]; then echo stopped; exit 0; fi
# The code is readable by the agent (the builder runs as agent); the runner's state is not.
code=/data/kiwi-code
mkdir -p "$code" && chmod 755 "$code"
dir=$code/runner-$version
if [ ! -f "$dir/.ok" ]; then
  rm -rf "$dir"; mkdir -p "$dir"
  curl -fsSL --retry 5 --retry-all-errors "$bundle" -o "$base/runner.tgz"
  tar -xzf "$base/runner.tgz" -C "$dir"
  rm -f "$base/runner.tgz"
  # The companion's dependencies: the image's copy when the lock file is the same, else installed.
  want=$(sha256sum "$dir/server/package-lock.json" | cut -d' ' -f1)
  if [ -f /opt/kiwi/server-deps/.lockhash ] && [ "$(cat /opt/kiwi/server-deps/.lockhash)" = "$want" ]; then
    ln -sfn /opt/kiwi/server-deps/node_modules "$dir/server/node_modules"
  else
    (cd "$dir/server" && npm ci --omit=dev --no-audit --no-fund --loglevel=error) >&2
  fi
  touch "$dir/.ok"
fi
# Gradle replaces files in its cache: the agent must own the shared caches (image v1 had them
# group-writable only).
if [ -d /data/shared/gradle ] && [ "$(stat -c %U /data/shared/gradle)" != agent ]; then sudo -n chown -R agent:kiwi /data/shared; fi
# The agent's wrapper from this bundle (root-owned: the agent cannot change it).
if [ -f "$dir/cloud/box/agent.sh" ] && [ -d /opt/kiwi ]; then
  sed 's/\r$//' "$dir/cloud/box/agent.sh" > "$base/agent.sh.new" && sudo -n install -o root -g root -m 755 "$base/agent.sh.new" /opt/kiwi/agent.sh && rm -f "$base/agent.sh.new"
fi
secrets=$(cat)
printf '%s' "$secrets" | nohup node "$dir/cloud/runner/$entry" --convex "$site" --pid-file "$pidf" >> "$base/runner.log" 2>&1 &
for i in $(seq 1 50); do [ -f "$pidf" ] && break; sleep 0.2; done
[ -f "$pidf" ] && echo started || { echo "runner did not start"; tail -n 20 "$base/runner.log" >&2; exit 1; }`;

// ---------- state

export const thread = internalQuery({
  args: { threadId: v.id('threads') },
  handler: async (ctx, { threadId }) => {
    const t = await ctx.db.get(threadId);
    if (!t) return null;
    const box = t.boxId ? await ctx.db.get(t.boxId) : null;
    const app = await ctx.db.get(t.appId);
    const user = await ctx.db.get(t.userId);
    return { thread: t, box, app, ownKey: user?.aiMode === 'ownAnthropic' };
  },
});

export const patchThread = internalMutation({
  args: { threadId: v.id('threads'), patch: v.any() },
  handler: async (ctx, { threadId, patch }) => {
    await ctx.db.patch(threadId, patch as Partial<Doc<'threads'>>);
  },
});

export const patchBox = internalMutation({
  args: { boxId: v.id('boxes'), patch: v.any() },
  handler: async (ctx, { boxId, patch }) => {
    await ctx.db.patch(boxId, patch as Partial<Doc<'boxes'>>);
  },
});

async function note(ctx: MutationCtx, threadId: Id<'threads'>, boxNote: string | undefined) {
  await ctx.db.patch(threadId, { boxNote });
}

/**
 * A thread needs its box: work arrived. Starts whatever brings the box to running with a live
 * runner, at most one such action at a time (boxState "starting" is the lock).
 */
export const ensure = internalMutation({
  args: { threadId: v.id('threads') },
  handler: async (ctx, { threadId }) => {
    const t = await ctx.db.get(threadId);
    if (!t) return;
    const app = await ctx.db.get(t.appId);
    if (!app || app.deletedAt) return;
    await ctx.db.patch(threadId, { lastActiveAt: now() });
    switch (t.boxState) {
      case 'starting':
        return;
      case 'running':
        // Alive if it polled in the last 90 s; else start (or restart) its runner.
        if (t.runnerSeenAt && now() - t.runnerSeenAt < 90_000) return;
        await ctx.db.patch(threadId, { boxState: 'starting' });
        await ctx.scheduler.runAfter(0, internal.boxes.startRunner, { threadId });
        return;
      case 'paused':
        await ctx.db.patch(threadId, { boxState: 'starting', boxNote: 'Waking up your app’s machine' });
        await ctx.scheduler.runAfter(0, internal.boxes.wake, { threadId });
        return;
      case 'none':
      case 'deleted':
      case 'snapshotted': {
        const live = await ctx.db.query('boxes').withIndex('by_user', (q) => q.eq('userId', t.userId)).collect();
        if (live.filter((b) => !b.deletedAt).length >= BOX.maxPerUser) {
          await note(ctx, threadId, 'Your other apps are using all 5 machines. This one starts when one of them pauses.');
          await ctx.scheduler.runAfter(60_000, internal.boxes.ensure, { threadId });
          return;
        }
        await ctx.db.patch(threadId, {
          boxState: 'starting',
          boxNote: t.boxState === 'snapshotted' ? 'Waking up your app’s machine (about a minute)' : 'Starting your app’s machine (about a minute)',
        });
        await ctx.scheduler.runAfter(0, internal.boxes.create, { threadId });
        return;
      }
    }
  },
});

export const newBoxRow = internalMutation({
  args: { threadId: v.id('threads'), name: v.string() },
  handler: async (ctx, { threadId, name }) => {
    const t = (await ctx.db.get(threadId))!;
    const boxId = await ctx.db.insert('boxes', { threadId, userId: t.userId, provider: 'instabox', name, size: '4x8', startedAt: now(), secondsBilled: 0 });
    await ctx.db.patch(threadId, { boxId });
    return boxId;
  },
});

/** The box could not start: say so in the chat, try again later (bounded). */
export const startFailed = internalMutation({
  args: { threadId: v.id('threads'), message: v.string(), retryMs: v.optional(v.number()), back: v.optional(v.string()) },
  handler: async (ctx, { threadId, message, retryMs, back }) => {
    const t = await ctx.db.get(threadId);
    if (!t) return;
    await ctx.db.patch(threadId, { boxState: (back as Doc<'threads'>['boxState']) ?? 'none', boxNote: message });
    if (retryMs) await ctx.scheduler.runAfter(retryMs, internal.boxes.ensure, { threadId });
  },
});

function friendly(e: unknown): { message: string; retryMs?: number } {
  const err = e as ProviderError;
  const s = err?.status;
  if (s === 402 || s === 403 || s === 409 || s === 429 || s === 503) {
    return { message: 'All our machines are busy right now. Your message waits and starts by itself in a minute.', retryMs: 60_000 };
  }
  return { message: 'Your app’s machine did not start. Trying again in a minute.', retryMs: 60_000 };
}

// ---------- actions

/** Makes the thread's box: from its own snapshot if it has one, else from the image. */
export const create = internalAction({
  args: { threadId: v.id('threads') },
  handler: async (ctx, { threadId }) => {
    const s = await ctx.runQuery(internal.boxes.thread, { threadId });
    if (!s?.app) return;
    const p = boxProvider();
    const name = `kw-${String(threadId).slice(-10)}-${Date.now().toString(36)}`.toLowerCase().replace(/[^a-z0-9-]/g, '');
    const fromSnapshot = s.thread.snapshotId;
    let boxId: Id<'boxes'> | null = null;
    try {
      boxId = await ctx.runMutation(internal.boxes.newBoxRow, { threadId, name });
      const b = await p.create({
        name,
        snapshot: fromSnapshot ?? BOX.imageSnapshot,
        metadata: { kiwiThread: String(threadId), kiwiUser: String(s.thread.userId) },
        // The AI key reaches the box only as Instabox's proxy placeholder (section 2). On the Own key
        // plan the box gets none of ours: the runner brings the person's own key.
        secrets: s.ownKey ? [] : (process.env.BOX_PROXY_SECRETS ?? 'ANTHROPIC_API_KEY').split(',').filter(Boolean),
      });
      await ctx.runMutation(internal.boxes.patchBox, { boxId, patch: { providerId: b.id } });
      await p.waitFor(b.id, ['running'], 5 * 60_000);
      await ctx.runMutation(internal.boxes.patchThread, { threadId, patch: { boxState: 'running', runnerSeenAt: undefined } });
    } catch (e) {
      const f = friendly(e);
      console.error('box create failed:', (e as Error).message);
      if (boxId) await ctx.runMutation(internal.boxes.patchBox, { boxId, patch: { error: (e as Error).message.slice(0, 300) } });
      // A half-made box is deleted so it never costs anything.
      if (boxId) await ctx.scheduler.runAfter(0, internal.boxes.deleteBox, { boxId });
      await ctx.runMutation(internal.boxes.startFailed, { threadId, ...f, back: fromSnapshot ? 'snapshotted' : 'none' });
      return;
    }
    await ctx.runAction(internal.boxes.startRunner, { threadId });
  },
});

export const wake = internalAction({
  args: { threadId: v.id('threads') },
  handler: async (ctx, { threadId }) => {
    const s = await ctx.runQuery(internal.boxes.thread, { threadId });
    if (!s?.box?.providerId) {
      await ctx.runMutation(internal.boxes.startFailed, { threadId, message: '', retryMs: 1, back: 'none' });
      return;
    }
    const p = boxProvider();
    try {
      const b = await p.get(s.box.providerId);
      if (!b || b.state === 'deleted') {
        await ctx.runMutation(internal.boxes.patchBox, { boxId: s.box._id, patch: { deletedAt: now() } });
        await ctx.runMutation(internal.boxes.startFailed, { threadId, message: 'Starting your app’s machine (about a minute)', retryMs: 1, back: s.thread.snapshotId ? 'snapshotted' : 'none' });
        return;
      }
      if (b.state === 'paused' || b.state === 'pausing') await p.resume(b.id);
      else if (b.state === 'stopped') await p.start(b.id);
      await p.waitFor(b.id, ['running'], 4 * 60_000);
      await ctx.runMutation(internal.boxes.patchBox, { boxId: s.box._id, patch: { pausedAt: undefined } });
      await ctx.runMutation(internal.boxes.patchThread, { threadId, patch: { boxState: 'running' } });
    } catch (e) {
      console.error('box wake failed:', (e as Error).message);
      await ctx.runMutation(internal.boxes.startFailed, { threadId, ...friendly(e), back: 'paused' });
      return;
    }
    await ctx.runAction(internal.boxes.startRunner, { threadId });
  },
});

export const setRunnerHash = internalMutation({
  args: { threadId: v.id('threads'), hash: v.string() },
  handler: async (ctx, { threadId, hash }) => {
    await ctx.db.patch(threadId, { runnerTokenHash: hash, runnerSeenAt: undefined });
  },
});

export const runnerBundle = internalQuery({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db.query('meta').withIndex('by_key', (q) => q.eq('key', 'runnerBundle')).first();
    if (!row) return null;
    const value = row.value as { fileId: Id<'_storage'>; version: string };
    return { url: await ctx.storage.getUrl(value.fileId), version: value.version };
  },
});

/** Makes sure the box runs the runner: starts it with a fresh token if it is not running. */
export const startRunner = internalAction({
  args: { threadId: v.id('threads') },
  handler: async (ctx, { threadId }) => {
    const s = await ctx.runQuery(internal.boxes.thread, { threadId });
    if (!s?.box?.providerId) return;
    const bundle = await ctx.runQuery(internal.boxes.runnerBundle, {});
    const site = process.env.CONVEX_SITE_URL!;
    const p = boxProvider();
    try {
      if (!bundle?.url) throw new Error('no runner bundle uploaded (node scripts/deploy.mjs)');
      // RUNNER_ENTRY=stub-runner.mjs (dev): lifecycle tests without an agent.
      const entry = process.env.RUNNER_ENTRY === 'stub-runner.mjs' ? 'stub-runner.mjs' : 'runner.mjs';
      const argv = (mode: string) => ['bash', '-c', BOOT_SCRIPT, 'boot', site, bundle.url!, bundle.version, mode, entry];
      const check = await p.exec(s.box.providerId, { argv: argv('check'), timeoutSeconds: 30 });
      if (check.stdout.trim() !== 'running') {
        const token = randomToken();
        await ctx.runMutation(internal.boxes.setRunnerHash, { threadId, hash: await sha256Hex(token) });
        const r = await p.exec(s.box.providerId, {
          argv: argv('start'),
          stdin: JSON.stringify({ runnerToken: token, threadId }),
          timeoutSeconds: 180,
          noHistory: true,
        });
        if (r.exitCode !== 0) throw new Error(`runner start: exit ${r.exitCode}: ${(r.stderr || r.stdout).slice(-400)}`);
      }
      await ctx.runMutation(internal.boxes.patchThread, { threadId, patch: { boxState: 'running', boxNote: undefined } });
    } catch (e) {
      console.error('runner start failed:', (e as Error).message);
      await ctx.runMutation(internal.boxes.startFailed, { threadId, message: 'Your app’s machine is up but did not get ready. Trying again in a minute.', retryMs: 60_000, back: 'running' });
    }
  },
});

/** Pauses a box (only disk is billed while paused). */
export const pause = internalAction({
  args: { threadId: v.id('threads') },
  handler: async (ctx, { threadId }) => {
    const s = await ctx.runQuery(internal.boxes.thread, { threadId });
    if (!s?.box?.providerId || s.thread.boxState !== 'running') return;
    const p = boxProvider();
    try {
      await p.pause(s.box.providerId);
      await ctx.runMutation(internal.boxes.patchBox, { boxId: s.box._id, patch: { pausedAt: now() } });
      await ctx.runMutation(internal.boxes.markPaused, { threadId });
    } catch (e) {
      console.error('box pause failed:', (e as Error).message);
    }
  },
});

export const markPaused = internalMutation({
  args: { threadId: v.id('threads') },
  handler: async (ctx, { threadId }) => {
    const t = await ctx.db.get(threadId);
    // Work that arrived while it paused wakes it again.
    if (!t || t.boxState !== 'running') return;
    await ctx.db.patch(threadId, { boxState: 'paused', busy: false });
    const waiting = await ctx.db.query('inbox').withIndex('by_thread_untaken', (q) => q.eq('threadId', threadId).eq('takenAt', undefined)).first();
    if (waiting) await ctx.scheduler.runAfter(0, internal.boxes.ensure, { threadId });
  },
});

/** Snapshots a long-paused box, then deletes it (snapshots are free; paused disk is not). */
export const snapshotAndDelete = internalAction({
  args: { threadId: v.id('threads') },
  handler: async (ctx, { threadId }) => {
    const s = await ctx.runQuery(internal.boxes.thread, { threadId });
    if (!s?.box?.providerId || s.thread.boxState !== 'paused') return;
    const p = boxProvider();
    const old = s.thread.snapshotId;
    try {
      // A paused box cannot be saved: wake it, stop it (files kept), then snapshot the stopped box
      // (quick: nothing is copied while it runs).
      const b = await p.get(s.box.providerId);
      if (b && (b.state === 'paused' || b.state === 'pausing')) {
        await p.resume(b.id);
        await p.waitFor(b.id, ['running'], 4 * 60_000);
      }
      if (b && b.state !== 'stopped') {
        await p.stop(s.box.providerId);
        await p.waitFor(s.box.providerId, ['stopped'], 4 * 60_000);
      }
      const snap = await p.snapshot(s.box.providerId, `kws-${String(threadId).slice(-10)}-${Date.now().toString(36)}`.toLowerCase());
      for (let i = 0; i < 60; i++) {
        const st = await p.getSnapshot(snap.id);
        if (st?.status === 'ready') break;
        if (st?.status === 'failed') throw new Error('snapshot failed');
        await new Promise((r) => setTimeout(r, 5000));
      }
      const ok = await ctx.runMutation(internal.boxes.markSnapshotted, { threadId, snapshotId: snap.id });
      if (!ok) {
        // Work arrived meanwhile: keep the box, drop the new snapshot.
        await p.deleteSnapshot(snap.id);
        return;
      }
      await p.delete(s.box.providerId);
      if (old && old !== snap.id) await p.deleteSnapshot(old);
    } catch (e) {
      console.error('snapshot failed:', (e as Error).message);
    }
  },
});

export const markSnapshotted = internalMutation({
  args: { threadId: v.id('threads'), snapshotId: v.string() },
  handler: async (ctx, { threadId, snapshotId }) => {
    const t = await ctx.db.get(threadId);
    if (!t || t.boxState !== 'paused') return false;
    if (t.boxId) await ctx.db.patch(t.boxId, { deletedAt: now(), snapshotId });
    await ctx.db.patch(threadId, { boxState: 'snapshotted', boxId: undefined, snapshotId, snapshotAt: now(), runnerTokenHash: undefined, runnerSeenAt: undefined });
    return true;
  },
});

export const deleteBox = internalAction({
  args: { boxId: v.id('boxes') },
  handler: async (ctx, { boxId }) => {
    const box = await ctx.runQuery(internal.boxes.boxRow, { boxId });
    if (!box) return;
    if (box.providerId) await boxProvider().delete(box.providerId);
    await ctx.runMutation(internal.boxes.patchBox, { boxId, patch: { deletedAt: now() } });
  },
});

export const boxRow = internalQuery({
  args: { boxId: v.id('boxes') },
  handler: async (ctx, { boxId }) => ctx.db.get(boxId),
});

/** The app was removed: its box and snapshot go; its runner token stops working. */
export const retire = internalAction({
  args: { threadId: v.id('threads') },
  handler: async (ctx, { threadId }) => {
    const s = await ctx.runQuery(internal.boxes.thread, { threadId });
    if (!s) return;
    const p = boxProvider();
    if (s.box?.providerId && !s.box.deletedAt) await p.delete(s.box.providerId);
    if (s.box) await ctx.runMutation(internal.boxes.patchBox, { boxId: s.box._id, patch: { deletedAt: now() } });
    if (s.thread.snapshotId) await p.deleteSnapshot(s.thread.snapshotId);
    await ctx.runMutation(internal.boxes.patchThread, {
      threadId,
      patch: { boxState: 'deleted', boxId: undefined, snapshotId: undefined, runnerTokenHash: undefined, runnerSeenAt: undefined, busy: false },
    });
  },
});

// ---------- the minute tick

export const due = internalQuery({
  args: {},
  handler: async (ctx) => {
    const t = now();
    const running = await ctx.db
      .query('threads')
      .withIndex('by_state_and_active', (q) => q.eq('boxState', 'running').lt('lastActiveAt', t - BOX.pauseAfterMs))
      .take(50);
    const paused = await ctx.db
      .query('threads')
      .withIndex('by_state_and_active', (q) => q.eq('boxState', 'paused').lt('lastActiveAt', t - BOX.pauseAfterMs - BOX.snapshotAfterMs))
      .take(20);
    const stale = await ctx.db
      .query('threads')
      .withIndex('by_state_and_active', (q) => q.eq('boxState', 'snapshotted').lt('lastActiveAt', t - BOX.snapshotTtlMs))
      .take(20);
    const busy = await ctx.db
      .query('threads')
      .withIndex('by_state_and_active', (q) => q.eq('boxState', 'running'))
      .filter((q) => q.eq(q.field('busy'), true))
      .take(100);
    return {
      pause: running.filter((x) => !x.busy).map((x) => x._id),
      snapshot: paused.map((x) => x._id),
      expire: stale.map((x) => x._id),
      lease: busy.filter((x) => x.boxId).map((x) => x._id),
    };
  },
});

export const tick = internalAction({
  args: {},
  handler: async (ctx) => {
    const d = await ctx.runQuery(internal.boxes.due, {});
    for (const threadId of d.pause) await ctx.scheduler.runAfter(0, internal.boxes.pause, { threadId });
    for (const threadId of d.snapshot) await ctx.scheduler.runAfter(0, internal.boxes.snapshotAndDelete, { threadId });
    for (const threadId of d.expire) await ctx.scheduler.runAfter(0, internal.boxes.expireSnapshot, { threadId });
    // A busy box holds an activity lease, so a silent model call never lets it pause itself.
    if (d.lease.length) {
      const p = boxProvider();
      for (const threadId of d.lease) {
        const s = await ctx.runQuery(internal.boxes.thread, { threadId });
        if (s?.box?.providerId) await p.lease(s.box.providerId, 'kiwi-work', 300).catch((e) => console.error('lease:', e.message));
      }
    }
  },
});

export const expireSnapshot = internalAction({
  args: { threadId: v.id('threads') },
  handler: async (ctx, { threadId }) => {
    const s = await ctx.runQuery(internal.boxes.thread, { threadId });
    if (!s || s.thread.boxState !== 'snapshotted' || !s.thread.snapshotId) return;
    await boxProvider().deleteSnapshot(s.thread.snapshotId);
    await ctx.runMutation(internal.boxes.patchThread, { threadId, patch: { boxState: 'none', snapshotId: undefined, snapshotAt: undefined } });
  },
});

/** Every 10 minutes: the provider's truth wins (a box Instabox paused or deleted by itself). */
export const reconcile = internalAction({
  args: {},
  handler: async (ctx) => {
    const live = await ctx.runQuery(internal.boxes.liveBoxes, {});
    const p = boxProvider();
    for (const b of live) {
      if (!b.providerId) continue;
      const info = await p.get(b.providerId).catch(() => undefined);
      if (info === undefined) continue;
      await ctx.runMutation(internal.boxes.providerSays, { providerId: b.providerId, state: info?.state ?? 'deleted' });
    }
  },
});

export const liveBoxes = internalQuery({
  args: {},
  handler: async (ctx) => (await ctx.db.query('boxes').collect()).filter((b) => !b.deletedAt),
});

/** What the provider says about a box (webhook or reconcile), applied to its thread. */
export const providerSays = internalMutation({
  args: { providerId: v.string(), state: v.string() },
  handler: async (ctx, { providerId, state }) => {
    const box = await ctx.db.query('boxes').withIndex('by_provider_id', (q) => q.eq('providerId', providerId)).first();
    if (!box || box.deletedAt) return;
    const t = await ctx.db.get(box.threadId);
    if (state === 'deleted') {
      await ctx.db.patch(box._id, { deletedAt: now() });
      if (t && t.boxId === box._id) {
        await ctx.db.patch(t._id, { boxState: t.snapshotId ? 'snapshotted' : 'none', boxId: undefined, runnerTokenHash: undefined, runnerSeenAt: undefined, busy: false });
      }
      return;
    }
    if (!t || t.boxId !== box._id) return;
    if ((state === 'paused' || state === 'stopped') && t.boxState === 'running') {
      await ctx.db.patch(box._id, { pausedAt: box.pausedAt ?? now() });
      await ctx.db.patch(t._id, { boxState: 'paused', busy: false });
      const waiting = await ctx.db.query('inbox').withIndex('by_thread_untaken', (q) => q.eq('threadId', t._id).eq('takenAt', undefined)).first();
      if (waiting) await ctx.scheduler.runAfter(0, internal.boxes.ensure, { threadId: t._id });
    }
  },
});

/**
 * Dev: the thread loses its box and its snapshot (as when a snapshot expires after 30 days), so
 * its next message makes a fresh box from the image and the code comes back from GitHub.
 */
export const forget = internalAction({
  args: { threadId: v.id('threads') },
  handler: async (ctx, { threadId }) => {
    if (process.env.KIWI_ALLOW_WIPE !== '1') throw new Error('dev only');
    const s = await ctx.runQuery(internal.boxes.thread, { threadId });
    if (!s) return;
    const p = boxProvider();
    if (s.box?.providerId && !s.box.deletedAt) await p.delete(s.box.providerId);
    if (s.box) await ctx.runMutation(internal.boxes.patchBox, { boxId: s.box._id, patch: { deletedAt: now() } });
    if (s.thread.snapshotId) await p.deleteSnapshot(s.thread.snapshotId);
    await ctx.runMutation(internal.boxes.patchThread, {
      threadId,
      patch: { boxState: 'none', boxId: undefined, snapshotId: undefined, runnerTokenHash: undefined, runnerSeenAt: undefined, busy: false },
    });
  },
});
