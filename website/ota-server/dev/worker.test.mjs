// node --test dev/worker.test.mjs : the update server (src/worker.js) on a folder bucket.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, createSign, generateKeyPairSync, createVerify } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import worker from "../src/worker.js";
import { folderBucket } from "./bucket.mjs";

const TOKEN = "t".repeat(40);
const RUNTIME = "abc123";
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const sign = (text) => `sig="${createSign("RSA-SHA256").update(text).sign(privateKey, "base64")}", keyid="main"`;

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "kiwimake-ota-"));
  const env = { OTA: folderBucket(dir), UPLOAD_TOKEN: TOKEN };
  const call = (method, path, { body, headers = {}, auth = false } = {}) =>
    worker.fetch(new Request(`http://ota.test${path}`, { method, body, headers: { ...headers, ...(auth ? { authorization: `Bearer ${TOKEN}` } : {}) } }), env);
  return { dir, call };
}

const phone = (extra = {}) => ({ "expo-protocol-version": "1", "expo-platform": "android", "expo-runtime-version": RUNTIME, ...extra });

test("uploads need the token; an asset must hash to its name", async () => {
  const { dir, call } = setup();
  const bytes = Buffer.from("bundle");
  const hex = createHash("sha256").update(bytes).digest("hex");
  assert.equal((await call("PUT", `/v1/admin/assets/${hex}`, { body: bytes })).status, 401);
  assert.equal((await call("PUT", `/v1/admin/assets/${"0".repeat(64)}`, { body: bytes, auth: true })).status, 400);
  assert.equal((await call("PUT", `/v1/admin/assets/${hex}`, { body: bytes, auth: true })).status, 201);
  const got = await call("GET", `/v1/assets/${hex}`);
  assert.equal(Buffer.from(await got.arrayBuffer()).toString(), "bundle");
  rmSync(dir, { recursive: true, force: true });
});

test("a published update is served signed, then 204 for the phone already on it; status names its version", async () => {
  const { dir, call } = setup();
  assert.equal((await call("GET", "/v1/manifest/production", { headers: phone() })).status, 204);

  const bytes = Buffer.from("bundle v2");
  const hex = createHash("sha256").update(bytes).digest("hex");
  const manifest = { id: "11111111-1111-4111-8111-111111111111", createdAt: "2026-11-17T00:00:00.000Z", runtimeVersion: RUNTIME, launchAsset: { url: `http://ota.test/v1/assets/${hex}` }, assets: [] };
  const body = JSON.stringify(manifest);
  const record = { kind: "update", version: "0.3.4", createdAt: manifest.createdAt, body, signature: sign(body) };
  const post = (r) => call("POST", `/v1/admin/updates/production/android/${RUNTIME}`, { body: JSON.stringify(r), headers: { "content-type": "application/json" }, auth: true });

  assert.equal((await post(record)).status, 409, "refused while its bundle is missing");
  await call("PUT", `/v1/admin/assets/${hex}`, { body: bytes, auth: true });
  assert.equal((await post(record)).status, 201);

  const served = await call("GET", "/v1/manifest/production", { headers: phone() });
  assert.equal(served.status, 200);
  assert.equal(served.headers.get("expo-protocol-version"), "1");
  const text = await served.text();
  assert.match(text, /name="manifest"/);
  const signature = /expo-signature: sig="([^"]+)"/.exec(text)[1];
  assert.ok(createVerify("RSA-SHA256").update(body).verify(publicKey, signature, "base64"), "the signature verifies");
  assert.ok(text.includes(body));

  assert.equal((await call("GET", "/v1/manifest/production", { headers: phone({ "expo-current-update-id": manifest.id }) })).status, 204);
  assert.deepEqual(await (await call("GET", `/v1/status/production/android/${RUNTIME}`)).json(), { version: "0.3.4", createdAt: manifest.createdAt });
  assert.equal((await call("GET", "/v1/manifest/production", { headers: phone({ "expo-runtime-version": "other" }) })).status, 204, "another runtime gets nothing");
  assert.equal((await call("GET", "/v1/manifest/production", { headers: phone({ "expo-platform": "ios" }) })).status, 400);

  const wrongRuntime = { ...record, body: JSON.stringify({ ...manifest, runtimeVersion: "zzz" }) };
  assert.equal((await post(wrongRuntime)).status, 400);
  rmSync(dir, { recursive: true, force: true });
});

test("a rollback directive replaces the update; history keeps both", async () => {
  const { dir, call } = setup();
  const body = JSON.stringify({ type: "rollBackToEmbedded", parameters: { commitTime: "2026-11-17T01:00:00.000Z" } });
  const record = { kind: "rollBackToEmbedded", version: null, createdAt: "2026-11-17T01:00:00.000Z", body, signature: sign(body) };
  const posted = await call("POST", `/v1/admin/updates/production/android/${RUNTIME}`, { body: JSON.stringify(record), headers: { "content-type": "application/json" }, auth: true });
  assert.equal(posted.status, 201);
  const served = await call("GET", "/v1/manifest/production", { headers: phone({ "expo-current-update-id": "aaa", "expo-embedded-update-id": "bbb" }) });
  assert.match(await served.text(), /name="directive"/);
  assert.equal((await call("GET", "/v1/manifest/production", { headers: phone({ "expo-current-update-id": "bbb", "expo-embedded-update-id": "bbb" }) })).status, 204, "a phone on its embedded code is done");
  assert.equal((await call("GET", `/v1/status/production/android/${RUNTIME}`)).status, 404);
  const history = await (await call("GET", `/v1/admin/updates/production/android/${RUNTIME}/history`, { auth: true })).json();
  assert.deepEqual(history.history, ["20261117T010000000Z-rollBackToEmbedded"]);
  rmSync(dir, { recursive: true, force: true });
});
