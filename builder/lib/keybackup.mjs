// An encrypted backup of every signing key on this PC, and restoring it (docs/DISTRIBUTION.md,
// "Backup and restore"). The file holds only its format, date and key count in the clear; the keys,
// their passwords and the lineages are AES-256-GCM encrypted with a key derived from the user's
// password by scrypt. Restore adds missing keys, skips identical ones and never overwrites a key
// that differs (it is reported as a conflict).
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

import { KEYSTORE_DIR } from './env.mjs';
import { appKeyDir, certSha256, listKeys, readAppKey, readSharedKey, SHARED_KEY_ID, writeJson } from './keystore.mjs';
import { withFileLock } from './lock.mjs';

export const BACKUP_FORMAT = 'anyappagent-signing-keys';
const SCRYPT = { N: 2 ** 16, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
const RECORD = 'backups.json';
export const MIN_PASSWORD = 8;

function checkPassword(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD) {
    throw new Error(`The password must be at least ${MIN_PASSWORD} characters.`);
  }
}

function deriveKey(password, salt) {
  return crypto.scryptSync(password.normalize('NFC'), salt, 32, SCRYPT);
}

/**
 * Every key on this PC as plain entries ({ id, info, files }), for a backup to encrypt: the key
 * backup below, and the whole-PC backup (server/src/backup.ts) that wraps them in its own file.
 * The entries hold passwords and private keys: never log or store them unencrypted.
 */
export async function exportKeyEntries(javaHome) {
  const keys = await listKeys(javaHome);
  const entries = [];
  for (const k of keys) {
    if (k.id === SHARED_KEY_ID) {
      const s = readSharedKey();
      entries.push({
        id: k.id,
        info: { keyAlias: s.keyAlias, storePassword: s.storePassword, keyPassword: s.keyPassword, certSha256: k.certSha256 },
        files: { store: (await fsp.readFile(s.storeFile)).toString('base64') },
      });
    } else {
      const a = readAppKey(k.id);
      const { storeFile, lineageFile, ...info } = a;
      const files = { store: (await fsp.readFile(storeFile)).toString('base64') };
      if (lineageFile) files.lineage = (await fsp.readFile(lineageFile)).toString('base64');
      entries.push({ id: k.id, info, files });
    }
  }
  return entries;
}

/** Notes that these keys are now in a backup made at `createdAt` (Settings, "Last backup"). */
export async function noteBackedUp(ids, createdAt) {
  await writeJson(path.join(KEYSTORE_DIR, RECORD), { lastBackupAt: createdAt, ids });
}

/** Writes every key to `file`, encrypted with `password`. Returns { file, count, ids }. */
export async function backupKeys(javaHome, { file, password }) {
  checkPassword(password);
  if (!file || !path.isAbsolute(file)) throw new Error('The backup file must be an absolute path.');
  const entries = await exportKeyEntries(javaHome);
  if (entries.length === 0) throw new Error('This PC has no signing keys yet, so there is nothing to back up.');
  const plain = Buffer.from(JSON.stringify({ keys: entries }), 'utf8');
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const createdAt = new Date().toISOString();
  const header = { format: BACKUP_FORMAT, version: 1, createdAt, count: entries.length };
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(password, salt), iv);
  cipher.setAAD(Buffer.from(JSON.stringify(header), 'utf8'));
  const data = Buffer.concat([cipher.update(plain), cipher.final()]);
  const out = {
    ...header,
    kdf: { name: 'scrypt', N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, salt: salt.toString('base64') },
    cipher: { name: 'aes-256-gcm', iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64') },
    data: data.toString('base64'),
  };
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(out, null, 2), { mode: 0o600 });
  await fsp.rename(tmp, file);
  const ids = entries.map((e) => e.id);
  await noteBackedUp(ids, createdAt);
  return { file, count: entries.length, ids, createdAt };
}

/** When the last backup was made and which keys it held: { lastBackupAt, ids } or null. */
export function lastBackup() {
  const f = path.join(KEYSTORE_DIR, RECORD);
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {
    return null;
  }
}

function readBackup(file, password) {
  checkPassword(password);
  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    throw new Error('That file is not an AnyAppAgent key backup.');
  }
  if (doc?.format !== BACKUP_FORMAT || doc.version !== 1 || doc.kdf?.name !== 'scrypt' || doc.cipher?.name !== 'aes-256-gcm') {
    throw new Error('That file is not an AnyAppAgent key backup.');
  }
  const header = { format: doc.format, version: doc.version, createdAt: doc.createdAt, count: doc.count };
  const key = crypto.scryptSync(password.normalize('NFC'), Buffer.from(doc.kdf.salt, 'base64'), 32, {
    N: doc.kdf.N, r: doc.kdf.r, p: doc.kdf.p, maxmem: SCRYPT.maxmem,
  });
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(doc.cipher.iv, 'base64'));
    decipher.setAAD(Buffer.from(JSON.stringify(header), 'utf8'));
    decipher.setAuthTag(Buffer.from(doc.cipher.tag, 'base64'));
    const plain = Buffer.concat([decipher.update(Buffer.from(doc.data, 'base64')), decipher.final()]);
    return { header, keys: JSON.parse(plain.toString('utf8')).keys };
  } catch {
    throw new Error('Wrong password, or the backup file was changed.');
  }
}

/**
 * Restores the keys in `file` that this PC does not have.
 * Returns { added: [id], same: [id], conflicts: [{ id, reason }] }.
 */
export async function restoreKeys(javaHome, { file, password }) {
  const { header, keys } = readBackup(file, password);
  return importKeyEntries(javaHome, keys, header.createdAt);
}

/**
 * Adds the keys in `entries` (from exportKeyEntries) that this PC does not have; keeps every key it
 * has, and reports one with a different certificate as a conflict. `createdAt`: when the backup
 * they came from was made.
 */
export async function importKeyEntries(javaHome, entries, createdAt) {
  const result = { added: [], same: [], conflicts: [] };
  await fsp.mkdir(KEYSTORE_DIR, { recursive: true });
  await withFileLock(path.join(KEYSTORE_DIR, '.restore.lock'), async () => {
    for (const entry of entries) {
      try {
        const outcome = entry.id === SHARED_KEY_ID ? await restoreShared(javaHome, entry) : await restoreApp(javaHome, entry);
        if (outcome === 'added') result.added.push(entry.id);
        else result.same.push(entry.id);
      } catch (e) {
        result.conflicts.push({ id: entry.id, reason: e.message });
      }
    }
    // The keys now here from this backup are, by definition, in a backup.
    const safe = [...result.added, ...result.same];
    if (safe.length) {
      const last = lastBackup();
      const ids = [...new Set([...(last?.ids ?? []), ...safe])];
      const lastBackupAt = [last?.lastBackupAt, createdAt].filter(Boolean).sort().at(-1);
      await writeJson(path.join(KEYSTORE_DIR, RECORD), { lastBackupAt, ids });
    }
  });
  return result;
}

async function restoreShared(javaHome, entry) {
  const local = readSharedKey();
  if (local) {
    if ((await certSha256(javaHome, local)) === entry.info.certSha256) return 'same';
    throw new Error('This PC already has a different shared key; it was kept.');
  }
  const storeFile = path.join(KEYSTORE_DIR, 'anyapp-release.p12');
  if (fs.existsSync(storeFile)) throw new Error(`${storeFile} exists without its password file; it was kept.`);
  await writeKeyFiles(javaHome, entry, { storeFile }, path.join(KEYSTORE_DIR, 'keystore.json'), (paths) => ({
    storeFile: paths.storeFile,
    storePassword: entry.info.storePassword,
    keyAlias: entry.info.keyAlias,
    keyPassword: entry.info.keyPassword,
    certSha256: entry.info.certSha256,
  }));
  return 'added';
}

async function restoreApp(javaHome, entry) {
  const dir = appKeyDir(entry.id);
  const local = readAppKey(entry.id);
  if (local) {
    if (local.certSha256 === entry.info.certSha256) return 'same';
    throw new Error('This PC already has a different key for this app; it was kept.');
  }
  const storeFile = path.join(dir, 'release.p12');
  const lineageFile = entry.files.lineage ? path.join(dir, 'lineage.bin') : undefined;
  for (const f of [storeFile, lineageFile].filter(Boolean)) {
    if (fs.existsSync(f)) throw new Error(`${f} exists without its key.json; it was kept.`);
  }
  await fsp.mkdir(dir, { recursive: true });
  await writeKeyFiles(javaHome, entry, { storeFile, lineageFile }, path.join(dir, 'key.json'), (paths) => ({
    ...entry.info,
    storeFile: paths.storeFile,
    ...(paths.lineageFile ? { lineageFile: paths.lineageFile } : {}),
  }));
  return 'added';
}

/** Writes the key files, checks the restored key opens and has the expected certificate, then its info. */
async function writeKeyFiles(javaHome, entry, paths, infoFile, makeInfo) {
  await fsp.writeFile(paths.storeFile, Buffer.from(entry.files.store, 'base64'), { mode: 0o600 });
  if (paths.lineageFile) await fsp.writeFile(paths.lineageFile, Buffer.from(entry.files.lineage, 'base64'), { mode: 0o600 });
  const info = makeInfo(paths);
  let cert;
  try {
    cert = await certSha256(javaHome, { ...info, certSha256: undefined });
  } catch {
    cert = null;
  }
  if (cert !== entry.info.certSha256) {
    await fsp.rm(paths.storeFile, { force: true });
    if (paths.lineageFile) await fsp.rm(paths.lineageFile, { force: true });
    throw new Error('The key in the backup could not be opened; nothing was written for it.');
  }
  await writeJson(infoFile, info);
}
