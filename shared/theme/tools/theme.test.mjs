// Run: node --test shared/theme/tools/   (Node 22.18+ or 23.6+; no dependencies)
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { theme } from "../tokens.ts";
import { renderThemeCss } from "./theme-css.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

test("theme.css is exactly what tokens.ts generates (run tools/gen-theme-css.mjs)", () => {
  assert.equal(read("theme.css"), renderThemeCss(theme));
});

test("light and dark define the same colour tokens", () => {
  assert.deepEqual(Object.keys(theme.color.dark).sort(), Object.keys(theme.color.light).sort());
  assert.deepEqual(Object.keys(theme.elevation.dark).sort(), Object.keys(theme.elevation.light).sort());
});

test("every --aa-* variable the pages use is defined by theme.css", () => {
  const css = read("theme.css");
  const defined = new Set([...css.matchAll(/(--aa-[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
  const sources = ["tools/pages/screens.css", "tools/pages/screens.js", "tools/pages/system.css", "tools/pages/system.js"].filter((p) =>
    fs.existsSync(path.join(root, p)),
  );
  const missing = new Set();
  for (const p of sources) for (const m of read(p).matchAll(/var\((--aa-[a-z0-9-]+)/g)) if (!defined.has(m[1])) missing.add(`${m[1]} (${p})`);
  assert.deepEqual([...missing], []);
});

test("every type style names the right native font file", () => {
  for (const [role, s] of Object.entries(theme.type)) {
    assert.equal(s.native, theme.fontFamily[s.family].native[s.weight], `type.${role}`);
  }
  const natives = new Set(theme.fontFiles.map((f) => f.native));
  for (const [role, fam] of Object.entries(theme.fontFamily)) {
    for (const n of Object.values(fam.native)) assert.ok(natives.has(n), `fontFamily.${role} ${n} has no file`);
  }
  for (const f of theme.fontFiles) {
    assert.ok(fs.existsSync(path.join(root, "fonts", f.file)), `fonts/${f.file} missing`);
    assert.equal(f.native, f.file.replace(/\.ttf$/, ""), "native name must be the file name (Expo's font plugin registers it so)");
  }
});

test("at most two font families, each with its licence", () => {
  const families = new Set(theme.fontFiles.map((f) => f.file.split("-")[0]));
  assert.ok(families.size <= 2, [...families].join(", "));
  for (const fam of families) assert.ok(fs.existsSync(path.join(root, "fonts", `OFL-${fam}.txt`)), `licence for ${fam}`);
});

function luminance(hex) {
  const n = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

for (const mode of ["light", "dark"]) {
  test(`${mode}: readable contrast (WCAG AA)`, () => {
    const c = theme.color[mode];
    const checks = [];
    for (const fg of ["text", "textSecondary", "textTertiary", "ready", "problem"])
      for (const bg of ["bg", "surface", "surfaceSunken"]) checks.push([fg, bg, 4.5]);
    checks.push(["onAccent", "accent", 4.5], ["onProblem", "problem", 4.5], ["onAttention", "attention", 4.5], ["attentionText", "bg", 4.5], ["attentionText", "surface", 4.5], ["attention", "surface", 1.8], ["bubbleText", "bubbleBg", 7], ["text", "surfaceOverlay", 7]);
    checks.push(["ready", "readySoft", 4.5], ["problem", "problemSoft", 4.5], ["qrFg", "qrBg", 10], ["markFg", "markBg", 4.5]);
    checks.push(["accent", "bg", 3], ["focus", "bg", 3], ["borderStrong", "bg", 1.5]);
    const failures = checks
      .map(([fg, bg, min]) => [fg, bg, min, contrast(c[fg], c[bg])])
      .filter(([, , min, r]) => r < min)
      .map(([fg, bg, min, r]) => `${fg} on ${bg}: ${r.toFixed(2)} < ${min}`);
    assert.deepEqual(failures, []);
  });
}

test("no em dash anywhere in the theme folder", () => {
  const bad = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name !== "node_modules") walk(p);
      } else if (/\.(ts|mjs|js|css|html|md|json|svg|txt)$/.test(e.name) && fs.readFileSync(p, "utf8").includes(String.fromCharCode(0x2014))) {
        bad.push(path.relative(root, p));
      }
    }
  };
  walk(root);
  assert.deepEqual(bad, []);
});
