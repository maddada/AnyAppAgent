// The fast lane's pure parts (docs/FAST-LANE.md): which changes count as native, the ZIP rewrite
// with alignment, and the versionCode patch of a binary manifest. The real builds (a quick build
// after a JavaScript change, a full one after a native change) are proven on the emulator.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { nativeFingerprint, nativeInputs } from '../lib/fastlane.mjs';
import { entryData, readZip, rawItem, writeZip } from '../lib/zip.mjs';
import { readVersionCode, setVersionCode } from '../lib/axml.mjs';

function tmpApp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anyapp-fl-'));
  const w = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  };
  w('app.json', '{"expo":{"name":"A"}}');
  w('package.json', '{"name":"a"}');
  w('package-lock.json', '{}');
  w('src/App.tsx', 'export default 1;');
  w('assets/icon.png', 'png');
  w('modules/alarms/index.ts', 'export {};');
  w('modules/alarms/app.plugin.js', 'module.exports = (c) => c;');
  w('modules/alarms/android/src/main/AndroidManifest.xml', '<manifest/>');
  w('modules/alarms/android/build/generated/x.kt', 'build output');
  w('node_modules/x/index.js', 'x');
  return { dir, w };
}

test('only native files are fingerprint inputs', () => {
  const { dir } = tmpApp();
  assert.deepEqual(nativeInputs(dir), [
    'app.json',
    'assets/icon.png',
    'modules/alarms/android/src/main/AndroidManifest.xml',
    'modules/alarms/app.plugin.js',
    'package-lock.json',
    'package.json',
  ]);
});

test('a JavaScript change keeps the fingerprint, a native change or another feed changes it', async () => {
  const { dir, w } = tmpApp();
  const base = await nativeFingerprint(dir);
  w('src/App.tsx', 'export default 2;');
  w('modules/alarms/index.ts', 'export const x = 1;');
  w('src/screens/New.tsx', 'export {};');
  assert.equal(await nativeFingerprint(dir), base, 'JavaScript only');
  for (const [rel, text] of [
    ['app.json', '{"expo":{"name":"B"}}'],
    ['assets/sounds/beep.wav', 'wav'],
    ['modules/alarms/android/src/main/java/A.kt', 'class A'],
    ['modules/alarms/app.plugin.js', 'module.exports = (c) => ({ ...c });'],
    ['package-lock.json', '{"v":2}'],
  ]) {
    const before = await nativeFingerprint(dir);
    w(rel, text);
    assert.notEqual(await nativeFingerprint(dir), before, `${rel} is native`);
  }
  const now = await nativeFingerprint(dir);
  assert.notEqual(await nativeFingerprint(dir, { ORG_GRADLE_PROJECT_anyappUpdateFeed: 'https://github.com/a/b/releases/latest/download/update.json' }), now);
});

/** A minimal binary AndroidManifest.xml: string pool, resource map, <manifest versionCode=7>. */
function binaryManifest(versionCode) {
  const strings = ['versionCode', 'manifest'];
  const enc = strings.map((s) => Buffer.concat([Buffer.from([s.length, s.length]), Buffer.from(s, 'utf8'), Buffer.from([0])]));
  const offsets = [];
  let off = 0;
  for (const e of enc) {
    offsets.push(off);
    off += e.length;
  }
  let data = Buffer.concat(enc);
  data = Buffer.concat([data, Buffer.alloc((4 - (data.length % 4)) % 4)]);
  const poolHeader = 28;
  const pool = Buffer.alloc(poolHeader + offsets.length * 4);
  pool.writeUInt16LE(0x0001, 0);
  pool.writeUInt16LE(poolHeader, 2);
  pool.writeUInt32LE(pool.length + data.length, 4);
  pool.writeUInt32LE(strings.length, 8);
  pool.writeUInt32LE(0x100, 16); // UTF-8
  pool.writeUInt32LE(pool.length, 20);
  offsets.forEach((o, i) => pool.writeUInt32LE(o, poolHeader + i * 4));
  const poolChunk = Buffer.concat([pool, data]);
  const resMap = Buffer.alloc(12);
  resMap.writeUInt16LE(0x0180, 0);
  resMap.writeUInt16LE(8, 2);
  resMap.writeUInt32LE(12, 4);
  resMap.writeUInt32LE(0x0101021b, 8);
  const el = Buffer.alloc(16 + 20 + 20);
  el.writeUInt16LE(0x0102, 0);
  el.writeUInt16LE(16, 2);
  el.writeUInt32LE(el.length, 4);
  el.writeInt32LE(-1, 12);
  el.writeInt32LE(-1, 16); // ns
  el.writeUInt32LE(1, 20); // name: "manifest"
  el.writeUInt16LE(20, 24);
  el.writeUInt16LE(20, 26);
  el.writeUInt16LE(1, 28);
  el.writeInt32LE(-1, 36); // attr ns
  el.writeUInt32LE(0, 40); // attr name: "versionCode"
  el.writeInt32LE(-1, 44); // raw value
  el.writeUInt16LE(8, 48);
  el[51] = 0x10;
  el.writeUInt32LE(versionCode, 52);
  const body = Buffer.concat([poolChunk, resMap, el]);
  const head = Buffer.alloc(8);
  head.writeUInt16LE(0x0003, 0);
  head.writeUInt16LE(8, 2);
  head.writeUInt32LE(8 + body.length, 4);
  return Buffer.concat([head, body]);
}

test('setVersionCode changes only the version code', () => {
  const m = binaryManifest(7);
  assert.equal(readVersionCode(m), 7);
  const out = setVersionCode(m, 12);
  assert.equal(readVersionCode(out), 12);
  assert.equal(out.length, m.length);
  assert.equal(Buffer.compare(out.subarray(0, 52), m.subarray(0, 52)), 0);
});

test('a ZIP rewrite keeps raw entries, replaces one, and aligns stored entries', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anyapp-zip-'));
  const a = path.join(dir, 'a.zip');
  await writeZip(a, [
    { name: 'AndroidManifest.xml', data: binaryManifest(3) },
    { name: 'x.txt', data: Buffer.from('hello hello hello') },
    { name: 'lib/x86_64/libx.so', data: Buffer.alloc(100, 1), store: true },
    { name: 'resources.arsc', data: Buffer.alloc(33, 2), store: true },
  ]);
  const buf = fs.readFileSync(a);
  const entries = readZip(buf);
  const b = path.join(dir, 'b.zip');
  await writeZip(b, entries.map((e) => (e.name === 'AndroidManifest.xml' ? { name: e.name, data: setVersionCode(entryData(buf, e), 9) } : rawItem(buf, e))));
  const out = fs.readFileSync(b);
  const outEntries = readZip(out);
  assert.deepEqual(outEntries.map((e) => e.name), entries.map((e) => e.name));
  assert.equal(readVersionCode(entryData(out, outEntries[0])), 9);
  assert.equal(entryData(out, outEntries[1]).toString(), 'hello hello hello');
  const so = outEntries.find((e) => e.name.endsWith('.so'));
  const arsc = outEntries.find((e) => e.name === 'resources.arsc');
  assert.equal(so.dataOffset % 16384, 0);
  assert.equal(arsc.dataOffset % 4, 0);
});
