// Phone abilities (com.anyapp.abilities: widgets, tiles, shortcuts, shares) and camera smarts
// (com.anyapp.camera) are one Kotlin core used by both templates: the Kotlin template compiles it
// into the app, the React Native template wraps it as Expo modules (modules/abilities,
// modules/camera). The copies, the widget resources and glyph.js must stay the same.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const kotlinMain = path.join(repo, 'template-kotlin', 'app', 'src', 'main');
const rnMain = path.join(repo, 'template', 'modules', 'abilities', 'android', 'src', 'main');
const CORE = ['ActionActivity.kt', 'ActionReceiver.kt', 'Actions.kt', 'Shares.kt', 'Shortcuts.kt', 'Tiles.kt', 'Widgets.kt'];
const RES = [
  'layout/anyapp_widget.xml',
  'drawable/anyapp_widget_bg.xml',
  'drawable/anyapp_widget_button.xml',
  'drawable/anyapp_widget_progress.xml',
  'values/anyapp_widget.xml',
  'values-night/anyapp_widget.xml',
  'values-v31/anyapp_widget.xml',
];

const read = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

test('the abilities core is the same in both templates', () => {
  const k = path.join(kotlinMain, 'java', 'com', 'anyapp', 'abilities');
  const r = path.join(rnMain, 'java', 'com', 'anyapp', 'abilities');
  assert.deepEqual(fs.readdirSync(k).sort(), CORE);
  assert.deepEqual(fs.readdirSync(r).sort(), CORE);
  for (const n of CORE) assert.equal(read(path.join(r, n)), read(path.join(k, n)), `${n} differs between the templates`);
});

test('both templates ship the same widget resources, and the Kotlin one keeps them', () => {
  for (const rel of RES) assert.equal(read(path.join(rnMain, 'res', rel)), read(path.join(kotlinMain, 'res', rel)), `${rel} differs`);
  const keep = read(path.join(kotlinMain, 'res', 'raw', 'anyapp_abilities_keep.xml'));
  assert.match(keep, /@layout\/anyapp_widget/);
  assert.match(read(path.join(repo, 'template-kotlin', 'app', 'proguard-rules.pro')), /implements com\.anyapp\.abilities\.ActionRunner/);
});

test('the widget layout has every part the renderer looks up by name', () => {
  const layout = read(path.join(rnMain, 'res', 'layout', 'anyapp_widget.xml'));
  const widgets = read(path.join(rnMain, 'java', 'com', 'anyapp', 'abilities', 'Widgets.kt'));
  const names = ['root', 'title', 'value', 'countdown', 'subtitle', 'progress', 'rows', 'button'];
  for (let i = 0; i < 6; i++) names.push(`row${i}`, `row${i}_label`, `row${i}_value`);
  for (const n of names) assert.match(layout, new RegExp(`@\\+id/anyapp_widget_${n}"`), `layout has no anyapp_widget_${n}`);
  assert.match(widgets, /MAX_ROWS = 6/);
});

test('nothing is declared by default: no widget, tile, share filter or runner in a plain app', () => {
  const rnManifest = read(path.join(rnMain, 'AndroidManifest.xml'));
  assert.doesNotMatch(rnManifest, /Widget[1-4]|Tile[1-4]|android\.intent\.action\.SEND/);
  const kManifest = read(path.join(kotlinMain, 'AndroidManifest.xml'));
  assert.doesNotMatch(kManifest, /com\.anyapp\.abilities\./);
  const appJson = JSON.parse(read(path.join(repo, 'template', 'app.json')));
  const plugins = appJson.expo.plugins.map((p) => (Array.isArray(p) ? p[0] : p));
  assert.ok(!plugins.includes('./modules/abilities/app.plugin.js'));
  assert.ok(!plugins.includes('./modules/camera/app.plugin.js'));
});

test('the camera core is the same in both templates', () => {
  const cam = path.join(repo, 'template', 'modules', 'camera', 'android', 'src');
  const extras = path.join(repo, 'template-kotlin', 'extras', 'camera');
  assert.equal(read(path.join(cam, 'codes-on', 'java', 'com', 'anyapp', 'camera', 'CodeScanner.kt')), read(path.join(extras, 'CodeScanner.kt')));
  assert.equal(read(path.join(cam, 'text-on', 'java', 'com', 'anyapp', 'camera', 'TextReader.kt')), read(path.join(extras, 'TextReader.kt')));
});

test('glyph.js is the same in both templates and makes a vector drawable', () => {
  const rn = path.join(repo, 'template', 'modules', 'abilities', 'glyph.js');
  const k = path.join(repo, 'template-kotlin', 'scripts', 'glyph.js');
  assert.equal(read(rn), read(k));
  const require = createRequire(import.meta.url);
  const glyph = require(k);
  const fontDir = path.join(repo, 'template-kotlin', 'scripts', 'icon-font');
  const xml = glyph.vectorDrawable('cup-water', { fontDir, color: '#FF1F5C45' });
  assert.match(xml, /<vector[\s\S]*android:viewportWidth="512"[\s\S]*android:pathData="M[\d. ]+[LQ]/);
  assert.match(xml, /android:fillColor="#FF1F5C45"/);
  assert.ok(glyph.hasGlyph('tea', { fontDir }));
  assert.throws(() => glyph.vectorDrawable('no-such-icon-anywhere', { fontDir }), /no icon named/);
});
