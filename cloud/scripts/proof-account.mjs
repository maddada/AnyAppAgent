// A proof account on the dev deployment (anonymous sign-in, SPIKE_ANONYMOUS=1) with GitHub
// connected through the spike's stored user token for `login` (github:adoptSpikeToken).
//   node scripts/proof-account.mjs <session file> [login]
// Writes the session token to the file (mode 600); prints the account's id and GitHub state.
import fs from 'node:fs';
import { env, run } from './dev.mjs';

const [file, login = 'maddada'] = process.argv.slice(2);
async function call(kind, fn, args, token) {
  const res = await fetch(`${env.CONVEX_URL}/api/${kind}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ path: fn, args, format: 'json' }),
  });
  const j = await res.json();
  if (j.status !== 'success') throw new Error(`${fn}: ${j.errorMessage ?? JSON.stringify(j)}`);
  return j.value;
}
const token = (await call('action', 'auth:signIn', { provider: 'anonymous' })).tokens.token;
fs.writeFileSync(file, token, { mode: 0o600 });
const me = await call('query', 'accounts:me', {}, token);
console.log('account', me.id);
console.log(JSON.stringify(run('github:adoptSpikeToken', { userId: me.id, login })));
console.log(JSON.stringify(run('github:statusOf', { userId: me.id })));
