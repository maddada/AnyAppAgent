// Deploys cloud/convex to the DEV deployment and sets its env vars, reading every secret from the
// secrets folder and passing values only on stdin (never on a command line, never printed).
//   node spike/convex.mjs env      (sets the auth and runner env vars; JWT keys made once)
//   node spike/convex.mjs deploy   (npx convex dev --once: push functions to the dev deployment)
//   node spike/convex.mjs names    (lists the env var names, no values)
// Never touches production: the deploy key in cloud-dev.env is a dev key ("dev:..."), checked here.
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readEnvFile } from './github-app.mjs';

const CLOUD = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRETS = process.env.ANYAPP_CLOUD_SECRETS ?? path.join(os.homedir(), '.appwin-secrets');
const env = readEnvFile();
if (!env.CONVEX_DEPLOY_KEY?.startsWith('dev:')) throw new Error('CONVEX_DEPLOY_KEY must be a dev deploy key');

function convex(args, input) {
  const r = spawnSync('npx', ['convex', ...args], {
    cwd: CLOUD,
    env: { ...process.env, CONVEX_DEPLOY_KEY: env.CONVEX_DEPLOY_KEY },
    input,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  if (r.status !== 0) throw new Error(`convex ${args[0]} ${args[1] ?? ''} failed: ${(r.stderr || r.stdout).slice(-800)}`);
  return r.stdout;
}

const setVar = (name, value) => {
  if (!value) throw new Error(`no value for ${name}`);
  convex(['env', 'set', name, '--force'], value);
  console.log(`set ${name}`);
};

/** The runner token (spike: one box). Kept in the secrets folder; Convex gets only its SHA-256. */
export function runnerToken() {
  const file = path.join(SECRETS, 'cloud-spike-runner.token');
  if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(32).toString('base64url'), { mode: 0o600 });
  return fs.readFileSync(file, 'utf8').trim();
}

function jwtKeys() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const jwk = publicKey.export({ format: 'jwk' });
  return { JWT_PRIVATE_KEY: pem.trimEnd().replace(/\n/g, ' '), JWKS: JSON.stringify({ keys: [{ use: 'sig', ...jwk }] }) };
}

// Run as a command only (run-runner.mjs imports runnerToken from here).
const cmd = process.argv[1]?.endsWith('convex.mjs') ? process.argv[2] : null;
if (cmd === null) {
  // imported
} else if (cmd === 'env') {
  const names = convex(['env', 'list', '--names-only']);
  if (!/^JWT_PRIVATE_KEY$/m.test(names)) {
    const k = jwtKeys();
    setVar('JWT_PRIVATE_KEY', k.JWT_PRIVATE_KEY);
    setVar('JWKS', k.JWKS);
  }
  setVar('SITE_URL', env.CONVEX_SITE_URL);
  setVar('AUTH_GOOGLE_ID', env.GOOGLE_CLIENT_ID);
  setVar('AUTH_GOOGLE_SECRET', env.GOOGLE_CLIENT_SECRET);
  setVar('AUTH_RESEND_KEY', env.RESEND_API_KEY);
  setVar('SPIKE_ANONYMOUS', '1');
  setVar('GITHUB_APP_CLIENT_ID', env.GITHUB_APP_CLIENT_ID);
  setVar('GITHUB_APP_CLIENT_SECRET', env.GITHUB_APP_CLIENT_SECRET);
  // The key that seals stored tokens (spike: an env var made once; launch: a key service).
  if (!/^KEYS_KEK$/m.test(names)) setVar('KEYS_KEK', crypto.randomBytes(32).toString('base64'));
  setVar('RUNNER_TOKEN_SHA256', crypto.createHash('sha256').update(runnerToken()).digest('hex'));
} else if (cmd === 'deploy') {
  const t = Date.now();
  const out = convex(['dev', '--once', '--typecheck', 'enable']);
  console.log(out.split('\n').filter((l) => !/key|secret|token/i.test(l)).slice(-6).join('\n'));
  console.log(`deployed in ${((Date.now() - t) / 1000).toFixed(1)} s`);
} else if (cmd === 'rotate-runner-token') {
  // A new runner token (the old file is replaced), and Convex gets its hash.
  fs.rmSync(path.join(SECRETS, 'cloud-spike-runner.token'), { force: true });
  setVar('RUNNER_TOKEN_SHA256', crypto.createHash('sha256').update(runnerToken()).digest('hex'));
} else if (cmd === 'names') {
  console.log(convex(['env', 'list', '--names-only']));
} else {
  console.error('usage: node spike/convex.mjs env | deploy | names');
  process.exit(2);
}
