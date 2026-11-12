// Copies the page kit from Ghostex (C:\dev\Ghostex, the user's own project, read only) into
// server/src/pages/kit/: the page API, the question kit (style and script) and the fit rules, as
// Ghostex's server injects them into every published page (server/src/visual_pages/{theme,kit,fit}.rs).
// The theme is Kiwimake's own (kit/theme.html, Workbench), so it is not copied.
//
//   node server/scripts/port-page-kit.mjs [path to Ghostex]
//
// Only user-visible wording that names Ghostex is changed (see EDITS); the markup, classes and
// the window.ghostex API stay as they are, so a page written for Ghostex works here unchanged
// (window.anyapp is the same object).
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ghostex = process.argv[2] ?? String.raw`C:\dev\Ghostex`;
const out = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "pages", "kit");
const sources = join(ghostex, "server", "src", "visual_pages");

function consts(file) {
  const src = readFileSync(join(sources, file), "utf8");
  const found = {};
  for (const m of src.matchAll(/const ([A-Z_]+): &str = r(#+)"([\s\S]*?)"\2;/g)) found[m[1]] = m[3];
  return found;
}

const EDITS = {
  "page-api.html": [
    ["Not sent yet: Ghostex can't be reached.", "Not sent yet: your PC can't be reached."],
    ["This page was posted by a Worker, so it is read-only here. Nothing was sent: answer through your coordinator.", "This page is read only here. Nothing was sent."],
    ["<b>Made with an older ghostex-visuals skill.</b> This page uses the old layout. Ghostex keeps the skill up to date on its own, so the agent&#39;s next page gets the new look.", "<b>This page uses an older layout.</b>"],
    ["})();</script>", "window.anyapp=window.ghostex;})();</script>"],
  ],
  "kit-script.html": [
    ["This Ghostex can't send answers from a page; type them in the chat.", "This page can't send answers here; type them in the chat."],
    // Every Kiwimake page is written for this kit, marker or not (the theme switch shows on all).
    [`function isV2(){var m=document.querySelector('meta[name="ghostex-page" i]');return!!m&&(m.getAttribute("content")||"").trim().toLowerCase()==="v2";}`, "function isV2(){return true;}"],
  ],
};

const theme = consts("theme.rs");
const kit = consts("kit.rs");
const fit = consts("fit.rs");
const files = {
  "page-api.html": theme.PAGE_API,
  "kit-style.html": kit.KIT_STYLE,
  "kit-script.html": kit.KIT_SCRIPT,
  "fit-style.html": fit.FIT_STYLE,
  "fit-script.html": fit.FIT_SCRIPT,
};
for (const [name, text] of Object.entries(files)) {
  if (!text) throw new Error(`Not found in Ghostex: ${name}`);
  let body = text;
  for (const [from, to] of EDITS[name] ?? []) {
    if (!body.includes(from)) throw new Error(`${name}: the text to change is gone: ${from.slice(0, 60)}`);
    body = body.split(from).join(to);
  }
  if (body.includes("\u2014")) throw new Error(`${name} has an em dash`);
  writeFileSync(join(out, name), body);
  console.log(`${name}: ${body.length} characters`);
}
