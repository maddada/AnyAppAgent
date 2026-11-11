// Signing keys, all outside the repository and every app folder, under %USERPROFILE%\.anyappagent\keystore\
// (docs/DISTRIBUTION.md, "Signing"):
//   anyapp-release.p12 + keystore.json        the PC's shared key (every app made before per-app keys)
//   apps\<package id>\release.p12 + key.json  an app's own key ("own": made with the app; "moved":
//   apps\<package id>\lineage.bin             rotated from the shared key, with the proof-of-rotation)
// An app with no folder under apps\ is a shared-key app and builds exactly as before. A key is never
// replaced or deleted: the same package id always gets the same key, so it can update the phone's copy.
// Passwords reach keytool and apksigner only through environment variables, never a command line.
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

import { KEYSTORE_DIR, tool } from './env.mjs';
import { run } from './exec.mjs';
import { withFileLock } from './lock.mjs';

const STORE = 'anyapp-release.p12';
const INFO = 'keystore.json';
const APP_STORE = 'release.p12';
const APP_INFO = 'key.json';
const LINEAGE = 'lineage.bin';
const PACKAGE_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;

export const SHARED_KEY_ID = 'shared';

export function appsKeyDir() {
  return path.join(KEYSTORE_DIR, 'apps');
}

export function appKeyDir(packageName) {
  if (!PACKAGE_RE.test(packageName ?? '')) throw new Error(`Not a valid package id: ${packageName}`);
  return path.join(appsKeyDir(), packageName);
}

// ---------------------------------------------------------------------------------------------
// The shared key (unchanged since the first builder)

export async function ensureKeystore(javaHome, log = () => {}) {
  const info = path.join(KEYSTORE_DIR, INFO);
  if (fs.existsSync(info)) return readInfo(info);
  await fsp.mkdir(KEYSTORE_DIR, { recursive: true });
  return withFileLock(path.join(KEYSTORE_DIR, '.lock'), async () => {
    if (fs.existsSync(info)) return readInfo(info);
    const storeFile = path.join(KEYSTORE_DIR, STORE);
    if (fs.existsSync(storeFile)) {
      throw new Error(`${storeFile} exists but ${info} (its password) is missing; refusing to replace the key.`);
    }
    log(`Generating the AnyAppAgent signing key in ${KEYSTORE_DIR} (once)…`);
    const data = await generateKey(javaHome, { storeFile, alias: 'anyapp', dname: 'CN=AnyAppAgent, O=AnyAppAgent' });
    await writeJson(info, data);
    return data;
  });
}

/** The shared key's info, or null when this PC has none yet (nothing is created). */
export function readSharedKey() {
  const info = path.join(KEYSTORE_DIR, INFO);
  return fs.existsSync(info) ? readInfo(info) : null;
}

function readInfo(file) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!data.storeFile || !fs.existsSync(data.storeFile)) {
    throw new Error(`Signing keystore ${data.storeFile} is missing (see ${file}).`);
  }
  return data;
}

// ---------------------------------------------------------------------------------------------
// Per-app keys

/** The app's own key info ({ kind: 'own' | 'moved', ... }), or null for a shared-key app. */
export function readAppKey(packageName) {
  if (!PACKAGE_RE.test(packageName ?? '')) return null; // a template placeholder: no key of its own
  const file = path.join(appKeyDir(packageName), APP_INFO);
  if (!fs.existsSync(file)) return null;
  const data = readInfo(file);
  if (data.kind === 'moved' && (!data.lineageFile || !fs.existsSync(data.lineageFile))) {
    throw new Error(`The key rotation record ${data.lineageFile} for ${packageName} is missing (see ${file}).`);
  }
  return data;
}

/** Makes the app's own key if it has none (a new app). Returns its info. */
export async function ensureAppKey(javaHome, packageName, log = () => {}) {
  const existing = readAppKey(packageName);
  if (existing) return existing;
  const dir = appKeyDir(packageName);
  await fsp.mkdir(dir, { recursive: true });
  return withFileLock(path.join(dir, '.lock'), async () => {
    const again = readAppKey(packageName);
    if (again) return again;
    const storeFile = path.join(dir, APP_STORE);
    if (fs.existsSync(storeFile)) throw new Error(`${storeFile} exists but its ${APP_INFO} is missing; refusing to replace the key.`);
    log(`Generating the signing key for ${packageName}…`);
    const key = await generateKey(javaHome, { storeFile, alias: 'app', dname: `CN=AnyAppAgent ${packageName}, O=AnyAppAgent` });
    const data = { kind: 'own', packageName, ...key, createdAt: new Date().toISOString() };
    await writeJson(path.join(dir, APP_INFO), data);
    return data;
  });
}

/**
 * Moves a shared-key app to its own key with Android's key rotation (APK Signature Scheme v3):
 * a new key plus a lineage signed by the shared key. Android 9+ then keeps the app's data and
 * refuses updates signed with the shared key alone ("rollback" is off for it).
 */
export async function moveAppToOwnKey(javaHome, sdk, packageName, log = () => {}) {
  if (readAppKey(packageName)) throw new Error(`${packageName} already has its own signing key.`);
  const shared = readSharedKey();
  if (!shared) throw new Error('This PC has no shared signing key, so there is nothing to move from.');
  const dir = appKeyDir(packageName);
  await fsp.mkdir(dir, { recursive: true });
  return withFileLock(path.join(dir, '.lock'), async () => {
    if (readAppKey(packageName)) throw new Error(`${packageName} already has its own signing key.`);
    const storeFile = path.join(dir, APP_STORE);
    const lineageFile = path.join(dir, LINEAGE);
    for (const f of [storeFile, lineageFile]) {
      if (fs.existsSync(f)) throw new Error(`${f} exists but its ${APP_INFO} is missing; refusing to replace it.`);
    }
    log(`Moving ${packageName} to its own signing key (key rotation)…`);
    const key = await generateKey(javaHome, { storeFile, alias: 'app', dname: `CN=AnyAppAgent ${packageName}, O=AnyAppAgent` });
    const { apksignerRun } = await import('./apksign.mjs');
    await apksignerRun(javaHome, sdk, [
      'rotate', '--out', lineageFile,
      '--old-signer', '--ks', shared.storeFile, '--ks-key-alias', shared.keyAlias, '--ks-pass', 'env:ANYAPP_OLD_PASS',
      '--set-installed-data', 'true', '--set-shared-uid', 'true', '--set-permission', 'true', '--set-rollback', 'false', '--set-auth', 'true',
      '--new-signer', '--ks', storeFile, '--ks-key-alias', key.keyAlias, '--ks-pass', 'env:ANYAPP_NEW_PASS',
    ], { ANYAPP_OLD_PASS: shared.storePassword, ANYAPP_NEW_PASS: key.storePassword });
    if (!fs.existsSync(lineageFile)) throw new Error('apksigner rotate did not write the lineage file.');
    const data = {
      kind: 'moved',
      packageName,
      ...key,
      lineageFile,
      movedFrom: { certSha256: await certSha256(javaHome, shared) },
      createdAt: new Date().toISOString(),
    };
    await writeJson(path.join(dir, APP_INFO), data);
    return data;
  });
}

/**
 * How a build of `packageName` is signed:
 *   kind 'shared': Gradle signs with the shared key (made on first use).
 *   kind 'own':    Gradle signs with the app's own key.
 *   kind 'moved':  Gradle signs with the shared key, then apksigner signs again with shared + own +
 *                  lineage (`resign`).
 * `expect` is what lib/apksign.mjs checkSigning must find in every APK of the build.
 */
export async function signingFor(javaHome, packageName, log = () => {}) {
  const own = packageName ? readAppKey(packageName) : null;
  if (!own) {
    const shared = await ensureKeystore(javaHome, log);
    const cert = await certSha256(javaHome, shared);
    return { kind: 'shared', gradle: shared, resign: null, certSha256: cert, expect: { current: cert } };
  }
  if (own.kind === 'own') return { kind: 'own', gradle: own, resign: null, certSha256: own.certSha256, expect: { current: own.certSha256 } };
  const shared = readSharedKey();
  if (!shared) throw new Error(`${packageName} was moved from the shared key, but this PC's shared key is missing. Restore the key backup first.`);
  if ((await certSha256(javaHome, shared)) !== own.movedFrom.certSha256) {
    throw new Error(`${packageName} was moved from a shared key this PC does not have (this PC has a different one). Restore the key backup made on the PC that made this app.`);
  }
  return {
    kind: 'moved',
    gradle: shared,
    resign: { old: shared, next: own, lineageFile: own.lineageFile },
    certSha256: own.certSha256,
    expect: { current: own.certSha256, legacy: own.movedFrom.certSha256 },
  };
}

/** Every key on this PC: [{ id: 'shared' | <package id>, kind, certSha256, createdAt? }]. */
export async function listKeys(javaHome) {
  const out = [];
  const shared = readSharedKey();
  if (shared) out.push({ id: SHARED_KEY_ID, kind: 'shared', certSha256: await certSha256(javaHome, shared) });
  const root = appsKeyDir();
  if (fs.existsSync(root)) {
    for (const name of fs.readdirSync(root).sort()) {
      if (!PACKAGE_RE.test(name) || !fs.existsSync(path.join(root, name, APP_INFO))) continue;
      const k = readAppKey(name);
      out.push({ id: name, kind: k.kind, certSha256: k.certSha256, createdAt: k.createdAt });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Helpers

const certCache = new Map();

/** SHA-256 (hex) of a key's certificate, read with keytool (the password through the environment). */
export async function certSha256(javaHome, info) {
  if (info.certSha256) return info.certSha256;
  const cacheKey = `${info.storeFile}|${fs.statSync(info.storeFile).mtimeMs}`;
  if (certCache.has(cacheKey)) return certCache.get(cacheKey);
  const tmp = path.join(path.dirname(info.storeFile), `.cert-${process.pid}-${Date.now()}.der`);
  try {
    await run(tool(javaHome, 'bin', 'keytool'), [
      '-exportcert', '-storetype', 'PKCS12', '-keystore', info.storeFile, '-alias', info.keyAlias, '-storepass:env', 'ANYAPP_KS_PASS', '-file', tmp,
    ], { env: { ...process.env, ANYAPP_KS_PASS: info.storePassword } });
    const digest = crypto.createHash('sha256').update(await fsp.readFile(tmp)).digest('hex');
    certCache.set(cacheKey, digest);
    return digest;
  } finally {
    await fsp.rm(tmp, { force: true });
  }
}

async function generateKey(javaHome, { storeFile, alias, dname }) {
  const password = crypto.randomBytes(24).toString('base64url');
  await run(tool(javaHome, 'bin', 'keytool'), [
    '-genkeypair', '-storetype', 'PKCS12', '-keystore', storeFile, '-alias', alias,
    '-keyalg', 'RSA', '-keysize', '3072', '-validity', '36500',
    '-storepass:env', 'ANYAPP_KS_PASS', '-keypass:env', 'ANYAPP_KS_PASS', '-dname', dname,
  ], { env: { ...process.env, ANYAPP_KS_PASS: password } });
  const info = { storeFile, storePassword: password, keyAlias: alias, keyPassword: password };
  return { ...info, certSha256: await certSha256(javaHome, info) };
}

export async function writeJson(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  await fsp.rename(tmp, file);
}
