#!/usr/bin/env node
// Makes the app's launcher icon (icon.png, 1024x1024) from a colour and a glyph or letter.
// No external tools: draws a Material Community Icons glyph (7000+ icons, vendored in scripts/icon-font)
// with a tiny TrueType rasterizer and writes the PNG with Node's zlib.
//
//   node scripts/make-icon.mjs --bg "#14532D" --glyph mosque
//   node scripts/make-icon.mjs --bg "#1E2023" --letter T
//   node scripts/make-icon.mjs --search alarm          (list glyph names containing "alarm")
//
// Options: --bg <hex>  flat background (required unless --search)
//          --fg <hex>  glyph colour (default #FFFFFF)           --scale <0.2..0.7> glyph size (0.46)
//          --glyph <name> | --letter <A-Z or 0-9>                --out <file> (default icon.png)
// Icons at https://pictogrammers.com/library/mdi/ (same names).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SIZE = 1024;

function fail(msg) {
  console.error(`make-icon: ${msg}`);
  process.exit(1);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) fail(`unexpected argument "${a}"`);
    const key = a.slice(2);
    const val = argv[i + 1];
    if (val === undefined || val.startsWith('--')) fail(`--${key} needs a value`);
    out[key] = val;
    i++;
  }
  return out;
}

function parseColor(s, name) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(s).trim());
  if (!m) fail(`${name} must be a hex colour like "#0E7C66", got "${s}"`);
  let h = m[1];
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

// ---------- font data ----------

function fontFiles() {
  // Material Design Icons, vendored in scripts/icon-font (this app has no node_modules).
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'icon-font');
  return {
    ttf: path.join(dir, 'MaterialCommunityIcons.ttf'),
    map: path.join(dir, 'MaterialCommunityIcons.json'),
  };
}

function parseFont(buf) {
  const tables = {};
  const numTables = buf.readUInt16BE(4);
  for (let i = 0; i < numTables; i++) {
    const o = 12 + i * 16;
    tables[buf.toString('latin1', o, o + 4)] = { offset: buf.readUInt32BE(o + 8), length: buf.readUInt32BE(o + 12) };
  }
  for (const t of ['head', 'maxp', 'cmap', 'loca', 'glyf']) if (!tables[t]) fail(`font has no ${t} table`);
  const indexToLocFormat = buf.readInt16BE(tables.head.offset + 50);
  const numGlyphs = buf.readUInt16BE(tables.maxp.offset + 4);

  const locaAt = (i) =>
    indexToLocFormat === 0
      ? buf.readUInt16BE(tables.loca.offset + i * 2) * 2
      : buf.readUInt32BE(tables.loca.offset + i * 4);

  // cmap: prefer format 12 (full Unicode; these icons live above U+FFFF), else format 4.
  const cmapOff = tables.cmap.offset;
  const nSub = buf.readUInt16BE(cmapOff + 2);
  let f12 = null;
  let f4 = null;
  for (let i = 0; i < nSub; i++) {
    const sub = cmapOff + buf.readUInt32BE(cmapOff + 4 + i * 8 + 4);
    const format = buf.readUInt16BE(sub);
    if (format === 12) f12 = sub;
    else if (format === 4) f4 = sub;
  }
  function glyphIndex(cp) {
    if (f12 !== null) {
      const n = buf.readUInt32BE(f12 + 12);
      for (let i = 0; i < n; i++) {
        const g = f12 + 16 + i * 12;
        const start = buf.readUInt32BE(g);
        const end = buf.readUInt32BE(g + 4);
        if (cp >= start && cp <= end) return buf.readUInt32BE(g + 8) + (cp - start);
      }
    }
    if (f4 !== null && cp <= 0xffff) {
      const segX2 = buf.readUInt16BE(f4 + 6);
      const ends = f4 + 14;
      const starts = ends + segX2 + 2;
      const deltas = starts + segX2;
      const ranges = deltas + segX2;
      for (let i = 0; i < segX2; i += 2) {
        if (cp > buf.readUInt16BE(ends + i)) continue;
        const start = buf.readUInt16BE(starts + i);
        if (cp < start) return 0;
        const delta = buf.readInt16BE(deltas + i);
        const ro = buf.readUInt16BE(ranges + i);
        if (ro === 0) return (cp + delta) & 0xffff;
        const g = buf.readUInt16BE(ranges + i + ro + (cp - start) * 2);
        return g === 0 ? 0 : (g + delta) & 0xffff;
      }
    }
    return 0;
  }

  // Returns contours: arrays of {x, y, on}.
  function outline(gi, depth = 0) {
    if (gi >= numGlyphs || depth > 8) return [];
    const start = locaAt(gi);
    if (locaAt(gi + 1) === start) return [];
    const g = tables.glyf.offset + start;
    const nContours = buf.readInt16BE(g);
    if (nContours >= 0) {
      const endPts = [];
      for (let i = 0; i < nContours; i++) endPts.push(buf.readUInt16BE(g + 10 + i * 2));
      const nPts = nContours ? endPts[nContours - 1] + 1 : 0;
      let p = g + 10 + nContours * 2;
      p += 2 + buf.readUInt16BE(p); // skip instructions
      const flags = [];
      while (flags.length < nPts) {
        const f = buf[p++];
        flags.push(f);
        if (f & 8) {
          let r = buf[p++];
          while (r--) flags.push(f);
        }
      }
      const read = (shortBit, sameBit) => {
        const vals = [];
        let v = 0;
        for (const f of flags) {
          if (f & shortBit) {
            const d = buf[p++];
            v += f & sameBit ? d : -d;
          } else if (!(f & sameBit)) {
            v += buf.readInt16BE(p);
            p += 2;
          }
          vals.push(v);
        }
        return vals;
      };
      const xs = read(2, 16);
      const ys = read(4, 32);
      const contours = [];
      let s = 0;
      for (const e of endPts) {
        const c = [];
        for (let i = s; i <= e; i++) c.push({ x: xs[i], y: ys[i], on: (flags[i] & 1) === 1 });
        contours.push(c);
        s = e + 1;
      }
      return contours;
    }
    // Composite glyph.
    const contours = [];
    let p = g + 10;
    for (;;) {
      const flags = buf.readUInt16BE(p);
      const child = buf.readUInt16BE(p + 2);
      p += 4;
      let dx;
      let dy;
      if (flags & 1) {
        dx = buf.readInt16BE(p);
        dy = buf.readInt16BE(p + 2);
        p += 4;
      } else {
        dx = buf.readInt8(p);
        dy = buf.readInt8(p + 1);
        p += 2;
      }
      if (!(flags & 2)) dx = dy = 0; // point-matching offsets are not supported (not used by icon fonts)
      let a = 1;
      let b = 0;
      let c = 0;
      let d = 1;
      const f2 = (o) => buf.readInt16BE(o) / 16384;
      if (flags & 8) {
        a = d = f2(p);
        p += 2;
      } else if (flags & 0x40) {
        a = f2(p);
        d = f2(p + 2);
        p += 4;
      } else if (flags & 0x80) {
        a = f2(p);
        b = f2(p + 2);
        c = f2(p + 4);
        d = f2(p + 6);
        p += 8;
      }
      for (const contour of outline(child, depth + 1)) {
        contours.push(contour.map((pt) => ({ x: a * pt.x + c * pt.y + dx, y: b * pt.x + d * pt.y + dy, on: pt.on })));
      }
      if (!(flags & 0x20)) break;
    }
    return contours;
  }

  return { glyphIndex, outline };
}

// Quadratic TrueType contours -> closed polygons (arrays of [x, y]).
function flatten(contours, steps = 12) {
  const polys = [];
  for (const c of contours) {
    if (c.length < 2) continue;
    const n = c.length;
    let startIdx = c.findIndex((p) => p.on);
    let start;
    if (startIdx < 0) {
      start = { x: (c[0].x + c[1].x) / 2, y: (c[0].y + c[1].y) / 2 };
      startIdx = 0;
    } else {
      start = c[startIdx];
      startIdx = (startIdx + 1) % n;
    }
    const poly = [[start.x, start.y]];
    let prev = start;
    let ctrl = null;
    for (let k = 0; k < n; k++) {
      const pt = c[(startIdx + k) % n];
      if (pt.on) {
        if (ctrl) quad(poly, prev, ctrl, pt, steps);
        else poly.push([pt.x, pt.y]);
        prev = pt;
        ctrl = null;
      } else if (ctrl) {
        const mid = { x: (ctrl.x + pt.x) / 2, y: (ctrl.y + pt.y) / 2 };
        quad(poly, prev, ctrl, mid, steps);
        prev = mid;
        ctrl = pt;
      } else {
        ctrl = pt;
      }
    }
    if (ctrl) quad(poly, prev, ctrl, start, steps);
    polys.push(poly);
  }
  return polys;
}

function quad(poly, p0, p1, p2, steps) {
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    poly.push([u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x, u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y]);
  }
}

// Nonzero-winding scanline fill with exact horizontal and 8x vertical anti-aliasing.
function rasterize(polys, w, h) {
  const edges = [];
  for (const poly of polys) {
    for (let i = 0; i < poly.length; i++) {
      const [x0, y0] = poly[i];
      const [x1, y1] = poly[(i + 1) % poly.length];
      if (y0 === y1) continue;
      edges.push(y0 < y1 ? { ya: y0, yb: y1, x0, y0, k: (x1 - x0) / (y1 - y0), dir: 1 } : { ya: y1, yb: y0, x0, y0, k: (x1 - x0) / (y1 - y0), dir: -1 });
    }
  }
  const cov = new Float32Array(w * h);
  const SUB = 8;
  const wt = 1 / SUB;
  const xs = [];
  for (let row = 0; row < h; row++) {
    for (let s = 0; s < SUB; s++) {
      const y = row + (s + 0.5) / SUB;
      xs.length = 0;
      for (const e of edges) if (y >= e.ya && y < e.yb) xs.push({ x: e.x0 + (y - e.y0) * e.k, dir: e.dir });
      if (xs.length < 2) continue;
      xs.sort((a, b) => a.x - b.x);
      let wind = 0;
      for (let i = 0; i < xs.length - 1; i++) {
        wind += xs[i].dir;
        if (wind === 0) continue;
        const xa = Math.max(0, xs[i].x);
        const xb = Math.min(w, xs[i + 1].x);
        if (xb <= xa) continue;
        const ia = Math.floor(xa);
        const ib = Math.floor(xb);
        const base = row * w;
        if (ia === ib) {
          cov[base + ia] += (xb - xa) * wt;
        } else {
          cov[base + ia] += (ia + 1 - xa) * wt;
          for (let x = ia + 1; x < ib; x++) cov[base + x] += wt;
          if (ib < w) cov[base + ib] += (xb - ib) * wt;
        }
      }
    }
  }
  return cov;
}

// ---------- PNG ----------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function encodePng(rgb, w, h) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- main ----------

const args = parseArgs(process.argv.slice(2));
const files = fontFiles();
const glyphMap = JSON.parse(fs.readFileSync(files.map, 'utf8'));

if (args.search) {
  const q = args.search.toLowerCase();
  const hits = Object.keys(glyphMap).filter((n) => n.includes(q));
  console.log(hits.length ? hits.slice(0, 200).join('\n') : `no glyph names contain "${q}"`);
  process.exit(0);
}

if (!args.bg) fail('--bg is required, e.g. --bg "#0E7C66"');
const bg = parseColor(args.bg, '--bg');
let glyphName = args.glyph;
if (args.letter) {
  const ch = String(args.letter).trim();
  if (/^[a-z]$/i.test(ch)) glyphName = `alpha-${ch.toLowerCase()}`;
  else if (/^[0-9]$/.test(ch)) glyphName = `numeric-${ch}`;
  else fail('--letter must be one character A-Z or 0-9');
}
if (!glyphName) fail('give --glyph <name> or --letter <A-Z>');
const cp = glyphMap[glyphName];
if (cp === undefined) {
  const stem = glyphName.split('-')[0];
  const close = Object.keys(glyphMap).filter((n) => n.startsWith(stem)).slice(0, 15);
  fail(`unknown glyph "${glyphName}".${close.length ? ` Similar: ${close.join(', ')}` : ''} (try --search <word>)`);
}

const fg = parseColor(args.fg ?? '#FFFFFF', '--fg');
const scale = Math.min(0.7, Math.max(0.2, Number(args.scale ?? 0.46) || 0.46));
const outFile = path.resolve(ROOT, args.out ?? 'icon.png');

const font = parseFont(fs.readFileSync(files.ttf));
const gi = font.glyphIndex(cp);
const polys = flatten(font.outline(gi));
if (!gi || polys.length === 0) fail(`glyph "${glyphName}" has no outline in the font`);

// Fit the glyph's bounding box into scale*SIZE, centred; font y grows upwards, so flip it.
let minX = Infinity;
let minY = Infinity;
let maxX = -Infinity;
let maxY = -Infinity;
for (const poly of polys) {
  for (const [x, y] of poly) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
}
const k = (scale * SIZE) / Math.max(maxX - minX, maxY - minY);
const cx = (minX + maxX) / 2;
const cy = (minY + maxY) / 2;
const placed = polys.map((poly) => poly.map(([x, y]) => [SIZE / 2 + (x - cx) * k, SIZE / 2 - (y - cy) * k]));
const cov = rasterize(placed, SIZE, SIZE);

const rgb = Buffer.alloc(SIZE * SIZE * 3);
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const a = Math.min(1, Math.max(0, cov[y * SIZE + x]));
    const o = (y * SIZE + x) * 3;
    for (let ch = 0; ch < 3; ch++) {
      const back = bg[ch];
      rgb[o + ch] = Math.round(back + (fg[ch] - back) * a);
    }
  }
}

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, encodePng(rgb, SIZE, SIZE));
console.log(`Wrote ${path.relative(ROOT, outFile) || outFile} (${SIZE}x${SIZE}, glyph "${glyphName}")`);
