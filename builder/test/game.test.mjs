// The game preset: createApp lays template-game/ over template-kotlin/ (the Kotlin AGENTS.md as
// ANDROID.md, no starter HomeScreen), buildApk builds it like a Kotlin app (game/ is a Kotlin
// Multiplatform module, its sounds land in the APK), and rename and adopt keep it a game.
// The template's own game code stays platform-free, and its manifest differs from the Kotlin one
// only by the activity's configChanges.
//   node --test builder/test/game.test.mjs      (the build needs the Android toolchain; ~1.5 min cold)
//   ANYAPP_SKIP_BUILD_TESTS=1 skips the build.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

import { adoptApp, buildApk, createApp, getIconPath, presetOf, renameApp } from '../index.mjs';
import { GAME_TEMPLATE_DIR, KOTLIN_TEMPLATE_DIR, PRESETS, skipFor } from '../lib/presets.mjs';
import { templateHash } from '../lib/template.mjs';
import { readZip } from '../lib/zip.mjs';

process.env.ANYAPP_NO_SPARE = '1'; // no background spare refills from a test

const ROOT = process.env.ANYAPP_TEST_DIR ?? (process.platform === 'win32' ? 'C:\\aa\\t' : path.join(os.homedir(), 'aa', 't'));
const dir = path.join(ROOT, `gm-${crypto.randomBytes(3).toString('hex')}`);
const copy = `${dir}-copy`;

before(async () => {
  await createApp({ dir, name: 'Kiwi Catch', slug: 'kiwi-catch', packageName: 'com.anyapp.kiwicatchtest', preset: 'game' });
});

after(async () => {
  for (const d of [dir, copy]) await fsp.rm(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
});

const read = (...p) => fs.readFileSync(path.join(...p), 'utf8');

test('game is a preset', () => {
  assert.ok(PRESETS.includes('game'));
  assert.notEqual(templateHash('game'), templateHash('kotlin'));
});

test('createApp makes a game: the Kotlin app with the game on top', () => {
  assert.deepEqual(JSON.parse(read(dir, 'anyapp.json')), { preset: 'game', slug: 'kiwi-catch', package: 'com.anyapp.kiwicatchtest' });
  assert.equal(presetOf(dir), 'game');
  assert.match(read(dir, 'app', 'src', 'main', 'res', 'values', 'strings.xml'), /<string name="app_name">Kiwi Catch<\/string>/);
  // The game's guide, and the Kotlin one as ANDROID.md.
  assert.match(read(dir, 'AGENTS.md'), /meant to move to iPhone and the web later/);
  assert.equal(read(dir, 'ANDROID.md'), read(KOTLIN_TEMPLATE_DIR, 'AGENTS.md'));
  assert.equal(read(dir, 'README.md'), read(GAME_TEMPLATE_DIR, 'README.md'));
  assert.match(read(dir, 'settings.gradle.kts'), /include\(":game", ":app"\)/);
  assert.match(read(dir, 'app', 'src', 'main', 'java', 'com', 'anyapp', 'app', 'MainActivity.kt'), /AndroidGameHost/);
  for (const f of ['game/build.gradle.kts', 'game/src/commonMain/kotlin/com/anyapp/game/Game.kt', 'game/src/commonMain/composeResources/files/sounds/catch.wav',
    'app/src/main/java/com/anyapp/feedback/Feedback.kt', 'app/src/main/java/com/anyapp/updates/ReadyPopup.kt', 'app/src/main/java/com/anyapp/app/ai/Ai.kt',
    'CLAUDE.md', 'AI.md', 'gradlew', 'icon.png', '.gitignore', 'scripts/make-icon.mjs']) {
    assert.ok(fs.existsSync(path.join(dir, f)), `${f} is missing`);
  }
  for (const f of ['app/src/main/java/com/anyapp/app/ui/HomeScreen.kt', 'build', 'game/build', 'app.json']) {
    assert.ok(!fs.existsSync(path.join(dir, f)), `${f} should not be in a new game`);
  }
  assert.equal(getIconPath({ dir }), path.join(dir, 'icon.png'));
  // The templates keep their placeholders.
  assert.match(read(GAME_TEMPLATE_DIR, 'anyapp.json'), /__APP_PACKAGE__/);
  assert.ok(skipFor('game').has(path.join('game', 'build')));
});

test('the template game code is platform-free (what its AGENTS.md asks of every game)', () => {
  const root = path.join(GAME_TEMPLATE_DIR, 'game', 'src');
  assert.deepEqual(fs.readdirSync(root), ['commonMain']);
  const files = fs.readdirSync(path.join(root, 'commonMain', 'kotlin'), { recursive: true }).filter((f) => String(f).endsWith('.kt'));
  assert.ok(files.length >= 6);
  for (const f of files) {
    const src = read(root, 'commonMain', 'kotlin', String(f));
    assert.doesNotMatch(src, /^import (android|java|javax|com\.google)\./m, `${f} imports a platform API`);
    assert.doesNotMatch(src, /^import androidx\.(activity|core|appcompat)\./m, `${f} imports an Android-only library`);
    assert.doesNotMatch(src, /\u2014/, `${f} has an em dash`);
  }
});

test('the game manifest is the Kotlin one plus configChanges on the activity', () => {
  const kotlin = read(KOTLIN_TEMPLATE_DIR, 'app', 'src', 'main', 'AndroidManifest.xml').replace(/\r\n/g, '\n');
  const game = read(GAME_TEMPLATE_DIR, 'app', 'src', 'main', 'AndroidManifest.xml').replace(/\r\n/g, '\n');
  const stripped = game
    .replace(/ *<!-- Games: turning the phone[\s\S]*?-->\n/, '')
    .replace(/ *android:configChanges="[^"]*"\n/, '');
  assert.equal(stripped, kotlin);
});

test('buildApk builds a game (game/ and app/) into one small APK', { skip: process.env.ANYAPP_SKIP_BUILD_TESTS === '1' }, async () => {
  const r = await buildApk({ dir, buildNumber: 3 });
  assert.equal(r.preset, 'game');
  assert.equal(r.versionCode, 3);
  assert.equal(r.packageName, 'com.anyapp.kiwicatchtest');
  assert.equal(r.delivery, 'full');
  assert.ok(r.sizeBytes < 4_000_000, `APK is ${r.sizeBytes} bytes`);
  const names = readZip(fs.readFileSync(r.apkPath)).map((e) => e.name);
  assert.ok(names.some((n) => /composeResources\/.*\/files\/sounds\/catch\.wav$/.test(n)), 'the sounds are not in the APK');
});

test('renameApp and adoptApp keep a game a game', async () => {
  const renamed = await renameApp({ dir, name: 'Kiwi Dash', slug: 'kiwi-dash', packageName: 'com.anyapp.kiwicatchtest' });
  assert.deepEqual(renamed, { preset: 'game', packageChanged: false });
  assert.equal(JSON.parse(read(dir, 'anyapp.json')).preset, 'game');
  assert.match(read(dir, 'app', 'src', 'main', 'res', 'values', 'strings.xml'), /Kiwi Dash/);
  const adopted = await adoptApp({ src: dir, dir: copy, name: 'My Kiwi Dash', slug: 'my-kiwi-dash', packageName: 'com.anyapp.mykiwidashtest' });
  assert.equal(adopted.preset, 'game');
  assert.deepEqual(JSON.parse(read(copy, 'anyapp.json')), { preset: 'game', slug: 'my-kiwi-dash', package: 'com.anyapp.mykiwidashtest' });
  assert.ok(!fs.existsSync(path.join(copy, 'game', 'build')), 'game/build was copied');
  assert.ok(!fs.existsSync(path.join(copy, 'build')), 'build was copied');
});
