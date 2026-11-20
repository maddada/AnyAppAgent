import { describe, expect, it } from "vitest";
import type { PairedDevice } from "../../shared/protocol.ts";
import { olderThan, phonesBehind } from "../src/renderer/src/phoneBehind.ts";

const phone = (over: Partial<PairedDevice>): PairedDevice => ({ id: "p", name: "Fold", pairedAt: "2026-11-01T00:00:00Z", connected: true, via: "same-network", ...over });

describe("phones on an older Kiwimake", () => {
  it("compares MAJOR.MINOR.PATCH by number", () => {
    expect(olderThan("0.3.5", "0.3.6")).toBe(true);
    expect(olderThan("0.3.10", "0.3.9")).toBe(false);
    expect(olderThan("0.3.6", "0.3.6")).toBe(false);
    expect(olderThan("junk", "0.3.6")).toBe(false);
  });

  it("lists connected phones that said an older version or none", () => {
    const devices = [
      phone({ id: "old", appVersion: "0.3.5" }),
      phone({ id: "silent" }),
      phone({ id: "current", appVersion: "0.3.6" }),
      phone({ id: "newer", appVersion: "0.4.0" }),
      phone({ id: "away", connected: false }),
    ];
    expect(phonesBehind(devices, "0.3.6").map((d) => d.id)).toEqual(["old", "silent"]);
  });

  it("says nothing without a release from the PC (an older companion)", () => {
    expect(phonesBehind([phone({})], undefined)).toEqual([]);
  });
});
