// Run: node --test website/gallery-refresh.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { refreshGallery } from "./gallery-refresh.mjs";

const CERT = "c".repeat(64);
const wanted = { apps: [{ package: "com.anyapp.waterglass", name: "Water Glass", line: "One tap per glass.", repo: "maddada/anyapp-waterglass-releases" }] };
const feed = (over = {}) => async () => new Response(JSON.stringify({ format: 1, package: "com.anyapp.waterglass", build: 7, version: "1.3", signer: CERT, apks: [], ...over }));

test("an entry takes its version and certificate from the published update.json", async () => {
  const { list, problems } = await refreshGallery({ wanted, current: { apps: [] }, fetchImpl: feed() });
  assert.deepEqual(problems, []);
  assert.equal(list.apps[0].certSha256, CERT);
  assert.deepEqual(list.apps[0].latest, { version: "1.3", build: 7 });
  assert.equal(list.apps[0].icon, "https://raw.githubusercontent.com/maddada/anyapp-waterglass-releases/HEAD/icon.png");
});

test("a changed key, another package or no published version is refused", async () => {
  const current = { apps: [{ package: "com.anyapp.waterglass", certSha256: "d".repeat(64) }] };
  assert.match((await refreshGallery({ wanted, current, fetchImpl: feed() })).problems[0], /another key/);
  assert.equal((await refreshGallery({ wanted, current, fetchImpl: feed(), acceptNewKey: ["com.anyapp.waterglass"] })).problems.length, 0);
  assert.match((await refreshGallery({ wanted, current: { apps: [] }, fetchImpl: feed({ package: "com.anyapp.other" }) })).problems[0], /not com.anyapp.waterglass/);
  assert.match((await refreshGallery({ wanted, current: { apps: [] }, fetchImpl: async () => new Response("", { status: 404 }) })).problems[0], /no published version/);
});
