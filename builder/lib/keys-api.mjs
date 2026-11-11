// The signing-key functions builder/index.mjs exports (docs/DISTRIBUTION.md, "Signing"):
//   listSigningKeys()                         -> { keys: [{ id, kind, certSha256, createdAt? }], lastBackupAt, notBackedUp: [id] }
//   appSigningKind({ packageName })           -> 'own' | 'moved' | 'shared'
//   moveAppToOwnKey({ packageName })          -> { kind: 'moved', certSha256 }
//   backupSigningKeys({ file, password })     -> { file, count, ids, createdAt }
//   restoreSigningKeys({ file, password })    -> { added, same, conflicts }
// Nothing returned above ever holds a password or a private key. For the whole-PC backup
// (server/src/backup.ts), which encrypts them in its own file:
//   exportSigningKeys()                       -> { entries }  (SECRET: keys and their passwords)
//   importSigningKeys({ entries, createdAt }) -> { added, same, conflicts }
//   markSigningKeysBackedUp({ ids, createdAt })
import { androidEnv } from './env.mjs';
import { backupKeys, exportKeyEntries, importKeyEntries, lastBackup, noteBackedUp, restoreKeys } from './keybackup.mjs';
import { listKeys, moveAppToOwnKey as move, readAppKey } from './keystore.mjs';

export async function listSigningKeys() {
  const keys = await listKeys(androidEnv().javaHome);
  const last = lastBackup();
  const backedUp = new Set(last?.ids ?? []);
  return { keys, lastBackupAt: last?.lastBackupAt ?? null, notBackedUp: keys.map((k) => k.id).filter((id) => !backedUp.has(id)) };
}

export function appSigningKind({ packageName }) {
  return readAppKey(packageName)?.kind ?? 'shared';
}

export async function moveAppToOwnKey({ packageName, onLog }) {
  const { javaHome, sdk } = androidEnv();
  const k = await move(javaHome, sdk, packageName, onLog);
  return { kind: k.kind, certSha256: k.certSha256 };
}

export async function backupSigningKeys({ file, password }) {
  return backupKeys(androidEnv().javaHome, { file, password });
}

export async function restoreSigningKeys({ file, password }) {
  return restoreKeys(androidEnv().javaHome, { file, password });
}

export async function exportSigningKeys() {
  return { entries: await exportKeyEntries(androidEnv().javaHome) };
}

export async function importSigningKeys({ entries, createdAt }) {
  if (!Array.isArray(entries)) throw new Error('importSigningKeys: entries must be a list');
  return importKeyEntries(androidEnv().javaHome, entries, createdAt);
}

export async function markSigningKeysBackedUp({ ids, createdAt }) {
  await noteBackedUp(ids, createdAt);
}
