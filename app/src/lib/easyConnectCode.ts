// The Easy Connect code the PC's QR holds (docs/EASY-CONNECT.md 4.1):
//   ANYAPP-EC1:<RFC 4648 base32, no padding> of length-prefixed fields (big-endian u16):
//   address (bytes; the tailcat address is "tc" + base64url without padding of them)
//   secret  (bytes; base64url without padding)
//   port    (u16)
//   name    (UTF-8)
// Bytes after `name` are ignored. Mirrors decodeEasyConnectCode in server/src/easy-connect/code.ts;
// base32 and base64url are written by hand (no Buffer in React Native), like Ghostex's pairingCodes.ts.

export const EASY_CONNECT_PREFIX = "ANYAPP-EC1:";
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const BASE64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export interface EasyConnectCode {
  address: string; // "tc..." (a secret: never log or show it)
  secret: string; // base64url (a secret, single use)
  port: number;
  name: string; // the PC's name
}

export function looksLikeEasyConnect(text: string): boolean {
  return text.trim().toUpperCase().startsWith(EASY_CONNECT_PREFIX);
}

export function decodeBase32(text: string): Uint8Array | null {
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const char of text.toUpperCase()) {
    const value = BASE32.indexOf(char);
    if (value < 0) return null;
    buffer = ((buffer << 5) | value) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  return Uint8Array.from(out);
}

export function encodeBase64Url(bytes: Uint8Array): string {
  let out = "";
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += BASE64URL[(n >> 18) & 63] + BASE64URL[(n >> 12) & 63] + BASE64URL[(n >> 6) & 63] + BASE64URL[n & 63];
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i] << 16;
    out += BASE64URL[(n >> 18) & 63] + BASE64URL[(n >> 12) & 63];
  } else if (rest === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += BASE64URL[(n >> 18) & 63] + BASE64URL[(n >> 12) & 63] + BASE64URL[(n >> 6) & 63];
  }
  return out;
}

function utf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8").decode(bytes);
  } catch {
    // Older engines without TextDecoder: names are almost always ASCII.
    return String.fromCharCode(...bytes);
  }
}

export function decodeEasyConnectCode(text: string): EasyConnectCode | null {
  // QR readers and copy/paste may add spaces or line breaks inside the code.
  const trimmed = text.trim().replace(/\s+/g, "");
  if (trimmed.slice(0, EASY_CONNECT_PREFIX.length).toUpperCase() !== EASY_CONNECT_PREFIX) return null;
  const bytes = decodeBase32(trimmed.slice(EASY_CONNECT_PREFIX.length));
  if (!bytes) return null;
  let offset = 0;
  const readU16 = (): number | null => {
    if (offset + 2 > bytes.length) return null;
    const value = (bytes[offset] << 8) | bytes[offset + 1];
    offset += 2;
    return value;
  };
  const readField = (): Uint8Array | null => {
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
  return { address: `tc${encodeBase64Url(address)}`, secret: encodeBase64Url(secret), port, name: utf8(name) };
}
