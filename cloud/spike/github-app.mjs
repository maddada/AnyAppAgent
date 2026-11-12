// GitHub App helpers for the cloud spike (milestone 0 of docs/CLOUD.md). Reads the App's id and
// private key from the secrets folder; never prints a token or the key.
//   node cloud/spike/github-app.mjs installations
//   node cloud/spike/github-app.mjs create-repo <name>          (private repo on the installation's account)
//   node cloud/spike/github-app.mjs token <owner/repo> > file   (a one-repo, Contents write, 1 hour token, to stdout)
//   node cloud/spike/github-app.mjs delete-repo <owner/repo>   (only names starting anyapp-cloud-spike-)
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SECRETS = process.env.ANYAPP_CLOUD_SECRETS ?? path.join(os.homedir(), '.appwin-secrets');

export function readEnvFile(file = path.join(SECRETS, 'cloud-dev.env')) {
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const b64url = (b) => Buffer.from(b).toString('base64url');

/** The App's own JWT (10 minutes), RS256 with its private key. */
export function appJwt() {
  const env = readEnvFile();
  const key = fs.readFileSync(path.join(SECRETS, 'github-app.pem'), 'utf8');
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: env.GITHUB_APP_CLIENT_ID || env.GITHUB_APP_ID }));
  const sig = crypto.sign('RSA-SHA256', Buffer.from(`${head}.${body}`), key).toString('base64url');
  return `${head}.${body}.${sig}`;
}

export async function gh(method, url, token, body) {
  const res = await fetch(`https://api.github.com${url}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'anyapp-cloud-spike',
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {}
  return { status: res.status, json, text };
}

export async function installation() {
  const r = await gh('GET', '/app/installations', appJwt());
  if (r.status !== 200) throw new Error(`GET /app/installations: ${r.status} ${r.text.slice(0, 200)}`);
  if (!r.json.length) throw new Error('The App is not installed on any account yet.');
  return r.json[0];
}

/** An installation token, optionally narrowed to repos and permissions. */
export async function installationToken(inst, { repositories, permissions } = {}) {
  const r = await gh('POST', `/app/installations/${inst.id}/access_tokens`, appJwt(), {
    ...(repositories ? { repositories } : {}),
    ...(permissions ? { permissions } : {}),
  });
  if (r.status !== 201) throw new Error(`access_tokens: ${r.status} ${r.text.slice(0, 300)}`);
  return r.json;
}

async function main() {
  const [cmd, arg] = process.argv.slice(2);
  const inst = await installation();
  if (cmd === 'installations') {
    console.log(JSON.stringify({ id: inst.id, account: inst.account?.login, type: inst.account?.type, selection: inst.repository_selection, permissions: inst.permissions }, null, 2));
  } else if (cmd === 'create-repo') {
    if (!/^anyapp-cloud-spike-\d+$/.test(arg ?? '')) throw new Error('name must be anyapp-cloud-spike-<n>');
    const t = await installationToken(inst);
    const r = await gh('POST', '/user/repos', t.token, { name: arg, private: true, auto_init: false, description: 'AnyAppAgent Cloud spike (test repo, safe to delete)' });
    console.log(JSON.stringify({ via: 'installation token', status: r.status, full_name: r.json?.full_name, private: r.json?.private, message: r.json?.message }));
    if (r.status === 201) {
      const t2 = await installationToken(inst);
      const list = await gh('GET', '/installation/repositories?per_page=100', t2.token);
      console.log(JSON.stringify({ inInstallation: (list.json?.repositories ?? []).some((x) => x.name === arg) }));
    }
  } else if (cmd === 'token') {
    const [owner, repo] = (arg ?? '').split('/');
    const t = await installationToken(inst, { repositories: [repo], permissions: { contents: 'write', metadata: 'read' } });
    process.stdout.write(t.token);
    console.error(JSON.stringify({ expires_at: t.expires_at, permissions: t.permissions, repos: (t.repositories ?? []).map((r) => r.full_name), owner }));
  } else if (cmd === 'delete-repo') {
    const [owner, repo] = (arg ?? '').split('/');
    if (!/^anyapp-cloud-spike-\d+$/.test(repo ?? '')) throw new Error('only anyapp-cloud-spike-<n> repos');
    const t = await installationToken(inst, { repositories: [repo], permissions: { administration: 'write' } });
    const r = await gh('DELETE', `/repos/${owner}/${repo}`, t.token);
    console.log(JSON.stringify({ status: r.status, message: r.json?.message }));
  } else {
    throw new Error('usage: installations | create-repo <name> | token <owner/repo> | delete-repo <owner/repo>');
  }
}

if (process.argv[1]?.endsWith('github-app.mjs')) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
