// One signing key for every app and every build, generated once outside the repository at
// %USERPROFILE%\.anyappagent\keystore\. Same key + higher versionCode = installs over the old app.
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

import { KEYSTORE_DIR, tool } from './env.mjs';
import { run } from './exec.mjs';
import { withFileLock } from './lock.mjs';

const STORE = 'anyapp-release.p12';
const INFO = 'keystore.json';

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
    const password = crypto.randomBytes(24).toString('base64url');
    log(`Generating the AnyAppAgent signing key in ${KEYSTORE_DIR} (once)…`);
    await run(tool(javaHome, 'bin', 'keytool'), [
      '-genkeypair',
      '-storetype', 'PKCS12',
      '-keystore', storeFile,
      '-alias', 'anyapp',
      '-keyalg', 'RSA',
      '-keysize', '3072',
      '-validity', '36500',
      '-storepass', password,
      '-keypass', password,
      '-dname', 'CN=AnyAppAgent, O=AnyAppAgent',
    ]);
    const data = { storeFile, storePassword: password, keyAlias: 'anyapp', keyPassword: password };
    await fsp.writeFile(info, JSON.stringify(data, null, 2), { mode: 0o600 });
    return data;
  });
}

function readInfo(file) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!data.storeFile || !fs.existsSync(data.storeFile)) {
    throw new Error(`Signing keystore ${data.storeFile} is missing (see ${file}).`);
  }
  return data;
}
