// Run: node --test shared/chat/test/   (Node 22.18+; no dependencies)
import { test } from "node:test";
import assert from "node:assert/strict";
import type { App, ChatItem, WorkerInfo } from "../../protocol.ts";
import {
  HELPER_FOLLOW_UP_LABEL,
  HELPER_TASK_LABEL,
  buildRows,
  composerState,
  describeApp,
  helperChatRows,
  helperView,
  helpersAtWork,
  mainChatReplying,
  mergeHelpers,
  turnEndedWithoutBuild,
  usesHelpers,
  workingLabel,
} from "../index.ts";

const T0 = "2026-11-11T10:00:00.000Z";
const at = (s: number) => new Date(Date.parse(T0) + s * 1000).toISOString();
let seq = 0;
function item(kind: ChatItem["kind"], extra: Partial<ChatItem> = {}): ChatItem {
  seq++;
  return { id: `i${seq}`, appId: "a", seq, kind, createdAt: at(seq), updatedAt: at(seq), ...extra };
}
function app(extra: Partial<App> = {}): App {
  return { id: "a", name: "Tip Splitter", slug: "tipsplitter", packageName: "com.anyapp.tipsplitter", status: "idle", iconVersion: 1, createdAt: T0, updatedAt: T0, ...extra };
}
function worker(extra: Partial<WorkerInfo> = {}): WorkerInfo {
  return { id: "w1", appId: "a", title: "Bigger tip buttons", state: "working", changesApp: true, createdAt: T0, updatedAt: T0, ...extra };
}

test("a helper row reads like the mockup in every state", () => {
  assert.deepEqual(helperView(worker({ state: "waiting", latest: "Waiting for another change to land" })).state, { kind: "idle", label: "Waiting to add its change" });
  assert.deepEqual(helperView(worker({ latest: "Changed TipButtons.tsx" })), {
    title: "Bigger tip buttons",
    latest: "Changed TipButtons.tsx",
    state: { kind: "working", label: "Working" },
    icon: "pen",
    active: true,
  });
  assert.equal(helperView(worker({ changesApp: false })).icon, "search");
  const combining = helperView(worker({ latest: "Fitting its change together with another one" }));
  assert.deepEqual([combining.state.label, combining.icon], ["Combining changes", "merge"]);
  assert.equal(helperView(worker({ state: "building" })).icon, "package");
  assert.deepEqual(helperView(worker({ state: "done", buildNumber: 3 })).state, { kind: "ready", label: "Done, in version 3" });
  assert.deepEqual(helperView(worker({ state: "done", changesApp: false })).state, { kind: "ready", label: "Done" });
  assert.deepEqual(helperView(worker({ state: "failed" })).state, { kind: "problem", label: "Ran into a problem" });
  assert.equal(helperView(worker({ state: "stopped", latest: "Stopped" })).latest, undefined);
  const stopped = helperView(worker({ state: "stopped" }));
  assert.deepEqual([stopped.state, stopped.active], [{ kind: "idle", label: "Stopped" }, false]);
});

test("helper rows and Stopped lines in the main chat", () => {
  const rows = buildRows(
    [item("user", { text: "Two changes" }), item("assistant", { text: "Two helpers on it." }), item("worker", { worker: worker() }), item("worker", { worker: worker({ id: "w2" }) }), item("stopped", { text: "Stopped" })],
    app({ activeHelpers: 2, replying: false, status: "working" }),
  );
  assert.deepEqual(
    rows.map((r) => r.type),
    ["item", "item", "helper", "helper", "stopped"],
  );
  assert.deepEqual(rows[4], { type: "stopped", key: rows[4].key, label: "Stopped" });
});

test("with helpers, only the main chat's own reply shows Working, Stop and the queue", () => {
  const items = [item("user", { text: "Change it" }), item("assistant", { text: "On it." })];
  const helpersOnly = app({ status: "working", activeHelpers: 2, replying: false });
  assert.equal(usesHelpers(helpersOnly), true);
  assert.equal(mainChatReplying(helpersOnly), false);
  assert.equal(workingLabel(items, helpersOnly), null);
  assert.equal(composerState(helpersOnly, "").button, "send");
  assert.equal(composerState(helpersOnly, "Another thing").button, "send");
  const answering = app({ status: "working", activeHelpers: 2, replying: true });
  assert.equal(mainChatReplying(answering), true);
  assert.equal(composerState(answering, "").button, "stop");
  assert.equal(composerState(answering, "More").button, "queue");
  // An older PC (no helpers): as before.
  const old = app({ status: "working" });
  assert.equal(usesHelpers(old), false);
  assert.equal(composerState(old, "").button, "stop");
  assert.equal(workingLabel(items, old), "Working");
});

test("with helpers the main chat never offers to build again after it answers", () => {
  const items = [item("user", { text: "What colour is it?" }), item("assistant", { text: "Green." })];
  assert.equal(turnEndedWithoutBuild(items, app({ activeHelpers: 0 })), false);
  assert.equal(turnEndedWithoutBuild(items, app()), true);
});

test("the state line counts helpers at work", () => {
  assert.equal(describeApp(app({ status: "working", activeHelpers: 2, replying: false })).label, "2 helpers at work");
  assert.equal(describeApp(app({ status: "working", activeHelpers: 1, replying: true })).label, "1 helper at work");
  assert.equal(describeApp(app({ status: "working", activeHelpers: 0, replying: true })).label, "Answering");
  assert.equal(describeApp(app({ status: "working" })).label, "Making changes");
  assert.equal(helpersAtWork(app({ activeHelpers: 0 })), null);
  assert.equal(helpersAtWork(app({ activeHelpers: 3 })), "3 helpers at work");
});

test("a helper's own chat: task card, follow-ups, Working while it is busy, Stopped after", () => {
  const items = [
    item("user", { text: "Make the buttons bigger." }),
    item("assistant", { text: "On it." }),
    item("tool", { tool: { kind: "edit", title: "Changed TipButtons.tsx", status: "completed" } }),
    item("user", { text: "Keep 20 percent green." }),
  ];
  const rows = helperChatRows(items, worker());
  assert.deepEqual(rows[0], { type: "task", key: rows[0].key, label: HELPER_TASK_LABEL, text: "Make the buttons bigger." });
  assert.equal(rows[3].type, "task");
  assert.equal((rows[3] as { label: string }).label, HELPER_FOLLOW_UP_LABEL);
  assert.deepEqual(rows.at(-1), { type: "working", key: "working", label: "Working" });
  const done = helperChatRows([...items, item("stopped", { text: "Stopped" })], worker({ state: "stopped" }));
  assert.equal(done.at(-1)?.type, "stopped");
});

test("helpers merge by id and stay in the order they started", () => {
  const a = worker({ id: "a", createdAt: at(1) });
  const b = worker({ id: "b", createdAt: at(2) });
  const list = mergeHelpers([], [b, a]);
  assert.deepEqual(list.map((w) => w.id), ["a", "b"]);
  const updated = mergeHelpers(list, [{ ...a, state: "done" }]);
  assert.deepEqual(updated.map((w) => [w.id, w.state]), [["a", "done"], ["b", "working"]]);
  assert.equal(mergeHelpers(list, []), list);
});
