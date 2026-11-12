// Kiwimake Cloud's dev deployment, from this PC. Every secret is read from the secrets file and
// passed to Convex's CLI on stdin only (never a command line, never printed). Dev only: the
// deploy key must be a dev key.
//   node scripts/dev.mjs env        env vars on the dev deployment (Instabox key, ...)
//   node scripts/dev.mjs deploy     push convex/ (functions, schema, crons)
//   node scripts/dev.mjs bundle     upload the runner bundle that boxes download
//   node scripts/dev.mjs run <fn> '<json>'
//   node scripts/dev.mjs codegen
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readEnvFile } from '../spike/github-app.mjs';

export const CLOUD = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const REPO = path.resolve(CLOUD, '..');
export const env = readEnvFile();
if (!env.CONVEX_DEPLOY_KEY?.startsWith('dev:')) throw new Error('CONVEX_DEPLOY_KEY must be a dev deploy key');

export function convex(args, input) {
  const r = spawnSync(process.execPath, [path.join(CLOUD, 'node_modules', 'convex', 'bin', 'main.js'), ...args], {
    cwd: CLOUD,
    env: { ...process.env, CONVEX_DEPLOY_KEY: env.CONVEX_DEPLOY_KEY },
    input,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.status !== 0) throw new Error(`convex ${args[0]} ${args[1] ?? ''} failed: ${(r.stderr || r.stdout).slice(-1500)}`);
  return r.stdout;
}

export function setVar(name, value) {
  if (value === undefined || value === '') throw new Error(`no value for ${name}`);
  convex(['env', 'set', name, '--force'], value);
  console.log(`set ${name}`);
}

export function run(fn, args = {}) {
  const out = convex(['run', fn, JSON.stringify(args)]).trim();
  try {
    return JSON.parse(out);
  } catch {
    return out;
  }
}

/** Packs what a box runs (the runner, and from milestone 2 the companion's code it reuses). */
export function packRunner() {
  const out = path.join(os.tmpdir(), `kiwi-runner-${process.pid}.tgz`);
  const parts = ['cloud/runner', 'server/src', 'server/package.json', 'server/package-lock.json', 'cloud/box/agent.sh', 'shared', 'builder', 'template', 'template-kotlin'].filter((p) => fs.existsSync(path.join(REPO, p)));
  const tarBin = process.platform === 'win32' ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
  const r = spawnSync(tarBin, ['-czf', out, '--exclude=node_modules', '--exclude=.gradle', '--exclude=build', '--exclude=android/app/build', '--exclude=*.test.ts', '-C', REPO, ...parts], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`tar failed: ${r.stderr}`);
  return out;
}

async function bundle() {
  const file = packRunner();
  const bytes = fs.readFileSync(file);
  fs.rmSync(file, { force: true });
  const version = crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 12);
  const url = run('admin:bundleUploadUrl');
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/gzip' }, body: bytes });
  if (!res.ok) throw new Error(`bundle upload: ${res.status}`);
  const { storageId } = await res.json();
  run('admin:setRunnerBundle', { fileId: storageId, version });
  console.log(`runner bundle ${version} (${(bytes.length / 1e6).toFixed(1)} MB)`);
}

const cmd = process.argv[1]?.endsWith('dev.mjs') ? process.argv[2] : null;
if (cmd === 'env') {
  setVar('INSTABOX_API_KEY', env.INSTABOX_API_KEY);
  setVar('KIWI_ALLOW_WIPE', '1');
} else if (cmd === 'deploy') {
  const t = Date.now();
  convex(['dev', '--once', '--typecheck', 'enable']);
  console.log(`deployed in ${((Date.now() - t) / 1000).toFixed(1)} s`);
} else if (cmd === 'bundle') {
  await bundle();
} else if (cmd === 'run') {
  console.log(JSON.stringify(run(process.argv[3], JSON.parse(process.argv[4] ?? '{}')), null, 2));
} else if (cmd === 'codegen') {
  convex(['codegen', '--typecheck', 'disable']);
  console.log('codegen done');
} else if (cmd) {
  console.error('usage: node scripts/dev.mjs env | deploy | bundle | run <fn> <json> | codegen');
  process.exit(2);
}
