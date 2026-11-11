import { test } from "node:test";
import assert from "node:assert/strict";
import type { App, AppVersion, ChatItem, CrashInfo } from "../../protocol.ts";
import { buildCard, changeLines, crashCard, diaryLine, goBackBlocked, undoQuestion, undoTarget, versionRows, whenLabel } from "../index.ts";

const now = new Date(2026, 10, 11, 18, 0);
const v = (build: number, over: Partial<AppVersion> = {}): AppVersion => ({ build, title: `Change ${build}`, createdAt: new Date(2026, 10, 11, 10 + build, 5).toISOString(), current: false, canRestore: true, ...over });

test("What changed lines come in order and skip empty ones", () => {
  assert.deepEqual(changeLines({ changed: "Rings three times", tryIt: "  ", goodToKnow: "Timers kept" }), [
    { label: "Changed", text: "Rings three times" },
    { label: "Good to know", text: "Timers kept" },
  ]);
  assert.deepEqual(changeLines(undefined), []);
});

test("the build card carries the notes and names a go-back", () => {
  const build = { number: 3, status: "succeeded" as const, startedAt: "", sizeBytes: 1, changes: { changed: "Back to version 1" }, restoredFrom: 1 };
  const app = { id: "a", latestApk: build, latestBuild: build, status: "idle" } as unknown as App;
  const item = { id: "b", appId: "a", seq: 1, kind: "build", build, createdAt: "", updatedAt: "" } as ChatItem;
  const card = buildCard(item, app, "pc");
  assert.equal(card?.state, "ready");
  if (card?.state !== "ready") return;
  assert.equal(card.title, "Back to version 1");
  assert.equal(card.changes[0].text, "Back to version 1");
  const running = buildCard({ ...item, build: { ...build, status: "running" } }, app, "pc");
  assert.equal(running?.title, "Going back to version 1");
});

test("versions read plainly and Undo goes to the one before the newest", () => {
  const list = [v(3, { current: true, canRestore: false }), v(2), v(1)];
  const rows = versionRows(list, now);
  assert.equal(rows[0].badge, "Newest");
  assert.equal(rows[0].canRestore, false);
  assert.equal(rows[1].when, "Today 12:05");
  assert.equal(undoTarget(list)?.build, 2);
  assert.equal(undoTarget([v(1, { current: true })]), null);
  assert.equal(whenLabel(new Date(2026, 10, 10, 9, 0).toISOString(), now), "Yesterday 09:00");
  assert.equal(whenLabel(new Date(2025, 2, 3).toISOString(), now), "3 Mar 2025");
});

test("going back waits for a busy app", () => {
  const base = { status: "idle", latestApk: { number: 1 } } as unknown as App;
  assert.equal(goBackBlocked(base), null);
  assert.match(goBackBlocked({ ...base, status: "building" }) ?? "", /built/);
  assert.match(goBackBlocked({ ...base, activeHelpers: 1 }) ?? "", /finished/);
});

test("the crash card asks once, then says it was sent", () => {
  const crash: CrashInfo = { id: "c", appId: "a", kind: "crash", message: "TypeError: x is undefined", versionCode: 3, count: 2, firstAt: now.toISOString(), lastAt: now.toISOString() };
  const card = crashCard(crash, "Tea Timer", now);
  assert.equal(card.title, "Tea Timer crashed. Fix it?");
  assert.equal(card.meta, "Version 3, Today 18:00, 2 times");
  assert.equal(card.canFix, true);
  const asked = crashCard({ ...crash, fixAskedAt: now.toISOString(), kind: "error" }, "Tea Timer", now);
  assert.equal(asked.title, "Tea Timer ran into an error");
  assert.equal(asked.canFix, false);
});

test("the diary line says what was read, or why not", () => {
  assert.equal(diaryLine({ ok: true, entries: 12 }), "Read the app's diary on your phone (12 notes)");
  assert.equal(diaryLine({ ok: false, entries: 0, problem: "your phone is not connected to the PC" }), "Could not read the app's diary: your phone is not connected to the PC");
});

test("the Undo question does not double the full stop", () => {
  assert.match(undoQuestion(v(2, { title: "Bigger numbers." })).body, /\(Bigger numbers\)\. It is built/);
});
