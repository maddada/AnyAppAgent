// node --test dev/packages.test.mjs : which packages the phone rechecks with Android (src/lib/packages.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { packagesComingBack, packagesToCheck } from "../src/lib/packages.ts";

const app = (id, extra = {}) => ({ id, packageName: `com.anyapp.${id}`, ...extra });

test("packagesToCheck: the list's apps and the ones only the cache still knows (a deleted app)", () => {
  const apps = { a: app("a"), b: app("b", { hidden: true }) };
  // c was deleted with "This phone": gone from the list, its cache entry still says installed.
  const cached = { "com.anyapp.a": { versionCode: 1 }, "com.anyapp.c": { versionCode: 1 } };
  assert.deepEqual(packagesToCheck(apps, cached).sort(), ["com.anyapp.a", "com.anyapp.b", "com.anyapp.c"]);
  assert.deepEqual(packagesToCheck({}, {}), []);
});

test("packagesComingBack: restored and unhidden apps, not the ones already shown or still hidden", () => {
  const before = { a: app("a"), h: app("h", { hidden: true }), k: app("k", { hidden: true }) };
  const incoming = [
    app("a"), // already in the list: an ordinary update
    app("r"), // restored from Recently deleted (or new to the list)
    app("h"), // unhidden
    app("k", { hidden: true }), // still hidden
    app("n", { hidden: true }), // restored but hidden
  ];
  assert.deepEqual(packagesComingBack(before, incoming), ["com.anyapp.r", "com.anyapp.h"]);
});
