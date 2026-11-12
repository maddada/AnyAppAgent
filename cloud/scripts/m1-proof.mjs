// Milestone 1 proof on real boxes: a signed-in phone stand-in makes a cloud app; Convex makes its
// box on Instabox from the image, starts the runner with a fresh token, and the reply comes back
// through the runner routes. Then pause and wake, snapshot-and-delete and restore from the
// snapshot, and finally removing the app deletes the box and the snapshot. Prints the times.
//   node scripts/m1-proof.mjs
import { env, run } from './dev.mjs';

const URL = env.CONVEX_URL;
const t0 = Date.now();
const secs = (from = t0) => ((Date.now() - from) / 1000).toFixed(1);
const log = (...m) => console.log(`[${secs()}s]`, ...m);

async function call(kind, path, args, token) {
  const res = await fetch(`${URL}/api/${kind}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ path, args, format: 'json' }),
  });
  const j = await res.json();
  if (j.status !== 'success') throw new Error(`${path}: ${j.errorMessage ?? JSON.stringify(j)}`);
  return j.value;
}

async function ib(path) {
  const res = await fetch(`https://api.instabox.sh${path}`, { headers: { Authorization: `Bearer ${env.INSTABOX_API_KEY}` } });
  return res.json();
}

async function waitFor(what, fn, timeoutMs = 6 * 60_000) {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - start > timeoutMs) throw new Error(`timed out: ${what}`);
    await new Promise((r) => setTimeout(r, 2000));
  }
}

const results = {};
const { tokens } = await call('action', 'auth:signIn', { provider: 'anonymous' });
const token = tokens.token;
const view = () => run('admin:threadView', { appId });
const replies = async () => (await call('query', 'chat:messages', { appId }, token)).filter((m) => m.kind === 'assistant');

let start = Date.now();
const appId = await call('mutation', 'apps:create', { name: 'M1 Proof', prompt: 'Hello from the milestone 1 proof' }, token);
log('app', appId);
await waitFor('first reply', async () => (await replies()).length >= 1);
results.firstReplyFromImage = secs(start);
let v = view();
log('box', v.box?.providerId, 'state', v.thread.boxState, 'first reply after', results.firstReplyFromImage, 's');

start = Date.now();
await call('mutation', 'chat:send', { appId, text: 'second message, box running' }, token);
await waitFor('second reply', async () => (await replies()).length >= 2);
results.replyOnRunningBox = secs(start);
log('reply on a running box', results.replyOnRunningBox, 's');

await waitFor('box running', async () => view().thread.boxState === 'running');
start = Date.now();
run('boxes:pause', { threadId: v.thread._id });
v = view();
const ibState = (await ib(`/v1/machines/${v.box.providerId}`)).state;
results.pause = secs(start);
log('paused: convex', v.thread.boxState, 'instabox', ibState, results.pause, 's');
if (v.thread.boxState !== 'paused') throw new Error('not paused');

start = Date.now();
await call('mutation', 'chat:send', { appId, text: 'third message, box paused' }, token);
await waitFor('reply after wake', async () => (await replies()).length >= 3);
results.replyAfterResume = secs(start);
log('reply after resume', results.replyAfterResume, 's');

await waitFor('box running', async () => view().thread.boxState === 'running');
run('boxes:pause', { threadId: v.thread._id });
start = Date.now();
run('boxes:snapshotAndDelete', { threadId: v.thread._id });
v = view();
results.snapshotAndDelete = secs(start);
const oldBox = (await ib(`/v1/machines/${v.box?.providerId ?? 'none'}`)).state ?? 'gone';
log('snapshotted:', v.thread.boxState, v.thread.snapshotId, 'old box', oldBox, results.snapshotAndDelete, 's');
if (v.thread.boxState !== 'snapshotted') throw new Error('not snapshotted');

start = Date.now();
await call('mutation', 'chat:send', { appId, text: 'fourth message, box snapshotted' }, token);
await waitFor('reply after restore', async () => (await replies()).length >= 4, 8 * 60_000);
results.replyAfterSnapshotRestore = secs(start);
v = view();
log('reply after restore from snapshot', results.replyAfterSnapshotRestore, 's; new box', v.box?.providerId);

start = Date.now();
await call('mutation', 'apps:remove', { appId }, token);
await waitFor('retired', async () => view().thread.boxState === 'deleted');
const machines = await ib('/v1/machines');
const snaps = (await ib('/v1/snapshots')).snapshots.map((s) => s.name);
results.retire = secs(start);
log('removed: machines left', machines.machines.length, 'snapshots', snaps.join(','));
console.log(JSON.stringify({ results, machinesLeft: machines.machines.length, snapshots: snaps }, null, 2));
