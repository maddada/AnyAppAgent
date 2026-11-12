// Signing outside the builder (docs/CLOUD.md section 6): in the cloud the builder runs as the
// agent's Unix user with ANYAPP_SIGN_EXTERNAL=1 and leaves its APKs and quick update unsigned.
// The runner, another Unix user, then signs copies of them here with the app's key, which it
// holds on a tmpfs for seconds. Passwords only through the environment, never a command line.
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

import { checkSigning, signApk } from './apksign.mjs';
import { signFile } from './fastlane.mjs';
import { tool } from './env.mjs';
import { run } from './exec.mjs';
import { entryData, rawItem, readZip, writeZip } from './zip.mjs';

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/**
 * Makes a new signing key (PKCS12, RSA 3072, 100 years) at `storeFile`, as builder/lib/keystore.mjs
 * does for a new app on a PC. Returns { storeFile, keyAlias, storePassword, keyPassword, certSha256 }.
 */
export async function newAppKey(javaHome, storeFile, packageName) {
  if (fs.existsSync(storeFile)) throw new Error(`${storeFile} exists; refusing to replace a key`);
  const password = crypto.randomBytes(24).toString('base64url');
  await run(tool(javaHome, 'bin', 'keytool'), [
    '-genkeypair', '-storetype', 'PKCS12', '-keystore', storeFile, '-alias', 'app',
    '-keyalg', 'RSA', '-keysize', '3072', '-validity', '36500',
    '-storepass:env', 'ANYAPP_KS_PASS', '-keypass:env', 'ANYAPP_KS_PASS', '-dname', `CN=AnyAppAgent ${packageName}, O=AnyAppAgent`,
  ], { env: { ...process.env, ANYAPP_KS_PASS: password } });
  const certSha256 = await keyCert(javaHome, { storeFile, keyAlias: 'app', storePassword: password });
  return { storeFile, keyAlias: 'app', storePassword: password, keyPassword: password, certSha256 };
}

/** The SHA-256 of a key's certificate (keytool, the password through the environment). */
export async function keyCert(javaHome, key) {
  const tmp = path.join(path.dirname(key.storeFile), `cert-${process.pid}.der`);
  try {
    await run(tool(javaHome, 'bin', 'keytool'), [
      '-exportcert', '-storetype', 'PKCS12', '-keystore', key.storeFile, '-alias', key.keyAlias, '-storepass:env', 'ANYAPP_KS_PASS', '-file', tmp,
    ], { env: { ...process.env, ANYAPP_KS_PASS: key.storePassword } });
    return sha256(await fsp.readFile(tmp));
  } finally {
    await fsp.rm(tmp, { force: true });
  }
}

/** Adds ota.sig to an unsigned quick update package, signed with `key`. */
export async function signOtaPackage(javaHome, key, file, expectCert) {
  const buf = await fsp.readFile(file);
  const entries = readZip(buf);
  const manifest = entries.find((e) => e.name === 'ota.json');
  if (!manifest) throw new Error(`${path.basename(file)} has no ota.json`);
  if (entries.some((e) => e.name === 'ota.sig')) throw new Error(`${path.basename(file)} is already signed`);
  const manifestFile = `${file}.manifest.json`;
  await fsp.writeFile(manifestFile, entryData(buf, manifest));
  let signed;
  try {
    signed = await signFile(javaHome, key, manifestFile);
  } finally {
    await fsp.rm(manifestFile, { force: true });
  }
  if (expectCert && signed.cert !== expectCert) throw new Error(`the quick update was signed by ${signed.cert.slice(0, 12)} but the app is signed by ${expectCert.slice(0, 12)}`);
  const items = [];
  for (const e of entries) {
    items.push(rawItem(buf, e));
    if (e.name === 'ota.json') items.push({ name: 'ota.sig', data: Buffer.from(signed.sig) });
  }
  await writeZip(file, items);
}

/**
 * Signs the given APKs in place and checks each carries exactly the key's certificate, then signs
 * the quick update (if any). Returns { apks: [{ path, sizeBytes, sha256 }], ota: {...} | null }.
 */
export async function signOutputs({ javaHome, sdk, key, apks, ota = null }) {
  const cert = key.certSha256 ?? (await keyCert(javaHome, key));
  const out = [];
  for (const apk of apks) {
    await signApk(javaHome, sdk, apk, key);
    await checkSigning(javaHome, sdk, apk, { current: cert });
    const data = await fsp.readFile(apk);
    out.push({ path: apk, sizeBytes: data.length, sha256: sha256(data) });
  }
  let otaOut = null;
  if (ota) {
    await signOtaPackage(javaHome, key, ota, cert);
    const data = await fsp.readFile(ota);
    otaOut = { path: ota, sizeBytes: data.length, sha256: sha256(data) };
  }
  return { certSha256: cert, apks: out, ota: otaOut };
}
