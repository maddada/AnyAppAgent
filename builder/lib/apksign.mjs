// apksigner, run as `java -jar apksigner.jar` (no .bat, so no shell), with passwords only in the
// child's environment. Used to sign moved apps with their key rotation lineage and to check every
// APK's certificates after a build (docs/DISTRIBUTION.md, "Signing").
import fs from 'node:fs';
import path from 'node:path';

import { tool } from './env.mjs';
import { run } from './exec.mjs';

function apksignerJar(sdk) {
  const root = path.join(sdk, 'build-tools');
  if (!fs.existsSync(root)) return null;
  const versions = fs
    .readdirSync(root)
    .filter((v) => /^\d/.test(v))
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  for (const v of versions) {
    const jar = path.join(root, v, 'lib', 'apksigner.jar');
    if (fs.existsSync(jar)) return jar;
  }
  return null;
}

export async function apksignerRun(javaHome, sdk, args, secrets = {}) {
  const jar = apksignerJar(sdk);
  if (!jar) throw new Error(`apksigner.jar not found under ${path.join(sdk, 'build-tools')}`);
  return run(tool(javaHome, 'bin', 'java'), ['-jar', jar, ...args], { env: { ...process.env, ...secrets } });
}

/**
 * Signs `apk` in place with the shared key, the app's own key and the lineage between them.
 * Rotation applies from Android 9 (API 28); older versions check the v2 signature (shared key).
 */
export async function signWithLineage(javaHome, sdk, apk, { old, next, lineageFile }) {
  await apksignerRun(javaHome, sdk, [
    'sign',
    '--ks', old.storeFile, '--ks-key-alias', old.keyAlias, '--ks-pass', 'env:ANYAPP_OLD_PASS',
    '--next-signer',
    '--ks', next.storeFile, '--ks-key-alias', next.keyAlias, '--ks-pass', 'env:ANYAPP_NEW_PASS',
    '--lineage', lineageFile,
    '--rotation-min-sdk-version', '28',
    '--alignment-preserved', 'true',
    '--v4-signing-enabled', 'false', // no .idsig file next to the APK
    apk,
  ], { ANYAPP_OLD_PASS: old.storePassword, ANYAPP_NEW_PASS: next.storePassword });
}

/**
 * Signs an unsigned APK in place with one key (`{ storeFile, storePassword, keyAlias }`). Used when
 * Gradle built it without the key (ANYAPP_SIGN_LATER=1, the cloud: docs/CLOUD.md, section 6).
 */
export async function signApk(javaHome, sdk, apk, key) {
  await apksignerRun(javaHome, sdk, [
    'sign',
    '--ks', key.storeFile, '--ks-type', 'PKCS12', '--ks-key-alias', key.keyAlias,
    '--ks-pass', 'env:ANYAPP_KS_PASS', '--key-pass', 'env:ANYAPP_KS_PASS',
    '--v4-signing-enabled', 'false',
    apk,
  ], { ANYAPP_KS_PASS: key.storePassword });
}

/**
 * `apksigner verify --print-certs` (plus `extra`, such as a --max-sdk-version): resolves with the
 * set of certificate SHA-256s it reports for the newest signature scheme that applies, and rejects
 * when the APK does not verify or when no certificate could be read at all (an output format
 * change once made a check like this read nothing and pass).
 */
export async function readCerts(javaHome, sdk, apk, extra = []) {
  let lines;
  try {
    ({ lines } = await apksignerRun(javaHome, sdk, ['verify', '--print-certs', '-v', ...extra, apk]));
  } catch (e) {
    const why = (e.lines ?? []).filter((l) => /ERROR|DOES NOT VERIFY/i.test(l)).slice(0, 3).join(' ');
    throw new Error(`${path.basename(apk)} does not verify${why ? `: ${why}` : ''}`);
  }
  const certs = new Set();
  for (const l of lines) {
    const m = /certificate SHA-256 digest:\s*([0-9a-f]{64})/i.exec(l);
    if (m) certs.add(m[1].toLowerCase());
  }
  if (certs.size === 0) throw new Error(`apksigner printed no certificate for ${path.basename(apk)}; refusing to trust its signature.`);
  return certs;
}

/** The key rotation lineage stored in the APK: [{ cert, rollback }] oldest first ([] when none). */
export async function readLineage(javaHome, sdk, apk) {
  let lines;
  try {
    ({ lines } = await apksignerRun(javaHome, sdk, ['lineage', '--in', apk, '--print-certs', '-v']));
  } catch {
    return [];
  }
  const out = [];
  for (const l of lines) {
    const c = /^Signer #(\d+) in lineage certificate SHA-256 digest:\s*([0-9a-f]{64})/i.exec(l);
    if (c) out.push({ cert: c[2].toLowerCase(), rollback: null });
    const r = /^Has rollback capability\s*:\s*(true|false)/i.exec(l);
    if (r && out.length) out[out.length - 1].rollback = r[1] === 'true';
  }
  return out;
}

const short = (list) => [...list].map((c) => c.slice(0, 12)).join(', ') || 'nothing';
const sameSet = (got, want) => got.size === want.length && want.every((c) => got.has(c));

/**
 * Throws unless the APK is signed exactly as `expect` says:
 *   { current }                    one key (an own-key or shared-key app);
 *   { current, legacy }            a moved app: `current` on Android 9+, `legacy` (the shared key) on
 *                                  Android 8 and older, and the lineage legacy -> current stored in
 *                                  the APK with rollback to the legacy key turned off.
 */
export async function checkSigning(javaHome, sdk, apk, expect) {
  const name = path.basename(apk);
  const modern = await readCerts(javaHome, sdk, apk);
  if (!sameSet(modern, [expect.current])) throw new Error(`${name} is signed by ${short(modern)} but must be signed by ${short([expect.current])}.`);
  if (!expect.legacy) return;
  const old = await readCerts(javaHome, sdk, apk, ['--max-sdk-version', '27']);
  if (!sameSet(old, [expect.legacy])) throw new Error(`${name} is signed for Android 8 and older by ${short(old)} but must be by ${short([expect.legacy])}.`);
  const lineage = await readLineage(javaHome, sdk, apk);
  const certs = lineage.map((s) => s.cert);
  if (certs.length !== 2 || certs[0] !== expect.legacy || certs[1] !== expect.current) {
    throw new Error(`${name} carries the key history ${short(certs)} but must carry ${short([expect.legacy, expect.current])}.`);
  }
  if (lineage[0].rollback !== false) throw new Error(`${name} still lets the old shared key sign updates (rollback capability is on).`);
}
