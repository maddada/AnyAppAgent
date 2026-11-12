// Pages in the cloud (the plan page, questions, mockups): the runner uploads each page the agent
// publishes, with the page kit already in it; the phone opens it here with a signed ticket (no
// phone token, as on the PC); answers given on the page go to the box through the inbox. Drafts
// are kept here. The routes mirror server/src/pages.ts's /page/<id>/<ticket>[/answers|/draft|...].
import { v } from 'convex/values';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { httpAction, internalMutation, internalQuery, mutation } from './_generated/server';
import { hmacSha256B64, sameHex, unb64 } from './lib/crypto';
import { ownApp, requireUser, threadOf } from './lib/session';

const TICKET_DAYS = 1;
const ANSWERS_MAX = 512 * 1024;

async function ticketKey(): Promise<Uint8Array> {
  const kek = process.env.KEYS_KEK;
  if (!kek) throw new Error('KEYS_KEK is not set');
  // A key of its own for page tickets, derived from the master key (never the master key itself).
  return unb64(await hmacSha256B64(unb64(kek), 'kiwimake page tickets'));
}

async function sign(pageId: string, expires: number) {
  const mac = await hmacSha256B64(await ticketKey(), `${pageId}.${expires}`);
  return mac.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '').slice(0, 32);
}

export async function checkTicket(pageId: string, ticket: string): Promise<boolean> {
  const m = /^([0-9a-z]+)\.([A-Za-z0-9_-]{32})$/.exec(ticket);
  if (!m) return false;
  const expires = parseInt(m[1]!, 36);
  if (!Number.isFinite(expires) || expires * 1000 < Date.now()) return false;
  return sameHex(await sign(pageId, expires), m[2]!);
}

/** The phone opens a page: a link good for a day, only for the app's owner. */
export const open = mutation({
  args: { appId: v.string(), pageId: v.string() },
  handler: async (ctx, { appId, pageId }) => {
    const user = await requireUser(ctx);
    const app = await ownApp(ctx, user._id, appId);
    const thread = await threadOf(ctx, app._id);
    const row = await ctx.db.query('pages').withIndex('by_thread_page', (q) => q.eq('threadId', thread._id).eq('pageId', pageId)).first();
    if (!row?.htmlFileId) throw new Error('This page is not ready yet. Try again in a moment.');
    const expires = Math.floor(Date.now() / 1000) + TICKET_DAYS * 86400;
    return { path: `/page/${pageId}/${expires.toString(36)}.${await sign(pageId, expires)}`, expiresAt: new Date(expires * 1000).toISOString() };
  },
});

export const record = internalMutation({
  args: { threadId: v.id('threads'), pageId: v.string(), info: v.any(), htmlFileId: v.id('_storage') },
  handler: async (ctx, a) => {
    const row = await ctx.db.query('pages').withIndex('by_thread_page', (q) => q.eq('threadId', a.threadId).eq('pageId', a.pageId)).first();
    if (row) {
      if (row.htmlFileId && row.htmlFileId !== a.htmlFileId) await ctx.storage.delete(row.htmlFileId).catch(() => {});
      await ctx.db.patch(row._id, { info: a.info, htmlFileId: a.htmlFileId });
    } else await ctx.db.insert('pages', a);
  },
});

export const byPage = internalQuery({
  args: { pageId: v.string() },
  handler: async (ctx, { pageId }) => {
    const row = await ctx.db.query('pages').withIndex('by_page', (q) => q.eq('pageId', pageId)).first();
    if (!row) return null;
    return row;
  },
});

export const answer = internalMutation({
  args: { pageId: v.string(), answers: v.any() },
  handler: async (ctx, { pageId, answers }) => {
    const row = await ctx.db.query('pages').withIndex('by_page', (q) => q.eq('pageId', pageId)).first();
    if (!row) return { status: 404, error: 'No such page.' };
    if (row.answeredAt) return { status: 409, error: 'These answers were already sent.', answeredAt: row.answeredAt };
    const at = new Date().toISOString();
    await ctx.db.patch(row._id, { answers, answeredAt: at, draft: undefined, draftEditedAt: undefined });
    await ctx.db.insert('inbox', { threadId: row.threadId, kind: 'page-answers', payload: { pageId, answers } });
    await ctx.db.patch(row.threadId, { lastActiveAt: Date.now() });
    await ctx.scheduler.runAfter(0, internal.boxes.ensure, { threadId: row.threadId });
    return { status: 200, answeredAt: at };
  },
});

export const saveDraft = internalMutation({
  args: { pageId: v.string(), draft: v.any(), editedAt: v.number() },
  handler: async (ctx, { pageId, draft, editedAt }) => {
    const row = await ctx.db.query('pages').withIndex('by_page', (q) => q.eq('pageId', pageId)).first();
    if (!row) return { status: 404 };
    if (row.answeredAt) return { status: 409, answeredAt: row.answeredAt };
    const kept = !(row.draftEditedAt && row.draftEditedAt > editedAt);
    if (kept) await ctx.db.patch(row._id, { draft, draftEditedAt: editedAt });
    return { status: 200, kept };
  },
});

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' } });

/** The page's content policy (as server/src/pages.ts pagePolicy), naming its routes on this host. */
function policy(host: string, base: string) {
  const own = ` https://${host}${base}/`;
  return [
    'sandbox allow-scripts allow-forms allow-popups',
    "default-src 'none'",
    "script-src 'unsafe-inline' 'unsafe-eval' https:",
    "style-src 'unsafe-inline' https:",
    `img-src data: blob: https:${own}`,
    'font-src data: https:',
    `connect-src https:${own}`,
    'media-src data: blob: https:',
  ].join('; ');
}

/** /page/<id>/<ticket>[/answers|/draft|/image|/notice|/scroll] */
export const route = httpAction(async (ctx, req) => {
  const url = new URL(req.url);
  const m = /^\/page\/([0-9a-f]{32})\/([^/]+)(?:\/(answers|draft|image|notice|scroll))?$/.exec(url.pathname);
  if (!m) return json(404, { ok: false, error: 'No such page.' });
  const [, pageId, ticket, action] = m as unknown as [string, string, string, string | undefined];
  const row = (await checkTicket(pageId, ticket)) ? await ctx.runQuery(internal.pages.byPage, { pageId }) : null;
  if (!row || !row.htmlFileId) {
    if (!action) {
      return new Response(
        "<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width'><p style='font:16px system-ui;padding:24px'>This page is not here any more, or its link is too old. Open it again from the chat.</p>",
        { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } },
      );
    }
    return json(404, { ok: false, error: 'No such page.' });
  }
  const method = req.method;
  if (!action && method === 'GET') {
    const blob = await ctx.storage.get(row.htmlFileId);
    if (!blob) return json(404, { ok: false, error: 'No such page.' });
    const stored = await blob.text();
    const state = row.answeredAt
      ? { answered: true, answeredAt: row.answeredAt, answers: row.answers ?? null, ...(row.info?.awaitsSeen ? { awaitsSeen: true } : {}) }
      : { answered: false, draft: row.draft ?? null, draftEditedAt: row.draftEditedAt ?? null, ...(row.info?.awaitsSeen ? { awaitsSeen: true } : {}) };
    const html = stored.replace('ghostex.__state(null)', `ghostex.__state(${JSON.stringify(state).replace(/</g, '\\u003c')})`);
    return new Response(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': policy(url.host, `/page/${pageId}/${ticket}`),
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Cache-Control': 'no-store',
      },
    });
  }
  if (action === 'answers' && method === 'POST') {
    const text = await req.text();
    if (text.length > ANSWERS_MAX) return json(413, { ok: false, error: 'The answers are too large.' });
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return json(400, { ok: false, error: 'Send {"answers": ...} as JSON.' });
    }
    if (!body || typeof body !== 'object' || !('answers' in body)) return json(400, { ok: false, error: 'Send {"answers": ...} as JSON.' });
    const r = await ctx.runMutation(internal.pages.answer, { pageId, answers: (body as { answers: unknown }).answers });
    return r.status === 200 ? json(200, { ok: true, answeredAt: r.answeredAt, delivered: true }) : json(r.status, { ok: false, ...r });
  }
  if (action === 'draft' && method === 'GET') {
    return json(200, row.answeredAt ? { ok: true, answered: true, draft: null, editedAt: null } : { ok: true, answered: false, draft: row.draft ?? null, editedAt: row.draftEditedAt ?? null });
  }
  if (action === 'draft' && method === 'POST') {
    const body = (await req.json().catch(() => null)) as { draft?: unknown; editedAt?: number } | null;
    if (!body || !('draft' in body)) return json(400, { ok: false, error: 'Send {"draft": ...} as JSON.' });
    const r = await ctx.runMutation(internal.pages.saveDraft, { pageId, draft: body.draft, editedAt: Number(body.editedAt ?? Date.now()) });
    return r.status === 200 ? json(200, { ok: true, kept: r.kept }) : json(r.status, { ok: false, error: 'These answers were already sent.' });
  }
  if ((action === 'notice' || action === 'scroll') && method === 'POST') return json(200, { ok: true });
  if (action === 'image') return json(409, { ok: false, error: 'Pictures cannot be pasted into a page in the cloud yet. Describe it in the chat instead.' });
  return json(405, { ok: false, error: 'Not allowed.' });
});

/** The runner's upload of a page it published (http.ts /runner/page). */
export async function storePage(ctx: { storage: { store(b: Blob): Promise<Id<'_storage'>> }; runMutation: Function }, threadId: Id<'threads'>, b: { pageId: string; info: unknown; html: string }) {
  if (!/^[0-9a-f]{32}$/.test(b.pageId)) throw new Error('bad page id');
  const fileId = await ctx.storage.store(new Blob([b.html], { type: 'text/html' }));
  await (ctx.runMutation as (f: unknown, a: unknown) => Promise<void>)(internal.pages.record, { threadId, pageId: b.pageId, info: b.info, htmlFileId: fileId });
}

