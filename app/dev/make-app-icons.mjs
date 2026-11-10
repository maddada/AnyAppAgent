// Generates AnyAppAgent's own launcher icons into assets/ (run once; output is committed).
// The mark: three rounded tiles and a plus, "apps, and one more".
import { writeFileSync } from "node:fs";
import { and, or, paint, roundRect, full } from "./png.mjs";

const BG = "#141416";
// Mark in a 0..1 box, scaled into [o, o+s].
function mark(o, s) {
  const r = (x0, y0, x1, y1, rad) => roundRect(o + x0 * s, o + y0 * s, o + x1 * s, o + y1 * s, rad * s);
  return {
    tiles: or(r(0, 0, 0.44, 0.44, 0.12), r(0.56, 0, 1, 0.44, 0.12), r(0, 0.56, 0.44, 1, 0.12)),
    plus: or(r(0.72, 0.56, 0.84, 1, 0.06), r(0.56, 0.72, 1, 0.84, 0.06)),
  };
}

const size = 1024;
const legacy = mark(0.26, 0.48);
writeFileSync("assets/icon.png", paint(size, [
  { color: BG, inside: full },
  { color: "#f4f4f5", inside: legacy.tiles },
  { color: "#3bb974", inside: legacy.plus },
]));
const fg = mark(0.33, 0.34); // inside the adaptive-icon safe zone
writeFileSync("assets/android-icon-foreground.png", paint(size, [
  { color: "#f4f4f5", inside: fg.tiles },
  { color: "#4bc680", inside: fg.plus },
]));
writeFileSync("assets/android-icon-monochrome.png", paint(size, [
  { color: "#ffffff", inside: or(fg.tiles, fg.plus) },
]));
writeFileSync("assets/splash-icon.png", paint(512, [
  { color: "#f4f4f5", inside: mark(0.2, 0.6).tiles },
  { color: "#3bb974", inside: and(full, mark(0.2, 0.6).plus) },
]));
console.log("icons written");
