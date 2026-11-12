// The Expo Exact preset (alpha): an app made with `exact new` from a pinned, locally patched Exact
// checkout (https://github.com/expo/exact). Exact apps refer to the checkout by the relative path
// `../../exact`, so the checkout lives beside the apps folder (C:\aa\exact for C:\aa\apps\<slug>).
//
// Android builds run Exact's own `scripts/agent-android.mjs build <app> --apk` (Rust for
// aarch64-linux-android, then Gradle), with the builder's init script added through
// EXACT_GRADLE_ARGS (shared signing key, versionCode = build number). See builder/exact/pin.json.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { BUILDER_DIR } from './env.mjs';
import { CommandError, run } from './exec.mjs';
import { withFileLock } from './lock.mjs';
import { KOTLIN_META } from './presets.mjs';

export const EXACT_PIN = JSON.parse(fs.readFileSync(path.join(BUILDER_DIR, 'exact', 'pin.json'), 'utf8'));
const PATCH = path.join(BUILDER_DIR, 'exact', EXACT_PIN.patch);
export const EXACT_TEMPLATE_DIR = process.env.ANYAPP_EXACT_TEMPLATE_DIR
  ? path.resolve(process.env.ANYAPP_EXACT_TEMPLATE_DIR)
  : path.resolve(BUILDER_DIR, '..', 'template-exact');

/** The Exact checkout: two folders above every app (`../../exact`). ANYAPP_EXACT_DIR overrides it. */
export function exactDirFor(appDir) {
  if (process.env.ANYAPP_EXACT_DIR) return path.resolve(process.env.ANYAPP_EXACT_DIR);
  return path.resolve(appDir, '..', '..', 'exact');
}

/** Bun at the version Exact pins (ANYAPP_BUN, else %USERPROFILE%\.bun-<version>, else bun on PATH). */
export function findBun() {
  const exe = process.platform === 'win32' ? 'bun.exe' : 'bun';
  const candidates = [
    process.env.ANYAPP_BUN,
    path.join(os.homedir(), `.bun-${EXACT_PIN.bun}`, 'bin', exe),
    path.join(os.homedir(), '.bun', 'bin', exe),
  ].filter(Boolean);
  for (const c of candidates) if (fs.existsSync(c)) return c;
  throw new Error(`Expo Exact needs Bun ${EXACT_PIN.bun}. Install it into %USERPROFILE%\.bun-${EXACT_PIN.bun} (https://bun.sh, next to any other Bun) or set ANYAPP_BUN.`);
}

function newestNdk(sdk) {
  const root = path.join(sdk, 'ndk');
  if (!fs.existsSync(root)) return null;
  const v = fs.readdirSync(root).filter((d) => /^\d/.test(d)).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0];
  return v ? path.join(root, v) : null;
}

/** The environment Exact's scripts need, on top of the builder's Android environment. */
export function exactEnv(base, { javaHome, sdk, exactDir }) {
  const bun = findBun();
  const pathKey = Object.keys(base).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
  const env = { ...base };
  const p = env[pathKey];
  delete env[pathKey];
  env.PATH = [path.dirname(bun), path.join(os.homedir(), '.cargo', 'bin'), p ?? ''].join(path.delimiter);
  const ndk = process.env.ANDROID_NDK_HOME || newestNdk(sdk);
  Object.assign(env, {
    JAVA_HOME: javaHome,
    ANDROID_HOME: sdk,
    ANDROID_SDK_ROOT: sdk,
    ...(ndk ? { ANDROID_NDK_HOME: ndk } : {}),
    BUN: bun,
    EXACT2: exactDir,
    // Nothing about the person's apps leaves this PC: Exact's feedback notes stay off.
    EXACT_FEEDBACK: '0',
  });
  delete env.ANDROID_SERIAL; // the builder never installs; it only builds the APK
  return { env, bun };
}

async function git(args, cwd, opts = {}) {
  return run('git', args, { cwd, ...opts });
}

/**
 * Makes sure the Exact checkout is at the pinned commit with the Windows patch applied, and (when
 * `setup`) that `exact setup` ran once for it. Never moves or resets a checkout it did not make.
 */
export async function ensureExact(appDir, log = () => {}, { setup = true, env = process.env } = {}) {
  const dir = exactDirFor(appDir);
  await fsp.mkdir(path.dirname(dir), { recursive: true });
  return withFileLock(`${dir}.anyapp.lock`, async () => {
    if (!fs.existsSync(path.join(dir, '.git'))) {
      log(`Getting Expo Exact (${EXACT_PIN.commit.slice(0, 8)}) into ${dir}, once…`);
      // LF line endings on every machine (expo/exact#147): a CRLF checkout fails its build scripts.
      await git(['-c', 'core.autocrlf=false', 'clone', '--no-checkout', EXACT_PIN.repo, dir], path.dirname(dir));
      await git(['config', 'core.autocrlf', 'false'], dir);
      await git(['-c', 'advice.detachedHead=false', 'checkout', EXACT_PIN.commit], dir);
    }
    const head = (await git(['rev-parse', 'HEAD'], dir)).lines.join('').trim();
    if (head !== EXACT_PIN.commit) {
      throw new Error(`${dir} is at Exact ${head.slice(0, 8)}, not the pinned ${EXACT_PIN.commit.slice(0, 8)} (builder/exact/pin.json). Move it away or check out the pin.`);
    }
    const applied = await git(['apply', '--check', '--reverse', PATCH], dir).then(() => true, () => false);
    if (!applied) {
      try {
        await git(['apply', PATCH], dir);
        log('Applied the Windows patch to Expo Exact (builder/exact/windows.patch).');
      } catch (e) {
        throw new Error(`Could not apply builder/exact/windows.patch to ${dir}: ${(e.lines ?? []).slice(-5).join(' ')}`);
      }
    }
    const marker = path.join(dir, `.anyapp-setup-${EXACT_PIN.commit.slice(0, 12)}`);
    if (setup && !fs.existsSync(marker)) {
      log('Setting up Expo Exact once (Rust toolchains, Hermes for Android; about 7 minutes)…');
      const bun = findBun();
      try {
        await run(bun, [path.join(dir, 'scripts', 'exact.mjs'), 'setup'], { cwd: dir, env, onLine: log });
      } catch (e) {
        // `setup` also checks things only web builds need (a Chrome revision) and exits 1 for them;
        // a real gap for Android shows up as a build error with its own message.
        log(`exact setup ended with exit ${e.code}; continuing (an Android build names anything still missing).`);
      }
      await fsp.writeFile(marker, new Date().toISOString());
    }
    return dir;
  }, { staleMs: 60 * 60_000, timeoutMs: 60 * 60_000 });
}

/** Makes an Exact app with `exact new` (Android named in its app.json), plus Kiwimake's files. */
export async function createExactApp(dir, { name, slug, packageName }, log = () => {}) {
  const exactDir = await ensureExact(dir, log, { setup: false });
  const bun = findBun();
  if (fs.existsSync(dir)) await fsp.rmdir(dir); // createApp only allows an empty dir
  try {
    await run(bun, [path.join(exactDir, 'scripts', 'exact.mjs'), 'new', dir, '--with', 'android', '--name', name, '--bundle-id', packageName], {
      cwd: path.dirname(dir),
      env: { ...process.env, BUN: bun, EXACT2: exactDir, EXACT_FEEDBACK: '0' },
    });
  } catch (e) {
    throw new Error(`exact new failed: ${(e.lines ?? []).slice(-8).join('\n')}`);
  }
  // Kiwimake's part: the preset marker, the app agent's instructions, a git-ignored build/.
  await fsp.writeFile(path.join(dir, KOTLIN_META), JSON.stringify({ preset: 'expo-exact', slug, package: packageName }, null, 2) + '\n');
  const ours = await fsp.readFile(path.join(EXACT_TEMPLATE_DIR, 'AGENTS.md'), 'utf8');
  const agentsPath = path.join(dir, 'AGENTS.md');
  const theirs = fs.existsSync(agentsPath) ? await fsp.readFile(agentsPath, 'utf8') : '';
  await fsp.rm(agentsPath, { force: true });
  await fsp.writeFile(agentsPath, `${ours.trimEnd()}\n\n${theirs}`);
  // exact new links CLAUDE.md to AGENTS.md; a plain file works everywhere (and in Git on Windows).
  await fsp.rm(path.join(dir, 'CLAUDE.md'), { force: true });
  await fsp.writeFile(path.join(dir, 'CLAUDE.md'), '@AGENTS.md\n');
  const gi = path.join(dir, '.gitignore');
  const ignore = fs.existsSync(gi) ? await fsp.readFile(gi, 'utf8') : '';
  if (!/^\/build\/$/m.test(ignore)) await fsp.writeFile(gi, `${ignore.trimEnd()}\n/build/\n`);
  log(`Created the Expo Exact app ${packageName} in ${dir}.`);
}

/** Lines of a failed Exact build that an agent needs: Rust and Contract errors, Gradle's "What went wrong". */
export function extractExactError(lines) {
  const keep = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^error(\[E\d+\])?:|panicked at|^\s*--> |EXACT_[A-Z_]+|^e: |What went wrong|could not start Gradle|^contract: |\.contract:\d+/.test(l)) {
      keep.push(...lines.slice(i, i + 4));
      i += 3;
    }
    if (keep.length > 60) break;
  }
  return keep.length ? [...new Set(keep)].join('\n') : null;
}

/** Runs Exact's Android build for the app. Resolves with the APK path; rejects with CommandError. */
export async function runExactAndroidBuild(dir, { env, bun, exactDir, extraGradleArgs, stream, handle }) {
  const result = await run(bun, [path.join(exactDir, 'scripts', 'agent-android.mjs'), 'build', dir, '--apk'], {
    cwd: dir,
    env: { ...env, EXACT_GRADLE_ARGS: extraGradleArgs.join(' ') },
    handle,
    ...stream,
  });
  const printed = [...result.lines].reverse().map((l) => l.trim()).find((l) => /\.apk$/i.test(l) && fs.existsSync(l));
  const standard = path.join(dir, 'target', 'android', 'app', 'outputs', 'apk', 'release', 'app-release.apk');
  const apk = printed ?? (fs.existsSync(standard) ? standard : null);
  if (!apk) throw new CommandError('Exact finished but printed no APK', { code: 0, lines: result.lines });
  return apk;
}
