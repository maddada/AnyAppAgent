// GitHub (docs/CLOUD.md section 3, "The code lives on the person's GitHub"), through the GitHub
// App "Kiwimake Cloud":
//   - connecting: the phone asks for a link (connectUrl), the person installs or authorizes the App
//     in the browser, GitHub sends them to /github/callback with a code and our state, and the code
//     becomes their user token (8 hours) and refresh token (6 months), both sealed in `secrets`;
//   - the user token is refreshed when it is about to expire; a refused refresh marks GitHub as
//     disconnected (cloud changes wait until they connect again);
//   - each cloud app gets a private repo anyapp-cloud-<slug>, made with the user token (an
//     installation token cannot make one on a personal account: spike, 12 Nov 2026);
//   - a box gets a token for its one repo only, Contents write, 1 hour, minted with the App's key.
import { v } from 'convex/values';
import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { httpAction, internalAction, internalMutation, internalQuery, mutation, type ActionCtx } from './_generated/server';
import { b64, open, randomToken, seal, unb64 } from './lib/crypto';
import { requireUser } from './lib/session';

const API = 'https://api.github.com';
const STATE_MS = 30 * 60_000;
const REFRESH_EARLY_MS = 5 * 60_000;
/** The phone's way back after the browser (app/app.json "scheme"). */
const BACK_TO_APP = 'anyappagent://github';

async function gh(method: string, path: string, token: string, body?: unknown) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'kiwimake-cloud',
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {}
  return { status: res.status, json };
}

// ---------- connecting

/** A link for the browser: install the App (first time) or authorize it again. */
export const connectUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const state = randomToken(24);
    await ctx.db.insert('githubStates', { state, userId: user._id, createdAt: Date.now() });
    const slug = process.env.GITHUB_APP_SLUG ?? '';
    const clientId = process.env.GITHUB_APP_CLIENT_ID ?? '';
    const install = `https://github.com/apps/${slug}/installations/new?state=${encodeURIComponent(state)}`;
    const authorize = `https://github.com/login/oauth/authorize?client_id=${encodeURIComponent(clientId)}&state=${encodeURIComponent(state)}`;
    return { url: user.githubInstallationId ? authorize : install, install, authorize };
  },
});

export const takeState = internalMutation({
  args: { state: v.string() },
  handler: async (ctx, { state }) => {
    const row = await ctx.db.query('githubStates').withIndex('by_state', (q) => q.eq('state', state)).first();
    if (!row) return null;
    await ctx.db.delete(row._id);
    if (Date.now() - row.createdAt > STATE_MS) return null;
    return row.userId;
  },
});

const page = (title: string, line: string, ok: boolean) =>
  new Response(
    `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{font-family:system-ui,sans-serif;background:#F3EEE6;color:#22201C;padding:32px;max-width:520px;margin:auto}
@media (prefers-color-scheme:dark){body{background:#1C1B19;color:#EDE8E0}a{color:#7FC29B}}
h1{font-size:24px}a.b{display:inline-block;margin-top:20px;padding:12px 18px;border-radius:10px;background:#2F6B4F;color:#fff;text-decoration:none}
.r{text-align:right}</style>
<h1>${title}</h1><p>${line}</p><div class="r"><a class="b" href="${BACK_TO_APP}?ok=${ok ? 1 : 0}">Back to Kiwimake</a></div>
${ok ? `<script>setTimeout(function(){location.href=${JSON.stringify(`${BACK_TO_APP}?ok=1`)}},600)</script>` : ''}`,
    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );

/** GitHub sends the person here after installing or authorizing, with a code and our state. */
export const callback = httpAction(async (ctx, req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state) return page('Nothing to connect', 'GitHub did not send everything back. Go back to Kiwimake and try again.', false);
  const userId = await ctx.runMutation(internal.github.takeState, { state });
  if (!userId) return page('That link has expired', 'Go back to Kiwimake and tap Connect GitHub again.', false);
  const res = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: process.env.GITHUB_APP_CLIENT_ID, client_secret: process.env.GITHUB_APP_CLIENT_SECRET, code }),
  });
  const t = await res.json();
  if (!t.access_token) return page('GitHub did not connect', `GitHub said: ${String(t.error_description ?? t.error ?? res.status).slice(0, 200)}`, false);
  const done = await saveFromToken(ctx, userId, t, url.searchParams.get('installation_id') ?? undefined);
  if (!done.ok) return page('GitHub did not connect', done.why, false);
  return page('GitHub is connected', `Your apps' code goes to your GitHub account ${done.login}, in private repositories you own.`, true);
});

/** Stores a fresh token response for the person and records their GitHub account and install. */
async function saveFromToken(ctx: ActionCtx, userId: Id<'users'>, t: any, installationId?: string): Promise<{ ok: true; login: string } | { ok: false; why: string }> {
  const me = await gh('GET', '/user', t.access_token);
  const login = String(me.json?.login ?? '');
  const githubUserId = Number(me.json?.id ?? 0);
  if (!login || !githubUserId) return { ok: false, why: 'Could not read your GitHub account.' };
  let inst = installationId;
  if (!inst) {
    const list = await gh('GET', '/user/installations', t.access_token);
    const mine = (list.json?.installations ?? []).find((i: any) => String(i.app_id) === String(process.env.GITHUB_APP_ID) || i.app_slug === process.env.GITHUB_APP_SLUG);
    if (mine) inst = String(mine.id);
  }
  if (!inst) return { ok: false, why: 'Kiwimake is not installed on your GitHub account yet. Go back and tap Connect GitHub again to install it.' };
  await ctx.runMutation(internal.github.saveToken, {
    userId,
    login,
    githubUserId,
    installationId: inst,
    access: await seal(t.access_token, `github:access:${userId}`),
    refresh: t.refresh_token ? await seal(t.refresh_token, `github:refresh:${userId}`) : undefined,
    expiresAt: t.expires_in ? Date.now() + Number(t.expires_in) * 1000 : undefined,
    refreshExpiresAt: t.refresh_token_expires_in ? Date.now() + Number(t.refresh_token_expires_in) * 1000 : undefined,
  });
  return { ok: true, login };
}

const sealed = v.object({ iv: v.string(), ciphertext: v.string() });

export const saveToken = internalMutation({
  args: {
    userId: v.id('users'),
    login: v.string(),
    githubUserId: v.number(),
    installationId: v.string(),
    access: sealed,
    refresh: v.optional(sealed),
    expiresAt: v.optional(v.number()),
    refreshExpiresAt: v.optional(v.number()),
  },
  handler: async (ctx, a) => {
    const put = async (kind: 'githubAccess' | 'githubRefresh', box: { iv: string; ciphertext: string }, expiresAt?: number) => {
      const old = await ctx.db.query('secrets').withIndex('by_user_kind', (q) => q.eq('userId', a.userId).eq('kind', kind)).first();
      const row = { userId: a.userId, kind, iv: box.iv, ciphertext: box.ciphertext, ...(expiresAt ? { expiresAt } : {}) };
      if (old) await ctx.db.replace(old._id, row);
      else await ctx.db.insert('secrets', row);
    };
    await put('githubAccess', a.access, a.expiresAt);
    if (a.refresh) await put('githubRefresh', a.refresh, a.refreshExpiresAt);
    await ctx.db.patch(a.userId, { githubLogin: a.login, githubUserId: a.githubUserId, githubInstallationId: a.installationId, githubDisconnectedAt: undefined });
  },
});

export const tokensOf = internalQuery({
  args: { userId: v.id('users') },
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get(userId);
    const access = await ctx.db.query('secrets').withIndex('by_user_kind', (q) => q.eq('userId', userId).eq('kind', 'githubAccess')).first();
    const refresh = await ctx.db.query('secrets').withIndex('by_user_kind', (q) => q.eq('userId', userId).eq('kind', 'githubRefresh')).first();
    return { user, access, refresh };
  },
});

export const markDisconnected = internalMutation({
  args: { userId: v.id('users') },
  handler: async (ctx, { userId }) => {
    await ctx.db.patch(userId, { githubDisconnectedAt: Date.now() });
  },
});

/** "Disconnect GitHub" in the account sheet: the tokens go; repos and apps stay as they are. */
export const disconnect = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    for (const kind of ['githubAccess', 'githubRefresh'] as const) {
      const row = await ctx.db.query('secrets').withIndex('by_user_kind', (q) => q.eq('userId', user._id).eq('kind', kind)).first();
      if (row) await ctx.db.delete(row._id);
    }
    await ctx.db.patch(user._id, { githubDisconnectedAt: Date.now() });
  },
});

/** The person's user token, refreshed when it is about to expire. Null when GitHub is disconnected. */
export const userToken = internalAction({
  args: { userId: v.id('users') },
  handler: async (ctx, { userId }): Promise<string | null> => {
    const { user, access, refresh } = await ctx.runQuery(internal.github.tokensOf, { userId });
    if (!user || !access || user.githubDisconnectedAt) return null;
    if (!access.expiresAt || access.expiresAt - REFRESH_EARLY_MS > Date.now()) return open(access, `github:access:${userId}`);
    if (!refresh) {
      await ctx.runMutation(internal.github.markDisconnected, { userId });
      return null;
    }
    const res = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: process.env.GITHUB_APP_CLIENT_ID,
        client_secret: process.env.GITHUB_APP_CLIENT_SECRET,
        grant_type: 'refresh_token',
        refresh_token: await open(refresh, `github:refresh:${userId}`),
      }),
    });
    const t = await res.json();
    if (!t.access_token) {
      // bad_refresh_token: revoked, expired or the App was uninstalled. Changes wait for a reconnect.
      console.error('GitHub refresh refused:', String(t.error ?? res.status));
      await ctx.runMutation(internal.github.markDisconnected, { userId });
      return null;
    }
    const done = await saveFromToken(ctx, userId, t, user.githubInstallationId);
    if (!done.ok) {
      await ctx.runMutation(internal.github.markDisconnected, { userId });
      return null;
    }
    return t.access_token as string;
  },
});

// ---------- the app's repo

export const appRow = internalQuery({
  args: { appId: v.id('apps') },
  handler: async (ctx, { appId }) => ctx.db.get(appId),
});

export const setRepo = internalMutation({
  args: { appId: v.id('apps'), repo: v.string() },
  handler: async (ctx, { appId, repo }) => {
    await ctx.db.patch(appId, { repo, updatedAt: Date.now() });
  },
});

export const REPO_RE = /^anyapp-cloud-[a-z0-9-]+$/;

/** Makes the app's private repo anyapp-cloud-<slug> on the person's account (a free name). */
export const createAppRepo = internalAction({
  args: { appId: v.id('apps') },
  handler: async (ctx, { appId }): Promise<string | null> => {
    const app = await ctx.runQuery(internal.github.appRow, { appId });
    if (!app || app.repo) return app?.repo ?? null;
    const token = await ctx.runAction(internal.github.userToken, { userId: app.userId });
    if (!token) return null;
    for (let n = 1; n <= 20; n++) {
      const name = `anyapp-cloud-${app.slug}${n > 1 ? `-${n}` : ''}`;
      if (!REPO_RE.test(name)) throw new Error(`not a cloud repo name: ${name}`);
      const made = await gh('POST', '/user/repos', token, { name, private: true, auto_init: false, description: `${app.name}: a Kiwimake app` });
      if (made.status === 201) {
        await ctx.runMutation(internal.github.setRepo, { appId, repo: String(made.json.full_name) });
        console.log(`made ${made.json.full_name}`);
        return made.json.full_name as string;
      }
      // A repo by that name exists already (another app, an older one): the next name.
      if (made.status === 422) continue;
      throw new Error(`GitHub refused to make the repo (${made.status}): ${String(made.json?.message ?? '').slice(0, 200)}`);
    }
    throw new Error('no free repo name');
  },
});

// ---------- one-repo tokens for a box

function pemToDer(pem: string): Uint8Array {
  return unb64(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''));
}

const b64url = (u: Uint8Array) => b64(u).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** The App's own JWT (RS256, 9 minutes), with its private key (GITHUB_APP_PRIVATE_KEY, PKCS#8 PEM). */
export async function appJwt(): Promise<string> {
  const pem = process.env.GITHUB_APP_PRIVATE_KEY;
  if (!pem) throw new Error('GITHUB_APP_PRIVATE_KEY is not set');
  const key = await crypto.subtle.importKey('pkcs8', pemToDer(pem) as Uint8Array<ArrayBuffer>, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const now = Math.floor(Date.now() / 1000);
  const enc = new TextEncoder();
  const head = b64url(enc.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const body = b64url(enc.encode(JSON.stringify({ iat: now - 60, exp: now + 540, iss: process.env.GITHUB_APP_CLIENT_ID || process.env.GITHUB_APP_ID })));
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(`${head}.${body}`)));
  return `${head}.${body}.${b64url(sig)}`;
}

export const threadApp = internalQuery({
  args: { threadId: v.id('threads') },
  handler: async (ctx, { threadId }) => {
    const t = await ctx.db.get(threadId);
    const app = t ? await ctx.db.get(t.appId) : null;
    const user = t ? await ctx.db.get(t.userId) : null;
    return { app, user } as { app: Doc<'apps'> | null; user: Doc<'users'> | null };
  },
});

/** A token for the thread's app repo only: Contents write, Metadata read, 1 hour. */
export const repoToken = internalAction({
  args: { threadId: v.id('threads') },
  handler: async (ctx, { threadId }): Promise<{ token: string; repo: string; expiresAt: string } | { error: string }> => {
    const { app, user } = await ctx.runQuery(internal.github.threadApp, { threadId });
    if (!app || !user) return { error: 'no app' };
    if (!user.githubInstallationId || user.githubDisconnectedAt) return { error: 'GitHub is not connected' };
    const repo = app.repo ?? (await ctx.runAction(internal.github.createAppRepo, { appId: app._id }));
    if (!repo) return { error: 'the app has no repo yet' };
    const [, name] = repo.split('/');
    const r = await gh('POST', `/app/installations/${user.githubInstallationId}/access_tokens`, await appJwt(), {
      repositories: [name],
      permissions: { contents: 'write', metadata: 'read' },
    });
    if (r.status !== 201) {
      // The App was uninstalled, or the repo left a "selected repositories" install.
      if (r.status === 404 || r.status === 403 || r.status === 422) await ctx.runMutation(internal.github.markDisconnected, { userId: user._id });
      return { error: `GitHub refused a token (${r.status}): ${String(r.json?.message ?? '').slice(0, 160)}` };
    }
    return { token: r.json.token as string, repo, expiresAt: r.json.expires_at as string };
  },
});

// ---------- dev only

/**
 * Dev: gives a (proof) account the user token the spike stored for `login`, resealed for that
 * account. Only with KIWI_ALLOW_WIPE=1 (the dev deployment).
 */
export const adoptSpikeToken = internalAction({
  args: { userId: v.id('users'), login: v.string() },
  handler: async (ctx, { userId, login }): Promise<{ ok: boolean }> => {
    if (process.env.KIWI_ALLOW_WIPE !== '1') throw new Error('dev only');
    const row = await ctx.runQuery(internal.github.spikeToken, { login });
    if (!row) throw new Error(`no spike token for ${login}`);
    const access = await open(row.access, `github:access:${login}`);
    const refresh = row.refresh ? await open(row.refresh, `github:refresh:${login}`) : undefined;
    // An expired access token is refreshed at once (its refresh token lasts 6 months).
    const done = await saveFromToken(ctx, userId, { access_token: access, refresh_token: refresh, expires_in: Math.max(1, Math.floor(((row.expiresAt ?? 0) - Date.now()) / 1000)) }, row.installationId).catch(() => null);
    if (!done?.ok) {
      // The old access token no longer reads /user: store the refresh token alone and refresh.
      if (!refresh) throw new Error('the spike token has expired and has no refresh token');
      await ctx.runMutation(internal.github.saveToken, {
        userId,
        login,
        githubUserId: 0,
        installationId: row.installationId ?? '',
        access: await seal(access, `github:access:${userId}`),
        refresh: await seal(refresh, `github:refresh:${userId}`),
        expiresAt: 1,
      });
    }
    const token: string | null = await ctx.runAction(internal.github.userToken, { userId });
    return { ok: Boolean(token) };
  },
});

export const spikeToken = internalQuery({
  args: { login: v.string() },
  handler: async (ctx, { login }) => ctx.db.query('githubTokens').withIndex('by_login', (q) => q.eq('login', login)).first(),
});

/** Dev: a user's GitHub state for scripts (no tokens). */
export const statusOf = internalQuery({
  args: { userId: v.id('users') },
  handler: async (ctx, { userId }) => {
    const u = await ctx.db.get(userId);
    const access = await ctx.db.query('secrets').withIndex('by_user_kind', (q) => q.eq('userId', userId).eq('kind', 'githubAccess')).first();
    return { login: u?.githubLogin ?? null, installationId: u?.githubInstallationId ?? null, disconnectedAt: u?.githubDisconnectedAt ?? null, accessExpiresAt: access?.expiresAt ?? null };
  },
});

/** Dev: makes the stored user token look expired (to prove the refresh). */
export const devExpireAccess = internalMutation({
  args: { userId: v.id('users') },
  handler: async (ctx, { userId }) => {
    if (process.env.KIWI_ALLOW_WIPE !== '1') throw new Error('dev only');
    const row = await ctx.db.query('secrets').withIndex('by_user_kind', (q) => q.eq('userId', userId).eq('kind', 'githubAccess')).first();
    if (row) await ctx.db.patch(row._id, { expiresAt: Date.now() - 1000 });
  },
});

/** Dev: gets the user token (refreshing it if due) and says only whether it works (never the token). */
export const devCheckToken = internalAction({
  args: { userId: v.id('users') },
  handler: async (ctx, { userId }): Promise<{ ok: boolean; login: string | null }> => {
    if (process.env.KIWI_ALLOW_WIPE !== '1') throw new Error('dev only');
    const token: string | null = await ctx.runAction(internal.github.userToken, { userId });
    if (!token) return { ok: false, login: null };
    const me = await gh('GET', '/user', token);
    return { ok: me.status === 200, login: me.json?.login ?? null };
  },
});

/** Dev: mints a one-repo token for a thread and says only what it may touch (never the token). */
export const devCheckRepoToken = internalAction({
  args: { threadId: v.id('threads') },
  handler: async (ctx, { threadId }): Promise<unknown> => {
    if (process.env.KIWI_ALLOW_WIPE !== '1') throw new Error('dev only');
    const t = await ctx.runAction(internal.github.repoToken, { threadId });
    if ('error' in t) return t;
    const repos = await gh('GET', '/installation/repositories', t.token);
    return { repo: t.repo, expiresAt: t.expiresAt, reaches: (repos.json?.repositories ?? []).map((r: { full_name: string }) => r.full_name) };
  },
});

/** Dev: the app repo's newest commit on main, read with the person's user token. */
export const devRepoHead = internalAction({
  args: { appId: v.id('apps') },
  handler: async (ctx, { appId }): Promise<unknown> => {
    if (process.env.KIWI_ALLOW_WIPE !== '1') throw new Error('dev only');
    const app = await ctx.runQuery(internal.github.appRow, { appId });
    if (!app?.repo) return { error: 'no repo' };
    const token: string | null = await ctx.runAction(internal.github.userToken, { userId: app.userId });
    if (!token) return { error: 'no token' };
    const repo = await gh('GET', `/repos/${app.repo}`, token);
    const head = await gh('GET', `/repos/${app.repo}/commits/main`, token);
    return { repo: app.repo, private: repo.json?.private ?? null, head: head.json?.sha ?? null, message: head.json?.commit?.message ?? null };
  },
});
