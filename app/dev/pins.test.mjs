// node --test dev/pins.test.mjs : the home grid's sections and drag moves (src/lib/pins.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyPins, dropPin, homeSections, movePin, slotAt } from "../src/lib/pins.ts";

const app = (id, extra = {}) => ({ id, name: id, slug: id, packageName: `com.anyapp.${id}`, status: "idle", iconVersion: 1, createdAt: "2026-01-01", updatedAt: "2026-01-01", ...extra });

test("sections: pinned in pin order, the rest last changed first, hidden left out", () => {
  const apps = {
    a: app("a", { updatedAt: "2026-03-01" }),
    b: app("b", { pin: 1 }),
    c: app("c", { pin: 0 }),
    d: app("d", { updatedAt: "2026-04-01" }),
    e: app("e", { hidden: true, updatedAt: "2026-05-01" }),
    f: app("f", { move: { to: "cloud", state: "done", at: "" } }),
  };
  const { pinned, rest } = homeSections(apps);
  assert.deepEqual(pinned.map((x) => x.id), ["c", "b"]);
  assert.deepEqual(rest.map((x) => x.id), ["d", "a"]);
});

test("movePin: pin at a place, reorder, unpin, clamp", () => {
  assert.deepEqual(movePin(["a", "b"], "c", 1), ["a", "c", "b"]);
  assert.deepEqual(movePin(["a", "b", "c"], "a", 2), ["b", "c", "a"]);
  assert.deepEqual(movePin(["a", "b", "c"], "b", null), ["a", "c"]);
  assert.deepEqual(movePin(["a"], "z", 99), ["a", "z"]);
  assert.deepEqual(movePin([], "z", 0), ["z"]);
});

test("slotAt: insertion points, left half before, right half after, below the last row last", () => {
  const slots = [
    { x: 0, y: 0, width: 100, height: 100 },
    { x: 110, y: 0, width: 100, height: 100 },
    { x: 0, y: 110, width: 100, height: 100 },
  ];
  assert.equal(slotAt(slots, 20, 50), 0);
  assert.equal(slotAt(slots, 80, 50), 1);
  assert.equal(slotAt(slots, 190, 50), 2);
  // The empty place right of the last tile: after it.
  assert.equal(slotAt(slots, 180, 160), 3);
  assert.equal(slotAt(slots, 50, 300), 3);
  assert.equal(slotAt([], 0, 0), -1);
});

test("dropPin: reorder, pin at a place, unpin", () => {
  assert.deepEqual(dropPin(["a", "b", "c"], "a", 2), ["b", "a", "c"]);
  assert.deepEqual(dropPin(["a", "b", "c"], "a", 3), ["b", "c", "a"]);
  assert.deepEqual(dropPin(["a", "b", "c"], "c", 0), ["c", "a", "b"]);
  assert.deepEqual(dropPin(["a", "b"], "z", 1), ["a", "z", "b"]);
  assert.deepEqual(dropPin(["a", "b"], "a", null), ["b"]);
});

test("applyPins numbers the section and drops pins of the rest", () => {
  const next = applyPins({ a: app("a", { pin: 0 }), b: app("b"), c: app("c", { pin: 1 }) }, ["b", "a"]);
  assert.equal(next.b.pin, 0);
  assert.equal(next.a.pin, 1);
  assert.equal("pin" in next.c, false);
});
