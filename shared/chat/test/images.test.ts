// Run: node --test shared/chat/test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { Drafts, base64Bytes, checkImages, composerState, fitWithin, imageExtension, MAX_IMAGE_BYTES, MAX_IMAGES, parseDataUrl, picturesLabel } from "../index.ts";
import type { App } from "../../protocol.ts";

const app = (status: App["status"]): App => ({ id: "a", name: "A", slug: "a", packageName: "com.anyapp.a", status, iconVersion: 1, createdAt: "", updatedAt: "" });

test("fitWithin scales the long edge down to 1568 and never up", () => {
  assert.deepEqual(fitWithin(3000, 1500), { width: 1568, height: 784, scaled: true });
  assert.deepEqual(fitWithin(1080, 2400), { width: 706, height: 1568, scaled: true });
  assert.deepEqual(fitWithin(800, 600), { width: 800, height: 600, scaled: false });
  assert.deepEqual(fitWithin(400, 100, 160), { width: 160, height: 40, scaled: true });
});

test("checkImages: count, type and size", () => {
  const small = { mimeType: "image/jpeg", data: "AAAA" };
  assert.equal(checkImages([small]), null);
  assert.match(checkImages(Array.from({ length: MAX_IMAGES + 1 }, () => small)) ?? "", /at most 6/);
  assert.match(checkImages([{ mimeType: "image/svg+xml", data: "AAAA" }]) ?? "", /PNG, JPEG/);
  const big = "A".repeat(Math.ceil(((MAX_IMAGE_BYTES + 10) * 4) / 3));
  assert.match(checkImages([{ mimeType: "image/png", data: big }]) ?? "", /too big/);
});

test("base64Bytes, parseDataUrl, extensions, labels", () => {
  assert.equal(base64Bytes(Buffer.from("hello world").toString("base64")), 11);
  assert.deepEqual(parseDataUrl("data:image/PNG;base64,QUJD"), { mimeType: "image/png", data: "QUJD" });
  assert.equal(parseDataUrl("https://x"), null);
  assert.equal(imageExtension("image/jpeg"), "jpg");
  assert.equal(imageExtension("image/png"), "png");
  assert.equal(picturesLabel(1), "Sent a picture");
  assert.equal(picturesLabel(3), "Sent 3 pictures");
});

test("pictures alone can be sent, and turn Stop back into Send", () => {
  assert.equal(composerState(app("idle"), "", { images: 1 }).enabled, true);
  assert.equal(composerState(app("working"), "", { images: 0 }).button, "stop");
  assert.equal(composerState(app("working"), "", { images: 2 }).button, "queue");
});

test("long pasted text is kept as typed", () => {
  const long = "line\n".repeat(5000) + "end";
  assert.equal(composerState(app("idle"), long).enabled, true);
  const d = new Drafts<{ key: string }>();
  d.set("a", long);
  d.setAttachments("a", [{ key: "x" }]);
  assert.equal(d.get("a"), long);
  assert.deepEqual(d.attachments("a"), [{ key: "x" }]);
  d.clear("a");
  assert.deepEqual(d.attachments("a"), []);
});
