// Renders the mark SVGs into every PNG and ICO the two apps need. Dev-only tool.
//   node tools/render-assets.mjs --puppeteer <dir containing node_modules/puppeteer-core> [--chrome <chrome.exe>]
// Outputs under mark/android/ and mark/windows/ (see README.md, "The mark").
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const arg = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const require = createRequire(path.join(path.resolve(arg("--puppeteer", ".")), "package.json"));
const puppeteer = require("puppeteer-core");
const chrome = arg("--chrome", "C:/Program Files/Google/Chrome/Application/chrome.exe");

const mark = (f) => "data:image/svg+xml;base64," + fs.readFileSync(path.join(root, "mark", f)).toString("base64");
const out = (...p) => {
  const file = path.join(root, "mark", ...p);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  return file;
};

const browser = await puppeteer.launch({ executablePath: chrome, headless: true });
const page = await browser.newPage();

async function shot(file, px, layers, shape = "none", height = px) {
  const radius = shape === "circle" ? "50%" : "0";
  const imgs = layers.map((src) => `<img src="${src}" style="position:absolute;inset:0;width:100%;height:100%">`).join("");
  await page.setViewport({ width: px, height, deviceScaleFactor: 1 });
  await page.setContent(
    `<html><body style="margin:0;background:transparent"><div id="c" style="position:relative;width:${px}px;height:${height}px;border-radius:${radius};overflow:hidden">${imgs}</div></body></html>`,
  );
  await page.evaluate(() => Promise.all([...document.images].map((i) => i.decode())));
  const el = await page.$("#c");
  await el.screenshot({ path: file, omitBackground: true });
  return file;
}

const fg = mark("android/adaptive-foreground.svg");
const bg = mark("android/adaptive-background.svg");
const mono = mark("android/adaptive-monochrome.svg");
const full = mark("mark.svg");
const small = mark("mark-small.svg");
const stat = mark("android/ic-stat.svg");
const launcher = mark("android/launcher.svg");

// Android, Expo app config (1024 px sources; Expo makes the densities).
await shot(out("android/expo/icon.png"), 1024, [launcher]);
await shot(out("android/expo/adaptive-foreground.png"), 1024, [fg]);
await shot(out("android/expo/adaptive-background.png"), 1024, [bg]);
await shot(out("android/expo/adaptive-monochrome.png"), 1024, [mono]);
await shot(out("android/expo/notification-icon.png"), 96, [stat]);

// Android, plain res/ folders.
const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [d, f] of Object.entries(densities)) {
  await shot(out(`android/res/mipmap-${d}/ic_launcher_foreground.png`), 108 * f, [fg]);
  await shot(out(`android/res/mipmap-${d}/ic_launcher_background.png`), 108 * f, [bg]);
  await shot(out(`android/res/mipmap-${d}/ic_launcher_monochrome.png`), 108 * f, [mono]);
  await shot(out(`android/res/mipmap-${d}/ic_launcher.png`), 48 * f, [launcher]);
  // A legacy round icon has no adaptive 108-to-72 crop. Use the same 75% mark.
  await shot(out(`android/res/mipmap-${d}/ic_launcher_round.png`), 48 * f, [launcher], "circle");
  await shot(out(`android/res/drawable-${d}/ic_stat_anyappagent.png`), 24 * f, [stat]);
}
const adaptiveXml = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@mipmap/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
    <monochrome android:drawable="@mipmap/ic_launcher_monochrome" />
</adaptive-icon>
`;
fs.writeFileSync(out("android/res/mipmap-anydpi-v26/ic_launcher.xml"), adaptiveXml);
fs.writeFileSync(out("android/res/mipmap-anydpi-v26/ic_launcher_round.xml"), adaptiveXml);

// Windows: app icon PNGs, the .ico, and tray icons. Up to 24 px uses the pixel-tuned small mark.
const pngs = {};
for (const px of [16, 20, 24, 32, 40, 48, 64, 96, 128, 256, 512]) {
  pngs[px] = await shot(out(`windows/icon-${px}.png`), px, [px <= 24 ? small : full]);
}
const trayScale = { "": 16, "@1.25x": 20, "@1.5x": 24, "@2x": 32, "@2.5x": 40, "@3x": 48 };
for (const [suffix, px] of Object.entries(trayScale)) {
  // Tray icons remain optically simple at every display scale.
  await shot(out(`windows/tray${suffix}.png`), px, [small]);
  await shot(out(`windows/tray-${px}.png`), px, [small]);
}
// Transparent in-app assets, separate from the cream launcher plate.
await shot(out("native/mark.png"), 512, [full]);
await shot(out("native/mark-small.png"), 512, [small]);
await shot(out("native/lockup.png"), 1653, [mark("lockup.svg")], "none", 424);
await shot(out("native/lockup-dark.png"), 1653, [mark("lockup-dark.svg")], "none", 424);
await browser.close();

function ico(sizes, sources = pngs) {
  const images = sizes.map((s) => fs.readFileSync(sources[s]));
  const header = Buffer.alloc(6 + 16 * sizes.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  sizes.forEach((s, i) => {
    const e = 6 + 16 * i;
    header.writeUInt8(s >= 256 ? 0 : s, e);
    header.writeUInt8(s >= 256 ? 0 : s, e + 1);
    header.writeUInt16LE(1, e + 4);
    header.writeUInt16LE(32, e + 6);
    header.writeUInt32LE(images[i].length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += images[i].length;
  });
  return Buffer.concat([header, ...images]);
}
fs.writeFileSync(out("windows/anyappagent.ico"), ico([16, 20, 24, 32, 40, 48, 64, 256]));
const traySizes = [16, 20, 24, 32, 40, 48];
fs.writeFileSync(out("windows/tray.ico"), ico(traySizes, Object.fromEntries(traySizes.map((s) => [s, out(`windows/tray-${s}.png`)]))));
console.log("assets written under", path.join(root, "mark"));
