// Easy Connect for the companion, after Ghostex's (gxserver server/src/tailcat/supervisor.rs and
// server/src/remote_access/): one Tailcat helper serves ONLY the companion's port; a one-time
// secret (5 minutes, single use) goes into the QR together with the helper's address; while that
// secret is live the helper's allow-list is lifted so a new phone can reach POST
// /api/pair/easy-connect through the tunnel; the phone's tailcat client key then goes on the
// allow-list and the helper is restarted with it, so afterwards only paired phones get in.
import { randomBytes, timingSafeEqual, createHash } from "node:crypto";
import { hostname } from "node:os";
import { join } from "node:path";
import type { EasyConnectState } from "../../../shared/protocol.ts";
import type { Auth } from "../auth.ts";
import { readJson, writeJsonAtomic } from "../fs-util.ts";
import { encodeEasyConnectCode } from "./code.ts";
import { allowArgument, ensureServerKey, ensureTailcat, TailcatServer, type TailcatPaths } from "./tailcat.ts";

export const EASY_CONNECT_CODE_TTL_MS = 5 * 60_000;
/** After a phone paired, the window stays open this long so its answer gets back before the restart. */
const RESTORE_AFTER_PAIRING_MS = 3_000;
const CLIENT_KEY_PATTERN = /^nodekey:[0-9a-f]{64}$/;

export class PairingRefused extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

interface LiveSecret {
  value: string;
  expiresAt: number;
  used: boolean;
}

export class EasyConnect {
  private readonly paths: TailcatPaths;
  private readonly settingsPath: string;
  private readonly port: number;
  private readonly auth: Auth;
  private readonly log: (message: string) => void;
  private readonly server: TailcatServer;
  private status: EasyConnectState["state"] = "off";
  private detail: string | undefined;
  private error: string | undefined;
  private binary: string | undefined;
  private address: string | null = null;
  private secret: LiveSecret | undefined;
  private expiryTimer: NodeJS.Timeout | undefined;
  private restoreTimer: NodeJS.Timeout | undefined;
  private turningOn: Promise<void> | undefined;
  onChange: () => void = () => {};

  constructor(options: { stateDir: string; port: number; auth: Auth; log: (message: string) => void }) {
    this.paths = { toolsDir: join(options.stateDir, "tools"), dataDir: join(options.stateDir, "easy-connect") };
    this.settingsPath = join(this.paths.dataDir, "settings.json");
    this.port = options.port;
    this.auth = options.auth;
    this.log = options.log;
    this.server = new TailcatServer({
      paths: this.paths,
      log: options.log,
      onAddress: (address) => {
        this.address = address;
        if (this.status === "starting" && address) {
          this.status = "ready";
          this.detail = undefined;
          this.log("Easy Connect is ready");
        }
        this.onChange();
      },
      onExit: (message) => {
        this.log(message);
        this.status = "starting";
        this.detail = "Easy Connect is restarting…";
        this.onChange();
      },
    });
  }

  /**
   * At startup: turn it back on when it was on before, for the phones already paired. No code is
   * made (and so the allow-list stays closed) until the desktop asks for one with pairing/new.
   */
  init(): void {
    if (readJson<{ enabled?: boolean }>(this.settingsPath, {}).enabled) void this.turnOn(false);
  }

  state(): EasyConnectState {
    const live = this.liveSecret();
    const out: EasyConnectState = { state: this.status };
    if (this.status === "ready" && live && this.address) {
      out.code = encodeEasyConnectCode({ address: this.address, secret: live.value, port: this.port, name: hostname() });
      out.expiresAt = new Date(live.expiresAt).toISOString();
    }
    if (this.status === "error" && this.error) out.error = this.error;
    if (this.status === "starting" && this.detail) out.detail = this.detail;
    return out;
  }

  async setEnabled(enabled: boolean): Promise<void> {
    writeJsonAtomic(this.settingsPath, { enabled });
    if (enabled) {
      if (this.status === "off" || this.status === "error") void this.turnOn(true);
      return;
    }
    this.clearSecret();
    this.server.stop();
    this.status = "off";
    this.address = null;
    this.detail = undefined;
    this.error = undefined;
    this.log("Easy Connect is off");
    this.onChange();
  }

  private turnOn(withCode: boolean): Promise<void> {
    this.turningOn ??= (async () => {
      this.status = "starting";
      this.error = undefined;
      this.detail = "Setting up Easy Connect…";
      this.onChange();
      try {
        this.binary = await ensureTailcat(this.paths, (message) => {
          this.detail = message;
          this.onChange();
        });
        ensureServerKey(this.binary, this.paths);
        if (withCode) this.makeSecret();
        this.detail = "Starting Easy Connect…";
        this.apply("turnedOn");
      } catch (error) {
        this.status = "error";
        this.error = `Easy Connect could not start: ${(error as Error).message}`;
        this.log(this.error);
        this.onChange();
      } finally {
        this.turningOn = undefined;
      }
    })();
    return this.turningOn;
  }

  /** A fresh one-time code (POST /api/admin/pairing/new). */
  newCode(): void {
    if (this.status !== "ready" && this.status !== "starting") return;
    this.makeSecret();
    this.apply("allowListLiftedForPairing");
  }

  /** Devices were added or removed: serve the new allow-list. */
  devicesChanged(): void {
    // Right after a pairing the restore below applies the new list anyway; restarting the helper
    // now would cut off the pairing answer that is still on its way back through the tunnel.
    if (this.restoreTimer) return;
    if (this.status === "ready" || this.status === "starting") this.apply("allowListChanged");
  }

  private liveSecret(): LiveSecret | undefined {
    const secret = this.secret;
    return secret && !secret.used && secret.expiresAt > Date.now() ? secret : undefined;
  }

  private makeSecret(): void {
    this.clearSecret();
    this.secret = { value: randomBytes(24).toString("base64url"), expiresAt: Date.now() + EASY_CONNECT_CODE_TTL_MS, used: false };
    this.expiryTimer = setTimeout(() => {
      this.secret = undefined;
      this.log("Easy Connect code expired");
      this.apply("allowListRestored");
      this.onChange();
    }, EASY_CONNECT_CODE_TTL_MS);
  }

  private clearSecret(): void {
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    if (this.restoreTimer) clearTimeout(this.restoreTimer);
    this.expiryTimer = undefined;
    this.restoreTimer = undefined;
    this.secret = undefined;
  }

  private apply(reason: string): void {
    if (!this.binary) return;
    const keys = this.auth.list().flatMap((device) => (device.clientKey ? [device.clientKey] : []));
    this.server.apply({ binary: this.binary, port: this.port, allow: allowArgument(keys, this.liveSecret() !== undefined) }, reason);
  }

  /** POST /api/pair/easy-connect: spend the one-time secret, admit this phone's client key. */
  pair(body: { secret?: unknown; deviceName?: unknown; clientKey?: unknown }): { token: string } {
    if (this.auth.locked()) throw new PairingRefused(429, "Too many wrong codes. Wait a minute and try again.");
    const live = this.liveSecret();
    const given = typeof body.secret === "string" ? body.secret : "";
    const same =
      live !== undefined &&
      timingSafeEqual(createHash("sha256").update(given).digest(), createHash("sha256").update(live.value).digest());
    if (!same) {
      this.auth.noteFailure();
      throw new PairingRefused(401, "This Easy Connect code is used up or too old. Show a new QR code on your PC and scan it again.");
    }
    const clientKey = typeof body.clientKey === "string" ? body.clientKey.trim() : "";
    if (!CLIENT_KEY_PATTERN.test(clientKey)) throw new PairingRefused(400, "The phone did not send its Easy Connect key. Update the AnyAppAgent app.");
    live!.used = true;
    const deviceName = typeof body.deviceName === "string" ? body.deviceName : "Phone";
    const { token } = this.auth.issue(deviceName, "easy-connect", clientKey);
    this.log(`paired a new device over Easy Connect: ${deviceName.slice(0, 80)}`);
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    this.restoreTimer = setTimeout(() => {
      this.restoreTimer = undefined;
      this.secret = undefined;
      this.apply("allowListRestored");
      this.onChange();
    }, RESTORE_AFTER_PAIRING_MS);
    this.onChange();
    return { token };
  }

  stop(): void {
    this.clearSecret();
    this.server.stop();
  }
}
