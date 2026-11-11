// "Point at it" feedback (com.anyapp.feedback) is one Kotlin core used by both templates: the
// Kotlin template compiles it into the app, the React Native template wraps it as an Expo module
// (modules/feedback). The two copies, and the fonts the screen draws with, must stay the same.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const kotlinMain = path.join(repo, 'template-kotlin', 'app', 'src', 'main');
const rnMain = path.join(repo, 'template', 'modules', 'feedback', 'android', 'src', 'main');
const CORE = ['AnnotateView.kt', 'Feedback.kt', 'FeedbackActivity.kt', 'FeedbackImage.kt', 'FeedbackProvider.kt', 'FeedbackStyle.kt', 'ShakeDetector.kt'];

test('the feedback core is the same in both templates', () => {
  const kotlin = path.join(kotlinMain, 'java', 'com', 'anyapp', 'feedback');
  const rn = path.join(rnMain, 'java', 'com', 'anyapp', 'feedback');
  assert.deepEqual(fs.readdirSync(kotlin).sort(), CORE);
  assert.deepEqual(fs.readdirSync(rn).sort(), CORE);
  for (const n of CORE) {
    const a = fs.readFileSync(path.join(kotlin, n), 'utf8').replace(/\r\n/g, '\n');
    const b = fs.readFileSync(path.join(rn, n), 'utf8').replace(/\r\n/g, '\n');
    assert.equal(b, a, `${n} differs between the templates`);
  }
});

test('both templates ship the same feedback fonts and register the provider and screen', () => {
  const k = path.join(kotlinMain, 'assets', 'anyapp-feedback');
  const r = path.join(rnMain, 'assets', 'anyapp-feedback');
  const names = fs.readdirSync(k).sort();
  assert.deepEqual(fs.readdirSync(r).sort(), names);
  for (const n of names.filter((f) => f.endsWith('.ttf'))) {
    assert.ok(fs.readFileSync(path.join(k, n)).equals(fs.readFileSync(path.join(r, n))), `${n} differs`);
  }
  for (const manifest of [path.join(kotlinMain, 'AndroidManifest.xml'), path.join(rnMain, 'AndroidManifest.xml')]) {
    const xml = fs.readFileSync(manifest, 'utf8');
    assert.match(xml, /android:name="com\.anyapp\.feedback\.FeedbackProvider"/);
    assert.match(xml, /android:authorities="\$\{applicationId\}\.anyappfeedback"/);
    assert.match(xml, /android:grantUriPermissions="true"/);
    assert.match(xml, /android:name="com\.anyapp\.feedback\.FeedbackActivity"/);
  }
});
