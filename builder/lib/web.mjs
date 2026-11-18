// Web apps (preset "web", template-web/): making one, adding a web version to an Android app
// ("Both": <app>/web), and building the static site the PC publishes (docs/WEB-APPS.md).
//
//   createWebApp({ dir, name, slug, packageName, onLog })   (createApp calls it for preset "web")
//   addWebVersion({ dir, name, slug, onLog }) -> { webDir }
//   buildWeb({ dir, buildNumber, onLog }) -> { distDir, files: [{ path, size, sha256 }], sizeBytes, ... }
//
// The built site in <dir>/dist: Vite's files (relative paths, no source maps), icon-192.png and
// icon-512.png from assets/icon.png, manifest.webmanifest, version.json ({"build": N}) and sw.js
// (cache kiwi-<slug>-<build>, precaches every file of the build).
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

import { cap, extractNpm, extractTsc, tail } from './errors.mjs';
import { CommandError, killTree, npmCommand, run } from './exec.mjs';
import { renameWithRetry, tryLock } from './lock.mjs';
import { decodePng, encodePng, resizeSquare } from './png.mjs';
import { KOTLIN_META, WEB_TEMPLATE_DIR, presetOf, readAppMeta } from './presets.mjs';
import { DEPS_STAMP, depsHash, makeAppTree } from './template.mjs';

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;
const WEB_ICON = path.join('assets', 'icon.png');
const DEFAULT_THEME = '#F3EFE7';
/** Files the builder or the PC write into dist/ that the service worker never precaches. */
const NOT_PRECACHED = new Set(['sw.js', 'version.json', '.nojekyll']);
const noop = () => {};

class BuildError extends Error {}

// ---------------------------------------------------------------------------------------------
// Making a web app

/** Writes the app's name, slug and package id into a web project (anyapp.json, package.json, lockfile). */
export async function fillWebPlaceholders(dir, { name, slug, packageName }) {
  const metaPath = path.join(dir, KOTLIN_META);
  let meta = {};
  try {
    meta = JSON.parse(await fsp.readFile(metaPath, 'utf8'));
  } catch {
    /* new app */
  }
  meta = { ...meta, preset: 'web', slug, ...(packageName ? { package: packageName } : {}), name };
  await fsp.writeFile(metaPath, JSON.stringify(meta, null, 2) + '\n');

  const pkgPath = path.join(dir, 'package.json');
  const pkg = JSON.parse(await fsp.readFile(pkgPath, 'utf8'));
  pkg.name = slug;
  await fsp.writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

  const lockPath = path.join(dir, 'package-lock.json');
  if (fs.existsSync(lockPath)) {
    const lock = JSON.parse(await fsp.readFile(lockPath, 'utf8'));
    lock.name = slug;
    if (lock.packages?.['']) lock.packages[''].name = slug;
    await fsp.writeFile(lockPath, JSON.stringify(lock, null, 2) + '\n');
  }
}

/** template-web (with node_modules from the deps cache) into dest, filled in. dest must not exist. */
async function makeWebTree(dest, fields, onLog) {
  const tmp = `${dest}.tmp-${process.pid}`;
  await fsp.rm(tmp, { recursive: true, force: true });
  try {
    await makeAppTree(tmp, onLog, 'web');
    await fillWebPlaceholders(tmp, fields);
    if (fs.existsSync(dest)) await fsp.rmdir(dest);
    await renameWithRetry(tmp, dest);
  } catch (e) {
    await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
    throw e;
  }
}

/** createApp for preset "web" (createApp has checked the arguments). No signing key: no APK. */
export async function createWebApp({ dir, name, slug, packageName, onLog = noop }) {
  const t0 = Date.now();
  await makeWebTree(dir, { name, slug, packageName }, onLog);
  onLog(`Created ${dir} from the web template (${((Date.now() - t0) / 1000).toFixed(1)}s).`);
}

/**
 * "Both": a web version of an Android app, made from template-web into <dir>/web. The Android
 * project's TypeScript check and lint are told to leave web/ alone. Refuses when web/ exists.
 */
export async function addWebVersion({ dir, name, slug, onLog = noop }) {
  if (!dir || !path.isAbsolute(dir)) throw new Error('addWebVersion: dir must be an absolute path');
  if (!name || !String(name).trim()) throw new Error('addWebVersion: name is required');
  if (!SLUG_RE.test(slug ?? '')) throw new Error(`addWebVersion: slug "${slug}" must be lowercase letters, digits and dashes`);
  dir = path.resolve(dir);
  if (!fs.existsSync(dir)) throw new Error(`addWebVersion: ${dir} does not exist`);
  const preset = presetOf(dir);
  if (preset === 'web') throw new Error('addWebVersion: this is already a web app');
  const webDir = path.join(dir, 'web');
  if (fs.existsSync(webDir)) throw new Error(`addWebVersion: ${webDir} already exists`);
  const t0 = Date.now();
  await makeWebTree(webDir, { name: String(name).trim(), slug, packageName: packageOf(dir) }, onLog);
  await keepRootOffWeb(dir, onLog);
  onLog(`Added a web version in ${webDir} (${((Date.now() - t0) / 1000).toFixed(1)}s).`);
  return { webDir };
}

function packageOf(dir) {
  const meta = readAppMeta(dir);
  if (meta?.package) return meta.package;
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'app.json'), 'utf8')).expo?.android?.package;
  } catch {
    return undefined;
  }
}

/** A React Native project would type-check and lint web/ as its own code: exclude it. */
async function keepRootOffWeb(dir, onLog) {
  const tsconfig = path.join(dir, 'tsconfig.json');
  if (fs.existsSync(tsconfig)) {
    try {
      const json = JSON.parse(await fsp.readFile(tsconfig, 'utf8'));
      const exclude = Array.isArray(json.exclude) ? json.exclude : ['node_modules'];
      if (!exclude.includes('web')) {
        json.exclude = [...exclude, 'web'];
        await fsp.writeFile(tsconfig, JSON.stringify(json, null, 2) + '\n');
      }
    } catch {
      onLog('Note: tsconfig.json could not be read; add "web" to its "exclude" by hand.');
    }
  }
  const eslint = path.join(dir, 'eslint.config.js');
  if (fs.existsSync(eslint)) {
    const text = await fsp.readFile(eslint, 'utf8');
    if (!text.includes("'web/") && /ignores:\s*\[/.test(text)) {
      await fsp.writeFile(eslint, text.replace(/ignores:\s*\[/, (m) => `${m}'web/**', `));
    }
  }
}

/** A web app's icon (assets/icon.png), or null. */
export function webIconPath(dir) {
  const p = path.resolve(dir, WEB_ICON);
  return fs.existsSync(p) ? p : null;
}

// ---------------------------------------------------------------------------------------------
// buildWeb

const building = new Set();

/**
 * Builds the web project in `dir` into <dir>/dist: npm install when its dependencies changed, the
 * TypeScript check and `vite build` (in parallel), then source maps removed, icons, manifest,
 * version.json and sw.js. Rejects with an Error whose message is what an agent needs to fix it
 * (err.logPath: the full log).
 */
export async function buildWeb({ dir, buildNumber, onLog = noop }) {
  if (!dir || !path.isAbsolute(dir)) throw new Error('buildWeb: dir must be an absolute path');
  dir = path.resolve(dir);
  const n = Number(buildNumber);
  if (!Number.isInteger(n) || n < 1 || n > 2_100_000_000) throw new Error('buildWeb: buildNumber must be a positive integer');
  if (presetOf(dir) !== 'web') throw new Error(`buildWeb: ${dir} is not a web app (no anyapp.json with "preset": "web")`);
  const key = dir.toLowerCase();
  if (building.has(key)) throw new Error(`buildWeb: a build of ${dir} is already running`);
  await fsp.mkdir(path.join(dir, 'build', 'logs'), { recursive: true });
  const release = await tryLock(path.join(dir, 'build', '.web-build.lock'), { staleMs: 15 * 60_000 });
  if (!release) throw new Error(`buildWeb: a build of ${dir} is already running (build/.web-build.lock)`);
  building.add(key);
  try {
    return await runWebBuild(dir, n, onLog);
  } finally {
    building.delete(key);
    await release();
  }
}

async function runWebBuild(dir, n, onLog) {
  const t0 = Date.now();
  const logFile = path.join(dir, 'build', 'logs', `web-${n}.log`);
  const logStream = fs.createWriteStream(logFile);
  const timings = {};
  const say = (m) => {
    logStream.write(`[builder] ${m}\n`);
    onLog(m);
  };
  const phase = async (name, fn) => {
    const s = Date.now();
    try {
      return await fn();
    } finally {
      timings[name] = Date.now() - s;
    }
  };
  try {
    const meta = readAppMeta(dir);
    const slug = meta.slug;
    if (!SLUG_RE.test(slug ?? '')) throw new BuildError(`anyapp.json has no valid "slug" (got ${JSON.stringify(slug)}). Put it back.`);
    const name = String(meta.name ?? '').trim() || slug;
    say(`Building the web app ${slug} #${n} in ${dir}`);
    const env = { ...process.env, VITE_KIWI_BUILD: String(n), VITE_KIWI_SLUG: slug, VITE_KIWI_NAME: name, NO_COLOR: '1', FORCE_COLOR: '0' };

    // 1. Dependencies: (re)install only when package.json or the lockfile changed.
    await phase('install', async () => {
      const want = depsHash(dir);
      const stamp = path.join(dir, DEPS_STAMP);
      const have = fs.existsSync(stamp) ? fs.readFileSync(stamp, 'utf8').trim() : null;
      if (have === want && fs.existsSync(path.join(dir, 'node_modules', 'vite'))) return;
      say('Dependencies changed: running npm install...');
      const npm = npmCommand();
      try {
        await run(npm.cmd, [...npm.pre, 'install', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: dir, env, shell: npm.shell, logStream, onLine: (l) => onLog(l) });
      } catch (e) {
        throw new BuildError(extractNpm(e.lines ?? []) ?? `npm install failed:\n${tail(e.lines ?? [])}`);
      }
      await fsp.writeFile(stamp, depsHash(dir));
    });

    // 2. The TypeScript check and vite build side by side; a type error wins (it says more).
    const tscBin = path.join(dir, 'node_modules', 'typescript', 'bin', 'tsc');
    const viteBin = path.join(dir, 'node_modules', 'vite', 'bin', 'vite.js');
    if (!fs.existsSync(viteBin)) throw new BuildError('vite is not installed: keep "vite" in package.json devDependencies.');
    const distDir = path.join(dir, 'dist');
    const viteHandle = {};
    const tsc = fs.existsSync(tscBin) && fs.existsSync(path.join(dir, 'tsconfig.json'))
      ? phase('typecheck', () =>
          run(process.execPath, [tscBin, '--noEmit', '-p', dir], { cwd: dir, env, logStream }).then(
            () => null,
            (e) => extractTsc(e.lines ?? []) ?? `Type check failed:\n${tail(e.lines ?? [])}`,
          ),
        )
      : Promise.resolve(null);
    tsc.then((err) => {
      if (err && viteHandle.child) {
        viteHandle.cancelled = true;
        killTree(viteHandle.child);
      }
    });
    const vite = phase('vite', () =>
      run(process.execPath, [viteBin, 'build', '--base', './', '--sourcemap', 'false', '--outDir', 'dist', '--emptyOutDir'], {
        cwd: dir,
        env,
        logStream,
        handle: viteHandle,
        onLine: (l) => onLog(l),
      }).then(
        () => null,
        (e) => (viteHandle.cancelled ? 'cancelled' : extractVite(e.lines ?? [])),
      ),
    );
    const [tscErr, viteErr] = await Promise.all([tsc, vite]);
    if (tscErr) throw new BuildError(tscErr);
    if (viteErr) throw new BuildError(viteErr);
    if (!fs.existsSync(path.join(distDir, 'index.html'))) throw new BuildError('vite build made no dist/index.html. Keep index.html at the project root.');

    // 3. What the site needs around Vite's files.
    await phase('site', async () => {
      await removeSourceMaps(distDir);
      const html = await ensureManifestLink(path.join(distDir, 'index.html'));
      await writeIcons(dir, distDir, say);
      const theme = themeColor(html);
      const manifest = {
        name,
        short_name: name,
        id: './',
        start_url: './',
        scope: './',
        display: 'standalone',
        theme_color: theme,
        background_color: theme,
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      };
      await fsp.writeFile(path.join(distDir, 'manifest.webmanifest'), JSON.stringify(manifest, null, 2) + '\n');
      await fsp.writeFile(path.join(distDir, 'version.json'), JSON.stringify({ build: n }) + '\n');
      const precache = (await listFiles(distDir)).filter((f) => !NOT_PRECACHED.has(f));
      await fsp.writeFile(path.join(distDir, 'sw.js'), serviceWorker({ slug, build: n, name, files: precache }));
    });

    const files = [];
    for (const rel of await listFiles(distDir)) {
      const buf = await fsp.readFile(path.join(distDir, rel));
      files.push({ path: rel, size: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex') });
    }
    const sizeBytes = files.reduce((s, f) => s + f.size, 0);
    const durationMs = Date.now() - t0;
    say(`Web build #${n} ready: ${files.length} files, ${(sizeBytes / 1024).toFixed(0)} KB in ${(durationMs / 1000).toFixed(1)}s (${distDir})`);
    return { distDir, files, sizeBytes, build: n, slug, durationMs, timings, logPath: logFile };
  } catch (e) {
    const msg = e instanceof BuildError ? e.message : e instanceof CommandError ? `${e.message}\n${tail(e.lines)}` : e.message;
    logStream.write(`[builder] FAILED: ${msg}\n`);
    const err = new Error(`Web build #${n} failed.\n${msg}\n(Full log: ${logFile})`);
    err.logPath = logFile;
    throw err;
  } finally {
    await new Promise((r) => logStream.end(r));
  }
}

/** The useful part of a failed `vite build`: the error and its code frame, without stack frames. */
export function extractVite(lines) {
  const start = lines.findIndex((l) => /error during build|Build failed|\[vite\]|\[plugin |RolldownError|^Error:|error TS|\bERROR\b|SyntaxError|Could not resolve|failed to resolve/i.test(l));
  const from = start >= 0 ? start : Math.max(0, lines.length - 30);
  const out = lines
    .slice(from)
    .filter(
      (l) =>
        l.trim() &&
        !/^\s+at /.test(l) &&
        !/^(vite v|transforming|rendering chunks|computing gzip|✗ Build failed in|errors: \[|\}$)/.test(l.trim()),
    );
  return `The web build failed (vite build):\n${cap(out, 40)}`;
}

/** Every file under dir, relative, with "/" separators, sorted. */
async function listFiles(dir, rel = '') {
  const out = [];
  for (const e of await fsp.readdir(path.join(dir, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...(await listFiles(dir, r)));
    else if (e.isFile()) out.push(r);
  }
  return out.sort();
}

/** No *.map files and no sourceMappingURL comments: the published site never carries the source. */
async function removeSourceMaps(distDir) {
  for (const rel of await listFiles(distDir)) {
    const p = path.join(distDir, rel);
    if (/\.map$/i.test(rel)) {
      await fsp.rm(p, { force: true });
      continue;
    }
    if (!/\.(m?js|cjs|css|html?)$/i.test(rel)) continue;
    const text = await fsp.readFile(p, 'utf8');
    const clean = text
      .replace(/[ \t]*\/\/[#@]\s*sourceMappingURL=[^\r\n]*/g, '')
      .replace(/\/\*[#@]\s*sourceMappingURL=[\s\S]*?\*\//g, '');
    if (clean !== text) await fsp.writeFile(p, clean);
  }
}

/** Adds <link rel="manifest"> when the page lost it. Returns the page. */
async function ensureManifestLink(indexPath) {
  let html = await fsp.readFile(indexPath, 'utf8');
  if (!/<link[^>]+rel=["']?manifest/i.test(html) && /<\/head>/i.test(html)) {
    html = html.replace(/<\/head>/i, '  <link rel="manifest" href="manifest.webmanifest" />\n  </head>');
    await fsp.writeFile(indexPath, html);
  }
  return html;
}

/** The page's <meta name="theme-color" content="...">, or the default. */
function themeColor(html) {
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    if (!/name=["']theme-color["']/i.test(m[0])) continue;
    const c = /content=["']([^"']{1,40})["']/i.exec(m[0])?.[1]?.trim();
    if (c && /^(#[0-9a-f]{3,8}|[a-z]+|(rgb|hsl)a?\([\d\s.,%/-]+\))$/i.test(c)) return c;
  }
  return DEFAULT_THEME;
}

/** icon-192.png and icon-512.png from assets/icon.png (the template's when the app has none). */
async function writeIcons(dir, distDir, say) {
  let src = webIconPath(dir);
  if (!src) {
    say('No assets/icon.png: using the default icon.');
    src = path.join(WEB_TEMPLATE_DIR, WEB_ICON);
  }
  let image;
  try {
    image = decodePng(await fsp.readFile(src));
  } catch (e) {
    throw new BuildError(`assets/icon.png could not be used: ${e.message}. Make it a 1024x1024, 8-bit, non-interlaced PNG (npm run icon).`);
  }
  for (const size of [192, 512]) {
    await fsp.writeFile(path.join(distDir, `icon-${size}.png`), encodePng(resizeSquare(image, size)));
  }
}

/** The service worker (contract: docs/WEB-APPS.md and shared/protocol.ts, "Web apps"). */
export function serviceWorker({ slug, build, name, files }) {
  const safeName = String(name).replace(/[\r\n*/]/g, ' ');
  return `// The service worker of ${safeName}, build ${build}. Made by Kiwimake's builder on every build: never edit it.
const SLUG = ${JSON.stringify(slug)};
const BUILD = ${JSON.stringify(build)};
const PREFIX = 'kiwi-' + SLUG + '-';
const CACHE = PREFIX + BUILD;
const FILES = ${JSON.stringify(files, null, 2)};
const SCOPE = self.registration.scope;
const full = (p) => new URL(p, SCOPE).href;
const PRECACHED = new Set(FILES.map(full));
const INDEX = full('index.html');
const VERSION = full('version.json');

self.addEventListener('install', (event) => {
  // Waits (no skipWaiting) until the page asks: the "Version N is ready" card's Reload.
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES.map((p) => new Request(full(p), { cache: 'reload' })))));
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Only this app's older caches: the person's other apps share this origin and have their own.
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE && n.startsWith(PREFIX) && /^\\d+$/.test(n.slice(PREFIX.length))).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || !req.url.startsWith(SCOPE)) return;
  const url = new URL(req.url);
  const clean = url.origin + url.pathname;
  if (clean === VERSION) return; // always the network
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.open(CACHE).then((cache) => cache.match(INDEX)).then((res) => res || Response.error())),
    );
    return;
  }
  if (PRECACHED.has(clean)) {
    event.respondWith(caches.open(CACHE).then((cache) => cache.match(clean)).then((res) => res || fetch(req)));
  }
});
`;
}
