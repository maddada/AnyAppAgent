// Run: node --test shared/chat/test/   (Node 22.18+; no dependencies)
import { test } from "node:test";
import assert from "node:assert/strict";
import { DictationText, insertAt, isNewStretch, joinWords } from "../dictation.ts";

/** Plays results into a box the way the apps do: sync with the box, then write what comes back. */
function play(start: { value: string; caret?: number; end?: number }, steps: (["partial" | "final", string] | ["type", (v: string) => string])[]) {
  let box = start.value;
  let caret = start.caret ?? box.length;
  const d = new DictationText(box, caret, start.end ?? caret);
  const seen: string[] = [];
  for (const [kind, arg] of steps) {
    if (kind === "type") {
      box = arg(box);
      continue;
    }
    d.sync(box);
    const out = kind === "partial" ? d.partial(arg) : d.final(arg);
    box = out.value;
    caret = out.caret;
    seen.push(box);
  }
  return { box, caret, seen };
}

test("growing partials then the final: each one replaces only the words of this dictation", () => {
  const r = play({ value: "" }, [
    ["partial", "make"],
    ["partial", "make the button"],
    ["partial", "make the button blue"],
    ["final", "Make the button blue"],
  ]);
  assert.deepEqual(r.seen, ["make", "make the button", "make the button blue", "Make the button blue"]);
  assert.equal(r.caret, r.box.length);
});

test("text typed before stays, and the words go after it with a space", () => {
  const r = play({ value: "Hello there." }, [
    ["partial", "please add"],
    ["partial", "please add a timer"],
    ["final", "please add a timer"],
  ]);
  assert.equal(r.box, "Hello there. please add a timer");
  for (const v of r.seen) assert.ok(v.startsWith("Hello there. "), v);
});

test("the caret in the middle: words go there, the text after it stays", () => {
  const r = play({ value: "Start. End.", caret: 6 }, [
    ["partial", "middle"],
    ["partial", "middle part"],
    ["final", "middle part"],
  ]);
  assert.equal(r.box, "Start. middle part End.");
  assert.equal(r.caret, "Start. middle part".length);
});

test("a selection is replaced by the dictated words", () => {
  const r = play({ value: "Make it red please", caret: 8, end: 11 }, [["final", "green"]]);
  assert.equal(r.box, "Make it green please");
});

test("partials that start over after a pause keep the earlier stretch", () => {
  const r = play({ value: "" }, [
    ["partial", "I want a prayer app"],
    ["partial", "I want a prayer app for Ajman"],
    // A pause: the recognizer starts its partials over with only the new stretch.
    ["partial", "with"],
    ["partial", "with a reminder"],
    ["partial", "with a reminder before each prayer"],
    ["final", "with a reminder before each prayer"],
  ]);
  assert.equal(r.box, "I want a prayer app for Ajman with a reminder before each prayer");
  for (const v of r.seen) assert.ok(v.startsWith("I want a prayer app"), v);
});

test("a new stretch that starts with a common word still keeps the one before", () => {
  const r = play({ value: "" }, [
    ["partial", "I want a prayer app for my city"],
    ["partial", "a reminder"],
    ["partial", "a reminder before each one"],
    ["final", "a reminder before each one"],
  ]);
  assert.equal(r.box, "I want a prayer app for my city a reminder before each one");
});

test("a final that holds everything replaces the stretches instead of repeating them", () => {
  const r = play({ value: "" }, [
    ["partial", "one two three"],
    ["partial", "four"],
    ["partial", "four five"],
    ["final", "One two three four five."],
  ]);
  assert.equal(r.box, "One two three four five.");
});

test("an empty final keeps what the partials showed", () => {
  const r = play({ value: "Note:" }, [
    ["partial", "buy milk"],
    ["final", ""],
  ]);
  assert.equal(r.box, "Note: buy milk");
});

test("a better guess at the same words replaces them (not a new stretch)", () => {
  assert.equal(isNewStretch("I scream for", "ice cream for"), false);
  assert.equal(isNewStretch("make the button blue", "and"), true);
  assert.equal(isNewStretch("make the button blue", "make the"), false);
  const r = play({ value: "" }, [
    ["partial", "I scream"],
    ["partial", "ice cream for"],
    ["final", "Ice cream for everyone"],
  ]);
  assert.equal(r.box, "Ice cream for everyone");
});

test("a second dictation after the first keeps the first one's words", () => {
  const first = play({ value: "" }, [
    ["partial", "first part"],
    ["final", "First part."],
  ]);
  const second = play({ value: first.box, caret: first.caret }, [
    ["partial", "second"],
    ["partial", "second part"],
    ["final", "Second part."],
  ]);
  assert.equal(second.box, "First part. Second part.");
  for (const v of second.seen) assert.ok(v.startsWith("First part. "), v);
});

test("a change the person makes while it listens stays", () => {
  const r = play({ value: "Title" }, [
    ["partial", "one two"],
    ["type", (v) => v + "!"],
    ["partial", "one two three"],
    ["final", "one two three"],
  ]);
  assert.equal(r.box, "Title one two! three");
});

test("results after the final change nothing", () => {
  const d = new DictationText("a");
  d.final("b");
  assert.equal(d.partial("c").value, "a b");
});

test("insertAt and joinWords put one space where it is needed", () => {
  assert.deepEqual(insertAt("ab", 1, 1, "X"), { value: "a X b", caret: 3 });
  assert.deepEqual(insertAt("a ", 2, 2, "X"), { value: "a X", caret: 3 });
  assert.deepEqual(insertAt("Hi", 2, 2, ", there"), { value: "Hi, there", caret: 9 });
  assert.deepEqual(insertAt("", 0, 0, "X"), { value: "X", caret: 1 });
  assert.equal(joinWords("one", "two"), "one two");
  assert.equal(joinWords("one", ". two"), "one. two");
  assert.equal(joinWords("", "two"), "two");
});
