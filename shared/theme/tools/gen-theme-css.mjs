// Writes theme.css from tokens.ts. Run from anywhere: `node shared/theme/tools/gen-theme-css.mjs`.
// Needs Node 22.18+ or 23.6+ (loads tokens.ts with Node's built-in type stripping).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { theme } from "../tokens.ts";
import { renderThemeCss } from "./theme-css.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = path.join(root, "theme.css");
fs.writeFileSync(target, renderThemeCss(theme));
console.log("wrote", target);
