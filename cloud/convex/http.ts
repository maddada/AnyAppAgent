// HTTP routes: Convex Auth's (OAuth callbacks, JWKS), the GitHub App's callback, Instabox's
// webhooks, and the runner's. A runner signs in with its thread's runner token (Bearer); Convex
// keeps only the token's SHA-256 (threads.runnerTokenHash), made per box start.
import { httpRouter } from 'convex/server';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { httpAction, type ActionCtx } from './_generated/server';
import { auth } from './auth';
import { callback } from './github';
import { hmacSha256B64, sha256Hex, unb64 } from './lib/crypto';

const http = httpRouter();
auth.addHttpRoutes(http);
http.route({ path: '/github/callback', method: 'GET', handler: callback });

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

type RunnerAuth = { threadId: Id<'threads'>; appId: Id<'apps'>; userId: Id<'users'> };

async function runnerOf(ctx: ActionCtx, req: Request): Promise<RunnerAuth | null> {
  const got = /^Bearer (.+)$/.exec(req.headers.get('Authorization') ?? '')?.[1];
  if (!got || got.length < 20) return null;
  return ctx.runQuery(internal.runner.byToken, { hash: await sha256Hex(got) });
}

function runnerRoute(path: string, handler: (ctx: ActionCtx, req: Request, r: RunnerAuth) => Promise<Response>) {
  http.route({
    path,
    method: 'POST',
    handler: httpAction(async (ctx, req) => {
      const r = await runnerOf(ctx, req);
      if (!r) return json(401, { error: 'unauthorized' });
      try {
        return await handler(ctx, req, r);
      } catch (e) {
        console.error(`${path}:`, (e as Error).message);
        return json(500, { error: (e as Error).message.slice(0, 300) });
      }
    }),
  });
}

runnerRoute('/runner/hello', async (ctx, _req, r) => json(200, await ctx.runMutation(internal.runner.hello, { threadId: r.threadId })));

// Long poll: waits up to 25 s for work (a cheap read each second, a write only when work is there).
runnerRoute('/runner/take', async (ctx, _req, r) => {
  // RUNNER_POLL_MS: how long a poll waits (tests set 0).
  const until = Date.now() + Number(process.env.RUNNER_POLL_MS ?? 25_000);
  await ctx.runMutation(internal.runner.seen, { threadId: r.threadId });
  for (;;) {
    if (await ctx.runQuery(internal.runner.hasWork, { threadId: r.threadId })) {
      const item = await ctx.runMutation(internal.runner.take, { threadId: r.threadId });
      if (item) return json(200, { item });
    }
    if (Date.now() >= until) break;
    await new Promise((res) => setTimeout(res, 1000));
  }
  return json(200, { item: null });
});

runnerRoute('/runner/ack', async (ctx, req, r) => {
  const body = (await req.json()) as { ids?: unknown[] };
  await ctx.runMutation(internal.runner.ack, { threadId: r.threadId, ids: (body.ids ?? []).map(String).slice(0, 50) });
  return json(200, { ok: true });
});

runnerRoute('/runner/events', async (ctx, req, r) => {
  const body = (await req.json()) as { events?: unknown[] };
  const events = Array.isArray(body.events) ? body.events : [];
  // Batches stay small: one mutation per 50 events.
  for (let i = 0; i < events.length; i += 50) await ctx.runMutation(internal.runner.events, { threadId: r.threadId, events: events.slice(i, i + 50) });
  return json(200, { ok: true });
});

// Signing (docs/CLOUD.md section 6): the new app's key once, a one-time ticket per build, the log.
runnerRoute('/runner/key', async (ctx, req, r) => {
  const b = await req.json();
  return json(200, await ctx.runMutation(internal.signing.storeKey, { threadId: r.threadId, p12: String(b.p12), storePassword: String(b.storePassword), keyAlias: String(b.keyAlias), certSha256: String(b.certSha256) }));
});
runnerRoute('/runner/sign-ticket', async (ctx, req, r) => {
  const b = await req.json();
  return json(200, await ctx.runMutation(internal.signing.ticket, { threadId: r.threadId, build: Number(b.build) }));
});
runnerRoute('/runner/signed', async (ctx, req, r) => {
  const b = await req.json();
  await ctx.runMutation(internal.signing.signed, { threadId: r.threadId, build: Number(b.build), files: b.files ?? [] });
  return json(200, { ok: true });
});

runnerRoute('/runner/upload-url', async (ctx) => json(200, { url: await ctx.runMutation(internal.runner.uploadUrl, {}) }));

runnerRoute('/runner/build', async (ctx, req, r) => {
  const b = await req.json();
  await ctx.runMutation(internal.runner.recordBuild, { threadId: r.threadId, ...b });
  return json(200, { ok: true });
});

// Instabox's webhooks (Standard Webhooks signing): a box paused, stopped or was deleted by itself.
http.route({
  path: '/instabox/webhook',
  method: 'POST',
  handler: httpAction(async (ctx, req) => {
    const secret = process.env.INSTABOX_WEBHOOK_SECRET;
    if (!secret) return json(503, { error: 'not configured' });
    const id = req.headers.get('webhook-id') ?? '';
    const ts = req.headers.get('webhook-timestamp') ?? '';
    const sigs = (req.headers.get('webhook-signature') ?? '').split(' ');
    const body = await req.text();
    if (!id || !ts || Math.abs(Date.now() / 1000 - Number(ts)) > 300) return json(400, { error: 'stale' });
    const want = await hmacSha256B64(unb64(secret.replace(/^whsec_/, '')), `${id}.${ts}.${body}`);
    if (!sigs.some((s) => s.split(',')[1] === want)) return json(401, { error: 'bad signature' });
    const e = JSON.parse(body) as { type: string; data?: { sandbox?: { id?: string }; state?: string } };
    const fresh = await ctx.runMutation(internal.webhooks.once, { source: 'instabox', eventId: id });
    if (!fresh) return json(200, { ok: true, duplicate: true });
    const boxId = e.data?.sandbox?.id;
    const state = e.type === 'sandbox.deleted' ? 'deleted' : e.type === 'sandbox.suspended' ? 'paused' : e.type === 'sandbox.stopped' ? 'stopped' : null;
    if (boxId && state) await ctx.runMutation(internal.boxes.providerSays, { providerId: boxId, state });
    return json(200, { ok: true });
  }),
});

export default http;
