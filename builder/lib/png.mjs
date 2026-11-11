// Minimal PNG decode / resize / encode with Node's zlib (no dependencies). Used to make the
// Android launcher sizes of a Kotlin app's icon.png. Decodes 8-bit greyscale, RGB, palette,
// grey+alpha and RGBA PNGs without interlacing (what icon tools and make-icon.mjs write).
import zlib from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/** Returns { width, height, rgba } or throws with a plain reason. */
export function decodePng(buf) {
  if (!buf.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG file');
  let off = 8;
  let ihdr = null;
  let palette = null;
  let trns = null;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      ihdr = { width: data.readUInt32BE(0), height: data.readUInt32BE(4), depth: data[8], color: data[9], interlace: data[12] };
    } else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (!ihdr) throw new Error('PNG has no header');
  const { width, height, depth, color, interlace } = ihdr;
  if (depth !== 8) throw new Error(`PNG bit depth ${depth} is not supported (use 8-bit)`);
  if (interlace) throw new Error('interlaced PNGs are not supported');
  const ch = CHANNELS[color];
  if (!ch) throw new Error(`PNG colour type ${color} is not supported`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * ch;
  const px = Buffer.alloc(stride * height);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = px.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? out[x - ch] : 0;
      const b = prev[x];
      const c = x >= ch ? prev[x - ch] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[x] = v & 0xff;
    }
    prev = out;
  }
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const s = i * ch;
    const d = i * 4;
    if (color === 0) rgba.fill(px[s], d, d + 3), (rgba[d + 3] = 255);
    else if (color === 4) rgba.fill(px[s], d, d + 3), (rgba[d + 3] = px[s + 1]);
    else if (color === 2) px.copy(rgba, d, s, s + 3), (rgba[d + 3] = 255);
    else if (color === 6) px.copy(rgba, d, s, s + 4);
    else {
      const idx = px[s];
      if (!palette || idx * 3 + 2 >= palette.length) throw new Error('PNG palette index out of range');
      palette.copy(rgba, d, idx * 3, idx * 3 + 3);
      rgba[d + 3] = trns && idx < trns.length ? trns[idx] : 255;
    }
  }
  return { width, height, rgba };
}

/** Area-average downscale (or nearest upscale) to size x size; premultiplied so edges stay clean. */
export function resizeSquare({ width, height, rgba }, size) {
  const out = Buffer.alloc(size * size * 4);
  const sx = width / size;
  const sy = height / size;
  for (let y = 0; y < size; y++) {
    const y0 = y * sy;
    const y1 = Math.max(y0 + 1e-9, (y + 1) * sy);
    for (let x = 0; x < size; x++) {
      const x0 = x * sx;
      const x1 = Math.max(x0 + 1e-9, (x + 1) * sx);
      let r = 0, g = 0, b = 0, a = 0, w = 0;
      for (let yy = Math.floor(y0); yy < Math.min(height, Math.ceil(y1)); yy++) {
        const wy = Math.min(y1, yy + 1) - Math.max(y0, yy);
        for (let xx = Math.floor(x0); xx < Math.min(width, Math.ceil(x1)); xx++) {
          const wx = Math.min(x1, xx + 1) - Math.max(x0, xx);
          const k = wx * wy;
          const i = (yy * width + xx) * 4;
          const al = rgba[i + 3] / 255;
          r += rgba[i] * al * k;
          g += rgba[i + 1] * al * k;
          b += rgba[i + 2] * al * k;
          a += al * k;
          w += k;
        }
      }
      const o = (y * size + x) * 4;
      if (a > 0) {
        out[o] = Math.round(r / a);
        out[o + 1] = Math.round(g / a);
        out[o + 2] = Math.round(b / a);
      }
      out[o + 3] = Math.round((a / w) * 255);
    }
  }
  return { width: size, height: size, rgba: out };
}

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
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
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

/** RGBA PNG (RGB when fully opaque). */
export function encodePng({ width, height, rgba }) {
  let opaque = true;
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] !== 255) { opaque = false; break; }
  const ch = opaque ? 3 : 4;
  const raw = Buffer.alloc((width * ch + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * ch + 1);
    for (let x = 0; x < width; x++) {
      const s = (y * width + x) * 4;
      const d = row + 1 + x * ch;
      raw[d] = rgba[s];
      raw[d + 1] = rgba[s + 1];
      raw[d + 2] = rgba[s + 2];
      if (ch === 4) raw[d + 3] = rgba[s + 3];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = opaque ? 2 : 6;
  return Buffer.concat([SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
