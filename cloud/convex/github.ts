// The GitHub App's user side (docs/CLOUD.md section 3, "The code lives on the person's GitHub"):
// the OAuth callback that turns GitHub's code into the person's user token (kept encrypted), and
// creating an app's repo with that token. Spike version: one token, no Convex user link yet
// (milestone 3 ties it to the signed-in person and refreshes it).
import { v } from 'convex/values';
import { internal } from './_generated/api';
import { httpAction, internalAction, internalMutation, internalQuery } from './_generated/server';

const enc = new TextEncoder();
const dec = new TextDecoder();
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** AES-256-GCM with KEYS_KEK (32 bytes, base64; spike: an env var, launch: a key service). */
async function kek() {
  const raw = process.env.KEYS_KEK;
  if (!raw) throw new Error('KEYS_KEK is not set');
  return crypto.subtle.importKey('raw', unb64(raw), 'AES-GCM', false, ['encrypt', 'decrypt']);
}
async function seal(text: string, aad: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(aad) }, await kek(), enc.encode(text)));
  return { iv: b64(iv), ciphertext: b64(ct) };
}
async function open(box: { iv: string; ciphertext: string }, aad: string) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.iv), additionalData: enc.encode(aad) }, await kek(), unb64(box.ciphertext));
  return dec.decode(pt);
}

async function gh(method: string, path: string, token: string, body?: unknown) {
  const res = await fetch(`https://api.github.com${path}`, {
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

const page = (title: string, line: string) =>
  new Response(
    `<!doctype html><meta name="viewport" content="width=device-width"><title>${title}</title><body style="font-family:system-ui;background:#F3EEE6;color:#22201C;padding:32px"><h1 style="font-size:24px">${title}</h1><p>${line}</p></body>`,
    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );

// GitHub sends the person here after "Authorize" (and after installing, with "Request user
// authorization during installation" on). The code becomes a user token, stored encrypted.
export const callback = httpAction(async (ctx, req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  if (!code) return page('Nothing to connect', 'GitHub did not send a code. Try connecting again.');
  const res = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: process.env.GITHUB_APP_CLIENT_ID, client_secret: process.env.GITHUB_APP_CLIENT_SECRET, code }),
  });
  const t = await res.json();
  if (!t.access_token) return page('GitHub did not connect', `GitHub said: ${String(t.error_description ?? t.error ?? res.status).slice(0, 200)}`);
  const me = await gh('GET', '/user', t.access_token);
  const login = String(me.json?.login ?? '');
  if (!login) return page('GitHub did not connect', 'Could not read your GitHub account.');
  await ctx.runMutation(internal.github.saveToken, {
    login,
    access: await seal(t.access_token, `github:access:${login}`),
    refresh: t.refresh_token ? await seal(t.refresh_token, `github:refresh:${login}`) : undefined,
    expiresAt: t.expires_in ? Date.now() + Number(t.expires_in) * 1000 : undefined,
    installationId: url.searchParams.get('installation_id') ?? undefined,
  });
  return page('GitHub is connected', `Signed in as ${login}. You can close this page.`);
});

const sealed = v.object({ iv: v.string(), ciphertext: v.string() });

export const saveToken = internalMutation({
  args: { login: v.string(), access: sealed, refresh: v.optional(sealed), expiresAt: v.optional(v.number()), installationId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const old = await ctx.db.query('githubTokens').withIndex('by_login', (q) => q.eq('login', args.login)).first();
    if (old) await ctx.db.replace(old._id, args);
    else await ctx.db.insert('githubTokens', args);
  },
});

export const tokenFor = internalQuery({
  args: { login: v.string() },
  handler: async (ctx, { login }) => ctx.db.query('githubTokens').withIndex('by_login', (q) => q.eq('login', login)).first(),
});

/**
 * Creates a private repo on the person's account with their user token, then checks whether it
 * is in the App's installation (an install on "Only select repositories" may leave it out).
 *   npx convex run github:createRepo '{"login":"maddada","name":"anyapp-cloud-spike-1"}'
 */
export const createRepo = internalAction({
  args: { login: v.string(), name: v.string() },
  handler: async (ctx, { login, name }) => {
    if (!/^anyapp-cloud-[a-z0-9-]+$/.test(name)) throw new Error('repo names start with anyapp-cloud-');
    const row = await ctx.runQuery(internal.github.tokenFor, { login });
    if (!row) throw new Error(`no GitHub token for ${login}: connect GitHub first`);
    const token = await open(row.access, `github:access:${login}`);
    const made = await gh('POST', '/user/repos', token, { name, private: true, description: 'A Kiwimake cloud app (spike test repo, safe to delete)' });
    const installs = await gh('GET', '/user/installations', token);
    const inst = (installs.json?.installations ?? [])[0];
    let inInstallation: boolean | null = null;
    if (inst) {
      const repos = await gh('GET', `/user/installations/${inst.id}/repositories?per_page=100`, token);
      inInstallation = (repos.json?.repositories ?? []).some((r: { name: string }) => r.name === name);
    }
    return {
      status: made.status,
      fullName: made.json?.full_name ?? null,
      private: made.json?.private ?? null,
      message: made.json?.message ?? null,
      installationId: inst?.id ?? null,
      selection: inst?.repository_selection ?? null,
      inInstallation,
    };
  },
});
