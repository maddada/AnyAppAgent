// Renewing an expired Easy Connect code must not restart the helper: every restart cut each
// phone's tunnel, APK downloads included (seen on a real phone: a restart every 5 minutes).
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EasyConnect, EASY_CONNECT_CODE_TTL_MS, RESTORE_AFTER_EXPIRY_MS } from "../src/easy-connect/controller.ts";
import type { ServeSpec } from "../src/easy-connect/tailcat.ts";

/** Stands in for TailcatServer: restarts only when what it serves changes, like the real one. */
class RecordingServer {
  spec: ServeSpec | undefined;
  restarts: string[] = [];
  apply(spec: ServeSpec, reason: string): void {
    if (this.spec && JSON.stringify(this.spec) === JSON.stringify(spec)) return;
    this.spec = spec;
    this.restarts.push(reason);
  }
  stop(): void {
    this.spec = undefined;
  }
}

function controller() {
  const devices = [{ id: "d1", deviceName: "Phone", clientKey: `nodekey:${"a".repeat(64)}` }];
  const auth = { list: () => devices, locked: () => false, noteFailure: () => {}, issue: () => ({ token: "t" }) };
  const ec = new EasyConnect({ stateDir: mkdtempSync(join(tmpdir(), "ec-renew-")), port: 9999, auth: auth as never, log: () => {} });
  const server = new RecordingServer();
  Object.assign(ec as unknown as Record<string, unknown>, { server, binary: "tailcat", status: "ready", address: "tcABC" });
  return { ec, server };
}

describe("Easy Connect code renewal", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("keeps the helper running when an expired code is replaced at once", () => {
    const { ec, server } = controller();
    ec.newCode();
    expect(server.restarts).toEqual(["allowListLiftedForPairing"]);
    for (let round = 0; round < 12; round++) {
      vi.advanceTimersByTime(EASY_CONNECT_CODE_TTL_MS);
      expect(ec.state().code).toBeUndefined(); // expired: the desktop asks for the next one
      vi.advanceTimersByTime(500);
      ec.newCode();
    }
    expect(server.restarts).toEqual(["allowListLiftedForPairing"]); // one start, no restart in an hour
    expect(server.spec?.allow).toBeNull();
  });

  it("closes the allow-list shortly after a code expires and nobody asks for another", () => {
    const { ec, server } = controller();
    ec.newCode();
    vi.advanceTimersByTime(EASY_CONNECT_CODE_TTL_MS + RESTORE_AFTER_EXPIRY_MS - 1);
    expect(server.spec?.allow).toBeNull();
    vi.advanceTimersByTime(1);
    expect(server.restarts).toEqual(["allowListLiftedForPairing", "allowListRestored"]);
    expect(server.spec?.allow).toBe(`nodekey:${"a".repeat(64)}`);
  });

  it("cannot pair after the code expired, even while the list is still open", () => {
    const { ec } = controller();
    ec.newCode();
    const secret = (ec as unknown as { secret: { value: string } }).secret.value;
    vi.advanceTimersByTime(EASY_CONNECT_CODE_TTL_MS + 1000);
    expect(() => ec.pair({ secret, deviceName: "x", clientKey: `nodekey:${"b".repeat(64)}` })).toThrow(/used up or too old/);
  });
});
