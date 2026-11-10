// Builds the review pages from tools/pages/*.
//   node tools/build-pages.mjs                      -> system.html
//   node tools/build-pages.mjs --directions <dir>   -> also directions.html, embedding the
//        exploration fonts listed in <dir>/fonts.json ({alias, weight, style, file}[]).
// The icon markup comes from tools/pages/icons.json (Lucide, ISC).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const pages = path.join(here, "pages");
const read = (f) => fs.readFileSync(path.join(pages, f), "utf8");

const icons = read("icons.json");
const screensJs = read("screens.js");
const screensCss = read("screens.css");

function fill(template, parts) {
  let out = template;
  for (const [key, value] of Object.entries(parts)) {
    out = out.split(`/*@${key}@*/`).join(value).split(`<!--@${key}@-->`).join(value);
  }
  return out;
}

const args = process.argv.slice(2);
const dIndex = args.indexOf("--directions");
if (dIndex !== -1) {
  const fontDir = path.resolve(args[dIndex + 1]);
  const list = JSON.parse(fs.readFileSync(path.join(fontDir, "fonts.json"), "utf8"));
  const faces = list
    .map((f) => {
      const data = fs.readFileSync(path.join(fontDir, f.file)).toString("base64");
      return `@font-face{font-family:"${f.alias}";font-weight:${f.weight};font-style:${f.style};font-display:block;src:url(data:font/ttf;base64,${data}) format("truetype");}`;
    })
    .join("\n");
  const html = fill(read("directions.template.html"), {
    FONTS: faces,
    SCREENS_CSS: screensCss,
    DIRECTIONS_CSS: read("directions.css"),
    ICONS: icons,
    SCREENS_JS: screensJs,
    RECOMMENDATION: read("recommendation.html"),
  });
  fs.writeFileSync(path.join(root, "directions.html"), html);
  console.log("wrote directions.html", Math.round(html.length / 1024), "KB");
}

if (fs.existsSync(path.join(pages, "system.template.html"))) {
  const { theme } = await import("../tokens.ts");
  const names = { colors: Object.keys(theme.color.light), types: Object.keys(theme.type) };
  const html = fill(read("system.template.html"), {
    TOKEN_NAMES: JSON.stringify(names),
    SCREENS_CSS: screensCss,
    ICONS: icons,
    SCREENS_JS: screensJs,
    SYSTEM_JS: read("system.js"),
    SYSTEM_CSS: read("system.css"),
  });
  fs.writeFileSync(path.join(root, "system.html"), html);
  console.log("wrote system.html", Math.round(html.length / 1024), "KB");
}
