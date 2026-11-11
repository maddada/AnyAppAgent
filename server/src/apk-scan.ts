// Reads every text-bearing file inside an APK (a zip) and looks for secrets before it goes public
// (docs/DISTRIBUTION.md, "Before anything goes public"). A tiny zip reader: the central directory,
// stored and deflated entries, nothing else (APKs need nothing else).
import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import { findSecrets, type SecretHit } from "./secrets.ts";

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const MAX_ENTRY = 64 * 1024 * 1024;

/** Entries worth reading: code, bundled JavaScript, config and resources. Images and fonts are skipped. */
const SCANNED = /(\.(dex|js|bundle|json|xml|txt|properties|html|htm|cfg|conf|ini|yaml|yml|env|arsc|kotlin_module)$)|^assets\//i;
const SKIPPED = /\.(png|jpe?g|webp|gif|ttf|otf|mp3|ogg|wav|mp4|so)$/i;

export interface ZipEntry {
  name: string;
  data(): Buffer;
}

export function readZip(buf: Buffer): ZipEntry[] {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a zip file");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries: ZipEntry[] = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== CENTRAL) throw new Error("broken zip directory");
    const method = buf.readUInt16LE(p + 10);
    const compressed = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    entries.push({
      name,
      data: () => {
        if (buf.readUInt32LE(local) !== LOCAL) throw new Error(`broken zip entry ${name}`);
        const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
        const raw = buf.subarray(start, start + compressed);
        if (method === 0) return raw;
        if (method === 8) return inflateRawSync(raw, { maxOutputLength: Math.max(size, 1) + 1024 });
        throw new Error(`unsupported zip method ${method} in ${name}`);
      },
    });
  }
  return entries;
}

/** Secrets found in the APK's text files and code, with the entry they are in. */
export function scanApk(path: string): SecretHit[] {
  const hits: SecretHit[] = [];
  for (const entry of readZip(readFileSync(path))) {
    if (!SCANNED.test(entry.name) || SKIPPED.test(entry.name)) continue;
    let data: Buffer;
    try {
      data = entry.data();
    } catch {
      continue;
    }
    if (data.length > MAX_ENTRY) continue;
    hits.push(...findSecrets(data.toString("latin1"), entry.name));
    if (hits.length >= 20) break;
  }
  return hits;
}
