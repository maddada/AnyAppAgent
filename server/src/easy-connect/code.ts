// The Easy Connect code the QR encodes. Copied from Ghostex's compact Easy Connect code
// (server/src/remote_access/pairing_code.rs `encode_easy_connect_compact_code`, and the reader
// apps/mobile/app/src/machines/pairingCodes.ts `readEasyConnectCompactCode`), minus the SSH
// fields: `ANYAPP-EC1:` + RFC 4648 base32 (no padding) of length-prefixed fields, every length a
// big-endian u16:
//   address  (the tailcat address blob's bytes: base64url-decoded text after the "tc" prefix)
//   secret   (the one-time pairing secret's bytes: base64url-decoded)
//   port     (u16, the companion's port the tunnel carries)
//   name     (UTF-8, the PC's name)
// Bytes after `name` are ignored, so a later field can be added without breaking a reader.
// Everything in the code is in the QR alphanumeric set (A-Z, 2-7, ':' and '-').
export const EASY_CONNECT_CODE_PREFIX = "ANYAPP-EC1:";
const TAILCAT_ADDRESS_PREFIX = "tc";
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export interface EasyConnectCode {
  address: string; // "tc…", verbatim as `tailcat serve` wrote it
  secret: string; // base64url, no padding
  port: number;
  name: string;
}

function canonicalBase64Url(text: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  const bytes = Buffer.from(text, "base64url");
  return bytes.toString("base64url") === text ? bytes : null;
}

function field(bytes: Buffer): Buffer {
  if (bytes.length > 0xffff) throw new Error("Easy Connect code field too long");
  const length = Buffer.alloc(2);
  length.writeUInt16BE(bytes.length);
  return Buffer.concat([length, bytes]);
}

export function encodeBase32(bytes: Uint8Array): string {
  let out = "";
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = ((buffer << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += BASE32_ALPHABET[(buffer >> bits) & 31];
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(buffer << (5 - bits)) & 31];
  return out;
}

export function decodeBase32(text: string): Buffer | null {
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const char of text.toUpperCase()) {
    const value = BASE32_ALPHABET.indexOf(char);
    if (value < 0) return null;
    buffer = ((buffer << 5) | value) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  return Buffer.from(out);
}

export function encodeEasyConnectCode(code: EasyConnectCode): string {
  if (!code.address.startsWith(TAILCAT_ADDRESS_PREFIX)) throw new Error("not a tailcat address");
  const address = canonicalBase64Url(code.address.slice(TAILCAT_ADDRESS_PREFIX.length));
  const secret = canonicalBase64Url(code.secret);
  if (!address || !secret) throw new Error("Easy Connect address or secret is not canonical base64url");
  const port = Buffer.alloc(2);
  port.writeUInt16BE(code.port);
  const bytes = Buffer.concat([field(address), field(secret), port, field(Buffer.from(code.name, "utf8"))]);
  return EASY_CONNECT_CODE_PREFIX + encodeBase32(bytes);
}

export function decodeEasyConnectCode(text: string): EasyConnectCode | null {
  const trimmed = text.trim();
  if (trimmed.slice(0, EASY_CONNECT_CODE_PREFIX.length).toUpperCase() !== EASY_CONNECT_CODE_PREFIX) return null;
  const bytes = decodeBase32(trimmed.slice(EASY_CONNECT_CODE_PREFIX.length));
  if (!bytes) return null;
  let offset = 0;
  const readU16 = (): number | null => {
    if (offset + 2 > bytes.length) return null;
    const value = bytes.readUInt16BE(offset);
    offset += 2;
    return value;
  };
  const readField = (): Buffer | null => {
    const length = readU16();
    if (length === null || offset + length > bytes.length) return null;
    const value = bytes.subarray(offset, offset + length);
    offset += length;
    return value;
  };
  const address = readField();
  const secret = readField();
  const port = readU16();
  const name = readField();
  if (!address || !secret || port === null || !name || address.length === 0 || secret.length === 0) return null;
  return {
    address: TAILCAT_ADDRESS_PREFIX + address.toString("base64url"),
    secret: secret.toString("base64url"),
    port,
    name: name.toString("utf8"),
  };
}
