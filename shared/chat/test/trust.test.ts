// Run: node --test shared/chat/test/
import { test } from "node:test";
import assert from "node:assert/strict";
import type { AppUsage, UsageState } from "../../protocol.ts";
import { cacheLine, formatTokens, headsUp, PLAN_UNKNOWN, planLine, reminderText, usageLine, usageRows, whenLabel } from "../index.ts";

const now = new Date(2026, 10, 11, 10, 0);
const u = (input: number, cacheRead = 0) => ({ inputTokens: input, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: cacheRead });
const appUsage = (total: number, changes: number): AppUsage => ({ total: u(total), month: u(total), monthKey: "2026-11", changes, since: "" });

test("token counts read short", () => {
  assert.equal(formatTokens(850), "850");
  assert.equal(formatTokens(1500), "1.5k");
  assert.equal(formatTokens(52_400), "52k");
  assert.equal(formatTokens(1_160_000), "1.2M");
  assert.equal(usageLine(u(52_400, 1_100_000)), "Used 52k tokens");
  assert.equal(cacheLine(u(52_400, 1_100_000)), "Plus 1.1M read again from Claude's memory of the chat, which counts for much less.");
  assert.equal(usageLine(undefined), null);
  assert.equal(usageLine(u(0)), null);
});

test("a plan line only shows a percentage Claude reported", () => {
  const resets = new Date(2026, 10, 11, 16, 0).toISOString();
  assert.deepEqual(planLine({ kind: "five_hour", status: "allowed", usedPercent: 62, resetsAt: resets, seenAt: "" }, now), { text: "5-hour limit: 62% used, resets at 16:00", kind: "ok", percent: 62 });
  assert.equal(planLine({ kind: "seven_day", status: "allowed_warning", seenAt: "" }, now).text, "Claude says you are close to your weekly limit.");
  assert.equal(planLine({ kind: "five_hour", status: "rejected", resetsAt: resets, seenAt: "" }, now).text, "5-hour limit is used up until 16:00. Changes wait until then.");
  assert.equal(planLine({ kind: "five_hour", status: "allowed", usedPercent: 85, seenAt: "" }, now).kind, "near");
  assert.equal(whenLabel(new Date(2026, 10, 13, 9, 5).toISOString(), now), "Fri 09:05");
  assert.equal(whenLabel(new Date(2026, 10, 30, 9, 5).toISOString(), now), "30 Nov");
  assert.match(PLAN_UNKNOWN, /not a percentage/);
});

test("the meter's rows are this month's use, against the biggest app, never the plan", () => {
  const rows = usageRows([
    { id: "a", name: "Tea", usage: appUsage(40_000, 2) },
    { id: "b", name: "Prayer", usage: appUsage(160_000, 4) },
    { id: "c", name: "New" },
  ]);
  assert.deepEqual(rows.map((r) => [r.name, r.tokens, r.share, r.perChange]), [
    ["Prayer", 160_000, 1, 40_000],
    ["Tea", 40_000, 0.25, 20_000],
  ]);
});

test("a heads-up before a big job, quiet for a small one", () => {
  const usage: UsageState = { plan: [], month: u(0), monthKey: "2026-11" };
  assert.equal(headsUp({ text: "Make the button blue", usage, now }), null);
  const app = headsUp({ text: "A prayer alarm", newApp: true, usage, now })!;
  assert.equal(app.send, "Make it");
  assert.match(app.body, /biggest job/);
  assert.match(app.body, /not shared how much of your plan is left/);
  const redo = headsUp({ text: "Redesign every screen", usage, appUsage: appUsage(300_000, 3), now })!;
  assert.match(redo.body, /about 100k tokens each so far/);
  const near: UsageState = { ...usage, plan: [{ kind: "five_hour", status: "allowed", usedPercent: 90, seenAt: "" }] };
  assert.match(headsUp({ text: "x".repeat(500), usage: near, now })!.body, /5-hour limit: 90% used\.$/);
  // A used-up limit warns even for a small change.
  const out: UsageState = { ...usage, plan: [{ kind: "five_hour", status: "rejected", seenAt: "" }] };
  assert.equal(headsUp({ text: "tiny", usage: out, now })!.title, "Your Claude plan needs a rest");
  for (const h of [app, redo]) assert.doesNotMatch(h.body + h.title, /—/);
});

test("the monthly reminder", () => {
  assert.equal(reminderText({ due: false, behind: 2, lastAt: null, nextAt: null }), null);
  assert.match(reminderText({ due: true, behind: 2, lastAt: null, nextAt: null })!.body, /^2 apps are behind/);
  assert.match(reminderText({ due: true, behind: 1, lastAt: null, nextAt: null })!.body, /^One app is behind/);
});
