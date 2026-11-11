import { test } from "node:test";
import assert from "node:assert/strict";
import type { App, ChatItem, PageInfo } from "../../protocol.ts";
import { answerLines, buildRows, describeApp, helperPageNote, pageAnswersMessage, pageCard, parsePageAnswers, staysInPage, waitingPages } from "../index.ts";

const page = (over: Partial<PageInfo> = {}): PageInfo => ({ id: "ab12", appId: "a", title: "Your app's plan", createdAt: "2026-11-11T10:00:00Z", ...over });
const item = (over: Partial<ChatItem>): ChatItem => ({ id: "i", appId: "a", seq: 1, kind: "user", createdAt: "2026-11-11T10:00:00Z", updatedAt: "2026-11-11T10:00:00Z", ...over });

test("the answers envelope goes out and comes back", () => {
  const text = pageAnswersMessage("ab12", 'Plan "v1" <draft>', { "Build it?": "Build it", "Build it? (note)": "bigger font" });
  assert.match(text, /^<page-answers page="ab12" title="Plan &quot;v1&quot; &lt;draft&gt;">\n\{/);
  const parsed = parsePageAnswers(text)!;
  assert.equal(parsed.pageId, "ab12");
  assert.equal(parsed.title, 'Plan "v1" <draft>');
  assert.deepEqual(parsed.answers, { "Build it?": "Build it", "Build it? (note)": "bigger font" });
  assert.equal(parsePageAnswers("just words"), null);
  const fromHelper = parsePageAnswers(`${text}

${helperPageNote({ workerId: "w1", title: "Explain (it)" })}`)!;
  assert.equal(fromHelper.extra, "");
});

test("answer lines fold notes under their question and name skipped ones", () => {
  const lines = answerLines({ "Which layout?": "tabs", "Which layout? (note)": "search on top", "Platforms?": ["Phone", "Tablet"], "Name?": "skipped", "Additional notes": "ship it" });
  assert.deepEqual(lines, [
    { label: "Which layout?", value: "tabs", note: "search on top" },
    { label: "Platforms?", value: "Phone, Tablet" },
    { label: "Name?", value: "Skipped" },
    { label: "Anything else", value: "ship it" },
  ]);
  assert.deepEqual(answerLines({ seen: true, reply: "Looks good" }), [{ label: "Marked as seen", value: "", note: "Looks good" }]);
});

test("the card says what the page wants", () => {
  assert.equal(pageCard(page({ questions: ["A?", "B?"] })).status, "2 questions for you");
  assert.equal(pageCard(page({ questions: ["A?"] })).status, "1 question for you");
  assert.equal(pageCard(page({ awaitsSeen: true })).status, "Have a look, then mark it seen");
  assert.equal(pageCard(page({ questions: ["A?"], answeredAt: "x" })).state, "answered");
  assert.equal(pageCard(page({ awaitsSeen: true, answeredAt: "x", seen: true })).status, "You marked it seen");
  assert.equal(pageCard(page({ from: { workerId: "w", title: "Make the plan" } })).from, 'From the helper "Make the plan"');
});

test("rows show page cards and answers cards", () => {
  const items = [
    item({ id: "p", seq: 1, kind: "page", text: "Your app's plan", page: page({ questions: ["Build it?"] }) }),
    item({ id: "u", seq: 2, kind: "user", text: pageAnswersMessage("ab12", "Your app's plan", { "Build it?": "Build it" }) }),
    item({ id: "u2", seq: 3, kind: "user", text: "hello" }),
  ];
  const rows = buildRows(items, undefined);
  assert.deepEqual(rows.map((r) => r.type), ["page", "answers", "item"]);
  assert.equal(waitingPages(items).length, 1);
});

test("a page card follows the rest of its turn", () => {
  const items = [
    item({ id: "u", seq: 1, kind: "user", text: "make it" }),
    item({ id: "t", seq: 2, kind: "tool", tool: { title: "Write plan.html", kind: "edit", status: "completed" } }),
    item({ id: "p", seq: 3, kind: "page", page: page({ questions: ["Build it?"] }) }),
    item({ id: "a", seq: 4, kind: "assistant", text: "Here is the plan" }),
    item({ id: "u2", seq: 5, kind: "user", text: "yes" }),
  ];
  assert.deepEqual(buildRows(items, undefined).map((r) => r.key), ["u", "t", "a", "p", "u2"]);
  assert.deepEqual(buildRows(items.slice(0, 4), undefined).map((r) => r.key), ["u", "t", "a", "p"]);
});

test("only the page's own address stays in its web view", () => {
  const at = "http://127.0.0.1:5000/page/ab12/t#gx-theme=dark";
  assert.equal(staysInPage(at, "http://127.0.0.1:5000/page/ab12/t"), true);
  assert.equal(staysInPage(at, "https://example.com/"), false);
  assert.equal(staysInPage(at, "http://127.0.0.1:5000/api/apps"), false);
});

test("a waiting plan or question page says so in the state line, updates still come first", () => {
  const app = (over: Partial<App> = {}): App => ({ id: "a", name: "P", slug: "p", packageName: "com.anyapp.p", status: "idle", iconVersion: 1, createdAt: "x", updatedAt: "x", ...over });
  const apk = { number: 3, status: "succeeded" as const, startedAt: "2026-11-11T10:00:00Z", finishedAt: "2026-11-11T10:05:00Z" };
  assert.deepEqual(describeApp(app({ waitingForAnswer: true })), { kind: "ready", label: "Waiting for your answer" });
  assert.equal(describeApp(app()).label, "Waiting for the first version");
  assert.equal(describeApp(app({ waitingForAnswer: true, status: "working" })).label, "Making changes");
  assert.equal(describeApp(app({ waitingForAnswer: true, latestApk: apk, latestBuild: apk }), { installedVersion: 3 }).label, "Waiting for your answer");
  assert.equal(describeApp(app({ waitingForAnswer: true, latestApk: apk, latestBuild: apk }), { installedVersion: 2 }).label, "Update ready");
  assert.equal(describeApp(app({ waitingForAnswer: true, latestApk: apk, latestBuild: apk })).label, "Waiting for your answer");
});
