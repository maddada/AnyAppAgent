// node --test dev/releaseFeed.test.mjs : the newest release and the APK this phone takes (src/lib/releaseFeed.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { apkNameFor, describeFeedFailure, isNewerVersion, parseVersion, readRelease } from "../src/lib/releaseFeed.ts";

const sha = "a".repeat(64);
const asset = (name, extra = {}) => ({ name, browser_download_url: `https://example.test/${name}`, size: 100, digest: `sha256:${sha}`, ...extra });

test("parseVersion and isNewerVersion compare MAJOR.MINOR.PATCH, with or without v", () => {
  assert.deepEqual(parseVersion("v0.3.4"), [0, 3, 4]);
  assert.equal(isNewerVersion("0.3.4", "0.3.3"), true);
  assert.equal(isNewerVersion("v0.10.0", "0.9.9"), true);
  assert.equal(isNewerVersion("0.3.3", "0.3.3"), false);
  assert.equal(isNewerVersion("0.3.2", "0.3.3"), false);
  assert.throws(() => parseVersion("0.3"), /MAJOR.MINOR.PATCH/);
});

test("apkNameFor: arm64 phones take the small APK, the emulator (x86_64 first) the universal one", () => {
  assert.equal(apkNameFor(["arm64-v8a", "armeabi-v7a"]), "AnyAppAgent.apk");
  assert.equal(apkNameFor(["x86_64", "arm64-v8a"]), "AnyAppAgent-universal.apk");
  assert.equal(apkNameFor(["x86_64"]), "AnyAppAgent-universal.apk");
  assert.equal(apkNameFor([]), "AnyAppAgent.apk");
});

test("readRelease: version, the right APK, its size and SHA-256", () => {
  const body = { tag_name: "v0.3.4", assets: [asset("AnyAppAgent.apk"), asset("AnyAppAgent-universal.apk", { size: 200 }), asset("Kiwimake-Setup.exe")] };
  assert.deepEqual(readRelease(body, ["arm64-v8a"]), { tag: "v0.3.4", version: "0.3.4", apk: { name: "AnyAppAgent.apk", url: "https://example.test/AnyAppAgent.apk", size: 100, sha256: sha } });
  assert.equal(readRelease(body, ["x86_64"]).apk.name, "AnyAppAgent-universal.apk");
});

test("readRelease: an arm64 phone falls back to the universal APK; an x86 phone never takes the arm64 one", () => {
  assert.equal(readRelease({ tag_name: "v1.0.0", assets: [asset("AnyAppAgent-universal.apk")] }, ["arm64-v8a"]).apk.name, "AnyAppAgent-universal.apk");
  assert.equal(readRelease({ tag_name: "v1.0.0", assets: [asset("AnyAppAgent.apk")] }, ["x86_64"]).apk, null);
});

test("readRelease: no digest means no SHA-256 check; a bad answer is refused", () => {
  assert.equal(readRelease({ tag_name: "v1.0.0", assets: [asset("AnyAppAgent.apk", { digest: null })] }, []).apk.sha256, null);
  assert.throws(() => readRelease(null, []), /unexpected/);
  assert.throws(() => readRelease({ tag_name: "nightly", assets: [] }, []), /MAJOR.MINOR.PATCH/);
});

test("describeFeedFailure: rate limit, no release, other errors", () => {
  assert.match(describeFeedFailure(403, "0", null), /GitHub is busy/);
  assert.match(describeFeedFailure(404, null, null), /no Kiwimake release/);
  assert.match(describeFeedFailure(500, null, null), /error 500/);
});
