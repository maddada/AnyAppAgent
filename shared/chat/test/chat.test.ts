// Run: node --test shared/chat/test/   (Node 22.18+; no dependencies)
import { test } from "node:test";
import assert from "node:assert/strict";
import type { App, ChatItem } from "../../protocol.ts";
import {
  Drafts,
  Follower,
  FOLLOW_WITHIN,
  appAction,
  buildCard,
  buildRows,
  composerState,
  describeApp,
  enterSends,
  mergeItems,
  permissionView,
  plainToolTitle,
  replaceHistory,
  summarizeTools,
  thoughtLabel,
  toolDetail,
  turnEndedWithoutBuild,
  userNote,
  workingLabel,
} from "../index.ts";

const T0 = "2026-11-11T10:00:00.000Z";
const at = (s: number) => new Date(Date.parse(T0) + s * 1000).toISOString();

let seq = 0;
function item(kind: ChatItem["kind"], extra: Partial<ChatItem> = {}): ChatItem {
  seq++;
  return { id: `i${seq}`, appId: "a", seq, kind, createdAt: at(seq), updatedAt: at(seq), ...extra };
}
const tool = (kind: string, title: string, status: "pending" | "in_progress" | "completed" | "failed" = "completed", detail?: string) =>
  item("tool", { tool: { kind, title, status, ...(detail ? { detail } : {}) } });

function app(extra: Partial<App> = {}): App {
  return { id: "a", name: "Water Glass", slug: "waterglass", packageName: "com.anyapp.waterglass", status: "idle", iconVersion: 1, createdAt: T0, updatedAt: T0, ...extra };
}

// ---------- items

test("mergeItems upserts by id and keeps seq order", () => {
  const a = item("user", { text: "hi" });
  const b = item("assistant", { text: "he" });
  const c = item("assistant", { text: "late" });
  let list = mergeItems([], [a, c]);
  list = mergeItems(list, [b]);
  assert.deepEqual(list.map((i) => i.id), [a.id, b.id, c.id]);
  list = mergeItems(list, [{ ...b, text: "hello" }]);
  assert.equal(list.length, 3);
  assert.equal(list[1].text, "hello");
  assert.equal(mergeItems(list, []), list, "no change keeps the same array");
});

test("replaceHistory keeps newer socket items", () => {
  const a = item("user");
  const b = item("assistant");
  const c = item("assistant");
  assert.deepEqual(replaceHistory([a, c], [b, a]).map((i) => i.id), [a.id, b.id, c.id]);
});

// ---------- tool titles

test("plainToolTitle hides raw commands and long paths", () => {
  assert.equal(plainToolTitle({ kind: "execute", title: "cd C:\\aa\\apps\\x && npm run check" }), "Ran a command");
  assert.equal(plainToolTitle({ kind: "execute", title: "npm test", detail: "npm test" }), "Ran a command");
  assert.equal(plainToolTitle({ kind: "execute", title: "Checked the app", detail: "npx tsc --noEmit" }), "Checked the app");
  assert.equal(plainToolTitle({ kind: "edit", title: "Write modules\\alarms\\android\\src\\AlarmModule.kt" }), "Write AlarmModule.kt");
  assert.equal(plainToolTitle({ kind: "search", title: "grep waterglass" }), "Searched the app");
  assert.equal(plainToolTitle({ kind: "read", title: "Read App.tsx" }), "Read App.tsx");
});

test("toolDetail: short results inline, commands and full titles open below", () => {
  assert.deepEqual(toolDetail({ kind: "edit", title: "Edit App.tsx", detail: "+48 -6" }), { inline: "+48 -6", block: undefined });
  assert.deepEqual(toolDetail({ kind: "execute", title: "Checked the app", detail: "npx tsc --noEmit" }), { block: "npx tsc --noEmit" });
  assert.deepEqual(toolDetail({ kind: "read", title: "Read src/App.tsx", detail: "src\\App.tsx" }), { block: "Read src/App.tsx" });
  assert.deepEqual(toolDetail({ kind: "read", title: "Read App.tsx", detail: "App.tsx" }), { block: undefined });
  const long = toolDetail({ kind: "edit", title: "Write modules/alarms/AlarmModule.kt" });
  assert.equal(long.block, "Write modules/alarms/AlarmModule.kt");
});

test("summarizeTools counts files once", () => {
  const items = [
    tool("edit", "Edit App.tsx", "completed", "App.tsx"),
    tool("edit", "Edit App.tsx", "completed", "App.tsx"),
    tool("edit", "Edit b.ts", "completed", "b.ts"),
    tool("read", "Read c.ts", "completed", "c.ts"),
    tool("execute", "Checked the app"),
    tool("search", "Searched the app"),
    tool("search", "Searched the app"),
    tool("think", "Planned"),
  ];
  assert.equal(summarizeTools(items), "Edited 2 files, read a file, ran a command, searched 2 times, one more step");
});

test("thoughtLabel", () => {
  assert.equal(thoughtLabel({ ...item("thought"), streaming: true }), "Thinking");
  assert.equal(thoughtLabel({ ...item("thought"), createdAt: at(0), updatedAt: at(75) }), "Thought for 1m 15s");
  assert.equal(thoughtLabel({ ...item("thought"), createdAt: at(0), updatedAt: at(1) }), "Thought");
});

// ---------- rows

test("buildRows folds runs of tools and keeps a live run open", () => {
  const u = item("user", { text: "go" });
  const t1 = tool("edit", "Edit a", "completed", "a");
  const t2 = tool("execute", "Checked the app", "completed");
  const said = item("assistant", { text: "Done" });
  const t3 = tool("read", "Read b", "completed", "b");
  const t4 = tool("edit", "Edit b", "in_progress", "b");
  const rows = buildRows([u, t1, t2, said, t3, t4], app({ status: "working" }));
  assert.deepEqual(rows.map((r) => r.type), ["item", "tools", "item", "tools"]);
  const [, done, , live] = rows;
  assert.ok(done.type === "tools" && !done.active && done.summary === "Edited a file, ran a command");
  assert.ok(live.type === "tools" && live.active);
});

test("a single tool stays a row of its own", () => {
  const rows = buildRows([item("user"), tool("edit", "Edit a")], app());
  assert.deepEqual(rows.map((r) => r.type), ["item", "item"]);
});

test("workingLabel appears only when nothing on screen moves", () => {
  const working = app({ status: "working" });
  assert.equal(workingLabel([], working), "Working");
  assert.equal(workingLabel([item("assistant", { streaming: true })], working), null);
  assert.equal(workingLabel([tool("edit", "Edit a", "in_progress")], working), null);
  assert.equal(workingLabel([item("assistant", { text: "ok" })], working), "Working");
  // A queued message at the end does not hide a live item before it.
  assert.equal(workingLabel([item("assistant", { streaming: true }), item("user", { queued: true })], working), null);
  assert.equal(workingLabel([], app({ status: "creating" })), "Setting up your app");
  assert.equal(workingLabel([item("user")], app({ status: "idle" })), null);
});

test("turnEndedWithoutBuild offers a rebuild after a quiet turn", () => {
  const u = item("user");
  const said = item("assistant", { text: "Nothing to change." });
  assert.equal(turnEndedWithoutBuild([u, said], app()), true);
  assert.equal(turnEndedWithoutBuild([u, said, item("build", { build: { number: 2, status: "running", startedAt: at(99) } })], app()), false);
  assert.equal(turnEndedWithoutBuild([u, said], app({ latestBuild: { number: 2, status: "running", startedAt: at(99) } })), false);
  assert.equal(turnEndedWithoutBuild([u, said], app({ status: "working" })), false);
  const rows = buildRows([u, said], app());
  assert.equal(rows[rows.length - 1].type, "rebuild");
});

test("userNote words queued and dropped messages", () => {
  assert.equal(userNote(item("user", { queued: true }))?.text, "Queued, sends when the agent is free");
  assert.equal(userNote(item("user", { queued: false, dropped: true }))?.kind, "dropped");
  assert.equal(userNote(item("user")), null);
});

// ---------- build card

test("buildCard words each state the same on both sides", () => {
  const running = item("build", { text: "Packing the app", build: { number: 3, status: "running", startedAt: T0 } });
  assert.deepEqual(buildCard(running, app({ status: "building" }), "pc"), { state: "running", number: 3, title: "Building version 3", sub: "Packing the app" });
  assert.equal(buildCard({ ...running, text: undefined }, app(), "phone")?.state === "running" && buildCard({ ...running, text: undefined }, app(), "phone")?.title, "Building version 3");

  const failed = item("build", { build: { number: 3, status: "failed", startedAt: T0, error: "Gradle failed" } });
  const f = buildCard(failed, app({ status: "error", latestBuild: failed.build }), "phone");
  assert.ok(f?.state === "failed" && f.canRetry && f.title === "Version 3 didn't build" && f.sub === "Gradle failed");
  const f2 = buildCard(failed, app({ status: "working", latestBuild: failed.build }), "pc");
  assert.ok(f2?.state === "failed" && !f2.canRetry, "no retry while the agent works");

  const built = { number: 4, status: "succeeded" as const, startedAt: T0, finishedAt: T0, sizeBytes: 60 * 1024 * 1024 };
  const ok = item("build", { build: built });
  const pcBefore = buildCard(ok, app({ status: "building", latestApk: { ...built, number: 3 } }), "pc");
  assert.ok(pcBefore?.state === "ready" && !pcBefore.sent && pcBefore.sub === "Version 4, 60 MB. Saving it, then it goes to your phone");
  const pcAfter = buildCard(ok, app({ latestApk: built }), "pc");
  assert.ok(pcAfter?.state === "ready" && pcAfter.sent && pcAfter.sub === "Version 4, 60 MB. Sent to your phone");
  const phone = buildCard(ok, app({ latestApk: built }), "phone", 3);
  assert.ok(phone?.state === "ready" && !phone.installed && phone.sub === "Version 4, 60 MB");
  const installed = buildCard(ok, app({ latestApk: built }), "phone", 4);
  assert.ok(installed?.state === "ready" && installed.installed && installed.sub === "Version 4. Installed");
  const older = buildCard(ok, app({ latestApk: { ...built, number: 5 } }), "pc");
  assert.deepEqual(older, { state: "older", number: 4, title: "Version 4 was ready" });
});

// ---------- state line

test("describeApp on the PC and on the phone", () => {
  const now = Date.parse(T0) + 60_000;
  const apk = { number: 2, status: "succeeded" as const, startedAt: T0, finishedAt: T0 };
  assert.deepEqual(describeApp(app({ status: "working" })), { kind: "working", label: "Making changes" });
  assert.deepEqual(describeApp(app({ status: "building", latestBuild: { ...apk, status: "running" } })), { kind: "working", label: "Building version 2" });
  assert.deepEqual(describeApp(app({ status: "building", latestBuild: apk })), { kind: "working", label: "Saving version 2" });
  assert.deepEqual(describeApp(app({ latestApk: apk }), undefined, now), { kind: "ready", label: "Version 2 ready" });
  assert.deepEqual(describeApp(app({ latestApk: apk }), undefined, now + 2 * 3600_000), { kind: "idle", label: "Up to date" });
  assert.deepEqual(describeApp(app()), { kind: "idle", label: "Waiting for the first version" });
  assert.deepEqual(describeApp(app({ latestApk: apk }), { installedVersion: 1 }), { kind: "ready", label: "Update ready" });
  assert.deepEqual(describeApp(app({ latestApk: apk }), { installedVersion: null }), { kind: "ready", label: "Ready to install" });
  assert.deepEqual(describeApp(app({ latestApk: apk }), { installedVersion: 2 }), { kind: "idle", label: "Version 2 is on this phone" });
  assert.deepEqual(describeApp(app(), { installedVersion: null, install: { phase: "downloading", progress: 0.42 } }), { kind: "working", label: "Downloading 42%" });
  assert.equal(appAction(app({ latestApk: apk }), 2), "open");
  assert.equal(appAction(app(), null), "notReady");
});

// ---------- composer

test("composerState: send, queue, stop", () => {
  assert.equal(composerState(app(), "").button, "send");
  assert.equal(composerState(app(), "").enabled, false);
  assert.deepEqual(composerState(app(), "make it blue"), { button: "send", enabled: true, label: "Send", placeholder: "Ask for a change" });
  assert.equal(composerState(app({ status: "working" }), "").button, "stop");
  assert.equal(composerState(app({ status: "working" }), "", { stopping: true }).enabled, false);
  assert.equal(composerState(app({ status: "working" }), "and red").button, "queue");
  assert.equal(composerState(app({ status: "building" }), "").button, "send", "a build cannot be stopped from the composer");
  assert.equal(composerState(app({ status: "building" }), "x").button, "queue");
  assert.equal(composerState(app({ status: "creating" }), "").placeholder, "Your app is being set up…");
  assert.equal(composerState(app(), "x", { online: false }).enabled, false);
  assert.equal(composerState(app(), "x", { sending: true }).enabled, false);
  assert.equal(enterSends("Enter", false, false), true);
  assert.equal(enterSends("Enter", true, false), false);
  assert.equal(enterSends("Enter", false, true), false);
});

test("Drafts keep text per app", () => {
  const d = new Drafts();
  d.set("a", "blue");
  d.set("b", "red");
  assert.equal(d.get("a"), "blue");
  d.set("a", "");
  assert.equal(d.get("a"), "");
  d.clear("b");
  assert.equal(d.get("b"), "");
});

test("Follower sticks to the newest item unless scrolled up", () => {
  const f = new Follower();
  assert.equal(f.shouldFollow(), true);
  assert.equal(f.scrolled(FOLLOW_WITHIN + 1), true);
  assert.equal(f.shouldFollow(), false);
  assert.equal(f.scrolled(FOLLOW_WITHIN + 50), false, "no change");
  assert.equal(f.scrolled(-10), true, "inverted lists report negative offsets");
  assert.equal(f.shouldFollow(), true);
  f.scrolled(500);
  f.jump();
  assert.equal(f.shouldFollow(), true);
});

// ---------- permission

test("permissionView orders the buttons and words the answer", () => {
  const p = {
    requestId: "r",
    title: "Run `rm -rf build`",
    options: [
      { optionId: "always", label: "Always allow", kind: "allow_always" },
      { optionId: "once", label: "Allow", kind: "allow_once" },
      { optionId: "no", label: "Don't allow", kind: "reject_once" },
    ],
  };
  const open = permissionView(p);
  assert.ok(!open.answered && open.title === "Run rm -rf build" && open.reject?.optionId === "no" && open.allow?.optionId === "once" && open.others[0].optionId === "always");
  assert.deepEqual(permissionView({ ...p, selectedOptionId: "once" }), { answered: true, allowed: true, line: "Allowed: Run rm -rf build" });
  assert.deepEqual(permissionView({ ...p, selectedOptionId: "no" }), { answered: true, allowed: false, line: "Not allowed: Run rm -rf build" });
  assert.equal(permissionView({ ...p, selectedOptionId: "cancelled" }).answered, true);
});
