// Milestone 2 proof on a real box: the real runner (server/'s AppManager) makes an app from a
// prompt through Convex, the orchestrator plans, a helper at its own level builds it as the
// `agent` Unix user, the runner signs the build with a one-time ticket and uploads it; then a small
// change goes to a `simple` helper. Prints the chat as it comes and saves everything under
// C:\aa\e2e\cloud-build\m2\. The box is left running for inspection unless --retire is given.
//   node scripts/m2-proof.mjs [--retire] [--app <id> --resume]
import fs from 'node:fs';
import path from 'node:path';
import { env, run } from './dev.mjs';

const OUT = 'C:\\aa\\e2e\\cloud-build\\m2';
fs.mkdirSync(OUT, { recursive: true });
const URL = env.CONVEX_URL;
const t0 = Date.now();
const secs = (from = t0) => ((Date.now() - from) / 1000).toFixed(0);
const lines = [];
const log = (...m) => {
  const line = `[${secs()}s] ${m.join(' ')}`;
  console.log(line);
  lines.push(line);
  fs.writeFileSync(path.join(OUT, 'm2-proof.log'), lines.join('\n') + '\n');
};

async function call(kind, fn, args, token) {
  const res = await fetch(`${URL}/api/${kind}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ path: fn, args, format: 'json' }),
  });
  const j = await res.json();
  if (j.status !== 'success') throw new Error(`${fn}: ${j.errorMessage ?? JSON.stringify(j)}`);
  return j.value;
}

const tokenFile = path.join(OUT, '.session');
let token;
if (process.argv.includes('--resume') && fs.existsSync(tokenFile)) token = fs.readFileSync(tokenFile, 'utf8').trim();
else {
  token = (await call('action', 'auth:signIn', { provider: 'anonymous' })).tokens.token;
  fs.writeFileSync(tokenFile, token, { mode: 0o600 });
}

const shown = new Map();
async function showChat(appId, workerId) {
  const items = await call('query', 'chat:messages', { appId, ...(workerId ? { workerId } : {}) }, token);
  for (const it of items) {
    const key = `${workerId ?? ''}:${it.id}`;
    const text = (it.text ?? it.tool?.title ?? it.page?.title ?? it.worker?.title ?? '').replace(/\s+/g, ' ').slice(0, 160);
    const sig = `${it.kind}|${text}|${it.build?.status ?? ''}|${it.worker?.state ?? ''}|${it.streaming ? 's' : ''}`;
    if (shown.get(key) === sig || it.streaming) continue;
    shown.set(key, sig);
    const extra = it.build ? ` build ${it.build.number} ${it.build.status}${it.build.delivery ? ` (${it.build.delivery})` : ''}` : it.worker ? ` helper ${it.worker.state}${it.worker.level ? ` [${it.worker.level}]` : ''}` : '';
    log(`${workerId ? `  {${workerId}}` : ''} ${it.kind}${extra}: ${text}`);
  }
  return items;
}

async function until(what, appId, fn, timeoutMs) {
  const start = Date.now();
  for (;;) {
    await showChat(appId);
    const app = await call('query', 'apps:get', { appId }, token);
    const v = await fn(app);
    if (v) return v;
    if (Date.now() - start > timeoutMs) throw new Error(`timed out: ${what}`);
    await new Promise((r) => setTimeout(r, 5000));
  }
}

const appIdx = process.argv.indexOf('--app');
let appId = appIdx > 0 ? process.argv[appIdx + 1] : null;
if (!appId) {
  appId = await call(
    'mutation',
    'apps:create',
    { name: 'Tip Split', prompt: 'A tip calculator: I type the bill and how many people, pick 10, 15 or 20 percent, and see what each person pays. Keep it to one screen.' },
    token,
  );
  log('app', appId);
  // The orchestrator plans first (the person's rule) and waits for a yes.
  await until('the plan', appId, (a) => a.waitingForAnswer || (a.status === 'idle' && a.replying === false && shown.size > 2), 15 * 60_000);
  log('plan shown; answering yes');
  await call('mutation', 'chat:send', { appId, text: 'Yes, build it.' }, token);
}
if (process.argv.includes('--rebuild')) {
  await call('mutation', 'chat:rebuild', { appId }, token);
  log('asked for Try again');
}
const first = await until('the first build', appId, (a) => (a.latestApk?.status === 'succeeded' ? a : a.status === 'error' && !process.argv.includes('--rebuild') ? a : null), 40 * 60_000);
log('first version:', JSON.stringify({ build: first.latestApk?.number, delivery: first.latestApk?.delivery, error: first.error ?? null }));

if (!process.argv.includes('--no-change') && first.latestApk?.status === 'succeeded') {
  const before = first.latestApk.number;
  await call('mutation', 'chat:send', { appId, text: 'Make the title green.' }, token);
  const second = await until('the change', appId, (a) => (a.latestApk?.number > before ? a : a.status === 'error' ? a : null), 25 * 60_000);
  log('change:', JSON.stringify({ build: second.latestApk?.number, delivery: second.latestApk?.delivery }));
}

const helpers = await call('query', 'chat:helpers', { appId }, token);
for (const h of helpers) {
  log(`helper ${h.id} "${h.title}" level=${h.level ?? '-'} state=${h.state}`);
  await showChat(appId, h.id);
}
const view = run('admin:threadView', { appId });
fs.writeFileSync(path.join(OUT, 'thread.json'), JSON.stringify(view, null, 2));
const builds = run('admin:buildsOf', { appId });
fs.writeFileSync(path.join(OUT, 'builds.json'), JSON.stringify(builds, null, 2));
log('builds', JSON.stringify(builds.map((b) => ({ n: b.number, delivery: b.delivery, files: b.files.map((f) => f.abi), ota: Boolean(b.otaUrl), signings: b.signings.length }))));
// The emulator's APK, for the signature check and the install.
const last = builds.at(-1);
const x86 = last?.files.find((f) => f.abi === 'x86_64');
if (x86?.url) {
  const res = await fetch(x86.url);
  fs.writeFileSync(path.join(OUT, `tipsplit-${last.number}-x86_64.apk`), Buffer.from(await res.arrayBuffer()));
  log('downloaded', `tipsplit-${last.number}-x86_64.apk`, 'cert', last.certSha256);
}
console.log(JSON.stringify({ appId, threadId: view.thread._id, box: view.box?.providerId }, null, 2));
if (process.argv.includes('--retire')) {
  run('boxes:retire', { threadId: view.thread._id });
  log('retired');
}
