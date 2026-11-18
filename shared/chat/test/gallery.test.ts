// Run: node --test shared/chat/test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { feedProblem, galleryFeedUrl, galleryInstallUrl, gallerySlug, galleryState, galleryStateLine, OFFICIAL_BADGE, pickFeedApk, readFeed, readGallery, showsBadge } from "../index.ts";

const CERT = "a".repeat(64);
const entry = {
  package: "com.anyapp.waterglass",
  name: "Water Glass",
  line: "Tap once per glass and watch the day's goal fill up.",
  icon: "https://raw.githubusercontent.com/maddada/anyapp-waterglass-releases/HEAD/icon.png",
  repo: "maddada/anyapp-waterglass-releases",
  code: "maddada/anyapp-waterglass",
  certSha256: CERT.toUpperCase(),
  latest: { version: "1.2", build: 14 },
};

test("a list reads back, certificates lowercased, the maker filled in", () => {
  const list = readGallery({ format: 1, apps: [entry] });
  assert.equal(list.maker, "Kiwimake");
  assert.equal(list.apps.length, 1);
  assert.equal(list.apps[0]!.certSha256, CERT);
  assert.equal(list.apps[0]!.code, "maddada/anyapp-waterglass");
  assert.equal(OFFICIAL_BADGE, "Official Kiwimake App");
});

test("a bad entry hides only itself; repeats of a package are dropped", () => {
  const list = readGallery({
    format: 1,
    apps: [
      entry,
      { ...entry, package: "com.other.waterglass" },
      { ...entry, name: "Copy" },
      { ...entry, package: "com.anyapp.x", certSha256: "nothex" },
      { ...entry, package: "com.anyapp.y", repo: "maddada/waterglass" },
      { ...entry, package: "com.anyapp.z", name: "" },
    ],
  });
  assert.deepEqual(list.apps.map((a) => a.package), ["com.anyapp.waterglass"]);
});

test("another format or no list at all is refused", () => {
  assert.throws(() => readGallery({ format: 2, apps: [] }), /newer Kiwimake/);
  assert.throws(() => readGallery("nope"), /not readable/);
});

test("addresses: https only, plain http only to this PC; no em dashes in the words", () => {
  const list = readGallery({
    format: 1,
    apps: [
      { ...entry, line: "Drink water \u2014 every hour", icon: "http://evil.example/icon.png", feed: "http://evil.example/update.json" },
      { ...entry, package: "com.anyapp.testglass", feed: "http://10.0.2.2:8899/feed/update.json", installUrl: "http://10.0.2.2:8899/feed/testglass.apk", icon: "data:image/png;base64,iVBORw0KGgo=" },
    ],
  });
  const [a, b] = list.apps;
  assert.equal(a!.line, "Drink water, every hour");
  assert.equal(a!.icon, undefined);
  assert.equal(a!.feed, undefined);
  assert.equal(galleryFeedUrl(a!), "https://github.com/maddada/anyapp-waterglass-releases/releases/latest/download/update.json");
  assert.equal(galleryInstallUrl(a!), "https://github.com/maddada/anyapp-waterglass-releases/releases/latest/download/waterglass.apk");
  assert.equal(gallerySlug(a!), "waterglass");
  assert.equal(b!.feed, "http://10.0.2.2:8899/feed/update.json");
  assert.equal(galleryInstallUrl(b!), "http://10.0.2.2:8899/feed/testglass.apk");
  assert.ok(b!.icon?.startsWith("data:image/png"));
});

const feedUrl = "https://github.com/maddada/anyapp-waterglass-releases/releases/latest/download/update.json";
const feedBody = {
  format: 1,
  package: "com.anyapp.waterglass",
  build: 15,
  version: "1.3",
  notes: "Bigger numbers.",
  signer: CERT,
  blocked: [],
  apks: [
    { abi: "universal", name: "waterglass.apk", size: 100, sha256: "b".repeat(64) },
    { abi: "arm64-v8a", name: "waterglass-arm64-v8a.apk", size: 60, sha256: "c".repeat(64) },
    { abi: "x86_64", name: "../../evil.apk", size: 60, sha256: "d".repeat(64) },
  ],
};

test("the feed: APKs relative to it, the phone's own ABI first, else the full one", () => {
  const feed = readFeed(feedBody, feedUrl);
  assert.equal(feed.apks.length, 2);
  assert.equal(pickFeedApk(feed, ["arm64-v8a"])!.url, "https://github.com/maddada/anyapp-waterglass-releases/releases/latest/download/waterglass-arm64-v8a.apk");
  assert.equal(pickFeedApk(feed, ["x86_64", "arm64-v8a"])!.abi, "arm64-v8a");
  assert.equal(pickFeedApk(feed, ["x86"])!.abi, "universal");
});

test("a feed signed by another key, or pulled back, is not installed", () => {
  const app = readGallery({ format: 1, apps: [entry] }).apps[0]!;
  assert.equal(feedProblem(app, readFeed(feedBody, feedUrl)), null);
  assert.match(feedProblem(app, readFeed({ ...feedBody, signer: "e".repeat(64) }, feedUrl))!, /not signed by Kiwimake/);
  assert.match(feedProblem(app, readFeed({ ...feedBody, blocked: [15] }, feedUrl))!, /pulled back/);
});

test("what a card shows: the mark is earned by the installed copy's certificate", () => {
  const app = readGallery({ format: 1, apps: [entry] }).apps[0]!;
  assert.equal(galleryState(app, null), "install");
  assert.equal(galleryState(app, { versionCode: 14, certSha256: CERT }), "open");
  assert.equal(galleryState(app, { versionCode: 13, certSha256: CERT.toUpperCase() }), "update");
  assert.equal(galleryState(app, { versionCode: 14, certSha256: CERT }, 15), "update");
  assert.equal(galleryState(app, { versionCode: 99, certSha256: "f".repeat(64) }), "notOfficial");
  assert.equal(galleryState(app, { versionCode: 14, certSha256: null }), "unknown");
  assert.equal(showsBadge("notOfficial"), false);
  assert.equal(showsBadge("install"), true);
  assert.match(galleryStateLine(app, "notOfficial")!.text, /not the official one/);
  assert.equal(galleryStateLine(app, "update")!.text, "Version 1.2 is ready");
  assert.equal(galleryStateLine(app, "install"), null);
});
