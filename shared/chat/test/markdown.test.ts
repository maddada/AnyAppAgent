// Run: node --test shared/chat/test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { inlineText, parseInline, parseMarkdown, safeHref, type Block } from "../markdown.ts";

const kinds = (blocks: Block[]) => blocks.map((b) => b.type);

test("paragraphs and line breaks", () => {
  const b = parseMarkdown("First line\nsecond line\n\nNext paragraph");
  assert.deepEqual(kinds(b), ["paragraph", "paragraph"]);
  assert.deepEqual(b[0].type === "paragraph" && b[0].inline, [{ type: "text", text: "First line" }, { type: "br" }, { type: "text", text: "second line" }]);
});

test("headings, rules, quotes", () => {
  const b = parseMarkdown("## What changed\n\n---\n\n> Note: one\n> two");
  assert.deepEqual(kinds(b), ["heading", "rule", "quote"]);
  assert.ok(b[0].type === "heading" && b[0].level === 2 && inlineText(b[0].inline) === "What changed");
  assert.ok(b[2].type === "quote" && b[2].blocks[0].type === "paragraph");
});

test("bullet, numbered, nested and task lists", () => {
  const b = parseMarkdown("I changed:\n- the colour\n- the **icon**\n  - nested one\n3. three\n4. four\n\n- [x] done\n- [ ] todo");
  assert.deepEqual(kinds(b), ["paragraph", "list", "list", "list"]);
  const bullets = b[1];
  assert.ok(bullets.type === "list" && !bullets.ordered && bullets.items.length === 2 && bullets.tight);
  const second = bullets.type === "list" ? bullets.items[1].blocks : [];
  assert.deepEqual(kinds(second), ["paragraph", "list"]);
  const nums = b[2];
  assert.ok(nums.type === "list" && nums.ordered && nums.start === 3 && nums.items.length === 2);
  const tasks = b[3];
  assert.ok(tasks.type === "list" && tasks.items[0].task && tasks.items[0].checked && tasks.items[1].checked === false);
});

test("a list item continues on its indented lines", () => {
  const b = parseMarkdown("1. Open the app\n   then tap Start\n2. Wait");
  assert.ok(b[0].type === "list" && b[0].items.length === 2);
  const first = b[0].type === "list" ? b[0].items[0].blocks[0] : null;
  assert.ok(first?.type === "paragraph" && inlineText(first.inline) === "Open the app\nthen tap Start");
});

test("fenced code keeps its text and survives streaming", () => {
  const b = parseMarkdown("Run this:\n```ts\nconst a = 1;\n  indented\n```\nafter");
  assert.deepEqual(kinds(b), ["paragraph", "code", "paragraph"]);
  assert.ok(b[1].type === "code" && b[1].lang === "ts" && b[1].text === "const a = 1;\n  indented");
  const open = parseMarkdown("```\nstill typing");
  assert.ok(open[0].type === "code" && open[0].text === "still typing");
});

test("tables", () => {
  const b = parseMarkdown("| Prayer | Time |\n|:--|--:|\n| Fajr | 05:10 |\n| `Dhuhr` \\| noon | 12:15 |");
  assert.equal(b[0].type, "table");
  if (b[0].type !== "table") return;
  assert.deepEqual(b[0].align, ["left", "right"]);
  assert.equal(b[0].rows.length, 2);
  assert.equal(inlineText(b[0].rows[1][0]), "Dhuhr | noon");
});

test("inline spans", () => {
  assert.deepEqual(parseInline("a **b** *c* ~~d~~ `e*f`"), [
    { type: "text", text: "a " },
    { type: "strong", children: [{ type: "text", text: "b" }] },
    { type: "text", text: " " },
    { type: "em", children: [{ type: "text", text: "c" }] },
    { type: "text", text: " " },
    { type: "del", children: [{ type: "text", text: "d" }] },
    { type: "text", text: " " },
    { type: "code", text: "e*f" },
  ]);
  assert.deepEqual(parseInline("snake_case_name and 2 * 3 * 4"), [{ type: "text", text: "snake_case_name and 2 * 3 * 4" }]);
  assert.deepEqual(parseInline("**unclosed"), [{ type: "text", text: "**unclosed" }]);
  assert.deepEqual(parseInline("\\*not em\\*"), [{ type: "text", text: "*not em*" }]);
});

test("links are safe: only http(s) and mailto", () => {
  assert.deepEqual(parseInline("see [the repo](https://github.com/x/y)"), [
    { type: "text", text: "see " },
    { type: "link", href: "https://github.com/x/y", children: [{ type: "text", text: "the repo" }] },
  ]);
  assert.deepEqual(parseInline("[click](javascript:alert(1))"), [{ type: "text", text: "click" }]);
  assert.deepEqual(parseInline("at https://example.com/a."), [
    { type: "text", text: "at " },
    { type: "link", href: "https://example.com/a", children: [{ type: "text", text: "https://example.com/a" }] },
    { type: "text", text: "." },
  ]);
  assert.equal(safeHref("intent://x"), null);
});

test("HTML stays text, entities decode", () => {
  assert.deepEqual(parseMarkdown("<script>alert(1)</script> &amp; ok"), [
    { type: "paragraph", inline: [{ type: "text", text: "<script>alert(1)</script> & ok" }] },
  ]);
});

test("loose lists and blank lines end lists", () => {
  const b = parseMarkdown("- one\n\n- two\n\nAfter the list");
  assert.deepEqual(kinds(b), ["list", "paragraph"]);
  assert.ok(b[0].type === "list" && !b[0].tight && b[0].items.length === 2);
});
