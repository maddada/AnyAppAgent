// The updater (com.anyapp.updates, docs/DISTRIBUTION.md stage 4) is one Kotlin core used by both
// templates: the Kotlin template compiles it into the app, the React Native template wraps it as
// an Expo module. The two copies must stay byte for byte the same.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const kotlin = path.join(repo, 'template-kotlin', 'app', 'src', 'main', 'java', 'com', 'anyapp', 'updates');
const rn = path.join(repo, 'template', 'modules', 'updates', 'android', 'src', 'main', 'java', 'com', 'anyapp', 'updates');

test('the updater core is the same in both templates', () => {
  const names = fs.readdirSync(kotlin).sort();
  assert.deepEqual(names, ['AppUpdater.kt', 'HostLink.kt', 'InstallReceiver.kt', 'Ota.kt', 'ReadyPopup.kt', 'UpdateActivity.kt', 'UpdateJob.kt']);
  assert.deepEqual(fs.readdirSync(rn).sort(), names);
  for (const n of names) {
    const a = fs.readFileSync(path.join(kotlin, n), 'utf8').replace(/\r\n/g, '\n');
    const b = fs.readFileSync(path.join(rn, n), 'utf8').replace(/\r\n/g, '\n');
    assert.equal(b, a, `${n} differs between the templates`);
  }
});

test('both templates keep the feed strings through resource shrinking', () => {
  for (const f of [
    path.join(repo, 'template-kotlin', 'app', 'src', 'main', 'res', 'raw', 'anyapp_keep.xml'),
    path.join(repo, 'template', 'modules', 'updates', 'android', 'src', 'main', 'res', 'raw', 'anyapp_keep.xml'),
  ]) {
    assert.match(fs.readFileSync(f, 'utf8'), /tools:keep="@string\/anyapp_update_feed,@string\/anyapp_update_testing_feed,@string\/anyapp_runtime"/);
  }
});
