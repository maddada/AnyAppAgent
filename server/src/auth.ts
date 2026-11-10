// Pairing: a 6-digit code shown on the PC, exchanged once for a bearer token. Only token
// hashes are stored (tokens.json in the state dir), so a restart keeps the phone paired.
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { nowIso, readJson, writeJsonAtomic } from "./fs-util.ts";

interface TokenRecord {
  hash: string;
  deviceName: string;
  createdAt: string;
}

const MAX_FAILURES_PER_MINUTE = 10;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export class Auth {
  readonly code: string;
  private readonly tokensPath: string;
  private readonly tokens: TokenRecord[];
  private failures: number[] = [];

  constructor(stateDir: string) {
    mkdirSync(stateDir, { recursive: true });
    this.tokensPath = join(stateDir, "tokens.json");
    this.tokens = readJson<TokenRecord[]>(this.tokensPath, []);
    this.code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    writeFileSync(join(stateDir, "pairing-code.txt"), `${this.code}\n`);
  }

  /** Returns a new token, "locked" after too many wrong codes, or null for a wrong code. */
  pair(code: string, deviceName: string): string | "locked" | null {
    const now = Date.now();
    this.failures = this.failures.filter((at) => now - at < 60_000);
    if (this.failures.length >= MAX_FAILURES_PER_MINUTE) return "locked";
    const given = Buffer.from(String(code).trim().padEnd(6, " ").slice(0, 6));
    if (!timingSafeEqual(given, Buffer.from(this.code))) {
      this.failures.push(now);
      return null;
    }
    const token = randomBytes(32).toString("base64url");
    this.tokens.push({ hash: hashToken(token), deviceName: deviceName.slice(0, 80) || "Phone", createdAt: nowIso() });
    writeJsonAtomic(this.tokensPath, this.tokens);
    return token;
  }

  check(token: string | undefined | null): boolean {
    if (!token) return false;
    const hash = hashToken(token);
    return this.tokens.some((record) => record.hash === hash);
  }
}
