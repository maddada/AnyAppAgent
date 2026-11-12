// A command-line stand-in for the phone (dev deployment only): signs in without an account
// (SPIKE_ANONYMOUS=1), sends one message and prints the chat until a build row (or a failure)
// arrives. Proves Convex -> box -> Convex before the phone is in the loop.
//   node cloud/spike/send.mjs "Change the subtitle to ..." [--wait-secs 600]
import { readEnvFile } from './github-app.mjs';

const env = readEnvFile();
const URL = env.CONVEX_URL;
const text = process.argv[2];
const waitSecs = Number(process.argv[process.argv.indexOf('--wait-secs') + 1]) || 600;

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

const signed = await call('action', 'auth:signIn', { provider: 'anonymous' });
const token = signed.tokens.token;
const t0 = Date.now();
await call('mutation', 'chat:send', { text }, token);
console.log(`sent at ${new Date(t0).toISOString()}`);
const seen = new Set();
for (;;) {
  const rows = await call('query', 'chat:messages', {}, token);
  for (const r of rows) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    console.log(`+${((r.at - t0) / 1000).toFixed(1)}s [${r.role}] ${r.text.slice(0, 300)}${r.apkUrl ? ' (APK link)' : ''}${r.usage ? ` usage=${JSON.stringify(r.usage)}` : ''}`);
  }
  const last = rows[rows.length - 1];
  if (last && (last.role === 'build' || /failed|stopped/i.test(last.text))) break;
  if (Date.now() - t0 > waitSecs * 1000) {
    console.log('timed out waiting');
    break;
  }
  await new Promise((r) => setTimeout(r, 2000));
}
