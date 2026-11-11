// Run: node --test shared/chat/test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { ownVersionName, parseSuggestion, readChangeLink, suggestionPrompt, suggestionText } from "../index.ts";

const draft = { appName: "Prayer Times", packageName: "com.anyapp.prayertimes", from: "Ahmad", text: "Bigger numbers, I can't read Isha.", build: 37 };

test("a suggestion reads back as it was written", () => {
  const text = suggestionText(draft);
  assert.equal(
    text,
    "Ahmad suggests a change to Prayer Times:\n\nBigger numbers, I can't read Isha.\n\nIf you made Prayer Times with AnyAppAgent, share this message to AnyAppAgent or paste it there.\nanyapp-suggestion: com.anyapp.prayertimes 37",
  );
  assert.deepEqual(parseSuggestion(text), { packageName: "com.anyapp.prayertimes", appName: "Prayer Times", from: "Ahmad", text: "Bigger numbers, I can't read Isha.", build: 37 });
  assert.equal(text.includes("\u2014"), false);
});

test("messengers' extra lines, Windows line ends and edits are survived", () => {
  const forwarded = `[12/11, 18:02] Ahmad: ${suggestionText(draft).replace(/\n/g, "\r\n")}\r\n\r\nSent from my phone`;
  const p = parseSuggestion(forwarded);
  assert.equal(p?.packageName, "com.anyapp.prayertimes");
  assert.equal(p?.text, "Bigger numbers, I can't read Isha.");
  const edited = "please make the alarm louder\nanyapp-suggestion: com.anyapp.prayertimes";
  assert.deepEqual(parseSuggestion(edited), { packageName: "com.anyapp.prayertimes", text: "please make the alarm louder" });
});

test("no name is Someone, and is not kept as a name", () => {
  const p = parseSuggestion(suggestionText({ ...draft, from: "" }));
  assert.equal(p?.from, undefined);
  assert.equal(suggestionPrompt({ text: "Louder" }), "Someone suggested this change: Louder");
  assert.equal(suggestionPrompt({ from: "Mum", text: "Bigger" }), "Mum suggested this change: Bigger");
});

test("text without the filing line, or without words, is not a suggestion", () => {
  assert.equal(parseSuggestion("Bigger numbers please"), null);
  assert.equal(parseSuggestion("Ahmad suggests a change to X:\n\nanyapp-suggestion: com.anyapp.x 3"), null);
  assert.equal(parseSuggestion(""), null);
});

test("the change link is read strictly", () => {
  assert.deepEqual(readChangeLink({ package: "com.anyapp.prayertimes", name: "Prayer Times", owner: "Mohamad", repo: "maddada/anyapp-prayertimes-releases", build: "37", screen: "settings" }), {
    packageName: "com.anyapp.prayertimes",
    appName: "Prayer Times",
    owner: "Mohamad",
    repo: "maddada/anyapp-prayertimes-releases",
    build: 37,
    screen: "settings",
  });
  assert.equal(readChangeLink({ package: "not a package" }), null);
  assert.equal(readChangeLink({ package: "com.anyapp.x", repo: "someone/other-repo" })?.repo, undefined);
  assert.equal(ownVersionName("Prayer Times", "Ahmad"), "Prayer Times (Ahmad's)");
  assert.equal(ownVersionName("Prayer Times"), "My Prayer Times");
});
