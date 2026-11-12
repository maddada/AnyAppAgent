// Turns tokens.ts into the text of theme.css. Pure: used by gen-theme-css.mjs (writes the file)
// and by theme.test.mjs (fails when the file on disk differs from what this returns).

const kebab = (s) => String(s).replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
const px = (n) => (n === 0 ? "0" : `${n}px`);
const round = (n) => Math.round(n * 1000) / 1000;

function colorBlock(map, elevation) {
  const lines = Object.entries(map).map(([k, v]) => `  --aa-${kebab(k)}: ${v};`);
  for (const [level, e] of Object.entries(elevation)) lines.push(`  --aa-shadow-${level}: ${e.css};`);
  return lines.join("\n");
}

export function renderThemeCss(t) {
  const out = [];
  out.push(
    "/* Kiwimake theme (" + t.themeName + "). GENERATED from tokens.ts by tools/gen-theme-css.mjs.",
    "   Do not edit by hand: change tokens.ts, run `node tools/gen-theme-css.mjs`, then `node --test tools/`.",
    "   Light is the default; dark follows the OS unless data-aa-theme=\"light\" or \"dark\" is set on <html>.",
    "   Any element can also carry data-aa-theme to render one mode inside the other. */",
    "",
  );

  for (const f of t.fontFiles) {
    out.push(
      `@font-face { font-family: "${f.cssFamily}"; font-weight: ${f.weight}; font-style: normal; font-display: swap; src: url("./fonts/${f.file}") format("truetype"); }`,
    );
  }
  out.push("");

  const root = [];
  for (const [role, fam] of Object.entries(t.fontFamily)) root.push(`  --aa-font-${role}: ${fam.css};`);
  for (const [key, s] of Object.entries(t.type)) {
    const role = kebab(key);
    root.push(
      `  --aa-type-${role}-family: var(--aa-font-${s.family});`,
      `  --aa-type-${role}-size: ${px(s.size)};`,
      `  --aa-type-${role}-line: ${px(s.lineHeight)};`,
      `  --aa-type-${role}-weight: ${s.weight};`,
      `  --aa-type-${role}-tracking: ${s.letterSpacing === 0 ? "0" : `${round(s.letterSpacing)}px`};`,
      `  --aa-type-${role}-transform: ${s.transform};`,
    );
  }
  root.push(`  --aa-type-strong-weight: ${t.strongWeight.weight};`);
  for (const [k, v] of Object.entries(t.space)) root.push(`  --aa-space-${k}: ${px(v)};`);
  for (const [k, v] of Object.entries(t.size)) root.push(`  --aa-size-${kebab(k)}: ${px(v)};`);
  for (const [k, v] of Object.entries(t.radius)) {
    const value = typeof v === "number" ? px(v) : `${px(v.topLeft)} ${px(v.topRight)} ${px(v.bottomRight)} ${px(v.bottomLeft)}`;
    root.push(`  --aa-radius-${kebab(k)}: ${value};`);
  }
  root.push(
    `  --aa-border-width: ${px(t.border.width)};`,
    `  --aa-tile-border-width: ${px(t.border.tileWidth)};`,
    `  --aa-list-border-width: ${px(t.border.listWidth)};`,
    `  --aa-focus-width: ${px(t.border.focusWidth)};`,
    `  --aa-tile-new-style: ${t.border.tileNewStyle};`,
    `  --aa-think-style: ${t.look.thinkingFontStyle};`,
    `  --aa-tile-align: ${t.look.tileAlign};`,
    `  --aa-tile-text-align: ${t.look.tileTextAlign};`,
    `  --aa-tile-padding: ${px(t.look.tilePadding)};`,
    `  --aa-tile-shadow: var(--aa-shadow-${t.look.tileElevation});`,
    `  --aa-wordmark-weight: ${t.look.wordmarkWeight};`,
    `  --aa-wordmark-tracking: ${t.look.wordmarkLetterSpacing}em;`,
  );
  for (const [k, v] of Object.entries(t.motion.duration)) root.push(`  --aa-duration-${kebab(k)}: ${v}ms;`);
  for (const [k, v] of Object.entries(t.motion.easing)) root.push(`  --aa-ease-${kebab(k)}: cubic-bezier(${v.join(", ")});`);
  root.push(`  --aa-icon-stroke: ${t.icon.stroke};`);
  for (const [k, v] of Object.entries(t.icon.size)) root.push(`  --aa-icon-${k}: ${px(v)};`);

  out.push(":root {", root.join("\n"), "}", "");
  out.push(':root,\n[data-aa-theme="light"] {', "  color-scheme: light;", colorBlock(t.color.light, t.elevation.light), "}", "");
  out.push(
    "@media (prefers-color-scheme: dark) {",
    '  :root:not([data-aa-theme="light"]) {',
    "    color-scheme: dark;",
    colorBlock(t.color.dark, t.elevation.dark).replace(/^ {2}/gm, "    "),
    "  }",
    "}",
    "",
  );
  out.push('[data-aa-theme="dark"] {', "  color-scheme: dark;", colorBlock(t.color.dark, t.elevation.dark), "}", "");

  out.push("/* One class per type role, for the desktop renderer. */");
  for (const role of Object.keys(t.type).map(kebab)) {
    out.push(
      `.aa-type-${role} { font-family: var(--aa-type-${role}-family); font-size: var(--aa-type-${role}-size); line-height: var(--aa-type-${role}-line); font-weight: var(--aa-type-${role}-weight); letter-spacing: var(--aa-type-${role}-tracking); text-transform: var(--aa-type-${role}-transform); }`,
    );
  }
  out.push("");
  out.push(
    "@media (prefers-reduced-motion: reduce) {",
    "  :root { --aa-duration-base: var(--aa-duration-fast); --aa-duration-slow: var(--aa-duration-fast); }",
    "}",
    "",
  );
  return out.join("\n");
}
