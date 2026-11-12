// "Make my own version" (docs/CHANGE-THIS-APP.md): adoptApp makes a separate app from another app's
// code, with its own name, package id and signing key. Real keytool, a throwaway ANYAPP_HOME, no build.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'anyapp-adopt-'));
process.env.ANYAPP_HOME = home;
const { adoptApp, changeValues } = await import('../index.mjs');
const { KEYSTORE_DIR } = await import('../lib/env.mjs');

test.after(() => fs.rmSync(home, { recursive: true, force: true }));

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

test('a React Native app becomes a separate app, without build output, keys or .env', async () => {
  const src = path.join(home, 'src-rn');
  write(path.join(src, 'app.json'), JSON.stringify({ expo: { name: 'Prayer Times', slug: 'prayertimes', android: { package: 'com.anyapp.prayertimes' } } }));
  write(path.join(src, 'package.json'), JSON.stringify({ name: 'prayertimes' }));
  write(path.join(src, 'src', 'App.tsx'), 'export default 1;\n');
  write(path.join(src, 'android', 'build.gradle'), 'generated');
  write(path.join(src, 'node_modules', 'x', 'index.js'), '');
  write(path.join(src, '.env'), 'SECRET=1');
  write(path.join(src, 'keys', 'release.p12'), 'key');
  const dir = path.join(home, 'apps', 'prayertimesahmad');
  const r = await adoptApp({ src, dir, name: "Prayer Times (Ahmad's)", slug: 'prayertimesahmad', packageName: 'com.anyapp.prayertimesahmad' });
  assert.equal(r.preset, 'react-native');
  const app = JSON.parse(fs.readFileSync(path.join(dir, 'app.json'), 'utf8'));
  assert.equal(app.expo.name, "Prayer Times (Ahmad's)");
  assert.equal(app.expo.android.package, 'com.anyapp.prayertimesahmad');
  assert.ok(fs.existsSync(path.join(dir, 'src', 'App.tsx')));
  for (const gone of ['android', 'node_modules', '.env', path.join('keys', 'release.p12')]) assert.ok(!fs.existsSync(path.join(dir, gone)), gone);
  assert.ok(fs.existsSync(path.join(KEYSTORE_DIR, 'apps', 'com.anyapp.prayertimesahmad', 'release.p12')), 'its own key');
  await assert.rejects(adoptApp({ src, dir, name: 'Again', slug: 'prayertimesahmad', packageName: 'com.anyapp.prayertimesahmad' }), /not empty/);
});

test('a Kotlin app gets its new name in strings.xml and anyapp.json', async () => {
  const src = path.join(home, 'src-kt');
  write(path.join(src, 'anyapp.json'), JSON.stringify({ preset: 'kotlin', slug: 'teatimer', package: 'com.anyapp.teatimer' }));
  write(path.join(src, 'app', 'src', 'main', 'res', 'values', 'strings.xml'), '<resources>\n  <string name="app_name">Tea Timer</string>\n</resources>\n');
  write(path.join(src, 'app', 'build', 'out.apk'), '');
  const dir = path.join(home, 'apps', 'teatimermum');
  await adoptApp({ src, dir, name: "Tea Timer (Mum's)", slug: 'teatimermum', packageName: 'com.anyapp.teatimermum' });
  assert.ok(fs.readFileSync(path.join(dir, 'app', 'src', 'main', 'res', 'values', 'strings.xml'), 'utf8').includes('<string name="app_name">Tea Timer (Mum\\\'s)</string>'));
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'anyapp.json'), 'utf8')).package, 'com.anyapp.teatimermum');
  assert.ok(!fs.existsSync(path.join(dir, 'app', 'build')));
});

test('not an app, or an Expo Exact app, is refused', async () => {
  const src = path.join(home, 'src-none');
  write(path.join(src, 'readme.txt'), 'hi');
  await assert.rejects(adoptApp({ src, dir: path.join(home, 'apps', 'x'), name: 'X', slug: 'x', packageName: 'com.anyapp.x' }), /not an app made with Kiwimake/);
});

test('the Change this app build values are plain and only what differs from the defaults', () => {
  assert.deepEqual(changeValues({}), {});
  assert.deepEqual(changeValues({ changeOwner: "Mohamad <b>'x'", changeOthers: true }), { ORG_GRADLE_PROJECT_anyappChangeOwner: 'Mohamad bx' });
  assert.deepEqual(changeValues({ changeOthers: false }), { ORG_GRADLE_PROJECT_anyappChangeOthers: '0' });
});
