// HTTP routes: Convex Auth's (OAuth callbacks, JWKS), the GitHub App's callback, Instabox's
// webhooks, and the runner's. A runner signs in with its thread's runner token (Bearer); Convex
// keeps only the token's SHA-256 (threads.runnerTokenHash), made per box start.
import { httpRouter } from 'convex/server';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { httpAction, type ActionCtx } from './_generated/server';
import { auth } from './auth';
import { callback } from './github';
import { route as pageRoute, storePage } from './pages';
import { sealKeyForPc, sealTicket } from './signing';
import { done as billingDone, webhook as stripeWebhook } from './stripe';
import { hmacSha256B64, openSecret, randomToken, sha256Hex, unb64 } from './lib/crypto';
import { pcLinkPage } from './lib/pcLinkPage';
import { cleanCode, hasScope, linkCode, REQUEST_MS, showCode, type PcAuth, type PcScope } from './pclinks';
import { sealTo } from './lib/transport';

const http = httpRouter();
auth.addHttpRoutes(http);
http.route({ path: '/github/callback', method: 'GET', handler: callback });
// Stripe: the signed webhook, and the page a payment returns to.
http.route({ path: '/stripe/webhook', method: 'POST', handler: stripeWebhook });
http.route({ path: '/billing/done', method: 'GET', handler: billingDone });
// Pages the phone opens (signed ticket in the path, no phone token).
http.route({ pathPrefix: '/page/', method: 'GET', handler: pageRoute });
http.route({ pathPrefix: '/page/', method: 'POST', handler: pageRoute });

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
  return json(200, await ctx.runMutation(internal.signing.storeKey, { threadId: r.threadId, box: b.box, certSha256: String(b.certSha256) }));
});
// The Own key plan: the person's Anthropic key, sealed to the runner's one-time key; the runner
// keeps it in memory and the agent reaches Anthropic through the runner's local forwarder.
runnerRoute('/runner/own-key', async (ctx, req, r) => {
  const b = await req.json();
  const found = await ctx.runQuery(internal.runner.ownKeyRow, { threadId: r.threadId });
  if (!found) return json(404, { error: 'no own key' });
  const key = await openSecret(found.row, found.aad);
  return json(200, { box: await sealTo(String(b.runnerKey), new TextEncoder().encode(key), `ownkey:${r.threadId}`) });
});

// Convex's transport public key: a new app's key goes up sealed to it.
runnerRoute('/runner/transport-key', async () => json(200, { publicRaw: process.env.KEYS_TRANSPORT_PUBLIC ?? '' }));
runnerRoute('/runner/sign-ticket', async (ctx, req, r) => {
  const b = await req.json();
  const t = await ctx.runMutation(internal.signing.ticket, { threadId: r.threadId, build: Number(b.build) });
  return json(200, await sealTicket(t, r.threadId, Number(b.build), String(b.runnerKey)));
});
runnerRoute('/runner/signed', async (ctx, req, r) => {
  const b = await req.json();
  await ctx.runMutation(internal.signing.signed, { threadId: r.threadId, build: Number(b.build), files: b.files ?? [] });
  return json(200, { ok: true });
});

// The app's repo and a token for it alone (Contents write, 1 hour): the runner pushes with it.
runnerRoute('/runner/github-token', async (ctx, _req, r) => {
  const t = await ctx.runAction(internal.github.repoToken, { threadId: r.threadId });
  return json('error' in t ? 409 : 200, t);
});

// The main chat as Convex has it: a box that starts with no state brings it back (restore).
runnerRoute('/runner/chat', async (ctx, _req, r) => json(200, { items: await ctx.runQuery(internal.runner.chatOf, { threadId: r.threadId }) }));

runnerRoute('/runner/page', async (ctx, req, r) => {
  const b = await req.json();
  await storePage(ctx, r.threadId, { pageId: String(b.pageId), info: b.info, html: String(b.html ?? '') });
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

// ---- The PC link (milestone 7, pclinks.ts). A PC signs in with its link (Bearer kpc_...). ----

async function pcOf(ctx: ActionCtx, req: Request): Promise<PcAuth | null> {
  const got = /^Bearer (kpc_.+)$/.exec(req.headers.get('Authorization') ?? '')?.[1];
  if (!got) return null;
  return ctx.runQuery(internal.pclinks.byHash, { hash: await sha256Hex(got) });
}

/** Every PC route names the scope it needs (null: any live link); Convex checks it here. */
export function pcRoute(path: string, scope: PcScope | null, handler: (ctx: ActionCtx, req: Request, pc: PcAuth) => Promise<Response>) {
  http.route({
    path,
    method: 'POST',
    handler: httpAction(async (ctx, req) => {
      const pc = await pcOf(ctx, req);
      if (!pc) return json(401, { error: 'This PC is not linked to an account any more.' });
      if (!hasScope(pc, scope)) return json(403, { error: `This PC's link may not ${scope}.` });
      try {
        await ctx.runMutation(internal.pclinks.seen, { linkId: pc.linkId });
        return await handler(ctx, req, pc);
      } catch (e) {
        console.error(`${path}:`, (e as Error).message);
        return json(500, { error: (e as Error).message.slice(0, 300) });
      }
    }),
  });
}

// Who this PC acts for (the desktop's Account page), and a check that the link still lives.
pcRoute('/pc/hello', null, async (_ctx, _req, pc) =>
  json(200, { linkId: pc.linkId, scopes: pc.scopes, deviceName: pc.deviceName, linkedFrom: pc.linkedFrom, linkedFromName: pc.linkedFromName, account: pc.account }),
);
pcRoute('/pc/unlink', null, async (ctx, _req, pc) => {
  await ctx.runMutation(internal.pclinks.revoke, { linkId: pc.linkId });
  return json(200, { ok: true });
});
// The PC hands its sign-in to its paired phone: a one-time code the phone signs in with.
pcRoute('/pc/handoff', null, async (ctx, _req, pc) => {
  const code = randomToken(32);
  const r = await ctx.runMutation(internal.pclinks.handoff, { linkId: pc.linkId, codeHash: await sha256Hex(code) });
  return r.ok ? json(200, { code }) : json(409, { error: r.why });
});

// The desktop signs in through the browser: start (a code and the page's address), the page,
// then the companion polls with its own secret until the page approved.
http.route({
  path: '/pc/link/start',
  method: 'POST',
  handler: httpAction(async (ctx, req) => {
    const body = (await req.json().catch(() => ({}))) as { deviceName?: unknown };
    const deviceName = typeof body.deviceName === 'string' ? body.deviceName : 'My PC';
    const code = linkCode();
    const poll = randomToken(32);
    await ctx.runMutation(internal.pclinks.startRequest, { code, pollHash: await sha256Hex(poll), deviceName });
    const site = process.env.CONVEX_SITE_URL ?? new URL(req.url).origin;
    return json(200, { code, shown: showCode(code), poll, url: `${site}/pc/link?l=${code}`, expiresInMs: REQUEST_MS });
  }),
});
http.route({
  path: '/pc/link',
  method: 'GET',
  handler: httpAction(async (_ctx, req) => {
    const code = cleanCode(new URL(req.url).searchParams.get('l') ?? '');
    const html = pcLinkPage({
      cloudUrl: process.env.CONVEX_CLOUD_URL ?? '',
      code,
      google: Boolean(process.env.AUTH_GOOGLE_ID),
      email: Boolean(process.env.AUTH_RESEND_KEY),
      testAccount: process.env.SPIKE_ANONYMOUS === '1',
    });
    return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
  }),
});
http.route({
  path: '/pc/link/poll',
  method: 'POST',
  handler: httpAction(async (ctx, req) => {
    const body = (await req.json().catch(() => ({}))) as { code?: unknown; poll?: unknown };
    if (typeof body.code !== 'string' || typeof body.poll !== 'string') return json(400, { error: 'code and poll are needed' });
    const token = `kpc_${randomToken()}`;
    const r = await ctx.runMutation(internal.pclinks.pollRequest, { code: body.code, pollHash: await sha256Hex(body.poll), tokenHash: await sha256Hex(token) });
    if (r.state === 'linked') return json(200, { state: 'linked', token });
    return json(r.state === 'gone' ? 410 : 200, { state: r.state });
  }),
});

// ---- Moving apps (milestone 8, moves.ts): the PC does the work with its link's `move` scope. ----

const bodyOf = async (req: Request) => (await req.json().catch(() => ({}))) as Record<string, unknown>;
const field = (b: Record<string, unknown>, k: string) => (typeof b[k] === 'string' ? (b[k] as string) : '');
const sentence = (e: unknown) => (e as Error).message.replace(/^[\s\S]*Uncaught Error: /, '').split('\n')[0]!;

pcRoute('/pc/move/to-cloud', 'move', async (ctx, req, pc) => {
  const b = await bodyOf(req);
  const presets = ['react-native', 'kotlin', 'expo-exact'] as const;
  const preset = presets.find((p) => p === field(b, 'preset'));
  let started;
  try {
    started = await ctx.runMutation(internal.moves.startToCloud, {
      userId: pc.userId,
      linkId: pc.linkId,
      pcAppId: field(b, 'pcAppId'),
      name: field(b, 'name'),
      slug: field(b, 'slug'),
      packageName: field(b, 'packageName'),
      ...(preset ? { preset } : {}),
      buildHigh: Number(b.buildHigh) || 0,
    });
  } catch (e) {
    return json(409, { error: sentence(e) });
  }
  // The app's own private repo on the person's GitHub (made once; a resumed move finds it).
  const repo = await ctx.runAction(internal.github.createAppRepo, { appId: started.appId });
  if (!repo) return json(409, { error: 'Could not make the app repo on your GitHub. Connect GitHub again, then try once more.' });
  const { move } = await ctx.runMutation(internal.moves.appOfMove, { moveId: started.moveId, userId: pc.userId });
  return json(200, { moveId: started.moveId, appId: started.appId, repo, resumed: started.resumed, steps: move.steps });
});

pcRoute('/pc/move/to-pc', 'move', async (ctx, req, pc) => {
  const b = await bodyOf(req);
  try {
    return json(200, await ctx.runMutation(internal.moves.startToPc, { userId: pc.userId, linkId: pc.linkId, appId: field(b, 'appId') }));
  } catch (e) {
    return json(409, { error: sentence(e) });
  }
});

async function moveFor(ctx: ActionCtx, pc: PcAuth, moveId: string) {
  return ctx.runMutation(internal.moves.appOfMove, { moveId, userId: pc.userId });
}

// A token for this app's repo only: the PC pushes (to the cloud) or clones (to the PC) with it.
pcRoute('/pc/move/repo-token', 'move', async (ctx, req, pc) => {
  const { app } = await moveFor(ctx, pc, field(await bodyOf(req), 'moveId'));
  const t = await ctx.runAction(internal.github.repoTokenForApp, { appId: app._id });
  return 'error' in t ? json(409, { error: t.error }) : json(200, t);
});

// The PC pushed: Convex checks the repo's main is that commit before the step counts.
pcRoute('/pc/move/code', 'move', async (ctx, req, pc) => {
  const b = await bodyOf(req);
  const { move, app } = await moveFor(ctx, pc, field(b, 'moveId'));
  const commit = field(b, 'commit');
  if (!/^[0-9a-f]{40}$/.test(commit)) return json(400, { error: 'commit is needed' });
  const t = await ctx.runAction(internal.github.repoTokenForApp, { appId: app._id });
  if ('error' in t) return json(409, { error: t.error });
  const res = await fetch(`https://api.github.com/repos/${t.repo}/commits/main`, { headers: { Authorization: `Bearer ${t.token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'kiwimake-cloud' } });
  const head = res.ok ? ((await res.json()) as { sha?: string }).sha : undefined;
  if (head !== commit) return json(409, { error: `GitHub does not have that commit on main yet (${res.status}).` });
  await ctx.runMutation(internal.moves.markStep, { moveId: move._id, step: 'code', commit });
  return json(200, { ok: true });
});

pcRoute('/pc/move/transport-key', 'move', async () => json(200, { publicRaw: process.env.KEYS_TRANSPORT_PUBLIC ?? '' }));

// To the cloud: the PC's key, sealed to Convex's transport key for this move.
pcRoute('/pc/move/key', 'move', async (ctx, req, pc) => {
  const b = await bodyOf(req);
  const { move } = await moveFor(ctx, pc, field(b, 'moveId'));
  try {
    const r = await ctx.runMutation(internal.signing.storeMovedKey, { moveId: move._id, box: b.box as { epk: string; iv: string; ct: string }, certSha256: field(b, 'certSha256') });
    await ctx.runMutation(internal.moves.markStep, { moveId: move._id, step: 'key' });
    return json(200, r);
  } catch (e) {
    return json(409, { error: sentence(e) });
  }
});

// To the cloud: the chat and to-dos, in batches; `last` ends the step.
pcRoute('/pc/move/chat', 'move', async (ctx, req, pc) => {
  const b = await bodyOf(req);
  return json(
    200,
    await ctx.runMutation(internal.moves.putChat, { moveId: field(b, 'moveId'), userId: pc.userId, items: Array.isArray(b.items) ? b.items : [], ...(Array.isArray(b.todos) ? { todos: b.todos } : {}), last: b.last === true }),
  );
});

// To the PC: the key sealed to the PC's one-time key, then the chat and to-dos.
pcRoute('/pc/move/key-down', 'move', async (ctx, req, pc) => {
  const b = await bodyOf(req);
  const { move, app } = await moveFor(ctx, pc, field(b, 'moveId'));
  if (move.kind !== 'toPc') return json(400, { error: 'Not a move to the PC.' });
  const k = await ctx.runQuery(internal.signing.keyForMove, { appId: app._id });
  if (!k) return json(409, { error: 'This app has no signing key in the cloud yet.' });
  return json(200, await sealKeyForPc(k, move._id, field(b, 'pcKey')));
});
pcRoute('/pc/move/chat-down', 'move', async (ctx, req, pc) => {
  const { move, app } = await moveFor(ctx, pc, field(await bodyOf(req), 'moveId'));
  if (move.kind !== 'toPc') return json(400, { error: 'Not a move to the PC.' });
  return json(200, await ctx.runQuery(internal.moves.chatForPc, { appId: app._id }));
});
// To the PC: the PC says it has the code, the key or the chat.
pcRoute('/pc/move/step', 'move', async (ctx, req, pc) => {
  const b = await bodyOf(req);
  const { move } = await moveFor(ctx, pc, field(b, 'moveId'));
  const step = field(b, 'step');
  if (move.kind !== 'toPc' || !['code', 'key', 'chat'].includes(step)) return json(400, { error: 'bad step' });
  await ctx.runMutation(internal.moves.markStep, { moveId: move._id, step: step as 'code' | 'key' | 'chat' });
  return json(200, { ok: true });
});

pcRoute('/pc/move/finish', 'move', async (ctx, req, pc) => {
  const b = await bodyOf(req);
  try {
    return json(
      200,
      await ctx.runMutation(internal.moves.finish, {
        moveId: field(b, 'moveId'),
        userId: pc.userId,
        ...(typeof b.buildHigh === 'number' ? { buildHigh: b.buildHigh } : {}),
        ...(field(b, 'pcAppId') ? { pcAppId: field(b, 'pcAppId') } : {}),
      }),
    );
  } catch (e) {
    return json(409, { error: sentence(e) });
  }
});
pcRoute('/pc/move/fail', 'move', async (ctx, req, pc) => {
  const b = await bodyOf(req);
  await ctx.runMutation(internal.moves.fail, { moveId: field(b, 'moveId'), userId: pc.userId, error: field(b, 'error') || 'stopped' });
  return json(200, { ok: true });
});

export default http;
