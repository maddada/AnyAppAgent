// The fast lane (docs/FAST-LANE.md): when a React Native app's change is only JavaScript (and the
// pictures and sounds it already had), the builder skips expo prebuild and Gradle and makes, in
// seconds:
//   - a quick update (OTA): the new Hermes bundle and its assets in one zip, with a manifest signed
//     by the app's own signing key. The app checks that signature with its own certificate before
//     it runs anything (com.anyapp.updates.Ota), so a quick update is exactly as trusted as an APK;
//   - a bundle swap APK: the last APK with the new bundle and the new version code, re-signed with
//     the same key. Every version stays a normal APK (first installs, shared releases, a phone
//     whose native part is older).
// Whether a change is "only JavaScript" is decided by the native fingerprint: a hash of every
// file that ends up in native code or resources (app.json, package.json and the lockfile, assets/,
// native files in modules/, plugins/), the builder's own version and the build's update feeds. The
// fingerprint is baked into every full APK (string resource anyapp_runtime) and into every quick
// update; the app refuses a quick update made for another fingerprint.
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

import { BUILDER_DIR, BUILDER_VERSION, tool } from './env.mjs';
import { run } from './exec.mjs';
import { apksignerRun } from './apksign.mjs';
import { setVersionCode } from './axml.mjs';
import { entryData, rawItem, readZip, writeZip } from './zip.mjs';

export const FAST_LANE_VERSION = '1';
const LAST = path.join('build', 'fastlane', 'last.json');
/** Gradle writes the bundle's pictures and sounds here (createBundleReleaseJsAndAssets). */
export const GRADLE_JS_RES = path.join('android', 'app', 'build', 'generated', 'res', 'react', 'release');
const V1_SIGNATURE = /^META-INF\/(MANIFEST\.MF|[^/]+\.(SF|RSA|DSA|EC))$/i;
const JS_IN_MODULES = /\.(ts|tsx|js|jsx|md)$/i;

export function fastLaneOn() {
  return process.env.ANYAPP_FAST_LANE !== '0';
}

// ---------------------------------------------------------------------------------------------
// The native fingerprint

/** The app's files whose change needs a full (Gradle) build, relative and sorted. */
export function nativeInputs(dir) {
  const files = [];
  for (const f of ['app.json', 'app.config.js', 'app.config.ts', 'package.json', 'package-lock.json']) {
    if (fs.existsSync(path.join(dir, f))) files.push(f);
  }
  const walk = (rel, keep) => {
    const abs = path.join(dir, rel);
    if (!fs.existsSync(abs)) return;
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      const r = path.join(rel, e.name);
      if (e.isDirectory()) {
        if (!['node_modules', 'build', '.gradle', '.cxx'].includes(e.name)) walk(r, keep);
      } else if (keep(r)) files.push(r);
    }
  };
  walk('assets', () => true);
  // In modules/, the TypeScript and JavaScript are part of the bundle; everything else (Kotlin,
  // manifests, Gradle files, expo-module.config.json, package.json) is native. A config plugin
  // (app.plugin.js) changes the native project, so it is native too.
  walk('modules', (r) => /app\.plugin\.js$/i.test(r) || !JS_IN_MODULES.test(r));
  walk('plugins', () => true);
  return files.map((f) => f.replace(/\\/g, '/')).sort();
}

export async function nativeFingerprint(dir, feeds = {}) {
  const h = crypto.createHash('sha256');
  h.update(`builder:${BUILDER_VERSION} fastlane:${FAST_LANE_VERSION}\n`);
  h.update(await fsp.readFile(path.join(BUILDER_DIR, 'anyapp.init.gradle')));
  h.update(`feeds:${JSON.stringify(Object.entries(feeds).sort())}\n`);
  for (const f of nativeInputs(dir)) {
    h.update(`${f}\n`);
    h.update(await fsp.readFile(path.join(dir, f)));
  }
  return h.digest('hex').slice(0, 32);
}

/** Hash of a folder of bundle assets (drawable-*, raw), by relative path and content. */
export async function assetsHash(resDir) {
  const h = crypto.createHash('sha256');
  const files = [];
  const walk = (abs, rel) => {
    if (!fs.existsSync(abs)) return;
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(abs, e.name), r);
      else files.push(r);
    }
  };
  walk(resDir, '');
  for (const f of files.sort()) {
    h.update(`${f}\n`);
    h.update(await fsp.readFile(path.join(resDir, f)));
  }
  return h.digest('hex').slice(0, 32);
}

// ---------------------------------------------------------------------------------------------
// What the last build left (the base for the next bundle swap)

export function readLast(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, LAST), 'utf8'));
  } catch {
    return null;
  }
}

/** After every React Native build: its fingerprint, its bundle assets and its APKs. */
export async function writeLast(dir, { build, fingerprint, assets, apkPath, variants = [] }) {
  const file = path.join(dir, LAST);
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const apks = [{ abi: 'universal', path: apkPath }, ...variants.map((v) => ({ abi: v.abi, path: v.apkPath }))];
  await fsp.writeFile(file, JSON.stringify({ build, fingerprint, assets, apks }, null, 2) + '\n');
}

// ---------------------------------------------------------------------------------------------
// The quick build

const requireFrom = (dir) => createRequire(path.join(dir, 'package.json'));

function hermescPath(dir) {
  const req = requireFrom(dir);
  const rn = path.dirname(req.resolve('react-native/package.json'));
  const pkg = path.dirname(createRequire(path.join(rn, 'package.json')).resolve('hermes-compiler/package.json'));
  const bin = process.platform === 'win32' ? 'win64-bin/hermesc.exe' : process.platform === 'darwin' ? 'osx-bin/hermesc' : 'linux64-bin/hermesc';
  return path.join(pkg, 'hermesc', bin);
}

function entryFile(dir) {
  try {
    const main = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).main;
    if (main && fs.existsSync(path.join(dir, main))) return main;
  } catch {
    // fall through
  }
  return 'index.ts';
}

/**
 * Exports the release bundle exactly as the Gradle build does (expo export:embed, then hermesc),
 * into outDir: index.android.bundle (Hermes bytecode) and res/ (drawable-*, raw).
 */
export async function exportBundle(dir, outDir, { env, stream }) {
  const jsDir = path.join(outDir, 'js');
  const resDir = path.join(outDir, 'res');
  await fsp.rm(outDir, { recursive: true, force: true });
  await fsp.mkdir(jsDir, { recursive: true });
  await fsp.mkdir(resDir, { recursive: true });
  const js = path.join(jsDir, 'index.android.bundle');
  const expoCli = path.join(dir, 'node_modules', 'expo', 'bin', 'cli');
  await run(process.execPath, [
    expoCli, 'export:embed',
    '--platform', 'android',
    '--dev', 'false',
    '--entry-file', entryFile(dir),
    '--bundle-output', js,
    '--assets-dest', resDir,
    '--sourcemap-output', `${js}.packager.map`,
    '--minify', 'false',
  ], { cwd: dir, env: { ...env, NODE_ENV: 'production' }, ...stream });
  const hbc = path.join(outDir, 'index.android.bundle');
  // Without -O: 1 s instead of 9 s for a 3 MB bundle (the bytecode is about a third larger). The
  // next full build optimises again. ANYAPP_FAST_LANE_OPTIMIZE=1 keeps -O.
  const opt = process.env.ANYAPP_FAST_LANE_OPTIMIZE === '1' ? ['-O'] : ['-O0'];
  await run(hermescPath(dir), ['-w', '-emit-binary', '-max-diagnostic-width=80', '-out', hbc, js, ...opt], { cwd: dir, env, ...stream });
  return { bundle: hbc, resDir };
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/** Signs `file` with the keystore `key` ({ storeFile, keyAlias, storePassword }); returns { sig, cert }. */
export async function signFile(javaHome, key, file) {
  const { lines } = await run(tool(javaHome, 'bin', 'java'), [path.join(BUILDER_DIR, 'lib', 'OtaSign.java'), key.storeFile, key.keyAlias, file], {
    env: { ...process.env, ANYAPP_KS_PASS: key.storePassword },
  });
  const out = lines.map((l) => l.trim()).filter(Boolean);
  const sig = out.find((l) => /^[A-Za-z0-9+/]+=*$/.test(l) && l.length > 100);
  const cert = out.find((l) => /^[0-9a-f]{64}$/.test(l));
  if (!sig || !cert) throw new Error('signing the quick update printed no signature');
  return { sig, cert };
}

/**
 * The quick update package: ota.json (what it is, for which app and native fingerprint, and the
 * SHA-256 of every file), ota.sig (ota.json signed with the app's key), then the files.
 */
export async function makeOtaPackage({ file, bundle, resDir, packageName, build, runtime, javaHome, key, expectCert }) {
  const files = [{ name: 'index.android.bundle', data: await fsp.readFile(bundle) }];
  const walk = async (abs, rel) => {
    for (const e of await fsp.readdir(abs, { withFileTypes: true })) {
      const r = `${rel}/${e.name}`;
      if (e.isDirectory()) await walk(path.join(abs, e.name), r);
      else files.push({ name: r.slice(1), data: await fsp.readFile(path.join(abs, e.name)) });
    }
  };
  if (fs.existsSync(resDir)) await walk(resDir, '');
  for (const f of files) {
    if (!/^[A-Za-z0-9_][A-Za-z0-9_./-]*$/.test(f.name) || f.name.includes('..')) throw new Error(`asset name not allowed in a quick update: ${f.name}`);
  }
  const manifest = {
    format: 1,
    package: packageName,
    build,
    runtime,
    createdAt: new Date().toISOString(),
    files: files.map((f) => ({ name: f.name, size: f.data.length, sha256: sha256(f.data) })),
  };
  const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 1));
  // No key (external signing, the cloud): the package goes out without ota.sig, and
  // lib/external-sign.mjs adds it later as another Unix user.
  let sig = null;
  if (key) {
    const manifestFile = `${file}.json`;
    await fsp.writeFile(manifestFile, manifestBytes);
    const signed = await signFile(javaHome, key, manifestFile);
    await fsp.rm(manifestFile, { force: true });
    if (expectCert && signed.cert !== expectCert) throw new Error(`the quick update was signed by ${signed.cert.slice(0, 12)} but the app is signed by ${expectCert.slice(0, 12)}`);
    sig = signed.sig;
  }
  await writeZip(file, [
    { name: 'ota.json', data: manifestBytes },
    ...(sig ? [{ name: 'ota.sig', data: Buffer.from(sig) }] : []),
    ...files.map((f) => ({ name: f.name, data: f.data, store: /\.(png|jpe?g|webp|gif|mp3|ogg|m4a|ttf|otf)$/i.test(f.name) })),
  ]);
  const data = await fsp.readFile(file);
  return { path: file, sizeBytes: data.length, sha256: sha256(data), runtime, files: files.length };
}

/**
 * The bundle swap: `baseApk` with assets/index.android.bundle replaced and versionCode set to
 * `build`, written to `outApk`, aligned and signed with the key Gradle signs with (`key`). A moved
 * app's lineage is added afterwards by finishApk, exactly as for a Gradle APK.
 */
export async function swapBundle({ baseApk, outApk, bundle, build, javaHome, sdk, key }) {
  const buf = await fsp.readFile(baseApk);
  const entries = readZip(buf);
  const newBundle = await fsp.readFile(bundle);
  let sawBundle = false;
  let sawManifest = false;
  const items = [];
  for (const e of entries) {
    if (V1_SIGNATURE.test(e.name)) continue;
    if (e.name === 'assets/index.android.bundle') {
      sawBundle = true;
      items.push({ name: e.name, data: newBundle, store: e.method === 0 });
    } else if (e.name === 'AndroidManifest.xml') {
      sawManifest = true;
      items.push({ name: e.name, data: setVersionCode(entryData(buf, e), build), store: e.method === 0 });
    } else {
      items.push(rawItem(buf, e));
    }
  }
  if (!sawBundle || !sawManifest) throw new Error(`${path.basename(baseApk)} has no ${sawBundle ? 'AndroidManifest.xml' : 'JavaScript bundle'}`);
  await fsp.mkdir(path.dirname(outApk), { recursive: true });
  await writeZip(outApk, items);
  if (!key) return outApk; // external signing: signed later by lib/external-sign.mjs
  await apksignerRun(javaHome, sdk, [
    'sign',
    '--ks', key.storeFile, '--ks-key-alias', key.keyAlias, '--ks-pass', 'env:ANYAPP_KS_PASS',
    '--alignment-preserved', 'true',
    '--v4-signing-enabled', 'false',
    outApk,
  ], { ANYAPP_KS_PASS: key.storePassword });
  return outApk;
}
