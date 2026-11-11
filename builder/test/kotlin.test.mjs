// The Kotlin preset: createApp fills in a native Android app, getIconPath finds its icon.png, and
// buildApk makes a small signed APK with versionCode = build number, remakes the launcher icon
// sizes when icon.png changes, and refuses a changed package id.
//   node --test builder/test/          (the build tests need the Android toolchain; ~1 min warm)
//   ANYAPP_SKIP_BUILD_TESTS=1 skips the two builds.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { after, before, test } from 'node:test';

import { buildApk, createApp, getIconPath, presetOf } from '../index.mjs';
import { decodePng, encodePng, resizeSquare } from '../lib/png.mjs';
import { KOTLIN_TEMPLATE_DIR } from '../lib/presets.mjs';
import { run } from '../lib/exec.mjs';

process.env.ANYAPP_NO_SPARE = '1'; // no background spare refills from a test

const ROOT = process.env.ANYAPP_TEST_DIR ?? 'C:\\aa\\t';
const dir = path.join(ROOT, `kt-${crypto.randomBytes(3).toString('hex')}`);
const NAME = `Mum's "Tea" & <Timer>`;

before(async () => {
  await createApp({ dir, name: NAME, slug: 'mums-tea', packageName: 'com.anyapp.mumstea', preset: 'kotlin' });
});

after(async () => {
  await fsp.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
});

test('createApp makes a Kotlin app with its name, slug and package id', () => {
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'anyapp.json'), 'utf8'));
  assert.deepEqual(meta, { preset: 'kotlin', slug: 'mums-tea', package: 'com.anyapp.mumstea' });
  const strings = fs.readFileSync(path.join(dir, 'app', 'src', 'main', 'res', 'values', 'strings.xml'), 'utf8');
  assert.match(strings, /<string name="app_name">Mum\\'s \\"Tea\\" &amp; &lt;Timer&gt;<\/string>/);
  assert.equal(presetOf(dir), 'kotlin');
  for (const f of ['AGENTS.md', 'CLAUDE.md', 'gradlew', 'gradlew.bat', 'gradle/wrapper/gradle-wrapper.jar', 'scripts/make-icon.mjs', '.gitignore']) {
    assert.ok(fs.existsSync(path.join(dir, f)), `${f} is missing`);
  }
  for (const f of ['build', '.gradle', 'app/build', 'node_modules', 'app.json']) {
    assert.ok(!fs.existsSync(path.join(dir, f)), `${f} should not be in a new Kotlin app`);
  }
  // The template itself still has its placeholders.
  assert.match(fs.readFileSync(path.join(KOTLIN_TEMPLATE_DIR, 'anyapp.json'), 'utf8'), /__APP_PACKAGE__/);
});

test('getIconPath finds icon.png of a Kotlin app', () => {
  assert.equal(getIconPath({ dir }), path.join(dir, 'icon.png'));
});

test('createApp refuses an unknown preset', async () => {
  await assert.rejects(
    createApp({ dir: path.join(ROOT, 'never'), name: 'X', slug: 'x', packageName: 'com.anyapp.x', preset: 'flutter' }),
    /unknown preset "flutter"/,
  );
  assert.ok(!fs.existsSync(path.join(ROOT, 'never')));
});

test('png: decode, resize and encode round trip', () => {
  const size = 64;
  const rgba = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) rgba.set([i % 256, 40, 200, 255], i * 4);
  const back = decodePng(encodePng({ width: size, height: size, rgba }));
  assert.equal(back.width, size);
  assert.deepEqual(back.rgba, rgba);
  const small = resizeSquare(back, 16);
  assert.equal(small.rgba.length, 16 * 16 * 4);
  assert.equal(small.rgba[3], 255);
  // A palette PNG (colour type 3) decodes too.
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(2, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 3;
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    return Buffer.concat([len, Buffer.from(type), data, Buffer.alloc(4)]); // CRC is not checked
  };
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('PLTE', Buffer.from([255, 0, 0, 0, 0, 255])),
    chunk('IDAT', zlib.deflateSync(Buffer.from([0, 0, 1]))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  assert.deepEqual([...decodePng(png).rgba], [255, 0, 0, 255, 0, 0, 255, 255]);
});

const skipBuilds = process.env.ANYAPP_SKIP_BUILD_TESTS === '1';

test('buildApk builds a small signed APK, versionCode = build number, icon sizes follow icon.png', { skip: skipBuilds, timeout: 20 * 60_000 }, async () => {
  const first = await buildApk({ dir, buildNumber: 1 });
  assert.equal(first.versionCode, 1);
  assert.equal(first.packageName, 'com.anyapp.mumstea');
  assert.equal(first.preset, 'kotlin');
  assert.ok(first.sizeBytes < 8 * 1048576, `APK is ${first.sizeBytes} bytes, expected a few MB`);
  assert.ok(fs.existsSync(first.apkPath));

  // A new icon (as the agent makes one) changes the generated launcher sizes.
  const fg = path.join(dir, 'app', 'src', 'main', 'res', 'mipmap-xxxhdpi', 'ic_launcher_foreground.png');
  const before = fs.readFileSync(fg);
  await run(process.execPath, [path.join(dir, 'scripts', 'make-icon.mjs'), '--bg', '#14532D', '--glyph', 'tea'], { cwd: dir });
  const second = await buildApk({ dir, buildNumber: 2 });
  assert.equal(second.versionCode, 2);
  assert.notDeepEqual(fs.readFileSync(fg), before, 'the launcher icon sizes were not remade from icon.png');
  const img = decodePng(fs.readFileSync(fg));
  assert.equal(img.width, 432);
  assert.deepEqual([...img.rgba.subarray(0, 3)], [0x14, 0x53, 0x2d]);

  // Both builds are signed with the same key, so 2 installs over 1.
  const certs = [];
  for (const apk of [first.apkPath, second.apkPath]) {
    const sdk = process.env.ANDROID_HOME ?? 'D:\\tools\\android\\sdk';
    const apksigner = path.join(sdk, 'build-tools', '37.0.0', process.platform === 'win32' ? 'apksigner.bat' : 'apksigner');
    if (!fs.existsSync(apksigner)) return;
    const { lines } = await run(apksigner, ['verify', '--print-certs', apk], { shell: process.platform === 'win32' });
    certs.push(lines.find((l) => /certificate SHA-256 digest/.test(l)));
  }
  assert.ok(certs[0], 'apksigner printed no certificate');
  assert.equal(certs[0], certs[1]);
});

test('buildApk refuses a Kotlin app whose package id was changed', { skip: skipBuilds, timeout: 20 * 60_000 }, async () => {
  const gradleFile = path.join(dir, 'app', 'build.gradle.kts');
  const original = fs.readFileSync(gradleFile, 'utf8');
  fs.writeFileSync(gradleFile, original.replace('applicationId = anyapp["package"] as String', 'applicationId = "com.example.other"'));
  try {
    await assert.rejects(buildApk({ dir, buildNumber: 3 }), /package id is com\.example\.other but must stay com\.anyapp\.mumstea/);
  } finally {
    fs.writeFileSync(gradleFile, original);
  }
});
