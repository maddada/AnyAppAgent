// Milestone 3 proof (GitHub) on real boxes, with an account connected to GitHub
// (scripts/proof-account.mjs): a new cloud app gets its private repo anyapp-cloud-<slug> on the
// person's GitHub; its first build is pushed with a one-repo token; then its box and snapshot are
// lost, the next message makes a fresh box that clones the repo, and the change after it is pushed
// too, numbered above the last build; disconnecting GitHub stops changes until a reconnect.
//   node scripts/m3-proof.mjs <session file> [--app <id>]
import fs from 'node:fs';
import path from 'node:path';
import { env, run } from './dev.mjs';

const OUT = 'C:/aa/e2e/cloud-build/m3';
fs.mkdirSync(OUT, { recursive: true });
const [sessionFile] = process.argv.slice(2);
const token = fs.readFileSync(sessionFile, 'utf8').trim();
const t0 = Date.now();
const lines = [];
const log = (...m) => {
  const line = `[${((Date.now() - t0) / 1000).toFixed(0)}s] ${m.join(' ')}`;
  console.log(line);
  lines.push(line);
  fs.writeFileSync(path.join(OUT, 'm3-proof.log'), `${lines.join('\n')}\n`);
};

async function call(kind, fn, args) {
  const res = await fetch(`${env.CONVEX_URL}/api/${kind}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ path: fn, args, format: 'json' }),
  });
  const j = await res.json();
  if (j.status !== 'success') throw Object.assign(new Error(j.errorMessage ?? JSON.stringify(j)), { convex: true });
  return j.value;
}

const shown = new Map();
async function showChat(appId) {
  for (const it of await call('query', 'chat:messages', { appId })) {
    if (it.streaming) continue;
    const text = (it.text ?? it.tool?.title ?? it.page?.title ?? it.worker?.title ?? '').replace(/\s+/g, ' ').slice(0, 150);
    const sig = `${it.kind}|${text}|${it.build?.status ?? ''}|${it.worker?.state ?? ''}`;
    if (shown.get(it.id) === sig) continue;
    shown.set(it.id, sig);
    log(` ${it.kind}${it.build ? ` build ${it.build.number} ${it.build.status}` : ''}${it.worker ? ` helper ${it.worker.state} [${it.worker.level ?? '-'}]` : ''}: ${text}`);
  }
}
async function until(what, appId, fn, ms) {
  const start = Date.now();
  for (;;) {
    await showChat(appId);
    const v = await fn(await call('query', 'apps:get', { appId }));
    if (v) return v;
    if (Date.now() - start > ms) throw new Error(`timed out: ${what}`);
    await new Promise((r) => setTimeout(r, 5000));
  }
}
const idx = process.argv.indexOf('--app');
let appId = idx > 0 ? process.argv[idx + 1] : null;

// 1. A new app and its repo.
if (!appId) {
  appId = await call('mutation', 'apps:create', {
    name: 'Shop List',
    prompt: 'A shopping list: add items, tick them off, and clear the ticked ones. One screen. No plan needed, build it straight away.',
  });
  log('app', appId);
}
const withRepo = await until('the repo', appId, (a) => (a.repoUrl ? a : null), 5 * 60_000);
log('repo', withRepo.repoUrl);
fs.appendFileSync('C:/aa/t/created-repos.txt', `${new Date().toISOString()} ${withRepo.repoUrl.replace('https://github.com/', '')} (private) created by the Kiwimake cloud build (milestone 3 proof) through the GitHub App with the user token\n`);

// 2. The first build, pushed.
let app = await until('the first build', appId, async (a) => {
  if (a.waitingForAnswer) {
    log('the agent asks first; answering yes');
    await call('mutation', 'chat:send', { appId, text: 'Yes, build it.' });
    await new Promise((r) => setTimeout(r, 15000));
  }
  return a.latestApk?.status === 'succeeded' ? a : null;
}, 40 * 60_000);
const view = run('admin:threadView', { appId });
const threadId = view.thread._id;
let builds = run('admin:buildsOf', { appId });
let head = run('github:devRepoHead', { appId });
log('first build', app.latestApk.number, 'commit', builds.at(-1)?.commit?.slice(0, 7), 'pushed', builds.at(-1)?.pushed, '| GitHub main', String(head.head).slice(0, 7), `"${String(head.message).split('\n')[0]}"`, 'private', head.private);
log('one-repo token', JSON.stringify(run('github:devCheckRepoToken', { threadId })));

// 3. The box and its snapshot are lost; the next message restores the app from GitHub.
const before = app.latestApk.number;
run('boxes:forget', { threadId });
log('box and snapshot gone; sending a change');
const tRestore = Date.now();
await call('mutation', 'chat:send', { appId, text: 'Show how many items are left at the top.' });
app = await until('the change on a fresh box', appId, (a) => (a.latestApk?.number > before ? a : null), 40 * 60_000);
// The app row moves a few seconds before the build row (its files are still uploading): wait for it.
for (let i = 0; i < 24; i++) {
  builds = run('admin:buildsOf', { appId });
  if (builds.some((b) => b.number === app.latestApk.number)) break;
  await new Promise((r) => setTimeout(r, 5000));
}
head = run('github:devRepoHead', { appId });
log('after restore: build', app.latestApk.number, `(${app.latestApk.delivery})`, 'in', ((Date.now() - tRestore) / 1000).toFixed(0), 's; commit', builds.at(-1)?.commit?.slice(0, 7), 'pushed', builds.at(-1)?.pushed, '| GitHub main', String(head.head).slice(0, 7), `"${String(head.message).split('\n')[0]}"`);
fs.writeFileSync(path.join(OUT, 'builds.json'), JSON.stringify(builds, null, 2));

// 4. Disconnect (it deletes the tokens: the account needs the person's browser to connect again).
await call('mutation', 'github:disconnect', {});
try {
  await call('mutation', 'chat:send', { appId, text: 'one more thing' });
  log('UNEXPECTED: a message was taken while GitHub was disconnected');
} catch (e) {
  log('disconnected, a message is refused:', e.message.replace(/^.*Uncaught Error: /s, '').split('\n')[0]);
}
const me = await call('query', 'accounts:me', {});
log('account after disconnect', JSON.stringify(me.cloud));
// A real reconnect is the person's browser (github:connectUrl, /github/callback).
log('done', JSON.stringify({ appId, threadId }));
