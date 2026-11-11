// A small ZIP reader and writer for the fast lane (lib/fastlane.mjs): it copies an APK entry by
// entry without recompressing (raw bytes), replaces or adds a few entries, and aligns stored
// entries the way zipalign does (4 bytes, 16 KB for native libraries), so apksigner can sign the
// result with --alignment-preserved. Also writes the small OTA package zip. No ZIP64 (APKs and
// OTA packages here are far below 4 GB), no encryption, no data descriptors on output.
import fs from 'node:fs/promises';
import zlib from 'node:zlib';

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Reads the central directory of a ZIP held in memory. Returns entries in file order:
 * { name, method, crc, compressedSize, size, localOffset, dataOffset, time, date }.
 */
export function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('not a zip file (no end of central directory)');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== CEN_SIG) throw new Error('bad central directory');
    const method = buf.readUInt16LE(p + 10);
    const time = buf.readUInt16LE(p + 12);
    const date = buf.readUInt16LE(p + 14);
    const crc = buf.readUInt32LE(p + 16);
    const compressedSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    if (buf.readUInt32LE(localOffset) !== LOC_SIG) throw new Error(`bad local header for ${name}`);
    const lNameLen = buf.readUInt16LE(localOffset + 26);
    const lExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + lNameLen + lExtraLen;
    entries.push({ name, method, crc, compressedSize, size, localOffset, dataOffset, time, date });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries.sort((a, b) => a.localOffset - b.localOffset);
}

/** The uncompressed bytes of one entry. */
export function entryData(buf, e) {
  const raw = buf.subarray(e.dataOffset, e.dataOffset + e.compressedSize);
  if (e.method === 0) return Buffer.from(raw);
  if (e.method === 8) return zlib.inflateRawSync(raw);
  throw new Error(`${e.name}: compression method ${e.method} is not supported`);
}

/** zipalign's rule: native libraries on 16 KB pages, other stored entries on 4 bytes. */
function alignmentFor(name, method) {
  if (method !== 0) return 1;
  return name.endsWith('.so') ? 16384 : 4;
}

/**
 * Writes a ZIP from `items`, in order. Each item is either
 *   { name, raw: { method, crc, compressedSize, size, bytes } }   copied as it is, or
 *   { name, data: Buffer, store?: boolean }                         compressed here (deflate) unless store.
 * Stored entries are aligned (see alignmentFor) with padding in the local extra field.
 */
export async function writeZip(file, items) {
  const chunks = [];
  const central = [];
  let offset = 0;
  // 1981-01-01 00:00, as the Android build tools write.
  const DOS_TIME = 0;
  const DOS_DATE = ((1981 - 1980) << 9) | (1 << 5) | 1;
  for (const item of items) {
    const name = Buffer.from(item.name, 'utf8');
    let method;
    let crc;
    let size;
    let bytes;
    if (item.raw) {
      ({ method, crc, size } = item.raw);
      bytes = item.raw.bytes;
    } else {
      size = item.data.length;
      crc = crc32(item.data);
      if (item.store) {
        method = 0;
        bytes = item.data;
      } else {
        method = 8;
        bytes = zlib.deflateRawSync(item.data, { level: 6 });
      }
    }
    const align = alignmentFor(item.name, method);
    const headerEnd = offset + 30 + name.length;
    const pad = align > 1 ? (align - (headerEnd % align)) % align : 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOC_SIG, 0);
    local.writeUInt16LE(method === 0 ? 10 : 20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc >>> 0, 14);
    local.writeUInt32LE(bytes.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(pad, 28);
    chunks.push(local, name, Buffer.alloc(pad), bytes);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(CEN_SIG, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(method === 0 ? 10 : 20, 6);
    cen.writeUInt16LE(0x0800, 8);
    cen.writeUInt16LE(method, 10);
    cen.writeUInt16LE(DOS_TIME, 12);
    cen.writeUInt16LE(DOS_DATE, 14);
    cen.writeUInt32LE(crc >>> 0, 16);
    cen.writeUInt32LE(bytes.length, 20);
    cen.writeUInt32LE(size, 24);
    cen.writeUInt16LE(name.length, 28);
    cen.writeUInt32LE(offset, 42);
    central.push(cen, name);
    offset += 30 + name.length + pad + bytes.length;
  }
  const cenStart = offset;
  const cenSize = central.reduce((n, b) => n + b.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(EOCD_SIG, 0);
  eocd.writeUInt16LE(items.length, 8);
  eocd.writeUInt16LE(items.length, 10);
  eocd.writeUInt32LE(cenSize, 12);
  eocd.writeUInt32LE(cenStart, 16);
  await fs.writeFile(file, Buffer.concat([...chunks, ...central, eocd]));
}

/** An entry of `buf` as a writeZip item that is copied without recompressing. */
export function rawItem(buf, e) {
  return {
    name: e.name,
    raw: { method: e.method, crc: e.crc, size: e.size, bytes: buf.subarray(e.dataOffset, e.dataOffset + e.compressedSize) },
  };
}
