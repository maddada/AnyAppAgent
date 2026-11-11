// "Never lose your apps" (docs/TRUST.md, "Backup"): one switch backs up what cannot be made again
// (every app's signing key, every app's code with its history, its chat and to-do list) into a
// folder the person picks (a OneDrive or USB folder), and restores it all on a new PC.
//
// Encryption, so the PC can back up by itself without keeping the password:
//   - Turning it on makes a recovery key pair (X25519). The private half is encrypted with the
//     person's password (scrypt N=2^16, r=8, p=1, then AES-256-GCM, as the key backup in
//     builder/lib/keybackup.mjs) and written to <folder>/AnyAppAgent backup/recovery.json. The PC
//     keeps only the public half (<state>/backup.json). The password is never stored or logged.
//   - Each backup file: a fresh X25519 key pair, ECDH with the recovery public key, HKDF-SHA256 to
//     an AES-256-GCM key; the header (format, date, the fresh public key, iv) is the GCM AAD, so a
//     changed file is refused. Nothing about the apps is in the clear.
//   - So a stolen backup folder is useless without the password, and the PC itself cannot read its
//     own backups: only the password opens them (on restore).
// The signing keys come from the builder's key export (the same entries the key backup encrypts).
import { createCipheriv, createDecipheriv, createPrivateKey, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync, randomBytes, scryptSync, type KeyObject } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import type { App, BackupRestoreResult, BackupState, BackupSummary, ChatItem } from "../../shared/protocol.ts";
import type { Builder, KeyEntry } from "./builder.ts";
import { nowIso, readJson, writeJsonAtomic } from "./fs-util.ts";
import { run } from "./git.ts";
import { HttpError } from "./http-error.ts";
import type { AppRecord } from "./store.ts";

export const BACKUP_DIR_NAME = "AnyAppAgent backup";
export const RECOVERY_FILE = "recovery.json";
export const RECOVERY_FORMAT = "anyappagent-backup-recovery";
export const BACKUP_FORMAT = "anyappagent-backup";
export const BACKUP_EXT = ".anyappbackup";
export const MIN_BACKUP_PASSWORD = 8;
const MAGIC = Buffer.from("ANYAPPAGENT-BACKUP\n", "utf8");
const SCRYPT = { N: 2 ** 16, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
const KEEP_FILES = 5;
const HKDF_INFO = Buffer.from("anyappagent-backup-v1", "utf8");
/** A backup older than this is made again by the hourly check. */
const DAILY_MS = 24 * 3600_000;
/** After a build, wait this long for more changes before backing up. */
const AFTER_CHANGE_MS = 2 * 60_000;

// ---------- the archive inside the encryption: named entries, one after another

export function packEntries(entries: { name: string; data: Buffer }[]): Buffer {
  const parts: Buffer[] = [];
  for (const e of entries) {
    const name = Buffer.from(e.name, "utf8");
    const head = Buffer.alloc(12);
    head.writeUInt32BE(name.length, 0);
    head.writeBigUInt64BE(BigInt(e.data.length), 4);
    parts.push(head, name, e.data);
  }
  return Buffer.concat(parts);
}

export function unpackEntries(buf: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  let at = 0;
  while (at < buf.length) {
    if (at + 12 > buf.length) throw new Error("The backup is cut short.");
    const nameLen = buf.readUInt32BE(at);
    const size = Number(buf.readBigUInt64BE(at + 4));
    at += 12;
    if (at + nameLen + size > buf.length) throw new Error("The backup is cut short.");
    out.set(buf.subarray(at, at + nameLen).toString("utf8"), buf.subarray(at + nameLen, at + nameLen + size));
    at += nameLen + size;
  }
  return out;
}

// ---------- the recovery key

interface RecoveryFile {
  format: typeof RECOVERY_FORMAT;
  version: 1;
  createdAt: string;
  publicKey: string; // base64 SPKI DER of the X25519 public key
  kdf: { name: "scrypt"; N: number; r: number; p: number; salt: string };
  cipher: { name: "aes-256-gcm"; iv: string; tag: string };
  privateKey: string; // base64: the PKCS#8 DER private key, encrypted
}

function checkPassword(password: unknown): string {
  if (typeof password !== "string" || password.length < MIN_BACKUP_PASSWORD) {
    throw new HttpError(400, `The password must be at least ${MIN_BACKUP_PASSWORD} characters.`);
  }
  return password;
}

export function makeRecovery(password: string): { file: RecoveryFile; publicKey: KeyObject } {
  const { publicKey, privateKey } = generateKeyPairSync("x25519");
  const pub = publicKey.export({ type: "spki", format: "der" }).toString("base64");
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(password.normalize("NFC"), salt, 32, SCRYPT);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(pub, "utf8"));
  const data = Buffer.concat([cipher.update(privateKey.export({ type: "pkcs8", format: "der" })), cipher.final()]);
  return {
    publicKey,
    file: {
      format: RECOVERY_FORMAT,
      version: 1,
      createdAt: nowIso(),
      publicKey: pub,
      kdf: { name: "scrypt", N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, salt: salt.toString("base64") },
      cipher: { name: "aes-256-gcm", iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64") },
      privateKey: data.toString("base64"),
    },
  };
}

export function readRecovery(path: string): RecoveryFile {
  let doc: RecoveryFile;
  try {
    doc = JSON.parse(readFileSync(path, "utf8")) as RecoveryFile;
  } catch {
    throw new HttpError(400, "There is no AnyAppAgent backup in that folder.");
  }
  if (doc?.format !== RECOVERY_FORMAT || doc.version !== 1 || doc.kdf?.name !== "scrypt" || doc.cipher?.name !== "aes-256-gcm") {
    throw new HttpError(400, "There is no AnyAppAgent backup in that folder.");
  }
  return doc;
}

export function openRecovery(doc: RecoveryFile, password: string): KeyObject {
  const key = scryptSync(password.normalize("NFC"), Buffer.from(doc.kdf.salt, "base64"), 32, { N: doc.kdf.N, r: doc.kdf.r, p: doc.kdf.p, maxmem: SCRYPT.maxmem });
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(doc.cipher.iv, "base64"));
    decipher.setAAD(Buffer.from(doc.publicKey, "utf8"));
    decipher.setAuthTag(Buffer.from(doc.cipher.tag, "base64"));
    const der = Buffer.concat([decipher.update(Buffer.from(doc.privateKey, "base64")), decipher.final()]);
    return createPrivateKey({ key: der, format: "der", type: "pkcs8" });
  } catch {
    throw new HttpError(400, "Wrong password, or the backup was changed.");
  }
}

function publicKeyOf(base64: string): KeyObject {
  return createPublicKey({ key: Buffer.from(base64, "base64"), format: "der", type: "spki" });
}

// ---------- one backup file

interface FileHeader {
  format: typeof BACKUP_FORMAT;
  version: 1;
  createdAt: string;
  ephemeralKey: string; // base64 SPKI DER
  iv: string;
}

function fileKey(shared: Buffer, ephemeralDer: Buffer): Buffer {
  return Buffer.from(hkdfSync("sha256", shared, ephemeralDer, HKDF_INFO, 32));
}

export function sealBackup(plain: Buffer, recipient: KeyObject, createdAt = nowIso()): Buffer {
  const eph = generateKeyPairSync("x25519");
  const ephDer = eph.publicKey.export({ type: "spki", format: "der" });
  const key = fileKey(diffieHellman({ privateKey: eph.privateKey, publicKey: recipient }), ephDer);
  const iv = randomBytes(12);
  const header: FileHeader = { format: BACKUP_FORMAT, version: 1, createdAt, ephemeralKey: ephDer.toString("base64"), iv: iv.toString("base64") };
  const headerBytes = Buffer.from(JSON.stringify(header), "utf8");
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(headerBytes);
  const data = Buffer.concat([cipher.update(plain), cipher.final()]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(headerBytes.length, 0);
  return Buffer.concat([MAGIC, len, headerBytes, data, cipher.getAuthTag()]);
}

export function openBackup(file: Buffer, privateKey: KeyObject): { createdAt: string; plain: Buffer } {
  const bad = () => new HttpError(400, "That backup file is damaged or was changed.");
  if (file.length < MAGIC.length + 4 + 16 || !file.subarray(0, MAGIC.length).equals(MAGIC)) throw bad();
  const len = file.readUInt32BE(MAGIC.length);
  const start = MAGIC.length + 4;
  if (start + len + 16 > file.length) throw bad();
  const headerBytes = file.subarray(start, start + len);
  let header: FileHeader;
  try {
    header = JSON.parse(headerBytes.toString("utf8")) as FileHeader;
  } catch {
    throw bad();
  }
  if (header.format !== BACKUP_FORMAT || header.version !== 1) throw bad();
  const ephDer = Buffer.from(header.ephemeralKey, "base64");
  try {
    const key = fileKey(diffieHellman({ privateKey, publicKey: publicKeyOf(header.ephemeralKey) }), ephDer);
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(header.iv, "base64"));
    decipher.setAAD(headerBytes);
    decipher.setAuthTag(file.subarray(file.length - 16));
    const plain = Buffer.concat([decipher.update(file.subarray(start + len, file.length - 16)), decipher.final()]);
    return { createdAt: header.createdAt, plain };
  } catch {
    throw new HttpError(400, "That backup could not be opened with this password, or it was changed.");
  }
}

// ---------- what goes in

interface ManifestApp {
  app: App;
  dirName: string;
  code: boolean; // a Git bundle of its whole history is in apps/<id>/code.bundle
}
interface Manifest {
  format: typeof BACKUP_FORMAT;
  createdAt: string;
  pc: string;
  apps: ManifestApp[];
  keys: number;
}

interface BackupFile {
  enabled: boolean;
  folder?: string;
  publicKey?: string;
  lastBackupAt: string | null;
  lastError?: string;
  apps: number;
  keys: number;
  sizeBytes?: number;
}

export interface BackupDeps {
  stateDir: string;
  appsDir: string;
  builder: Builder;
  log: (...parts: unknown[]) => void;
  /** The apps to back up (not deleted ones). */
  records(): AppRecord[];
  /** An app restored from a backup joins the list (it is not in it: checked first). */
  addRestored(record: AppRecord, chat: ChatItem[], todos: unknown): void;
  /** Builds a restored app once, so phones get a version that installs over the one they have. */
  buildRestored(appId: string): void;
  /** Whether an app with this id or package is already here. */
  hasApp(id: string, packageName: string): boolean;
}

/** Plain words for a folder that cannot be written (a USB drive that is not plugged in). */
function folderProblem(error: unknown, folder: string): string {
  const code = (error as NodeJS.ErrnoException)?.code;
  if (code === "ENOENT") return `The backup folder ${folder} is not there. Is the drive plugged in?`;
  if (code === "EACCES" || code === "EPERM") return `This PC may not write to ${folder}. Pick another folder in Settings.`;
  if (code === "ENOSPC") return `The backup folder ${folder} is full.`;
  return `The backup could not be saved: ${(error as Error)?.message ?? String(error)}`;
}

export class Backups {
  private readonly deps: BackupDeps;
  private readonly path: string;
  private data: BackupFile;
  private running: Promise<void> | undefined;
  private soonTimer: NodeJS.Timeout | undefined;
  private dailyTimer: NodeJS.Timeout | undefined;
  onChange: () => void = () => {};

  constructor(deps: BackupDeps) {
    this.deps = deps;
    this.path = join(deps.stateDir, "backup.json");
    this.data = readJson<BackupFile>(this.path, { enabled: false, lastBackupAt: null, apps: 0, keys: 0 });
  }

  /** The hourly check: backs up when the last backup is a day old. */
  start(): void {
    this.dailyTimer = setInterval(() => this.dailyCheck(), 3600_000);
    this.dailyTimer.unref?.();
    setTimeout(() => this.dailyCheck(), 30_000).unref?.();
  }

  stop(): void {
    if (this.dailyTimer) clearInterval(this.dailyTimer);
    if (this.soonTimer) clearTimeout(this.soonTimer);
  }

  private dailyCheck(): void {
    if (!this.data.enabled) return;
    const last = this.data.lastBackupAt ? Date.parse(this.data.lastBackupAt) : 0;
    if (Date.now() - last >= DAILY_MS) void this.run().catch(() => undefined);
  }

  summary(): BackupSummary {
    return { enabled: this.data.enabled, lastBackupAt: this.data.lastBackupAt, apps: this.data.apps, ...(this.data.lastError ? { lastError: this.data.lastError } : {}) };
  }

  state(): BackupState {
    return {
      ...this.summary(),
      ...(this.data.enabled && this.data.folder ? { folder: this.data.folder } : {}),
      keys: this.data.keys,
      ...(this.data.sizeBytes !== undefined ? { sizeBytes: this.data.sizeBytes } : {}),
      onGithub: this.deps.records().filter((r) => r.app.repoUrl).length,
      running: this.running !== undefined,
    };
  }

  private save(): void {
    writeJsonAtomic(this.path, this.data);
    this.onChange();
  }

  private backupDir(folder = this.data.folder): string {
    if (!folder) throw new HttpError(409, "Backups are off.");
    return join(folder, BACKUP_DIR_NAME);
  }

  /**
   * Turns backups on (a folder and a password) or off. A folder that already holds an AnyAppAgent
   * backup keeps its recovery key, so the password must be the one it was made with.
   */
  async setup(req: { enabled?: unknown; folder?: unknown; password?: unknown }): Promise<BackupState> {
    if (typeof req.enabled !== "boolean") throw new HttpError(400, '"enabled" must be true or false.');
    if (!req.enabled) {
      this.data = { ...this.data, enabled: false };
      delete this.data.lastError;
      this.save();
      this.deps.log("backups turned off (the backup files are kept)");
      return this.state();
    }
    if (typeof req.folder !== "string" || !/^([a-zA-Z]:[\\/]|\\\\|\/)/.test(req.folder)) throw new HttpError(400, '"folder" must be an absolute path.');
    const folder = req.folder;
    const password = checkPassword(req.password);
    const dir = this.backupDir(folder);
    const recoveryPath = join(dir, RECOVERY_FILE);
    let publicKey: string;
    if (existsSync(recoveryPath)) {
      const doc = readRecovery(recoveryPath);
      openRecovery(doc, password); // the same password, or it is refused
      publicKey = doc.publicKey;
    } else {
      try {
        mkdirSync(dir, { recursive: true });
        const made = makeRecovery(password);
        writeFileSync(recoveryPath, JSON.stringify(made.file, null, 2), { mode: 0o600 });
        publicKey = made.file.publicKey;
      } catch (error) {
        throw new HttpError(400, folderProblem(error, folder));
      }
    }
    this.data = { ...this.data, enabled: true, folder, publicKey };
    delete this.data.lastError;
    this.save();
    this.deps.log(`backups turned on, to ${dir}`);
    await this.run();
    return this.state();
  }

  /** A build landed: back up a little later (several changes in a row make one backup). */
  changed(): void {
    if (!this.data.enabled) return;
    if (this.soonTimer) clearTimeout(this.soonTimer);
    this.soonTimer = setTimeout(() => {
      this.soonTimer = undefined;
      void this.run().catch(() => undefined);
    }, AFTER_CHANGE_MS);
    this.soonTimer.unref?.();
  }

  /** Backs up now (one at a time). Rejects with a plain sentence; also kept as lastError. */
  async run(): Promise<BackupState> {
    if (!this.data.enabled || !this.data.publicKey || !this.data.folder) throw new HttpError(409, "Turn on backups first.");
    if (!this.running) {
      this.running = this.backupOnce().finally(() => {
        this.running = undefined;
        this.onChange();
      });
      this.onChange();
    }
    await this.running;
    return this.state();
  }

  private async backupOnce(): Promise<void> {
    const folder = this.data.folder!;
    const started = Date.now();
    try {
      const createdAt = nowIso();
      const { plain, apps, keys } = await this.collect(createdAt);
      const sealed = sealBackup(plain, publicKeyOf(this.data.publicKey!), createdAt);
      const dir = this.backupDir();
      if (!existsSync(dir)) throw Object.assign(new Error("missing"), { code: "ENOENT" });
      const name = `backup-${createdAt.replace(/[:.]/g, "-")}${BACKUP_EXT}`;
      const tmp = join(dir, `${name}.tmp`);
      writeFileSync(tmp, sealed, { mode: 0o600 });
      renameSync(tmp, join(dir, name));
      this.prune(dir);
      this.data = { ...this.data, lastBackupAt: createdAt, apps, keys, sizeBytes: sealed.length };
      delete this.data.lastError;
      this.save();
      this.deps.log(`backed up ${apps} apps and ${keys} signing keys (${Math.round(sealed.length / 1024)} KB, ${Math.round((Date.now() - started) / 1000)} s)`);
    } catch (error) {
      const text = error instanceof HttpError ? error.message : folderProblem(error, folder);
      this.data = { ...this.data, lastError: text };
      this.save();
      this.deps.log(`backup failed: ${text}`);
      throw new HttpError(400, text);
    }
  }

  private prune(dir: string): void {
    const files = readdirSync(dir).filter((f) => f.startsWith("backup-") && f.endsWith(BACKUP_EXT)).sort();
    for (const f of files.slice(0, Math.max(0, files.length - KEEP_FILES))) rmSync(join(dir, f), { force: true });
  }

  private async collect(createdAt: string): Promise<{ plain: Buffer; apps: number; keys: number }> {
    const entries: { name: string; data: Buffer }[] = [];
    const manifest: Manifest = { format: BACKUP_FORMAT, createdAt, pc: hostname(), apps: [], keys: 0 };
    const keyEntries: KeyEntry[] = this.deps.builder.keys?.exportEntries ? await this.deps.builder.keys.exportEntries() : [];
    manifest.keys = keyEntries.length;
    if (keyEntries.length > 0) entries.push({ name: "keys.json", data: Buffer.from(JSON.stringify(keyEntries), "utf8") });
    const scratch = join(tmpdir(), `anyapp-backup-${process.pid}-${Date.now()}`);
    mkdirSync(scratch, { recursive: true });
    try {
      for (const record of this.deps.records()) {
        const { app } = record;
        if (app.status === "creating" && !(record as { ready?: boolean }).ready) continue;
        const bundle = join(scratch, `${app.id}.bundle`);
        let code = false;
        if (existsSync(join(record.dir, ".git"))) {
          const r = await run("git", ["bundle", "create", bundle, "--all"], record.dir, 300_000);
          if (r.code === 0 && existsSync(bundle)) {
            entries.push({ name: `apps/${app.id}/code.bundle`, data: readFileSync(bundle) });
            code = true;
          } else {
            this.deps.log(`[${app.slug}] backup: no code bundle (${(r.stderr || r.stdout).trim().split(/\r?\n/).at(-1)})`);
          }
        }
        const chat = join(this.deps.stateDir, "chat", `${app.id}.json`);
        if (existsSync(chat)) entries.push({ name: `apps/${app.id}/chat.json`, data: readFileSync(chat) });
        const todos = join(this.deps.stateDir, "todos", `${app.id}.json`);
        if (existsSync(todos)) entries.push({ name: `apps/${app.id}/todos.json`, data: readFileSync(todos) });
        manifest.apps.push({ app, dirName: record.dir.split(/[\\/]/).at(-1) ?? app.slug, code });
      }
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
    entries.unshift({ name: "manifest.json", data: Buffer.from(JSON.stringify(manifest), "utf8") });
    if (keyEntries.length > 0 && this.deps.builder.keys?.markBackedUp) {
      await this.deps.builder.keys.markBackedUp(keyEntries.map((k) => k.id), createdAt).catch(() => undefined);
    }
    return { plain: packEntries(entries), apps: manifest.apps.length, keys: keyEntries.length };
  }

  /** The newest backup in `folder` (the picked folder or its "AnyAppAgent backup" folder). */
  private findBackup(folder: string): { dir: string; file: string } {
    const dir = existsSync(join(folder, RECOVERY_FILE)) ? folder : join(folder, BACKUP_DIR_NAME);
    if (!existsSync(join(dir, RECOVERY_FILE))) throw new HttpError(400, "There is no AnyAppAgent backup in that folder.");
    const files = readdirSync(dir).filter((f) => f.startsWith("backup-") && f.endsWith(BACKUP_EXT)).sort();
    if (files.length === 0) throw new HttpError(400, "That folder has the backup's key but no backup yet.");
    return { dir, file: join(dir, files.at(-1)!) };
  }

  /**
   * Restores a backup on this PC: adds every signing key it lacks (never replaces one), brings back
   * every app it does not have (its code with its history, its chat and to-do list), then builds
   * each once so phones get a version that installs over the one they have (same key, higher
   * version). Backups then carry on into the same folder with the same password.
   */
  async restore(req: { folder?: unknown; password?: unknown }): Promise<BackupRestoreResult> {
    if (typeof req.folder !== "string" || req.folder.trim() === "") throw new HttpError(400, '"folder" must be a folder.');
    const password = checkPassword(req.password);
    const { dir, file } = this.findBackup(req.folder);
    const recovery = readRecovery(join(dir, RECOVERY_FILE));
    const privateKey = openRecovery(recovery, password);
    const { createdAt, plain } = openBackup(readFileSync(file), privateKey);
    const entries = unpackEntries(plain);
    const manifest = JSON.parse(entries.get("manifest.json")?.toString("utf8") ?? "null") as Manifest | null;
    if (!manifest || manifest.format !== BACKUP_FORMAT) throw new HttpError(400, "That backup file is damaged or was changed.");

    let keys: BackupRestoreResult["keys"] = null;
    const keyData = entries.get("keys.json");
    if (keyData && this.deps.builder.keys?.importEntries) {
      keys = await this.deps.builder.keys.importEntries(JSON.parse(keyData.toString("utf8")) as KeyEntry[], createdAt);
      this.deps.log(`restore: signing keys ${keys.added.length} added, ${keys.same.length} already here, ${keys.conflicts.length} kept`);
    }

    const result: BackupRestoreResult = { backupCreatedAt: createdAt, apps: [], keys, rebuilding: 0 };
    const scratch = join(tmpdir(), `anyapp-restore-${process.pid}-${Date.now()}`);
    mkdirSync(scratch, { recursive: true });
    const toBuild: string[] = [];
    try {
      for (const item of manifest.apps) {
        const app = item.app;
        if (this.deps.hasApp(app.id, app.packageName)) {
          result.apps.push({ id: app.id, name: app.name, outcome: "here" });
          continue;
        }
        try {
          const target = this.freeDir(item.dirName || app.slug);
          const bundle = entries.get(`apps/${app.id}/code.bundle`);
          if (!bundle) throw new Error("its code was not in the backup");
          const bundlePath = join(scratch, `${app.id}.bundle`);
          writeFileSync(bundlePath, bundle);
          mkdirSync(this.deps.appsDir, { recursive: true });
          const clone = await run("git", ["clone", "--quiet", bundlePath, target], this.deps.appsDir, 300_000);
          if (clone.code !== 0) throw new Error((clone.stderr || clone.stdout).trim().split(/\r?\n/).at(-1) ?? "git clone failed");
          // Its private GitHub repo stays its remote; without one, the bundle file is not a remote.
          if (app.repoUrl) await run("git", ["remote", "set-url", "origin", `${app.repoUrl}.git`], target);
          else await run("git", ["remote", "remove", "origin"], target);
          const chat = JSON.parse(entries.get(`apps/${app.id}/chat.json`)?.toString("utf8") ?? "[]") as ChatItem[];
          const todos = JSON.parse(entries.get(`apps/${app.id}/todos.json`)?.toString("utf8") ?? "null") as unknown;
          this.deps.addRestored({ app: restoredApp(app), dir: target }, chat, todos);
          result.apps.push({ id: app.id, name: app.name, outcome: "restored" });
          toBuild.push(app.id);
          this.deps.log(`[${app.slug}] restored into ${target}`);
        } catch (error) {
          result.apps.push({ id: app.id, name: app.name, outcome: "failed", reason: (error as Error).message });
          this.deps.log(`[${app.slug}] could not be restored: ${(error as Error).message}`);
        }
      }
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
    // Carry on backing up into the same folder, with the same recovery key (and so the same password).
    const folder = dir.endsWith(BACKUP_DIR_NAME) ? dir.slice(0, -BACKUP_DIR_NAME.length - 1) : dir;
    this.data = { ...this.data, enabled: true, folder, publicKey: recovery.publicKey, lastBackupAt: this.data.lastBackupAt ?? createdAt, apps: manifest.apps.length, keys: manifest.keys };
    delete this.data.lastError;
    this.save();
    for (const id of toBuild) this.deps.buildRestored(id);
    result.rebuilding = toBuild.length;
    return result;
  }

  private freeDir(name: string): string {
    const clean = name.replace(/[^a-zA-Z0-9-]/g, "") || "app";
    let dir = join(this.deps.appsDir, clean);
    for (let n = 2; existsSync(dir) && readdirSync(dir).length > 0; n++) dir = join(this.deps.appsDir, `${clean}-${n}`);
    return dir;
  }
}

/** The app as it is on a new PC: nothing running, no session, and no APK file here yet. */
function restoredApp(app: App): App {
  const { replying: _r, activeHelpers: _h, error: _e, latestApk: _apk, health: _health, waitingForAnswer: _w, ...rest } = app;
  const out: App = { ...rest, status: "idle", updatedAt: nowIso() };
  // The next build's number follows the last one, so it installs over the copy on the phone.
  const last = Math.max(app.latestApk?.number ?? 0, app.latestBuild?.number ?? 0);
  if (last > 0) out.latestBuild = { number: last, status: "succeeded", startedAt: app.latestBuild?.startedAt ?? nowIso(), finishedAt: app.latestBuild?.finishedAt ?? nowIso() };
  else delete out.latestBuild;
  return out;
}
