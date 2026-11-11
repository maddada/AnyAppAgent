// Signing keys (docs/DISTRIBUTION.md): per-app keys, moving an app off the shared key, and the
// encrypted backup. Real keytool and apksigner, in a throwaway ANYAPP_HOME (no build, ~20 s).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'anyapp-keys-'));
process.env.ANYAPP_HOME = home;
const { androidEnv, KEYSTORE_DIR } = await import('../lib/env.mjs');
const keystore = await import('../lib/keystore.mjs');
const backup = await import('../lib/keybackup.mjs');
const { javaHome, sdk } = androidEnv();

test.after(() => fs.rmSync(home, { recursive: true, force: true }));

test('a new app gets its own key once; the same package id keeps it', async () => {
  const a = await keystore.ensureAppKey(javaHome, 'com.anyapp.keystest');
  const again = await keystore.ensureAppKey(javaHome, 'com.anyapp.keystest');
  assert.equal(a.kind, 'own');
  assert.match(a.certSha256, /^[0-9a-f]{64}$/);
  assert.equal(again.certSha256, a.certSha256);
  const signing = await keystore.signingFor(javaHome, 'com.anyapp.keystest');
  assert.equal(signing.kind, 'own');
  assert.deepEqual(signing.expect, { current: a.certSha256 });
  assert.ok(!fs.readFileSync(path.join(KEYSTORE_DIR, 'apps', 'com.anyapp.keystest', 'key.json'), 'utf8').includes('..'));
  assert.throws(() => keystore.appKeyDir('../evil'), /Not a valid package id/);
});

test('an app without a key folder signs with the shared key; moving it adds a lineage', async () => {
  const before = await keystore.signingFor(javaHome, 'com.anyapp.oldapp');
  assert.equal(before.kind, 'shared');
  const moved = await keystore.moveAppToOwnKey(javaHome, sdk, 'com.anyapp.oldapp');
  assert.equal(moved.kind, 'moved');
  assert.ok(fs.existsSync(moved.lineageFile));
  assert.equal(moved.movedFrom.certSha256, before.certSha256);
  const after = await keystore.signingFor(javaHome, 'com.anyapp.oldapp');
  assert.equal(after.kind, 'moved');
  assert.deepEqual(after.expect, { current: moved.certSha256, legacy: before.certSha256 });
  await assert.rejects(keystore.moveAppToOwnKey(javaHome, sdk, 'com.anyapp.oldapp'), /already has its own/);
});

test('backup: encrypted, refused with a wrong password or a changed file, restores what is missing', async () => {
  const file = path.join(home, 'keys.anyappkeys');
  const listed = await keystore.listKeys(javaHome);
  await assert.rejects(backup.backupKeys(javaHome, { file, password: 'short' }), /at least 8/);
  const made = await backup.backupKeys(javaHome, { file, password: 'a good password' });
  assert.equal(made.count, listed.length);
  const text = fs.readFileSync(file, 'utf8');
  for (const id of ['com.anyapp.keystest', 'com.anyapp.oldapp']) {
    const info = JSON.parse(fs.readFileSync(path.join(KEYSTORE_DIR, 'apps', id, 'key.json'), 'utf8'));
    assert.ok(!text.includes(info.storePassword), 'a key password is in the backup in clear');
    assert.ok(!text.includes(id), 'an app id is in the backup in clear');
  }
  await assert.rejects(backup.restoreKeys(javaHome, { file, password: 'the wrong one' }), /Wrong password/);
  const doc = JSON.parse(text);
  doc.data = (doc.data[0] === 'A' ? 'B' : 'A') + doc.data.slice(1);
  const changed = path.join(home, 'changed.anyappkeys');
  fs.writeFileSync(changed, JSON.stringify(doc));
  await assert.rejects(backup.restoreKeys(javaHome, { file: changed, password: 'a good password' }), /Wrong password, or the backup file was changed/);

  // Lose every key, restore them, and get exactly the same certificates back.
  fs.renameSync(KEYSTORE_DIR, `${KEYSTORE_DIR}.lost`);
  const restored = await backup.restoreKeys(javaHome, { file, password: 'a good password' });
  assert.deepEqual(restored.added.sort(), listed.map((k) => k.id).sort());
  assert.deepEqual(restored.conflicts, []);
  const back = await keystore.listKeys(javaHome);
  assert.deepEqual(back.map((k) => [k.id, k.kind, k.certSha256]), listed.map((k) => [k.id, k.kind, k.certSha256]));
  assert.equal((await keystore.signingFor(javaHome, 'com.anyapp.oldapp')).kind, 'moved');
  assert.ok(backup.lastBackup()?.ids.includes('com.anyapp.oldapp'));

  // Again: nothing new. A different key already here is kept, never overwritten.
  const again = await backup.restoreKeys(javaHome, { file, password: 'a good password' });
  assert.equal(again.added.length, 0);
  fs.rmSync(path.join(KEYSTORE_DIR, 'apps', 'com.anyapp.keystest'), { recursive: true });
  const other = await keystore.ensureAppKey(javaHome, 'com.anyapp.keystest');
  const conflict = await backup.restoreKeys(javaHome, { file, password: 'a good password' });
  assert.deepEqual(conflict.conflicts.map((c) => c.id), ['com.anyapp.keystest']);
  assert.equal(keystore.readAppKey('com.anyapp.keystest').certSha256, other.certSha256);
});
