// Run: node --test shared/chat/test/   (Node 22.18+; no dependencies)
import { test } from "node:test";
import assert from "node:assert/strict";
import { pageInsertScript } from "../page-voice.ts";

/** A textarea as far as the script needs one, and a document where execCommand does nothing. */
function fakePage(value: string, caret: number, focused: boolean) {
  const area = {
    nodeType: 1,
    tagName: "TEXTAREA",
    isContentEditable: false,
    readOnly: false,
    disabled: false,
    offsetParent: {},
    value,
    selectionStart: caret,
    selectionEnd: caret,
    events: 0,
    focus() {},
    setSelectionRange(s: number, e: number) {
      this.selectionStart = s;
      this.selectionEnd = e;
    },
    setRangeText(text: string, s: number, e: number) {
      this.value = this.value.slice(0, s) + text + this.value.slice(e);
      this.selectionStart = this.selectionEnd = s + text.length;
    },
    dispatchEvent() {
      this.events++;
      return true;
    },
  };
  const document = {
    activeElement: focused ? area : null,
    querySelectorAll: () => [area],
    execCommand: () => false,
  };
  return { area, document };
}

function run(script: string, document: object) {
  return new Function("document", "Event", "getSelection", `return ${script.replace(/;true;$/, "")}`)(document, class {}, () => null);
}

test("the words go in at the caret of the focused box, with spaces where needed", () => {
  const { area, document } = fakePage("Make it bigger please", 14, true);
  assert.equal(run(pageInsertScript("and blue"), document), "ok");
  assert.equal(area.value, "Make it bigger and blue please");
  assert.equal(area.events, 1);
});

test("with no box focused, the words go at the end of the last box", () => {
  const { area, document } = fakePage("Keep the colours.", 3, false);
  run(pageInsertScript("Change the font."), document);
  assert.equal(area.value, "Keep the colours. Change the font.");
});

test("quotes and line breaks in the words cannot break out of the script", () => {
  const { area, document } = fakePage("", 0, true);
  run(pageInsertScript('say "hi"\n</script>'), document);
  assert.equal(area.value, 'say "hi"\n</script>');
});
