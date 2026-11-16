import { describe, expect, it } from "vitest";
import type { App } from "../../shared/protocol.ts";
import { appSections, dropIndex, placePin, samePins, unpin } from "../src/renderer/src/pins.ts";

const app = (id: string, updatedAt: string, more: Partial<App> = {}): App =>
  ({ id, name: id, slug: id, packageName: `com.anyapp.${id}`, status: "idle", iconVersion: 1, createdAt: updatedAt, updatedAt, ...more }) as App;

describe("appSections", () => {
  it("puts pinned apps first in pin order, the rest by last change, and leaves hidden apps out", () => {
    const apps = [
      app("a", "2026-11-10T00:00:00Z"),
      app("b", "2026-11-12T00:00:00Z", { pin: 1 }),
      app("c", "2026-11-14T00:00:00Z"),
      app("d", "2026-11-01T00:00:00Z", { pin: 0 }),
      app("e", "2026-11-15T00:00:00Z", { hidden: true }),
    ];
    const { pinned, rest } = appSections(apps);
    expect(pinned.map((a) => a.id)).toEqual(["d", "b"]);
    expect(rest.map((a) => a.id)).toEqual(["c", "a"]);
  });

  it("has an empty Pinned section when nothing is pinned", () => {
    expect(appSections([app("a", "2026-11-10T00:00:00Z")]).pinned).toEqual([]);
  });
});

describe("dropIndex", () => {
  it("counts the row middles above the pointer", () => {
    expect(dropIndex([10, 30, 50], 0)).toBe(0);
    expect(dropIndex([10, 30, 50], 20)).toBe(1);
    expect(dropIndex([10, 30, 50], 60)).toBe(3);
    expect(dropIndex([], 60)).toBe(0);
  });
});

describe("placePin", () => {
  it("pins an app from the rest at the drop slot", () => {
    expect(placePin(["a", "b"], "x", 0)).toEqual(["x", "a", "b"]);
    expect(placePin(["a", "b"], "x", 1)).toEqual(["a", "x", "b"]);
    expect(placePin(["a", "b"], "x", 2)).toEqual(["a", "b", "x"]);
    expect(placePin([], "x", 0)).toEqual(["x"]);
  });

  it("moves a pinned app down and up", () => {
    expect(placePin(["a", "b", "c"], "a", 3)).toEqual(["b", "c", "a"]);
    expect(placePin(["a", "b", "c"], "a", 2)).toEqual(["b", "a", "c"]);
    expect(placePin(["a", "b", "c"], "c", 0)).toEqual(["c", "a", "b"]);
  });

  it("leaves the order alone when dropped on either side of itself", () => {
    expect(samePins(placePin(["a", "b", "c"], "b", 1), ["a", "b", "c"])).toBe(true);
    expect(samePins(placePin(["a", "b", "c"], "b", 2), ["a", "b", "c"])).toBe(true);
  });

  it("clamps a slot out of range", () => {
    expect(placePin(["a"], "x", 9)).toEqual(["a", "x"]);
    expect(placePin(["a"], "x", -1)).toEqual(["x", "a"]);
  });
});

describe("unpin", () => {
  it("drops the app from the Pinned section", () => {
    expect(unpin(["a", "b"], "a")).toEqual(["b"]);
    expect(unpin(["a", "b"], "x")).toEqual(["a", "b"]);
  });
});
