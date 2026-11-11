// AnyAppAgent builder: makes apps from a template and builds their signed release APKs.
// Two presets: 'react-native' (template/, the default) and 'kotlin' (template-kotlin/).
// Contract (docs/SPEC.md):
//   createApp({ dir, name, slug, packageName, preset?, onLog? }) -> Promise<void>
//   buildApk({ dir, buildNumber, onLog? }) -> Promise<{ apkPath, sizeBytes, sha256, ... }>
//   getIconPath({ dir }) -> string | null
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

import { ABIS, BUILDER_DIR, BUILDER_VERSION, androidEnv, findBuildTool, tool } from './lib/env.mjs';
import { extractGradle, extractMetro, extractNpm, extractPrebuild, extractTsc, tail } from './lib/errors.mjs';
import { CommandError, killTree, npmCommand, run } from './lib/exec.mjs';
import { checkSigning, signWithLineage } from './lib/apksign.mjs';
import { ensureAppKey, signingFor } from './lib/keystore.mjs';
import { renameWithRetry, tryLock } from './lib/lock.mjs';
import { fillKotlinPlaceholders, KOTLIN_ICON, syncKotlinIcon } from './lib/kotlin.mjs';
import { createExactApp, ensureExact, exactDirFor, exactEnv, extractExactError, runExactAndroidBuild } from './lib/exact.mjs';
import { checkPreset, presetOf, readAppMeta, readKotlinMeta } from './lib/presets.mjs';
import { claimSpare, refillSparesInBackground } from './lib/spare.mjs';
import { DEPS_STAMP, depsHash, makeAppTree, templateHash } from './lib/template.mjs';

export { PRESETS, DEFAULT_PRESET, presetOf } from './lib/presets.mjs';
export { listSigningKeys, moveAppToOwnKey, backupSigningKeys, restoreSigningKeys, appSigningKind } from './lib/keys-api.mjs';

const PACKAGE_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;
const PREBUILD_STAMP = path.join('android', '.anyapp-prebuild');
const KEEP_APKS = 5;

const noop = () => {};

// ---------------------------------------------------------------------------------------------
// createApp

export async function createApp({ dir, name, slug, packageName, preset, onLog = noop }) {
  if (!dir || !path.isAbsolute(dir)) throw new Error('createApp: dir must be an absolute path');
  try {
    preset = checkPreset(preset);
  } catch (e) {
    throw new Error(`createApp: ${e.message}`);
  }
  if (!name || !String(name).trim()) throw new Error('createApp: name is required');
  if (!SLUG_RE.test(slug ?? '')) throw new Error(`createApp: slug "${slug}" must be lowercase letters, digits and dashes`);
  if (!PACKAGE_RE.test(packageName ?? '')) {
    throw new Error(`createApp: packageName "${packageName}" is not a valid Android package id (e.g. com.anyapp.${slug.replace(/-/g, '')})`);
  }
  dir = path.resolve(dir);
  if (fs.existsSync(dir) && fs.readdirSync(dir).length > 0) throw new Error(`createApp: ${dir} already exists and is not empty`);
  await fsp.mkdir(path.dirname(dir), { recursive: true });
  // Every new app gets its own signing key (kept outside the app; the same package id always gets
  // the same key). Made first, so a failure here leaves no half-made app folder.
  await ensureAppKey(androidEnv().javaHome, packageName, onLog);

  const t0 = Date.now();
  if (preset === 'expo-exact') {
    // `exact new` makes the app in about a second, so there is no spare (lib/exact.mjs).
    await createExactApp(dir, { name: String(name).trim(), slug, packageName }, onLog);
    onLog(`Created ${dir} with Expo Exact (${((Date.now() - t0) / 1000).toFixed(1)}s).`);
    return;
  }
  const hash = templateHash(preset);
  let how = 'spare';
  if (!(await claimSpare(dir, hash, preset))) {
    how = 'copy';
    if (preset === 'react-native') onLog('No ready spare app folder; copying the template (about 20 s)…');
    const tmp = `${dir}.tmp-${process.pid}`;
    await fsp.rm(tmp, { recursive: true, force: true });
    await makeAppTree(tmp, onLog, preset);
    if (fs.existsSync(dir)) await fsp.rmdir(dir);
    await renameWithRetry(tmp, dir);
  }
  const fields = { name: String(name).trim(), slug, packageName };
  if (preset === 'kotlin') await fillKotlinPlaceholders(dir, fields);
  else await fillPlaceholders(dir, fields);
  onLog(`Created ${dir} from the ${preset} template (${how}, ${((Date.now() - t0) / 1000).toFixed(1)}s).`);
  refillSparesInBackground(dir, preset);
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
  // Kotlin and Expo Exact apps: icon.png at the project root (an Exact app has none yet: null).
  if (readAppMeta(dir)) {
    const p = path.resolve(dir, KOTLIN_ICON);
    return fs.existsSync(p) ? p : null;
  }
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
  const preset = presetOf(dir);
  if (!preset) throw new Error(`buildApk: ${dir} has neither app.json (React Native) nor anyapp.json (Kotlin)`);

  const key = dir.toLowerCase();
  if (building.has(key)) throw new Error(`buildApk: a build of ${dir} is already running`);
  await fsp.mkdir(path.join(dir, 'build', 'logs'), { recursive: true });
  const release = await tryLock(path.join(dir, 'build', '.build.lock'), { staleMs: 30 * 60_000 });
  if (!release) throw new Error(`buildApk: a build of ${dir} is already running (build/.build.lock)`);
  const job = runBuild(dir, n, onLog, preset);
  building.set(key, job);
  try {
    return await job;
  } finally {
    building.delete(key);
    await release();
  }
}

async function runBuild(dir, n, onLog, preset) {
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
    const kotlin = preset === 'kotlin';
    let slug;
    let packageName;
    if (kotlin || preset === 'expo-exact') {
      const meta = readAppMeta(dir);
      slug = meta.slug ?? path.basename(dir);
      packageName = meta.package;
    } else {
      const appJson = JSON.parse(await fsp.readFile(path.join(dir, 'app.json'), 'utf8'));
      slug = appJson.expo?.slug ?? path.basename(dir);
      packageName = appJson.expo?.android?.package;
    }
    // The app's own key, or the shared key for apps made before per-app keys (lib/keystore.mjs).
    const signing = await signingFor(javaHome, packageName, say);
    const keystore = signing.gradle;
    say(`Building ${packageName ?? slug} #${n} (${preset}, ${signing.kind} key) in ${dir}`);
    const finish = (built, parts = []) =>
      finishApk({ built, parts, sdk, javaHome, signing, n, dir, slug, packageName, preset, t0, timings, logFile, say });

    if (preset === 'expo-exact') {
      // Exact's own Android build (Rust, then Gradle), with the builder's init script for the
      // shared key and versionCode (lib/exact.mjs, builder/exact/pin.json).
      const exactDir = await phase('exact-setup', () => ensureExact(dir, say, { env: exactEnv(env, { javaHome, sdk, exactDir: exactDirFor(dir) }).env }));
      const { env: xenv, bun } = exactEnv(env, { javaHome, sdk, exactDir });
      const gradleProps = {
        ORG_GRADLE_PROJECT_anyappVersionCode: String(n),
        ORG_GRADLE_PROJECT_anyappStoreFile: keystore.storeFile,
        ORG_GRADLE_PROJECT_anyappStorePassword: keystore.storePassword,
        ORG_GRADLE_PROJECT_anyappKeyAlias: keystore.keyAlias,
        ORG_GRADLE_PROJECT_anyappKeyPassword: keystore.keyPassword,
      };
      say('Running the Expo Exact Android build (Rust, then Gradle)…');
      const built = await phase('exact', async () => {
        try {
          return await runExactAndroidBuild(dir, {
            env: { ...xenv, ...gradleProps },
            bun,
            exactDir,
            extraGradleArgs: ['--init-script', path.join(BUILDER_DIR, 'anyapp.init.gradle')],
            stream,
          });
        } catch (e) {
          const lines = e.lines ?? [];
          throw new BuildError(extractExactError(lines) ?? extractGradle(lines) ?? `The Expo Exact build failed:\n${tail(lines)}`);
        }
      });
      return await finish(built);
    }

    const tscHandle = {};
    const gradleHandle = {};
    let tscError = null;
    let tsc = Promise.resolve(null);
    if (kotlin) {
      // Kotlin: no npm, TypeScript or prebuild; only the launcher icon sizes from icon.png.
      await phase('icon', async () => {
        try {
          await syncKotlinIcon(dir, say);
        } catch (e) {
          throw new BuildError(e.message);
        }
      });
    } else {
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
      tsc = fs.existsSync(path.join(dir, 'tsconfig.json'))
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
      tsc.then((err) => {
        tscError = err;
        if (err && gradleHandle.child) {
          gradleHandle.cancelled = true;
          killTree(gradleHandle.child);
        }
      });

      await phase('prebuild', () => prebuildIfNeeded(dir, env, say, stream));
      if (tscError) throw new BuildError(tscError);
    }

    // 4. Gradle release build with the shared key and versionCode = build number.
    const gradleEnv = {
      ...env,
      ORG_GRADLE_PROJECT_anyappVersionCode: String(n),
      ORG_GRADLE_PROJECT_anyappStoreFile: keystore.storeFile,
      ORG_GRADLE_PROJECT_anyappStorePassword: keystore.storePassword,
      ORG_GRADLE_PROJECT_anyappKeyAlias: keystore.keyAlias,
      ORG_GRADLE_PROJECT_anyappKeyPassword: keystore.keyPassword,
    };
    const androidDir = kotlin ? dir : path.join(dir, 'android');
    const gradle = gradleCommand(androidDir, javaHome);
    const gradleArgs = [
      ...gradle.pre,
      'app:assembleRelease',
      '--console=plain',
      '--build-cache',
      ...(kotlin
        ? [] // no native libraries of its own; it shrinks itself with R8 (app/build.gradle.kts)
        : [
            `-PreactNativeArchitectures=${ABIS}`,
            // Smaller downloads (anyapp.init.gradle): native libraries compressed, and one APK per
            // ABI besides the full one (the phone takes arm64-v8a, the emulator x86_64).
            '-Pexpo.useLegacyPackaging=true',
            '-PanyappCompressNativeLibs=true',
            ...(abiSplits() ? [`-PanyappAbiSplits=${ABIS}`] : []),
            // Expo SDK 58 turns R8 shrinking on for release; it costs ~90 s per build and can break
            // reflection-based libraries. Side-loaded apps do not need it (ANYAPP_MINIFY=1 turns it on).
            `-Pandroid.enableMinifyInReleaseBuilds=${process.env.ANYAPP_MINIFY === '1'}`,
          ]),
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
    const releaseDir = path.join(androidDir, 'app', 'build', 'outputs', 'apk', 'release');
    // With ABI splits the full APK is app-universal-release.apk and each ABI has its own.
    const universal = path.join(releaseDir, 'app-universal-release.apk');
    const built = fs.existsSync(universal) ? universal : path.join(releaseDir, 'app-release.apk');
    if (!fs.existsSync(built)) throw new BuildError(`Gradle succeeded but ${built} is missing`);
    // One APK per ABI next to the full one, when this build made them (anyapp.init.gradle).
    const parts =
      built === universal
        ? ABIS.split(',')
            .map((abi) => ({ abi, path: path.join(releaseDir, `app-${abi}-release.apk`) }))
            .filter((p) => fs.existsSync(p.path) && fs.statSync(p.path).mtimeMs >= fs.statSync(built).mtimeMs - 60_000)
        : [];
    return await finish(built, parts);
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

/**
 * Checks the built APK (versionCode, package id), copies it to build/apk/ and fingerprints it,
 * with its per-ABI APKs (`parts`, [{ abi, path }]) as `variants`.
 */
async function finishApk({ built, parts = [], sdk, javaHome, signing, n, dir, slug, packageName, preset, t0, timings, logFile, say }) {
  const badging = await readBadging(sdk, built);
  if (badging && badging.versionCode !== n) {
    throw new BuildError(`APK versionCode is ${badging.versionCode}, expected ${n} (the builder's init script did not apply)`);
  }
  if (preset !== 'react-native' && badging && packageName && badging.packageName !== packageName) {
    const where = preset === 'kotlin' ? 'anyapp.json, used by app/build.gradle.kts' : 'app.json app.id';
    throw new BuildError(
      `The app's package id is ${badging.packageName} but must stay ${packageName} (${where}). Put it back: a different id cannot update the app on the phone.`,
    );
  }
  const outDir = path.join(dir, 'build', 'apk');
  await fsp.mkdir(outDir, { recursive: true });
  const apkPath = path.join(outDir, `${slug}-${n}.apk`);
  await fsp.copyFile(built, apkPath);
  const copies = [];
  for (const part of parts) {
    const out = path.join(outDir, `${slug}-${n}-${part.abi}.apk`);
    await fsp.copyFile(part.path, out);
    copies.push({ abi: part.abi, out });
  }
  // A moved app is signed again with its key rotation lineage; then every APK must carry exactly
  // the expected certificates (docs/DISTRIBUTION.md, "Signing").
  for (const apk of [apkPath, ...copies.map((c) => c.out)]) {
    try {
      if (signing.resign) await signWithLineage(javaHome, sdk, apk, signing.resign);
      await checkSigning(javaHome, sdk, apk, signing.expect);
    } catch (e) {
      await fsp.rm(apk, { force: true });
      throw new BuildError(`Signing check failed: ${e.message}`);
    }
  }
  const variants = [];
  for (const { abi, out } of copies) {
    const data = await fsp.readFile(out);
    variants.push({ abi, apkPath: out, sizeBytes: data.length, sha256: crypto.createHash('sha256').update(data).digest('hex') });
  }
  await pruneApks(outDir, KEEP_APKS);
  const buf = await fsp.readFile(apkPath);
  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  const durationMs = Date.now() - t0;
  const sizes = variants.map((v) => `${v.abi} ${(v.sizeBytes / 1048576).toFixed(1)} MB`).join(', ');
  say(`APK ready: ${apkPath} (${(buf.length / 1048576).toFixed(1)} MB${sizes ? `; ${sizes}` : ''}) in ${(durationMs / 1000).toFixed(1)}s`);
  return {
    apkPath,
    sizeBytes: buf.length,
    sha256,
    ...(variants.length > 0 ? { variants } : {}),
    versionCode: n,
    packageName: badging?.packageName ?? packageName,
    preset,
    signing: { kind: signing.kind, certSha256: signing.certSha256 },
    durationMs,
    timings,
    logPath: logFile,
  };
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

/** Keeps the APKs of the newest `keep` build numbers (<slug>-<n>.apk and <slug>-<n>-<abi>.apk). */
async function pruneApks(outDir, keep) {
  const buildNumber = (f) => {
    const abi = ABIS.split(',').find((a) => f.endsWith(`-${a}.apk`));
    const full = abi ? `${f.slice(0, -(abi.length + 5))}.apk` : f;
    return Number(/-(\d+)\.apk$/.exec(full)?.[1] ?? 0);
  };
  const apks = (await fsp.readdir(outDir))
    .filter((f) => f.endsWith('.apk'))
    .map((f) => ({ f, n: buildNumber(f) }));
  const newest = [...new Set(apks.map((a) => a.n))].sort((a, b) => b - a).slice(0, keep);
  for (const { f, n } of apks) if (!newest.includes(n)) await fsp.rm(path.join(outDir, f), { force: true });
}

/** ABI splits are on unless ANYAPP_ABI_SPLITS=0 (then only the full APK is built). */
function abiSplits() {
  return process.env.ANYAPP_ABI_SPLITS !== '0';
}
