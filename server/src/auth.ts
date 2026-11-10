// Pairing: a 6-digit code shown on the PC, exchanged once for a bearer token. Only token
// hashes are stored (tokens.json in the state dir), so a restart keeps the phone paired.
// The desktop app's admin token (ANYAPP_ADMIN_TOKEN) is held in memory only.
import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { nowIso, readJson, writeJsonAtomic } from "./fs-util.ts";

export interface DeviceRecord {
  id: string;
  hash: string;
  deviceName: string;
  createdAt: string;
  lastSeenAt?: string;
  via?: "lan" | "easy-connect";
  clientKey?: string; // Easy Connect: the phone's tailcat client key ("nodekey:…"), on the helper's allow-list
}

const MAX_FAILURES_PER_MINUTE = 10;
export const ADMIN_DEVICE_ID = "admin";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function sameSecret(a: string, b: string): boolean {
  const left = createHash("sha256").update(a).digest();
  const right = createHash("sha256").update(b).digest();
  return timingSafeEqual(left, right);
}

export class Auth {
  private currentCode = "";
  private readonly stateDir: string;
  private readonly tokensPath: string;
  private readonly devices: DeviceRecord[];
  private readonly adminToken: string | undefined;
  private failures: number[] = [];
  private seenTimer: NodeJS.Timeout | undefined;
  onChange: () => void = () => {};

  constructor(stateDir: string, adminToken?: string) {
    mkdirSync(stateDir, { recursive: true });
    this.stateDir = stateDir;
    this.tokensPath = join(stateDir, "tokens.json");
    this.devices = readJson<DeviceRecord[]>(this.tokensPath, []);
    let migrated = false;
    for (const device of this.devices) {
      if (!device.id) {
        device.id = randomUUID();
        migrated = true;
      }
    }
    if (migrated) writeJsonAtomic(this.tokensPath, this.devices);
    this.adminToken = adminToken && adminToken.length >= 16 ? adminToken : undefined;
    this.newCode();
  }

  get code(): string {
    return this.currentCode;
  }

  get hasAdmin(): boolean {
    return this.adminToken !== undefined;
  }

  newCode(): string {
    this.currentCode = String(randomInt(0, 1_000_000)).padStart(6, "0");
    writeFileSync(join(this.stateDir, "pairing-code.txt"), `${this.currentCode}\n`);
    this.failures = [];
    return this.currentCode;
  }

  /** Counts a failed pairing attempt of any kind; true when attempts are locked for now. */
  noteFailure(): void {
    this.failures.push(Date.now());
  }

  locked(): boolean {
    const now = Date.now();
    this.failures = this.failures.filter((at) => now - at < 60_000);
    return this.failures.length >= MAX_FAILURES_PER_MINUTE;
  }

  /** Checks a same-network 6-digit code. "locked" after too many wrong codes. */
  checkCode(code: string): boolean | "locked" {
    const now = Date.now();
    this.failures = this.failures.filter((at) => now - at < 60_000);
    if (this.failures.length >= MAX_FAILURES_PER_MINUTE) return "locked";
    const given = Buffer.from(String(code).trim().padEnd(6, " ").slice(0, 6));
    if (!timingSafeEqual(given, Buffer.from(this.currentCode))) {
      this.failures.push(now);
      return false;
    }
    return true;
  }

  /** Issues a new device token (the caller has checked a code). */
  issue(deviceName: string, via: DeviceRecord["via"], clientKey?: string): { token: string; device: DeviceRecord } {
    const token = randomBytes(32).toString("base64url");
    const device: DeviceRecord = {
      id: randomUUID(),
      hash: hashToken(token),
      deviceName: deviceName.trim().slice(0, 80) || "Phone",
      createdAt: nowIso(),
      lastSeenAt: nowIso(),
      ...(via ? { via } : {}),
      ...(clientKey ? { clientKey } : {}),
    };
    this.devices.push(device);
    writeJsonAtomic(this.tokensPath, this.devices);
    this.onChange();
    return { token, device };
  }

  /** Same-network pairing: a new token, "locked", or null for a wrong code. */
  pair(code: string, deviceName: string): string | "locked" | null {
    const ok = this.checkCode(code);
    if (ok === "locked") return "locked";
    if (!ok) return null;
    return this.issue(deviceName, "lan").token;
  }

  isAdmin(token: string | undefined | null): boolean {
    return !!token && this.adminToken !== undefined && sameSecret(token, this.adminToken);
  }

  /** The device id a phone token belongs to, ADMIN_DEVICE_ID for the admin token, or null. */
  identify(token: string | undefined | null): string | null {
    if (!token) return null;
    if (this.isAdmin(token)) return ADMIN_DEVICE_ID;
    const hash = hashToken(token);
    const device = this.devices.find((record) => record.hash === hash);
    if (!device) return null;
    device.lastSeenAt = nowIso();
    this.seenTimer ??= setTimeout(() => {
      this.seenTimer = undefined;
      writeJsonAtomic(this.tokensPath, this.devices);
    }, 5_000);
    return device.id;
  }

  check(token: string | undefined | null): boolean {
    return this.identify(token) !== null;
  }

  list(): readonly DeviceRecord[] {
    return this.devices;
  }

  remove(id: string): boolean {
    const index = this.devices.findIndex((device) => device.id === id);
    if (index < 0) return false;
    this.devices.splice(index, 1);
    writeJsonAtomic(this.tokensPath, this.devices);
    this.onChange();
    return true;
  }

  flush(): void {
    if (this.seenTimer) {
      clearTimeout(this.seenTimer);
      this.seenTimer = undefined;
      writeJsonAtomic(this.tokensPath, this.devices);
    }
  }
}
