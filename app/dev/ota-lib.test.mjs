// node --test dev/ota-lib.test.mjs : the over-the-air update tooling's rules (scripts/ota-lib.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { assertNoEmDash, manifestAssetKey, parseManifestResponse, parseWhatsNew, unreachableAssetKeys } from "../scripts/ota-lib.mjs";

test("manifestAssetKey: an asset is keyed by its Metro MD5, which must be its exported name", () => {
  const bytes = Buffer.from("picture");
  const md5 = createHash("md5").update(bytes).digest("hex");
  assert.equal(manifestAssetKey(bytes, `assets/${md5}`), md5);
  assert.throws(() => manifestAssetKey(bytes, "assets/0000"), /MD5/);
  assert.deepEqual(unreachableAssetKeys({ assets: [{ key: md5 }, { key: "f".repeat(64) }] }), ["f".repeat(64)]);
});

test("parseManifestResponse: none, an update, a rollback directive", () => {
  assert.deepEqual(parseManifestResponse(204, null, ""), { kind: "none" });
  const manifest = { id: "u1", createdAt: "2026-11-17T00:00:00.000Z", extra: { kiwimake: { version: "0.3.4" } } };
  const part = (name, body) => `--b\r\ncontent-disposition: form-data; name="${name}"\r\ncontent-type: application/json\r\n\r\n${body}\r\n--b--\r\n`;
  assert.deepEqual(parseManifestResponse(200, "multipart/mixed; boundary=b", part("manifest", JSON.stringify(manifest))), { kind: "update", id: "u1", createdAt: manifest.createdAt, version: "0.3.4" });
  assert.deepEqual(parseManifestResponse(200, "multipart/mixed; boundary=b", part("directive", "{}")), { kind: "rollBackToEmbedded" });
  assert.throws(() => parseManifestResponse(500, null, "boom"), /500/);
});

test("parseWhatsNew: a JSON array, one line, or nothing; never an em dash", () => {
  assert.deepEqual(parseWhatsNew('["Faster installs.", " "]'), ["Faster installs."]);
  assert.deepEqual(parseWhatsNew("One line."), ["One line."]);
  assert.deepEqual(parseWhatsNew(undefined), []);
  assert.throws(() => assertNoEmDash(["a \u2014 b"]), /em dash/);
});
