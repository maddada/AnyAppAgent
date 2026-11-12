// Tests for the fence around automation scripts (automate/app/tools/automate-fence.js), through
// Babel with Expo's preset, as Metro runs it. Needs an app folder with node_modules (any
// Kiwimake React Native app, or a copy of template/ after npm ci):
//
//   APP_DIR=C:/aa/apps/appwinautomate node --test "automate/test/*.test.mjs"
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = process.env.APP_DIR;
const fence = path.join(here, '..', 'app', 'tools', 'automate-fence.js');

const skip = !appDir && 'set APP_DIR to an app folder with node_modules';
const req = appDir ? createRequire(path.join(appDir, 'package.json')) : null;

function compile(id, code) {
  const babel = req('@babel/core');
  const preset = req.resolve('babel-preset-expo', { paths: [req.resolve('expo/package.json')] });
  const filename = path.join(appDir, 'automations', `${id}.ts`);
  return babel.transformSync(code, { filename, babelrc: false, configFile: false, presets: [preset], plugins: [fence], caller: { name: 'metro', platform: 'android' } }).code;
}

/** Runs the compiled module and returns its default export (the wrapped automation). */
function load(id, code) {
  const out = compile(id, code);
  const module = { exports: {} };
  new Function('module', 'exports', 'require', out)(module, module.exports, (m) => req(m));
  return module.exports.default;
}

const MAGHRIB = `
const MINUTES = 20;
export default automation({
  name: 'Maghrib quiet time',
  says: 'At Maghrib, Do Not Disturb for 20 minutes',
  when: prayer('maghrib'),
  async run() {
    await speak('Maghrib time');
    await doNotDisturb.on({ minutes: MINUTES });
  },
});`;

test('records powers and literal arguments, hashes the source', { skip }, () => {
  const m = load('maghrib-quiet', MAGHRIB);
  assert.equal(m.id, 'maghrib-quiet');
  assert.match(m.hash, /^[0-9a-f]{16}$/);
  assert.deepEqual(m.powers, ['doNotDisturb', 'speak']);
  assert.deepEqual(
    m.actions.map((a) => [a.call, a.args]),
    [
      ['speak', ['Maghrib time']],
      ['doNotDisturb.on', [{ minutes: 20 }]],
    ],
  );
  assert.equal(typeof m.define, 'function');
  const changed = load('maghrib-quiet', MAGHRIB.replace('= 20', '= 30'));
  assert.notEqual(changed.hash, m.hash);
  assert.deepEqual(changed.actions[1].args, [{ minutes: 30 }]);
});

test('the script sees only what it is handed', { skip }, () => {
  const m = load('x', `export default automation({ name: 'x', says: '', when: at('07:00'), run() { return Math.max(1, 2); } })`);
  const api = new Proxy({}, { get: (_, k) => (k === 'automation' ? (d) => d : k === 'at' ? (t) => ({ kind: 'at', time: t }) : () => {}) });
  const def = m.define(api);
  assert.equal(def.name, 'x');
  assert.equal(def.run(), 2);
});

for (const [why, code, message] of [
  ['imports', `import x from 'y';\nexport default automation({ name: 'a', says: '', when: at('07:00'), run() {} })`, /cannot import/],
  ['fetch', `export default automation({ name: 'a', says: '', when: at('07:00'), run() { fetch('https://x'); } })`, /"fetch" is not available/],
  ['globalThis', `const g = globalThis;\nexport default automation({ name: 'a', says: '', when: at('07:00'), run() {} })`, /"globalThis" is not available/],
  ['.constructor', `export default automation({ name: 'a', says: '', when: at('07:00'), run() { return Math.max.constructor; } })`, /"\.constructor" is not allowed/],
  ['destructured constructor', `export default automation({ name: 'a', says: '', when: at('07:00'), run() { const { constructor } = Math.max; } })`, /not allowed/],
  ['no export', `automation({ name: 'a', says: '', when: at('07:00'), run() {} })`, /exactly one/],
  ['the wrong export', `export default notify('x')`, /The one export must be/],
  ['fence helpers', `export default automation({ name: 'a', says: '', when: at('07:00'), run() { $get(1, 2); } })`, /reserved/],
]) {
  test(`refuses ${why}`, { skip }, () => {
    assert.throws(() => compile('bad', code), message);
  });
}

test('refuses a bad file name', { skip }, () => {
  assert.throws(() => compile('Bad_Name', MAGHRIB), /file name is the automation's id/);
});

test('guards dynamic property access and loops at run time', { skip }, () => {
  const m = load(
    'guarded',
    `export default automation({ name: 'g', says: '', when: at('07:00'), run() {
      const k = 'constr' + 'uctor';
      const counts = {};
      counts['a'] = 1;
      counts[k.slice(0, 1)] = 2;
      for (let i = 0; i < 3; i++) counts[k.slice(0, 1)]++;
      return Math.max[k];
    } })`,
  );
  let ticks = 0;
  const blocked = new Set(['constructor', 'prototype', '__proto__']);
  const key = (k) => {
    if (blocked.has(String(k))) throw new Error(`"${k}" is not allowed`);
    return k;
  };
  const api = {
    automation: (d) => d,
    at: (t) => ({ kind: 'at', time: t }),
    $get: (o, k) => o[key(k)],
    $set: (o, k, v) => (o[key(k)] = v),
    $call: (o, k, a) => o[key(k)](...a),
    $del: (o, k) => delete o[key(k)],
    $upd: (o, k, fn) => (o[key(k)] = fn(o[key(k)])),
    $tick: () => {
      ticks += 1;
    },
  };
  const def = m.define(api);
  assert.throws(() => def.run(), /"constructor" is not allowed/);
  assert.equal(ticks, 3);
});
