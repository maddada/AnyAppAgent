// The template, its installed dependencies (cached once per lockfile), and making a full app tree.
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

import { BUILDER_VERSION, CACHE_DIR, TEMPLATE_DIR } from './env.mjs';
import { npmCommand, run } from './exec.mjs';
import { withFileLock } from './lock.mjs';

/** Folders of the template that are never copied (generated or installed). */
const SKIP = new Set(['node_modules', 'build', 'android', 'ios', '.expo', 'dist', '.git']);

export const DEPS_STAMP = path.join('node_modules', '.anyapp-deps');

function listTemplateFiles(root = TEMPLATE_DIR, rel = '') {
  const out = [];
  for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
    if (SKIP.has(e.name) && rel === '') continue;
    const r = path.join(rel, e.name);
    if (e.isDirectory()) out.push(...listTemplateFiles(root, r));
    else if (e.isFile()) out.push(r);
  }
  return out.sort();
}

/** Changes whenever any template source file (not node_modules) or the builder changes. */
export function templateHash() {
  const h = crypto.createHash('sha256').update(`builder:${BUILDER_VERSION}\n`);
  for (const f of listTemplateFiles()) {
    h.update(f.replace(/\\/g, '/') + '\n');
    h.update(fs.readFileSync(path.join(TEMPLATE_DIR, f)));
  }
  return h.digest('hex').slice(0, 16);
}

/** Changes whenever the app's dependencies change (package.json deps or the lockfile). */
export function depsHash(dir) {
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const h = crypto.createHash('sha256');
  h.update(JSON.stringify([pkg.dependencies ?? {}, pkg.devDependencies ?? {}, pkg.overrides ?? {}]));
  const lockPath = path.join(dir, 'package-lock.json');
  if (fs.existsSync(lockPath)) {
    // Ignore the root package's own name/version (createApp rewrites them per app).
    const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    const { name: _n, version: _v, ...rest } = lock;
    const packages = { ...(rest.packages ?? {}) };
    if (packages['']) {
      const { name: _rn, version: _rv, ...root } = packages[''];
      packages[''] = root;
    }
    h.update(JSON.stringify({ ...rest, packages }));
  }
  return h.digest('hex').slice(0, 16);
}

/**
 * node_modules for the template's lockfile, installed once with `npm ci` into
 * %USERPROFILE%\.anyappagent\cache\deps-<hash> and reused for every new app.
 */
export async function ensureDepsCache(log = () => {}) {
  const hash = depsHash(TEMPLATE_DIR);
  const dir = path.join(CACHE_DIR, `deps-${hash}`);
  const ready = path.join(dir, '.ready');
  if (fs.existsSync(ready)) return { dir, hash };
  await fsp.mkdir(CACHE_DIR, { recursive: true });
  return withFileLock(path.join(CACHE_DIR, `deps-${hash}.lock`), async () => {
    if (fs.existsSync(ready)) return { dir, hash };
    const tmp = `${dir}.tmp-${process.pid}`;
    await fsp.rm(tmp, { recursive: true, force: true });
    await fsp.mkdir(tmp, { recursive: true });
    for (const f of ['package.json', 'package-lock.json']) {
      if (fs.existsSync(path.join(TEMPLATE_DIR, f))) await fsp.copyFile(path.join(TEMPLATE_DIR, f), path.join(tmp, f));
    }
    log(`Installing template dependencies into ${dir} (once per lockfile)…`);
    const npm = npmCommand();
    const hasLock = fs.existsSync(path.join(tmp, 'package-lock.json'));
    await run(npm.cmd, [...npm.pre, hasLock ? 'ci' : 'install', '--no-audit', '--no-fund', '--loglevel=error'], {
      cwd: tmp,
      shell: npm.shell,
      onLine: (l) => log(l),
    });
    await fsp.writeFile(path.join(tmp, '.ready'), new Date().toISOString());
    await fsp.rm(dir, { recursive: true, force: true });
    await fsp.rename(tmp, dir);
    return { dir, hash };
  }, { staleMs: 15 * 60_000 });
}

/** Copies a directory tree with robocopy (Windows) or fs.cp. */
export async function copyTree(src, dest) {
  if (process.platform === 'win32') {
    try {
      await run('robocopy', [src, dest, '/E', '/MT:32', '/NFL', '/NDL', '/NJH', '/NJS', '/NP', '/R:2', '/W:1']);
    } catch (e) {
      // robocopy exit codes 0-7 mean success (1 = files copied).
      if (!(typeof e.code === 'number' && e.code < 8)) throw e;
    }
    return;
  }
  await fsp.cp(src, dest, { recursive: true, verbatimSymlinks: true });
}

/** Writes a complete, installed app tree (template sources + node_modules) into dest. */
export async function makeAppTree(dest, log = () => {}) {
  const deps = await ensureDepsCache(log);
  await fsp.mkdir(dest, { recursive: true });
  for (const f of listTemplateFiles()) {
    const to = path.join(dest, f);
    await fsp.mkdir(path.dirname(to), { recursive: true });
    await fsp.copyFile(path.join(TEMPLATE_DIR, f), to);
  }
  await copyTree(path.join(deps.dir, 'node_modules'), path.join(dest, 'node_modules'));
  await fsp.writeFile(path.join(dest, DEPS_STAMP), deps.hash);
}
