// Signing outside the builder (docs/CLOUD.md section 6): a quick update package made without a
// key (ANYAPP_SIGN_EXTERNAL=1) has no ota.sig; lib/external-sign.mjs adds it, signed by the app's
// key, right after ota.json, and refuses a package that is signed already. Needs the JDK.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { androidEnv } from '../lib/env.mjs';
import { newAppKey, signOtaPackage } from '../lib/external-sign.mjs';
import { makeOtaPackage } from '../lib/fastlane.mjs';
import { entryData, readZip } from '../lib/zip.mjs';

test('an unsigned quick update gets its ota.sig from the app key', async () => {
  const { javaHome } = androidEnv();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anyapp-xs-'));
  const bundle = path.join(dir, 'index.android.bundle');
  fs.writeFileSync(bundle, 'bytecode');
  fs.mkdirSync(path.join(dir, 'res'));
  const file = path.join(dir, 'ota.zip');
  await makeOtaPackage({ file, bundle, resDir: path.join(dir, 'res'), packageName: 'com.anyappcloud.t', build: 3, runtime: 'abc', javaHome, key: null });
  let names = readZip(fs.readFileSync(file)).map((e) => e.name);
  assert.deepEqual(names, ['ota.json', 'index.android.bundle']);

  const key = await newAppKey(javaHome, path.join(dir, 'key.p12'), 'com.anyappcloud.t');
  assert.match(key.certSha256, /^[0-9a-f]{64}$/);
  await assert.rejects(newAppKey(javaHome, key.storeFile, 'com.anyappcloud.t'), /refusing to replace/);
  await signOtaPackage(javaHome, key, file, key.certSha256);
  const buf = fs.readFileSync(file);
  const entries = readZip(buf);
  names = entries.map((e) => e.name);
  assert.deepEqual(names, ['ota.json', 'ota.sig', 'index.android.bundle']);
  assert.ok(entryData(buf, entries[1]).toString().length > 100);
  assert.equal(JSON.parse(entryData(buf, entries[0]).toString()).build, 3);
  await assert.rejects(signOtaPackage(javaHome, key, file, key.certSha256), /already signed/);
  await assert.rejects(signOtaPackage(javaHome, key, file, 'f'.repeat(64)), /already signed|signed by/);
  fs.rmSync(dir, { recursive: true, force: true });
});
