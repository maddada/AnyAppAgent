// The Expo Exact preset (alpha): createApp makes an `exact new` app with AnyAppAgent's files from the
// pinned, patched Exact checkout; buildApk builds it with the shared key and versionCode.
//   node --test builder/test/          (needs Bun 1.4.2 and the Exact checkout beside the apps;
//                                       skipped without them)
//   ANYAPP_EXACT_BUILD_TEST=1 also runs a real build (minutes the first time: Rust).
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { after, test } from 'node:test';

import { buildApk, createApp, getIconPath, presetOf } from '../index.mjs';
import { EXACT_PIN, exactDirFor, extractExactError, findBun } from '../lib/exact.mjs';
import { run } from '../lib/exec.mjs';

const ROOT = process.env.ANYAPP_TEST_DIR ?? 'C:\\aa\\t';
const dir = path.join(ROOT, `ex-${crypto.randomBytes(3).toString('hex')}`);

let missing = null;
try {
  findBun();
  if (!fs.existsSync(path.join(exactDirFor(dir), '.git'))) missing = `no Exact checkout at ${exactDirFor(dir)} (node builder/cli.mjs warm --preset expo-exact)`;
} catch (e) {
  missing = e.message;
}

after(async () => {
  await fsp.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
});

test('extractExactError keeps Rust, Contract and Gradle errors', () => {
  const lines = ['   Compiling foo v0.1.0', 'error[E0425]: cannot find value `x` in this scope', '  --> src/lib.rs:3:5', '   |', 'warning: unused', '* What went wrong:', "Execution failed for task ':app:x'."];
  const out = extractExactError(lines);
  assert.match(out, /error\[E0425\]/);
  assert.match(out, /What went wrong/);
  assert.doesNotMatch(out, /Compiling foo/);
  assert.equal(extractExactError(['all good']), null);
});

test('the pin and the Windows patch are in the builder', () => {
  assert.match(EXACT_PIN.commit, /^[0-9a-f]{40}$/);
  const patch = fs.readFileSync(path.join(import.meta.dirname, '..', 'exact', EXACT_PIN.patch), 'utf8');
  assert.match(patch, /windows-x86_64/);
  assert.match(patch, /EXACT_GRADLE_ARGS/);
  assert.match(patch, /gradle-wrapper\.jar/);
  assert.match(patch, /plainDrivePath/);
  assert.doesNotMatch(patch, /\u2014/);
});

test('createApp makes an Expo Exact app with AnyAppAgent files', { skip: missing ?? false, timeout: 5 * 60_000 }, async () => {
  await createApp({ dir, name: 'Exact Check', slug: 'exact-check', packageName: 'com.anyapp.exactcheck', preset: 'expo-exact' });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'anyapp.json'), 'utf8')), { preset: 'expo-exact', slug: 'exact-check', package: 'com.anyapp.exactcheck' });
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'app.json'), 'utf8'));
  assert.equal(manifest.app.id, 'com.anyapp.exactcheck');
  assert.equal(manifest.app.name, 'Exact Check');
  assert.ok(manifest.host?.android, 'Android is not named in app.json');
  const agents = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');
  assert.match(agents, /^# Working on this app \(AnyAppAgent, Expo Exact alpha\)/);
  assert.match(agents, /exact:begin/, "Exact's own block is kept below ours");
  assert.equal(fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8'), '@AGENTS.md\n');
  assert.match(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8'), /^\/build\/$/m);
  assert.equal(presetOf(dir), 'expo-exact');
  assert.equal(getIconPath({ dir }), null);
  // The checkout is at the pin with the patch applied.
  const exactDir = exactDirFor(dir);
  const head = (await run('git', ['rev-parse', 'HEAD'], { cwd: exactDir })).lines.join('').trim();
  assert.equal(head, EXACT_PIN.commit);
  await run('git', ['apply', '--check', '--reverse', path.join(import.meta.dirname, '..', 'exact', EXACT_PIN.patch)], { cwd: exactDir });
});

test('buildApk builds a signed APK with versionCode = build number', { skip: missing ?? (process.env.ANYAPP_EXACT_BUILD_TEST === '1' ? false : 'set ANYAPP_EXACT_BUILD_TEST=1'), timeout: 40 * 60_000 }, async () => {
  const r = await buildApk({ dir, buildNumber: 3 });
  assert.equal(r.versionCode, 3);
  assert.equal(r.packageName, 'com.anyapp.exactcheck');
  assert.equal(r.preset, 'expo-exact');
  assert.ok(fs.existsSync(r.apkPath));
});
