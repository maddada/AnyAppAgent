// Tiny PNG painter for the mock: app icons and test-APK launcher icons, no dependencies.
// Shapes are drawn with 4x4 supersampling, so edges are smooth.
import { Buffer } from "node:buffer";
import { deflateSync } from "node:zlib";

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

export function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

/**
 * Paints `size`x`size`. `layers` is a list of { color, inside(x, y) } in 0..1 coordinates,
 * painted in order. Returns a PNG buffer.
 */
export function paint(size, layers) {
  const rgba = Buffer.alloc(size * size * 4);
  const S = 4;
  const cols = layers.map((l) => ({ ...l, rgb: hex(l.color), a: l.alpha ?? 1 }));
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const x = (px + (sx + 0.5) / S) / size;
          const y = (py + (sy + 0.5) / S) / size;
          let cr = 0, cg = 0, cb = 0, ca = 0;
          for (const l of cols) {
            if (!l.inside(x, y)) continue;
            const la = l.a;
            cr = l.rgb[0] * la + cr * (1 - la);
            cg = l.rgb[1] * la + cg * (1 - la);
            cb = l.rgb[2] * la + cb * (1 - la);
            ca = la + ca * (1 - la);
          }
          r += cr; g += cg; b += cb; a += ca;
        }
      }
      const n = S * S;
      const i = (py * size + px) * 4;
      const alpha = a / n;
      rgba[i] = alpha ? Math.round(r / n / alpha) : 0;
      rgba[i + 1] = alpha ? Math.round(g / n / alpha) : 0;
      rgba[i + 2] = alpha ? Math.round(b / n / alpha) : 0;
      rgba[i + 3] = Math.round(alpha * 255);
    }
  }
  return encodePng(size, size, rgba);
}

// ---------- shapes (0..1 coordinates)

export const full = () => true;
export const circle = (cx, cy, r) => (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
export const roundRect = (x0, y0, x1, y1, r) => (x, y) => {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const dx = Math.max(x0 + r - x, 0, x - (x1 - r));
  const dy = Math.max(y0 + r - y, 0, y - (y1 - r));
  return dx * dx + dy * dy <= r * r;
};
export const and = (...fs) => (x, y) => fs.every((f) => f(x, y));
export const not = (f) => (x, y) => !f(x, y);
export const or = (...fs) => (x, y) => fs.some((f) => f(x, y));
/** Thick line segment from (ax,ay) to (bx,by), width w, round caps. */
export const line = (ax, ay, bx, by, w) => (x, y) => {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
  return (x - ax - t * dx) ** 2 + (y - ay - t * dy) ** 2 <= (w / 2) ** 2;
};
export const polygon = (pts) => (x, y) => {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

/** The glyphs used by the mock's apps, white on a coloured background. */
export const GLYPHS = {
  moon: or(and(circle(0.5, 0.5, 0.26), not(circle(0.6, 0.42, 0.22))), star5(0.66, 0.6, 0.07)),
  drop: or(circle(0.5, 0.58, 0.2), polygon([[0.5, 0.2], [0.32, 0.5], [0.68, 0.5]])),
  list: or(
    line(0.3, 0.34, 0.36, 0.4, 0.05), line(0.36, 0.4, 0.46, 0.28, 0.05), roundRect(0.52, 0.31, 0.74, 0.37, 0.03),
    line(0.3, 0.56, 0.36, 0.62, 0.05), line(0.36, 0.62, 0.46, 0.5, 0.05), roundRect(0.52, 0.53, 0.74, 0.59, 0.03),
    roundRect(0.28, 0.72, 0.46, 0.78, 0.03), roundRect(0.52, 0.72, 0.74, 0.78, 0.03),
  ),
  star: star5(0.5, 0.52, 0.28),
  sun: or(circle(0.5, 0.5, 0.15), ...Array.from({ length: 8 }, (_, k) => {
    const a = (k * Math.PI) / 4;
    return line(0.5 + Math.cos(a) * 0.23, 0.5 + Math.sin(a) * 0.23, 0.5 + Math.cos(a) * 0.32, 0.5 + Math.sin(a) * 0.32, 0.05);
  })),
  coin: or(and(circle(0.5, 0.5, 0.26), not(circle(0.5, 0.5, 0.2))), roundRect(0.46, 0.36, 0.54, 0.64, 0.02)),
  heart: or(circle(0.39, 0.42, 0.13), circle(0.61, 0.42, 0.13), polygon([[0.27, 0.47], [0.73, 0.47], [0.5, 0.74]])),
};

function star5(cx, cy, r) {
  const pts = [];
  for (let k = 0; k < 10; k++) {
    const a = -Math.PI / 2 + (k * Math.PI) / 5;
    const rr = k % 2 === 0 ? r : r * 0.45;
    pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
  }
  return polygon(pts);
}

/** A square app icon: rounded coloured background (or full bleed) and a white glyph. */
export function appIconPng(size, color, glyph, { fullBleed = false } = {}) {
  const bg = fullBleed ? full : roundRect(0, 0, 1, 1, 0.22);
  return paint(size, [
    { color, inside: bg },
    { color: "#ffffff", inside: and(bg, GLYPHS[glyph] ?? GLYPHS.star) },
  ]);
}
