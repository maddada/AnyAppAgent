// AnyAppAgent builder: makes apps from the template and builds their signed release APKs.
// Contract (docs/SPEC.md):
//   createApp({ dir, name, slug, packageName, onLog? }) -> Promise<void>
//   buildApk({ dir, buildNumber, onLog? }) -> Promise<{ apkPath, sizeBytes, sha256, ... }>
//   getIconPath({ dir }) -> string | null
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

import { ABIS, BUILDER_DIR, BUILDER_VERSION, androidEnv, findBuildTool, tool } from './lib/env.mjs';
import { extractGradle, extractMetro, extractNpm, extractPrebuild, extractTsc, tail } from './lib/errors.mjs';
import { CommandError, killTree, npmCommand, run } from './lib/exec.mjs';
import { ensureKeystore } from './lib/keystore.mjs';
import { tryLock } from './lib/lock.mjs';
import { claimSpare, refillSparesInBackground } from './lib/spare.mjs';
import { DEPS_STAMP, depsHash, makeAppTree, templateHash } from './lib/template.mjs';

const PACKAGE_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;
const PREBUILD_STAMP = path.join('android', '.anyapp-prebuild');
const KEEP_APKS = 5;

const noop = () => {};

// ---------------------------------------------------------------------------------------------
// createApp

export async function createApp({ dir, name, slug, packageName, onLog = noop }) {
  if (!dir || !path.isAbsolute(dir)) throw new Error('createApp: dir must be an absolute path');
  if (!name || !String(name).trim()) throw new Error('createApp: name is required');
  if (!SLUG_RE.test(slug ?? '')) throw new Error(`createApp: slug "${slug}" must be lowercase letters, digits and dashes`);
  if (!PACKAGE_RE.test(packageName ?? '')) {
    throw new Error(`createApp: packageName "${packageName}" is not a valid Android package id (e.g. com.anyapp.${slug.replace(/-/g, '')})`);
  }
  dir = path.resolve(dir);
  if (fs.existsSync(dir) && fs.readdirSync(dir).length > 0) throw new Error(`createApp: ${dir} already exists and is not empty`);
  await fsp.mkdir(path.dirname(dir), { recursive: true });

  const t0 = Date.now();
  const hash = templateHash();
  let how = 'spare';
  if (!(await claimSpare(dir, hash))) {
    how = 'copy';
    onLog('No ready spare app folder; copying the template (about 20 s)…');
    const tmp = `${dir}.tmp-${process.pid}`;
    await fsp.rm(tmp, { recursive: true, force: true });
    await makeAppTree(tmp, onLog);
    if (fs.existsSync(dir)) await fsp.rmdir(dir);
    await fsp.rename(tmp, dir);
  }
  await fillPlaceholders(dir, { name: String(name).trim(), slug, packageName });
  onLog(`Created ${dir} from the template (${how}, ${((Date.now() - t0) / 1000).toFixed(1)}s).`);
  refillSparesInBackground(dir);
}

async function fillPlaceholders(dir, { name, slug, packageName }) {
  const appJsonPath = path.join(dir, 'app.json');
  const appJson = JSON.parse(await fsp.readFile(appJsonPath, 'utf8'));
  appJson.expo.name = name;
  appJson.expo.slug = slug;
  appJson.expo.android = { ...appJson.expo.android, package: packageName };
  await fsp.writeFile(appJsonPath, JSON.stringify(appJson, null, 2) + '\n');

  const pkgPath = path.join(dir, 'package.json');
  const pkg = JSON.parse(await fsp.readFile(pkgPath, 'utf8'));
  pkg.name = slug;
  await fsp.writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

  for (const f of ['package-lock.json']) {
    const p = path.join(dir, f);
    if (!fs.existsSync(p)) continue;
    const lock = JSON.parse(await fsp.readFile(p, 'utf8'));
    lock.name = slug;
    if (lock.packages?.['']) lock.packages[''].name = slug;
    await fsp.writeFile(p, JSON.stringify(lock, null, 2) + '\n');
  }
}

// ---------------------------------------------------------------------------------------------
// getIconPath

export function getIconPath({ dir }) {
  try {
    const appJson = JSON.parse(fs.readFileSync(path.join(dir, 'app.json'), 'utf8'));
    const rel = appJson.expo?.icon ?? './assets/icon.png';
    const p = path.resolve(dir, rel);
    return fs.existsSync(p) ? p : null;
  } catch {
    const p = path.join(dir, 'assets', 'icon.png');
    return fs.existsSync(p) ? path.resolve(p) : null;
  }
}

// ---------------------------------------------------------------------------------------------
// buildApk

class BuildError extends Error {}

const building = new Map();

export async function buildApk({ dir, buildNumber, onLog = noop }) {
  if (!dir || !path.isAbsolute(dir)) throw new Error('buildApk: dir must be an absolute path');
  dir = path.resolve(dir);
  const n = Number(buildNumber);
  if (!Number.isInteger(n) || n < 1 || n > 2_100_000_000) throw new Error('buildApk: buildNumber must be a positive integer');
  if (!fs.existsSync(path.join(dir, 'app.json'))) throw new Error(`buildApk: ${dir} has no app.json`);

  const key = dir.toLowerCase();
  if (building.has(key)) throw new Error(`buildApk: a build of ${dir} is already running`);
  await fsp.mkdir(path.join(dir, 'build', 'logs'), { recursive: true });
  const release = await tryLock(path.join(dir, 'build', '.build.lock'), { staleMs: 30 * 60_000 });
  if (!release) throw new Error(`buildApk: a build of ${dir} is already running (build/.build.lock)`);
  const job = runBuild(dir, n, onLog);
  building.set(key, job);
  try {
    return await job;
  } finally {
    building.delete(key);
    await release();
  }
}

async function runBuild(dir, n, onLog) {
  const t0 = Date.now();
  const logFile = path.join(dir, 'build', 'logs', `build-${n}.log`);
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
  const stream = { logStream, onLine: (l) => onLog(l) };

  try {
    const { env, javaHome, sdk } = androidEnv();
    const keystore = await ensureKeystore(javaHome, say);
    const appJson = JSON.parse(await fsp.readFile(path.join(dir, 'app.json'), 'utf8'));
    const slug = appJson.expo?.slug ?? path.basename(dir);
    const packageName = appJson.expo?.android?.package;
    say(`Building ${packageName ?? slug} #${n} in ${dir}`);

    // 1. Dependencies: (re)install only when package.json or the lockfile changed.
    await phase('install', async () => {
      const want = depsHash(dir);
      const stamp = path.join(dir, DEPS_STAMP);
      const have = fs.existsSync(stamp) ? fs.readFileSync(stamp, 'utf8').trim() : null;
      if (have === want && fs.existsSync(path.join(dir, 'node_modules', 'expo'))) return;
      say('Dependencies changed: running npm install…');
      const npm = npmCommand();
      try {
        await run(npm.cmd, [...npm.pre, 'install', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: dir, env, shell: npm.shell, ...stream });
      } catch (e) {
        throw new BuildError(extractNpm(e.lines ?? []) ?? `npm install failed:\n${tail(e.lines ?? [])}`);
      }
      await fsp.writeFile(stamp, depsHash(dir));
    });

    // 2. Type check, in parallel with the native build (it is the error agents most often need).
    const tscHandle = {};
    const tsc = fs.existsSync(path.join(dir, 'tsconfig.json'))
      ? phase('typecheck', () =>
          run(process.execPath, [path.join(dir, 'node_modules', 'typescript', 'bin', 'tsc'), '--noEmit', '-p', dir], {
            cwd: dir,
            env,
            logStream,
            handle: tscHandle,
          }).then(
            () => null,
            (e) => extractTsc(e.lines ?? []) ?? `Type check failed:\n${tail(e.lines ?? [])}`,
          ),
        )
      : Promise.resolve(null);

    // 3. Native project: (re)generate with expo prebuild only when its inputs changed.
    const gradleHandle = {};
    let tscError = null;
    tsc.then((err) => {
      tscError = err;
      if (err && gradleHandle.child) {
        gradleHandle.cancelled = true;
        killTree(gradleHandle.child);
      }
    });

    await phase('prebuild', () => prebuildIfNeeded(dir, env, say, stream));
    if (tscError) throw new BuildError(tscError);

    // 4. Gradle release build with the shared key and versionCode = build number.
    const gradleEnv = {
      ...env,
      ORG_GRADLE_PROJECT_anyappVersionCode: String(n),
      ORG_GRADLE_PROJECT_anyappStoreFile: keystore.storeFile,
      ORG_GRADLE_PROJECT_anyappStorePassword: keystore.storePassword,
      ORG_GRADLE_PROJECT_anyappKeyAlias: keystore.keyAlias,
      ORG_GRADLE_PROJECT_anyappKeyPassword: keystore.keyPassword,
    };
    const androidDir = path.join(dir, 'android');
    const gradle = gradleCommand(androidDir, javaHome);
    const gradleArgs = [
      ...gradle.pre,
      'app:assembleRelease',
      '--console=plain',
      '--build-cache',
      `-PreactNativeArchitectures=${ABIS}`,
      // Expo SDK 58 turns R8 shrinking on for release; it costs ~90 s per build and can break
      // reflection-based libraries. Side-loaded apps do not need it (ANYAPP_MINIFY=1 turns it on).
      `-Pandroid.enableMinifyInReleaseBuilds=${process.env.ANYAPP_MINIFY === '1'}`,
      '-Dorg.gradle.jvmargs=-Xmx4g -XX:MaxMetaspaceSize=1g -XX:+HeapDumpOnOutOfMemoryError -Dfile.encoding=UTF-8',
      '--init-script',
      path.join(BUILDER_DIR, 'anyapp.init.gradle'),
      ...(process.env.ANYAPP_GRADLE_ARGS ? process.env.ANYAPP_GRADLE_ARGS.split(' ').filter(Boolean) : []),
    ];
    say('Running Gradle assembleRelease…');
    const runGradle = () =>
      run(gradle.cmd, gradleArgs, { cwd: androidDir, env: gradleEnv, shell: gradle.shell, handle: gradleHandle, ...stream });
    await phase('gradle', async () => {
      try {
        try {
          await runGradle();
        } catch (e) {
          // Windows: a warm Gradle/Kotlin daemon sometimes keeps a jar inside this app open after
          // its native modules change. Stop that daemon (only if no other build runs here) and retry once.
          if (gradleHandle.cancelled || !(await releaseLockedFile(e.lines ?? [], dir, say))) throw e;
          say('Retrying Gradle after stopping the daemon that held a build file open…');
          await runGradle();
        }
      } catch (e) {
        const tscErr = await tsc;
        if (tscErr) throw new BuildError(tscErr);
        const lines = e.lines ?? [];
        const parts = [extractMetro(lines), extractGradle(lines)].filter(Boolean);
        throw new BuildError(parts.length ? parts.join('\n\n') : `Gradle failed:\n${tail(lines)}`);
      }
    });
    const tscErr = await tsc;
    if (tscErr) throw new BuildError(tscErr);

    // 5. Check, copy and fingerprint the APK.
    const built = path.join(androidDir, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
    if (!fs.existsSync(built)) throw new BuildError(`Gradle succeeded but ${built} is missing`);
    const badging = await readBadging(sdk, built);
    if (badging && badging.versionCode !== n) {
      throw new BuildError(`APK versionCode is ${badging.versionCode}, expected ${n} (the builder's init script did not apply)`);
    }
    const outDir = path.join(dir, 'build', 'apk');
    await fsp.mkdir(outDir, { recursive: true });
    const apkPath = path.join(outDir, `${slug}-${n}.apk`);
    await fsp.copyFile(built, apkPath);
    await pruneApks(outDir, KEEP_APKS);
    const buf = await fsp.readFile(apkPath);
    const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
    const durationMs = Date.now() - t0;
    say(`APK ready: ${apkPath} (${(buf.length / 1048576).toFixed(1)} MB) in ${(durationMs / 1000).toFixed(1)}s`);
    return {
      apkPath,
      sizeBytes: buf.length,
      sha256,
      versionCode: n,
      packageName: badging?.packageName ?? packageName,
      durationMs,
      timings,
      logPath: logFile,
    };
  } catch (e) {
    const msg = e instanceof BuildError ? e.message : e instanceof CommandError ? `${e.message}\n${tail(e.lines)}` : e.message;
    logStream.write(`[builder] FAILED: ${msg}\n`);
    const err = new Error(`Build #${n} failed.\n${msg}\n(Full log: ${logFile})`);
    err.logPath = logFile;
    throw err;
  } finally {
    await new Promise((r) => logStream.end(r));
  }
}

/** Files whose change requires `expo prebuild` to run again. */
function prebuildInputs(dir) {
  const files = [];
  for (const f of ['app.json', 'app.config.js', 'app.config.ts', 'package.json']) {
    if (fs.existsSync(path.join(dir, f))) files.push(f);
  }
  const walk = (rel, filter) => {
    const abs = path.join(dir, rel);
    if (!fs.existsSync(abs)) return;
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      const r = path.join(rel, e.name);
      if (e.isDirectory()) {
        if (e.name !== 'node_modules' && e.name !== 'android' && e.name !== 'build') walk(r, filter);
      } else if (filter(r)) files.push(r);
    }
  };
  walk('assets', () => true);
  walk('modules', (r) => /app\.plugin\.js$|AndroidManifest\.xml$|expo-module\.config\.json$/.test(r));
  walk('plugins', () => true);
  return files.sort();
}

async function prebuildHash(dir) {
  const h = crypto.createHash('sha256').update(`builder:${BUILDER_VERSION}\n`);
  for (const f of prebuildInputs(dir)) {
    h.update(f.replace(/\\/g, '/') + '\n');
    h.update(await fsp.readFile(path.join(dir, f)));
  }
  return h.digest('hex').slice(0, 16);
}

async function prebuildIfNeeded(dir, env, say, stream) {
  const want = await prebuildHash(dir);
  const stampPath = path.join(dir, PREBUILD_STAMP);
  const have = fs.existsSync(stampPath) ? fs.readFileSync(stampPath, 'utf8').trim() : null;
  if (have === want && fs.existsSync(path.join(dir, 'android', 'app', 'build.gradle'))) return;

  const expoCli = path.join(dir, 'node_modules', 'expo', 'bin', 'cli');
  const prebuild = (clean) =>
    run(process.execPath, [expoCli, 'prebuild', '--platform', 'android', '--no-install', ...(clean ? ['--clean'] : [])], {
      cwd: dir,
      env,
      ...stream,
    });
  const existed = fs.existsSync(path.join(dir, 'android'));
  say(existed ? 'Native config changed: running expo prebuild…' : 'Generating the native project (expo prebuild)…');
  try {
    await prebuild(false);
  } catch (e) {
    if (!existed) throw new BuildError(extractPrebuild(e.lines ?? []));
    say('expo prebuild failed on the existing android/ folder; retrying with --clean…');
    try {
      await prebuild(true);
    } catch (e2) {
      throw new BuildError(extractPrebuild(e2.lines ?? []));
    }
  }
  // Hash again: prebuild may itself touch package.json.
  await fsp.writeFile(stampPath, await prebuildHash(dir));
}

/**
 * If Gradle failed with "Unable to delete file '<inside dir>'", finds the process holding it
 * (Windows Restart Manager) and, when it is a Gradle or Kotlin daemon and this process runs no
 * other build, stops it. Returns true when something was stopped.
 */
async function releaseLockedFile(lines, dir, say) {
  if (process.platform !== 'win32' || building.size > 1) return false;
  const file = lines.map((l) => /Unable to delete (?:file|directory) '([^']+)'/.exec(l)?.[1]).find(Boolean);
  if (!file || !path.resolve(file).toLowerCase().startsWith(dir.toLowerCase() + path.sep)) return false;
  let holders = [];
  try {
    const { lines: out } = await run('powershell.exe', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(BUILDER_DIR, 'lib', 'who-locks.ps1'), '-Path', file,
    ]);
    holders = out.map((l) => l.trim().split(' ')).filter(([pid, kind]) => /^\d+$/.test(pid) && /Daemon$/.test(kind ?? ''));
  } catch {
    return false;
  }
  for (const [pid, kind] of holders) {
    say(`${kind} ${pid} holds ${file} open; stopping it.`);
    killTree({ pid: Number(pid), exitCode: null });
  }
  return holders.length > 0;
}

/** Runs the Gradle wrapper with java directly (no .bat, no shell), like gradlew.bat does. */
function gradleCommand(androidDir, javaHome) {
  const jar = path.join(androidDir, 'gradle', 'wrapper', 'gradle-wrapper.jar');
  if (fs.existsSync(jar)) {
    return {
      cmd: tool(javaHome, 'bin', 'java'),
      pre: ['-Xmx64m', '-Xms64m', '-Dorg.gradle.appname=gradlew', '-jar', jar],
    };
  }
  return { cmd: path.join(androidDir, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew'), pre: [], shell: process.platform === 'win32' };
}

async function readBadging(sdk, apk) {
  const aapt2 = findBuildTool(sdk, 'aapt2');
  if (!aapt2) return null;
  try {
    const { lines } = await run(aapt2, ['dump', 'badging', apk]);
    const m = /package: name='([^']+)' versionCode='(\d+)'/.exec(lines.find((l) => l.startsWith('package:')) ?? '');
    return m ? { packageName: m[1], versionCode: Number(m[2]) } : null;
  } catch {
    return null;
  }
}

async function pruneApks(outDir, keep) {
  const apks = (await fsp.readdir(outDir))
    .filter((f) => f.endsWith('.apk'))
    .map((f) => ({ f, n: Number(/-(\d+)\.apk$/.exec(f)?.[1] ?? 0) }))
    .sort((a, b) => b.n - a.n);
  for (const { f } of apks.slice(keep)) await fsp.rm(path.join(outDir, f), { force: true });
}
