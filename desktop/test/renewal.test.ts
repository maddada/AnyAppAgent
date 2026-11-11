import { describe, expect, it } from "vitest";
import { RENEW_WHILE_IDLE_MS, someoneIsHere } from "../src/renderer/src/renewal.ts";

describe("Easy Connect code renewal on the desktop", () => {
  const now = 1_000_000_000;
  it("renews while the window is in front and was used lately", () => {
    expect(someoneIsHere(now, now - 60_000, true, true)).toBe(true);
  });
  it("stops renewing when nobody used the window for a while, or it is hidden or in the back", () => {
    expect(someoneIsHere(now, now - RENEW_WHILE_IDLE_MS, true, true)).toBe(false);
    expect(someoneIsHere(now, now, false, true)).toBe(false);
    expect(someoneIsHere(now, now, true, false)).toBe(false);
  });
});
