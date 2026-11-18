// Web apps (preset "web", template-web/): createApp, buildWeb and addWebVersion. A real
// `vite build` and `tsc` (a second or two each). The dependency cache follows ANYAPP_HOME like the
// other tests (set it to a throwaway folder to keep ~/.anyappagent untouched). With Chromium on
// the machine it also opens the built site under a sub-path, as GitHub Pages serves it: the
// service worker, storage prefixes, "Version N is ready" with Reload, and offline.
//   node --test builder/test/web.test.mjs     (ANYAPP_SKIP_BROWSER_TESTS=1 skips the browser part)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import vm from 'node:vm';

import { addWebVersion, buildWeb, createApp, getIconPath, presetOf } from '../index.mjs';
import { KEYSTORE_DIR } from '../lib/env.mjs';
import { decodePng } from '../lib/png.mjs';
import { findChromium, openBrowser } from './helpers/cdp.mjs';

process.env.ANYAPP_NO_SPARE = '1';

const ROOT = fs.mkdtempSync(path.join(process.env.ANYAPP_TEST_DIR ?? os.tmpdir(), 'kiwi-web-'));
const SLUG = 'plant-diary';
const NAME = 'Plant <Diary> & Co';
const dir = path.join(ROOT, 'apps', SLUG);
let built;

after(() => fs.rmSync(ROOT, { recursive: true, force: true }));

function listFiles(root, rel = '') {
  const out = [];
  for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...listFiles(root, r));
    else out.push(r);
  }
  return out.sort();
}

const appTsx = () => path.join(dir, 'src', 'App.tsx');

before(async () => {
  await createApp({ dir, name: NAME, slug: SLUG, packageName: 'com.anyapp.plantdiary', preset: 'web' });
  // Use storage on the first screen, so the build carries it (the starter screen does not).
  const src = fs.readFileSync(appTsx(), 'utf8');
  fs.writeFileSync(
    appTsx(),
    src
      .replace("import { WebReady } from '@/components/WebReady';", "import { WebReady } from '@/components/WebReady';\nimport { usePersistentState } from '@/lib/storage';")
      .replace('export default function App() {\n', "export default function App() {\n  const [opens, setOpens] = usePersistentState<number>('opens', 0);\n  if (opens === 0) queueMicrotask(() => setOpens((n) => n + 1));\n")
      .replace('Ready for its first idea.', 'Opened {opens} times.'),
  );
  built = await buildWeb({ dir, buildNumber: 7 });
});

test('createApp makes a web app: anyapp.json, names filled in, no signing key', () => {
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'anyapp.json'), 'utf8')), {
    preset: 'web',
    slug: SLUG,
    package: 'com.anyapp.plantdiary',
    name: NAME,
  });
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).name, SLUG);
  assert.equal(presetOf(dir), 'web');
  assert.equal(getIconPath({ dir }), path.join(dir, 'assets', 'icon.png'));
  assert.ok(fs.existsSync(path.join(dir, 'node_modules', 'vite', 'package.json')));
  assert.ok(fs.existsSync(path.join(dir, 'AGENTS.md')) && fs.existsSync(path.join(dir, 'CLAUDE.md')));
  assert.ok(!fs.existsSync(path.join(KEYSTORE_DIR, 'apps', 'com.anyapp.plantdiary')), 'a web app has no signing key');
  const nm = path.join(dir, 'node_modules', 'react', 'package.json');
  assert.equal(fs.statSync(nm).nlink, 1, 'node_modules is an own copy');
});

test('buildWeb: the result lists every file of dist/ with sizes and hashes', () => {
  assert.equal(built.distDir, path.join(dir, 'dist'));
  const onDisk = listFiles(built.distDir);
  assert.deepEqual(built.files.map((f) => f.path), onDisk);
  for (const f of built.files) {
    assert.ok(!f.path.includes('\\'));
    assert.equal(f.size, fs.statSync(path.join(built.distDir, f.path)).size);
    assert.match(f.sha256, /^[0-9a-f]{64}$/);
  }
  assert.equal(built.sizeBytes, built.files.reduce((s, f) => s + f.size, 0));
  for (const need of ['index.html', 'sw.js', 'manifest.webmanifest', 'version.json', 'icon-192.png', 'icon-512.png']) assert.ok(onDisk.includes(need), need);
  assert.ok(onDisk.some((f) => /^assets\/index-.*\.js$/.test(f)));
});

test('buildWeb: no source maps, relative paths, name escaped in the page', () => {
  const files = listFiles(built.distDir);
  assert.deepEqual(files.filter((f) => f.endsWith('.map')), []);
  for (const f of files.filter((x) => /\.(js|css|html)$/.test(x))) {
    assert.doesNotMatch(fs.readFileSync(path.join(built.distDir, f), 'utf8'), /sourceMappingURL/, f);
  }
  const html = fs.readFileSync(path.join(built.distDir, 'index.html'), 'utf8');
  assert.match(html, /src="\.\/assets\/index-[^"]+\.js"/);
  assert.doesNotMatch(html, /(src|href)="\/(?!\/)/, 'no absolute paths');
  assert.match(html, /<title>Plant &#60;Diary&#62; &#38; Co<\/title>/);
  assert.match(html, /<link rel="manifest" href="manifest.webmanifest"/);
});

test('buildWeb: manifest, icons and version.json', () => {
  const m = JSON.parse(fs.readFileSync(path.join(built.distDir, 'manifest.webmanifest'), 'utf8'));
  assert.equal(m.name, NAME);
  assert.equal(m.start_url, './');
  assert.equal(m.scope, './');
  assert.equal(m.display, 'standalone');
  assert.match(m.theme_color, /^#[0-9A-Fa-f]{6}$/);
  assert.deepEqual(m.icons.map((i) => `${i.src} ${i.sizes}`), ['icon-192.png 192x192', 'icon-512.png 512x512', 'icon-512.png 512x512']);
  for (const size of [192, 512]) {
    const png = decodePng(fs.readFileSync(path.join(built.distDir, `icon-${size}.png`)));
    assert.equal(png.width, size);
    assert.equal(png.height, size);
  }
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(built.distDir, 'version.json'), 'utf8')), { build: 7 });
});

test('buildWeb: the build number, slug and storage prefix are in the bundle', () => {
  const js = built.files.filter((f) => f.path.endsWith('.js')).map((f) => fs.readFileSync(path.join(built.distDir, f.path), 'utf8')).join('\n');
  assert.ok(js.includes(SLUG), 'slug baked in');
  assert.match(js, /kiwi-storage-changed/, 'storage.ts is used');
  assert.match(js, /kiwimake:check-update/);
});

/** Runs sw.js in a sandbox with fake caches; returns what it did. */
async function runServiceWorker(code, { scope, cacheNames }) {
  const handlers = {};
  const log = { added: [], deleted: [], skipWaiting: 0, claimed: 0 };
  const caches = {
    open: async (name) => ({
      name,
      addAll: async (reqs) => log.added.push(...reqs.map((r) => ({ url: r.url, cache: r.cache, into: name }))),
      match: async () => undefined,
    }),
    keys: async () => cacheNames,
    delete: async (n) => (log.deleted.push(n), true),
  };
  const self = {
    registration: { scope },
    addEventListener: (type, fn) => (handlers[type] = fn),
    skipWaiting: () => log.skipWaiting++,
    clients: { claim: async () => log.claimed++ },
  };
  vm.runInNewContext(code, { self, caches, URL, Request, Response, fetch: async () => new Response('net'), Set, Promise });
  const waitFor = async (type, event = {}) => {
    let p;
    handlers[type]({ ...event, waitUntil: (x) => (p = x) });
    await p;
  };
  await waitFor('install');
  handlers.message({ data: { type: 'skipWaiting' } });
  await waitFor('activate');
  const responds = (url, mode = 'no-cors') => {
    let used = false;
    handlers.fetch({ request: { method: 'GET', url, mode }, respondWith: () => (used = true) });
    return used;
  };
  return { log, responds };
}

test('sw.js: precaches every file, kiwi-<slug>-<build>, deletes only its own old caches', async () => {
  const code = fs.readFileSync(path.join(built.distDir, 'sw.js'), 'utf8');
  const scope = 'https://someone.github.io/anyapp-plant-diary-web/';
  const { log, responds } = await runServiceWorker(code, {
    scope,
    cacheNames: ['kiwi-plant-diary-6', 'kiwi-plant-diary-7', 'kiwi-plant-diary-extra-3', 'kiwi-other-app-2', 'something-else'],
  });
  const expected = built.files.map((f) => f.path).filter((p) => p !== 'sw.js' && p !== 'version.json');
  assert.deepEqual(log.added.map((a) => a.url.slice(scope.length)).sort(), expected);
  assert.ok(log.added.every((a) => a.cache === 'reload' && a.into === `kiwi-${SLUG}-7`));
  assert.deepEqual(log.deleted, ['kiwi-plant-diary-6']);
  assert.equal(log.skipWaiting, 1, 'skips waiting only when the page asks');
  assert.equal(log.claimed, 1);
  assert.equal(responds(`${scope}version.json?t=1`), false, 'version.json always goes to the network');
  assert.equal(responds(`${scope}${expected.find((p) => p.endsWith('.js'))}`), true);
  assert.equal(responds(`${scope}`, 'navigate'), true);
  assert.equal(responds('https://someone.github.io/anyapp-other-web/index.html'), false, 'outside its scope');
  assert.equal(responds('https://api.example.com/data'), false);
});

test('buildWeb rejects with the TypeScript error, then builds again once it is fixed', async () => {
  const good = fs.readFileSync(appTsx(), 'utf8');
  fs.writeFileSync(appTsx(), `${good}\nexport const broken: number = 'not a number';\n`);
  try {
    await assert.rejects(buildWeb({ dir, buildNumber: 8 }), (e) => {
      assert.match(e.message, /^Web build #8 failed\./);
      assert.match(e.message, /TypeScript errors \(1\):/);
      assert.match(e.message, /src\/App\.tsx\(\d+,\d+\): error TS2322/);
      assert.ok(e.logPath && fs.existsSync(e.logPath));
      return true;
    });
  } finally {
    fs.writeFileSync(appTsx(), good);
  }
  const again = await buildWeb({ dir, buildNumber: 8 });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(again.distDir, 'version.json'), 'utf8')), { build: 8 });
  built = again;
});

test('buildWeb rejects with the bundler error (a missing file)', async () => {
  const good = fs.readFileSync(appTsx(), 'utf8');
  fs.writeFileSync(appTsx(), `import './missing.css';\n${good}`);
  try {
    await assert.rejects(buildWeb({ dir, buildNumber: 9 }), /The web build failed \(vite build\):[\s\S]*Could not resolve '\.\/missing\.css'/);
  } finally {
    fs.writeFileSync(appTsx(), good);
  }
});

test('buildWeb and buildApk tell the presets apart', async () => {
  const { buildApk } = await import('../index.mjs');
  await assert.rejects(buildApk({ dir, buildNumber: 1 }), /a web app has no APK/);
  const other = path.join(ROOT, 'not-web');
  fs.mkdirSync(other, { recursive: true });
  await assert.rejects(buildWeb({ dir: other, buildNumber: 1 }), /is not a web app/);
  await assert.rejects(buildWeb({ dir, buildNumber: 0 }), /positive integer/);
});

test('addWebVersion: "Both" puts a web version in <app>/web and keeps it out of the Android checks', async () => {
  const app = path.join(ROOT, 'apps', 'both');
  fs.mkdirSync(app, { recursive: true });
  fs.writeFileSync(path.join(app, 'app.json'), JSON.stringify({ expo: { name: 'Both', slug: 'both', android: { package: 'com.anyapp.both' } } }));
  fs.writeFileSync(path.join(app, 'tsconfig.json'), JSON.stringify({ compilerOptions: {}, exclude: ['node_modules', 'android'] }));
  fs.writeFileSync(path.join(app, 'eslint.config.js'), "module.exports = [{ ignores: ['dist/*', 'node_modules/*'] }];\n");
  const { webDir } = await addWebVersion({ dir: app, name: 'Both', slug: 'both' });
  assert.equal(webDir, path.join(app, 'web'));
  assert.equal(presetOf(app), 'react-native');
  assert.equal(presetOf(webDir), 'web');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(webDir, 'anyapp.json'), 'utf8')), { preset: 'web', slug: 'both', package: 'com.anyapp.both', name: 'Both' });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(app, 'tsconfig.json'), 'utf8')).exclude, ['node_modules', 'android', 'web']);
  assert.match(fs.readFileSync(path.join(app, 'eslint.config.js'), 'utf8'), /ignores: \['web\/\*\*', 'dist/);
  await assert.rejects(addWebVersion({ dir: app, name: 'Both', slug: 'both' }), /already exists/);
  const r = await buildWeb({ dir: webDir, buildNumber: 3 });
  assert.ok(r.files.some((f) => f.path === 'sw.js'));
  assert.match(fs.readFileSync(path.join(r.distDir, 'sw.js'), 'utf8'), /const SLUG = "both";/);
});

test('renameApp and adoptApp handle a web app (no signing key)', async () => {
  const { adoptApp, renameApp } = await import('../index.mjs');
  const copy = path.join(ROOT, 'apps', 'copy');
  const r = await adoptApp({ src: dir, dir: copy, name: 'Copy', slug: 'copy', packageName: 'com.anyapp.copy' });
  assert.equal(r.preset, 'web');
  assert.equal(JSON.parse(fs.readFileSync(path.join(copy, 'anyapp.json'), 'utf8')).slug, 'copy');
  for (const gone of ['node_modules', 'dist', 'build']) assert.ok(!fs.existsSync(path.join(copy, gone)), gone);
  const renamed = await renameApp({ dir: copy, name: 'Copy Two', slug: 'copy-two', packageName: 'com.anyapp.copytwo' });
  assert.deepEqual(renamed, { preset: 'web', packageChanged: true });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(copy, 'anyapp.json'), 'utf8')), { preset: 'web', slug: 'copy-two', package: 'com.anyapp.copytwo', name: 'Copy Two' });
  assert.equal(JSON.parse(fs.readFileSync(path.join(copy, 'package.json'), 'utf8')).name, 'copy-two');
  assert.ok(!fs.existsSync(path.join(KEYSTORE_DIR, 'apps', 'com.anyapp.copytwo')), 'no key for a web app');
});

test('the template uses storage only through src/lib/storage.ts', () => {
  const src = path.join(dir, 'src');
  for (const f of listFiles(src)) {
    if (f === 'lib/storage.ts' || !/\.tsx?$/.test(f)) continue;
    assert.doesNotMatch(fs.readFileSync(path.join(src, f), 'utf8'), /\b(localStorage|sessionStorage|indexedDB|caches)\b/, f);
  }
  for (const f of listFiles(path.resolve(dir))) {
    if (f.startsWith('node_modules/') || !/\.(tsx?|css|html|md|json)$/.test(f)) continue;
    assert.ok(!fs.readFileSync(path.join(dir, f), 'utf8').includes(String.fromCharCode(0x2014)), `no em dash in ${f}`);
  }
});

// ---------------------------------------------------------------------------------------------
// In a real browser, served under a sub-path like GitHub Pages

const chromium = findChromium();
const skipBrowser = process.env.ANYAPP_SKIP_BROWSER_TESTS === '1' ? 'ANYAPP_SKIP_BROWSER_TESTS=1' : chromium ? false : 'no Chromium on this machine';

function serve(root, prefix) {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const rel = u.pathname.startsWith(`/${prefix}/`) ? decodeURIComponent(u.pathname.slice(prefix.length + 2)) || 'index.html' : null;
    const file = rel && path.join(root, rel);
    if (!file || !file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

test('in a browser: service worker, prefixed storage, Version N is ready, Reload, offline', { skip: skipBrowser, timeout: 120_000 }, async () => {
  const prefix = `anyapp-${SLUG}-web`;
  let server = await serve(built.distDir, prefix);
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}/${prefix}/`;
  const browser = await openBrowser({ bin: chromium });
  try {
    const page = await browser.page(url);
    await page.waitFor(`document.querySelector('footer')?.innerText.includes('Version 8')`);
    assert.equal(await page.eval('document.title'), NAME);
    await page.waitFor(`Object.keys(localStorage).length > 0`);
    assert.deepEqual(await page.eval('Object.keys(localStorage)'), [`${SLUG}:opens`]);
    assert.equal(await page.eval('navigator.serviceWorker.ready.then((r) => r.scope)'), url);
    await page.waitFor('!!navigator.serviceWorker.controller');
    assert.deepEqual(await page.eval('caches.keys()'), [`kiwi-${SLUG}-8`]);

    // A newer build goes online while the app is open; Kiwimake tells the page.
    built = await buildWeb({ dir, buildNumber: 10 });
    fs.writeFileSync(path.join(built.distDir, 'version.json'), JSON.stringify({ build: 10, changed: 'Plants now have photos.' }));
    await page.eval(`window.dispatchEvent(new Event('kiwimake:check-update')), true`);
    const card = await page.waitFor(`document.querySelector('.notice')?.innerText`);
    assert.match(card, /Version 10 is ready\s+Plants now have photos\.\s+Reload/);
    await page.eval(`[...document.querySelectorAll('.notice button')].find((b) => b.textContent === 'Reload').click(), true`);
    await page.waitFor(`document.querySelector('footer')?.innerText.includes('Version 10')`);
    await page.waitFor(`caches.keys().then((k) => k.length === 1 && k[0] === 'kiwi-${SLUG}-10')`);
    assert.match(await page.eval(`document.body.innerText`), /Opened 1 times/, 'saved data survives the new version');

    // Offline: the server is gone, the app still opens.
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    server = null;
    await page.send('Page.reload', {});
    await new Promise((r) => setTimeout(r, 500));
    await page.waitFor(`document.querySelector('footer')?.innerText.includes('Version 10')`);
    page.close();
  } finally {
    await browser.close();
    server?.closeAllConnections();
    server?.close();
  }
});
