// Turns a Material Design Icons glyph name ("cup-water", https://pictogrammers.com/library/mdi/)
// into an Android vector drawable, for tile and shortcut icons. Reads the icon font that the app
// already has (@expo/vector-icons in the React Native template, scripts/icon-font in the Kotlin
// one). Plain Node, no packages. The same file is in both templates.
//
//   node glyph.js <name> <out.xml> [--color "#RRGGBB"] [--font-dir <dir>]   (Kotlin template)
const fs = require('fs');
const path = require('path');

function fontFiles(fontDir, projectRoot) {
  if (fontDir) return { ttf: path.join(fontDir, 'MaterialCommunityIcons.ttf'), map: path.join(fontDir, 'MaterialCommunityIcons.json') };
  const pkg = path.dirname(require.resolve('@expo/vector-icons/package.json', { paths: [projectRoot || process.cwd()] }));
  const vendor = path.join(pkg, 'build', 'vendor', 'react-native-vector-icons');
  return { ttf: path.join(vendor, 'Fonts', 'MaterialCommunityIcons.ttf'), map: path.join(vendor, 'glyphmaps', 'MaterialCommunityIcons.json') };
}

const fonts = new Map();

function loadFont(files) {
  const key = files.ttf;
  if (fonts.has(key)) return fonts.get(key);
  const buf = fs.readFileSync(files.ttf);
  const map = JSON.parse(fs.readFileSync(files.map, 'utf8'));
  const tables = {};
  for (let i = 0; i < buf.readUInt16BE(4); i++) {
    const o = 12 + i * 16;
    tables[buf.toString('latin1', o, o + 4)] = buf.readUInt32BE(o + 8);
  }
  const upem = buf.readUInt16BE(tables.head + 18);
  const ascender = buf.readInt16BE(tables.hhea + 4);
  const longLoca = buf.readInt16BE(tables.head + 50) !== 0;
  const numGlyphs = buf.readUInt16BE(tables.maxp + 4);
  const loca = (i) => (longLoca ? buf.readUInt32BE(tables.loca + i * 4) : buf.readUInt16BE(tables.loca + i * 2) * 2);

  let f12 = null;
  const nSub = buf.readUInt16BE(tables.cmap + 2);
  for (let i = 0; i < nSub; i++) {
    const sub = tables.cmap + buf.readUInt32BE(tables.cmap + 4 + i * 8 + 4);
    if (buf.readUInt16BE(sub) === 12) f12 = sub;
  }
  function glyphIndex(cp) {
    if (f12 === null) return 0;
    const n = buf.readUInt32BE(f12 + 12);
    for (let i = 0; i < n; i++) {
      const g = f12 + 16 + i * 12;
      const s = buf.readUInt32BE(g);
      if (cp >= s && cp <= buf.readUInt32BE(g + 4)) return buf.readUInt32BE(g + 8) + (cp - s);
    }
    return 0;
  }
  function outline(gi, depth = 0) {
    if (gi >= numGlyphs || depth > 8 || loca(gi + 1) === loca(gi)) return [];
    const g = tables.glyf + loca(gi);
    const nContours = buf.readInt16BE(g);
    if (nContours < 0) {
      const out = [];
      let p = g + 10;
      for (;;) {
        const flags = buf.readUInt16BE(p);
        const child = buf.readUInt16BE(p + 2);
        p += 4;
        let dx = flags & 1 ? buf.readInt16BE(p) : buf.readInt8(p);
        let dy = flags & 1 ? buf.readInt16BE(p + 2) : buf.readInt8(p + 1);
        p += flags & 1 ? 4 : 2;
        if (!(flags & 2)) dx = dy = 0;
        let a = 1, b = 0, c = 0, d = 1;
        const f2 = (o) => buf.readInt16BE(o) / 16384;
        if (flags & 8) { a = d = f2(p); p += 2; }
        else if (flags & 0x40) { a = f2(p); d = f2(p + 2); p += 4; }
        else if (flags & 0x80) { a = f2(p); b = f2(p + 2); c = f2(p + 4); d = f2(p + 6); p += 8; }
        for (const ct of outline(child, depth + 1)) out.push(ct.map((q) => ({ x: a * q.x + c * q.y + dx, y: b * q.x + d * q.y + dy, on: q.on })));
        if (!(flags & 0x20)) break;
      }
      return out;
    }
    const ends = [];
    for (let i = 0; i < nContours; i++) ends.push(buf.readUInt16BE(g + 10 + i * 2));
    const nPts = nContours ? ends[nContours - 1] + 1 : 0;
    let p = g + 10 + nContours * 2;
    p += 2 + buf.readUInt16BE(p);
    const flags = [];
    while (flags.length < nPts) {
      const f = buf[p++];
      flags.push(f);
      if (f & 8) for (let r = buf[p++]; r > 0; r--) flags.push(f);
    }
    const read = (short, same) => {
      const vals = [];
      let v = 0;
      for (const f of flags) {
        if (f & short) { const dd = buf[p++]; v += f & same ? dd : -dd; }
        else if (!(f & same)) { v += buf.readInt16BE(p); p += 2; }
        vals.push(v);
      }
      return vals;
    };
    const xs = read(2, 16);
    const ys = read(4, 32);
    const contours = [];
    let s = 0;
    for (const e of ends) {
      const ct = [];
      for (let i = s; i <= e; i++) ct.push({ x: xs[i], y: ys[i], on: (flags[i] & 1) === 1 });
      contours.push(ct);
      s = e + 1;
    }
    return contours;
  }
  const font = { map, upem, ascender, glyphIndex, outline };
  fonts.set(key, font);
  return font;
}

const num = (v) => String(Math.round(v * 100) / 100);

/** SVG-style path data (y down, 0..upem) from TrueType quadratic contours. */
function pathData(contours, ascender) {
  const P = (q) => `${num(q.x)} ${num(ascender - q.y)}`;
  let d = '';
  for (const c of contours) {
    if (c.length < 2) continue;
    const n = c.length;
    let si = c.findIndex((q) => q.on);
    let start;
    if (si < 0) { start = { x: (c[0].x + c[1].x) / 2, y: (c[0].y + c[1].y) / 2, on: true }; si = 0; }
    else { start = c[si]; si = (si + 1) % n; }
    d += `M${P(start)}`;
    let ctrl = null;
    for (let k = 0; k < n; k++) {
      const q = c[(si + k) % n];
      if (q === start) continue;
      if (q.on) {
        d += ctrl ? `Q${P(ctrl)} ${P(q)}` : `L${P(q)}`;
        ctrl = null;
      } else if (ctrl) {
        const mid = { x: (ctrl.x + q.x) / 2, y: (ctrl.y + q.y) / 2 };
        d += `Q${P(ctrl)} ${P(mid)}`;
        ctrl = q;
      } else ctrl = q;
    }
    d += ctrl ? `Q${P(ctrl)} ${P(start)}Z` : 'Z';
  }
  return d;
}

/** True when [name] is a glyph in the font. */
function hasGlyph(name, opts = {}) {
  const font = loadFont(fontFiles(opts.fontDir, opts.projectRoot));
  return Object.prototype.hasOwnProperty.call(font.map, name);
}

/** The path data and size of glyph [name]; throws with a helpful message if there is none. */
function glyphPath(name, opts = {}) {
  const font = loadFont(fontFiles(opts.fontDir, opts.projectRoot));
  const cp = font.map[name];
  if (cp === undefined) {
    const near = Object.keys(font.map).filter((k) => k.includes(String(name).split('-')[0])).slice(0, 8);
    throw new Error(`no icon named "${name}" (https://pictogrammers.com/library/mdi/)${near.length ? `; similar: ${near.join(', ')}` : ''}`);
  }
  return { d: pathData(font.outline(font.glyphIndex(cp)), font.ascender), size: font.upem };
}

/** A vector drawable of glyph [name] in [color], [dp] dp square. */
function vectorDrawable(name, { color = '#FFFFFFFF', dp = 24, ...opts } = {}) {
  const { d, size } = glyphPath(name, opts);
  return `<?xml version="1.0" encoding="utf-8"?>
<!-- Icon "${name}" (Material Design Icons), made by glyph.js. -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
  android:width="${dp}dp" android:height="${dp}dp"
  android:viewportWidth="${size}" android:viewportHeight="${size}">
  <path android:fillColor="${color}" android:pathData="${d}" />
</vector>
`;
}

/**
 * An adaptive icon for an app shortcut (Android 8+): [glyph color] on a [background] circle area,
 * like the launcher's own shortcut icons. The glyph sits in the middle 40% of the 108 dp canvas.
 */
function shortcutIcon(name, { color, background, ...opts }) {
  const { d, size } = glyphPath(name, opts);
  const scale = (108 * 0.4) / size;
  const off = (108 - size * scale) / 2;
  return `<?xml version="1.0" encoding="utf-8"?>
<!-- Shortcut icon "${name}" (Material Design Icons), made by glyph.js. -->
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
  <background android:drawable="@android:color/transparent" />
  <foreground>
    <vector android:width="108dp" android:height="108dp" android:viewportWidth="108" android:viewportHeight="108">
      <path android:fillColor="${background}" android:pathData="M0,0h108v108h-108z" />
      <group android:translateX="${num(off)}" android:translateY="${num(off)}" android:scaleX="${scale}" android:scaleY="${scale}">
        <path android:fillColor="${color}" android:pathData="${d}" />
      </group>
    </vector>
  </foreground>
</adaptive-icon>
`;
}

module.exports = { hasGlyph, glyphPath, vectorDrawable, shortcutIcon };

if (require.main === module) {
  const [name, out, ...rest] = process.argv.slice(2);
  if (!name || !out) {
    console.error('usage: node glyph.js <icon-name> <out.xml> [--color "#RRGGBB"] [--font-dir <dir>]');
    process.exit(2);
  }
  const flag = (k) => {
    const i = rest.indexOf(k);
    return i >= 0 ? rest[i + 1] : undefined;
  };
  try {
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    fs.writeFileSync(out, vectorDrawable(name, { color: flag('--color') ?? '#FFFFFFFF', fontDir: flag('--font-dir') ?? path.dirname(require.resolve('./icon-font/MaterialCommunityIcons.json')) }));
    console.log(`wrote ${out}`);
  } catch (e) {
    console.error(`glyph: ${e.message}`);
    process.exit(1);
  }
}
