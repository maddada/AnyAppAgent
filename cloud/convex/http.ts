// HTTP routes: Convex Auth's (OAuth callbacks, JWKS) and the runner's. The runner signs in with a
// bearer token whose SHA-256 is the RUNNER_TOKEN_SHA256 env var (the spike: one box; milestone 1
// makes one token per box, stored as a hash in the boxes table).
import { httpRouter } from 'convex/server';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { httpAction } from './_generated/server';
import { auth } from './auth';

const http = httpRouter();
auth.addHttpRoutes(http);

async function sha256Hex(s: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function runnerOk(req: Request) {
  const want = process.env.RUNNER_TOKEN_SHA256;
  const got = /^Bearer (.+)$/.exec(req.headers.get('Authorization') ?? '')?.[1];
  if (!want || !got) return false;
  return (await sha256Hex(got)) === want;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// Long poll: waits up to 25 s for work.
http.route({
  path: '/runner/take',
  method: 'POST',
  handler: httpAction(async (ctx, req) => {
    if (!(await runnerOk(req))) return json(401, { error: 'unauthorized' });
    const until = Date.now() + 25_000;
    while (Date.now() < until) {
      const item = await ctx.runMutation(internal.runner.take, {});
      if (item) return json(200, { item });
      await new Promise((r) => setTimeout(r, 1000));
    }
    return json(200, { item: null });
  }),
});

http.route({
  path: '/runner/post',
  method: 'POST',
  handler: httpAction(async (ctx, req) => {
    if (!(await runnerOk(req))) return json(401, { error: 'unauthorized' });
    const b = await req.json();
    await ctx.runMutation(internal.runner.post, {
      threadId: b.threadId as Id<'threads'>,
      role: b.role,
      text: String(b.text ?? ''),
      ...(b.apkFileId ? { apkFileId: b.apkFileId as Id<'_storage'> } : {}),
      ...(b.usage ? { usage: b.usage } : {}),
    });
    return json(200, { ok: true });
  }),
});

// A one-time upload URL for an APK (the box POSTs the file there and gets a storageId back).
http.route({
  path: '/runner/upload-url',
  method: 'POST',
  handler: httpAction(async (ctx, req) => {
    if (!(await runnerOk(req))) return json(401, { error: 'unauthorized' });
    return json(200, { url: await ctx.storage.generateUploadUrl() });
  }),
});

export default http;
