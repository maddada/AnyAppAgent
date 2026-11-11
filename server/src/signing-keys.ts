// The PC's signing keys, as the desktop app sees them (docs/DISTRIBUTION.md, "Signing"): a summary
// for AdminState, and the encrypted backup and restore. The work is done by builder/
// (lib/keybackup.mjs). Passwords pass straight through and are never kept or logged.
import { isAbsolute } from "node:path";
import type { KeysBackupResult, KeysRestoreResult, SigningKeysState } from "../../shared/protocol.ts";
import { HttpError } from "./apps.ts";
import type { Builder } from "./builder.ts";

export const MIN_KEYS_PASSWORD = 8;

export class SigningKeys {
  private current: SigningKeysState | undefined;
  private timer: NodeJS.Timeout | undefined;
  onChange: () => void = () => {};
  private readonly builder: Builder;
  private readonly appNames: () => Map<string, string>; // package id -> app name
  private readonly log: (...args: unknown[]) => void;

  constructor(builder: Builder, appNames: () => Map<string, string>, log: (...args: unknown[]) => void) {
    this.builder = builder;
    this.appNames = appNames;
    this.log = log;
  }

  get available(): boolean {
    return Boolean(this.builder.keys);
  }

  state(): SigningKeysState | undefined {
    return this.current;
  }

  /** Reads the keys again (soon, coalesced), then tells the desktop app if anything changed. */
  refreshSoon(delayMs = 500): void {
    if (!this.available) return;
    this.timer ??= setTimeout(() => {
      this.timer = undefined;
      void this.refresh();
    }, delayMs);
  }

  async refresh(): Promise<void> {
    const keys = this.builder.keys;
    if (!keys) return;
    try {
      const listed = await keys.list();
      const names = this.appNames();
      const next: SigningKeysState = {
        keys: listed.keys.map((k) => ({ id: k.id, kind: k.kind, certSha256: k.certSha256, ...(names.has(k.id) ? { appName: names.get(k.id) } : {}) })),
        lastBackupAt: listed.lastBackupAt,
        notBackedUp: listed.notBackedUp,
      };
      if (JSON.stringify(next) !== JSON.stringify(this.current)) {
        this.current = next;
        this.onChange();
      }
    } catch (error) {
      this.log("signing keys could not be read:", (error as Error).message);
    }
  }

  async backup(file: unknown, password: unknown): Promise<KeysBackupResult> {
    const keys = this.need();
    const args = checkArgs(file, password);
    try {
      const result = await keys.backup(args);
      this.log(`signing keys backed up (${result.count}) to ${result.file}`);
      await this.refresh();
      return { file: result.file, count: result.count, createdAt: result.createdAt };
    } catch (error) {
      throw new HttpError(400, (error as Error).message);
    }
  }

  async restore(file: unknown, password: unknown): Promise<KeysRestoreResult> {
    const keys = this.need();
    const args = checkArgs(file, password);
    try {
      const result = await keys.restore(args);
      this.log(`signing keys restored: ${result.added.length} added, ${result.same.length} already here, ${result.conflicts.length} kept`);
      await this.refresh();
      return result;
    } catch (error) {
      throw new HttpError(400, (error as Error).message);
    }
  }

  private need(): NonNullable<Builder["keys"]> {
    if (!this.builder.keys) throw new HttpError(409, "Signing keys are made by the real builder, which this companion is not using.");
    return this.builder.keys;
  }
}

function checkArgs(file: unknown, password: unknown): { file: string; password: string } {
  if (typeof file !== "string" || !isAbsolute(file)) throw new HttpError(400, '"file" must be an absolute path.');
  if (typeof password !== "string" || password.length < MIN_KEYS_PASSWORD) {
    throw new HttpError(400, `The password must be at least ${MIN_KEYS_PASSWORD} characters.`);
  }
  return { file, password };
}
