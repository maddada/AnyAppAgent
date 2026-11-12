// Small crypto helpers that run in Convex's default runtime (Web Crypto, no Node).
// Sealing uses AES-256-GCM with KEYS_KEK (docs/CLOUD.md section 6; dev: an env var, launch: a
// key service). Milestone 5 moves app keys and secrets to per-row data keys (envelope).
import { unwrapDataKey, wrapDataKey } from './keyservice.ts';

const enc = new TextEncoder();
const dec = new TextDecoder();

export const b64 = (u: Uint8Array) => {
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
};
export const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export type Sealed = { iv: string; ciphertext: string };

async function kek() {
  const raw = process.env.KEYS_KEK;
  if (!raw) throw new Error('KEYS_KEK is not set');
  return crypto.subtle.importKey('raw', unb64(raw), 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function seal(text: string, aad: string): Promise<Sealed> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(aad) }, await kek(), enc.encode(text)));
  return { iv: b64(iv), ciphertext: b64(ct) };
}

export async function open(box: Sealed, aad: string): Promise<string> {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.iv), additionalData: enc.encode(aad) }, await kek(), unb64(box.ciphertext));
  return dec.decode(pt);
}

export async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** A random token, base64url, 32 bytes. */
export function randomToken(bytes = 32): string {
  const u = crypto.getRandomValues(new Uint8Array(bytes));
  return b64(u).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Constant-time compare of two hex strings. */
export function sameHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}

export async function hmacSha256B64(keyBytes: Uint8Array, data: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', keyBytes as Uint8Array<ArrayBuffer>, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64(new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data))));
}

/**
 * Envelope encryption (docs/CLOUD.md section 6): a fresh 256-bit data key per item seals the
 * plaintext (AES-256-GCM, `aad` binds it to its row); the data key is stored only wrapped by the
 * master key (lib/keyservice.ts: version 1 KEYS_KEK, version 2 a Google Cloud KMS key).
 */
export type Envelope = { wrappedDataKey: string; iv: string; ciphertext: string; kekVersion: number };

export async function envelopeSeal(plaintext: Uint8Array, aad: string): Promise<Envelope> {
  const dataKey = crypto.getRandomValues(new Uint8Array(32));
  const key = await crypto.subtle.importKey('raw', dataKey, 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(aad) }, key, plaintext as Uint8Array<ArrayBuffer>));
  const { wrapped, version } = await wrapDataKey(dataKey, aad);
  dataKey.fill(0);
  return { wrappedDataKey: wrapped, iv: b64(iv), ciphertext: b64(ct), kekVersion: version };
}

export async function envelopeOpen(e: Envelope, aad: string): Promise<Uint8Array> {
  const dataKey = await unwrapDataKey(e.wrappedDataKey, aad, e.kekVersion);
  const key = await crypto.subtle.importKey('raw', dataKey as Uint8Array<ArrayBuffer>, 'AES-GCM', false, ['decrypt']);
  dataKey.fill(0);
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(e.iv), additionalData: enc.encode(aad) }, key, unb64(e.ciphertext)));
}

/** A secret as text in an envelope (the person's AI key, their GitHub tokens). */
export async function sealSecret(text: string, aad: string): Promise<Envelope> {
  return envelopeSeal(enc.encode(text), aad);
}

/** Opens a secret row: an envelope, or an older row sealed directly with KEYS_KEK (no wrappedDataKey). */
export async function openSecret(row: { iv: string; ciphertext: string; wrappedDataKey?: string; kekVersion?: number }, aad: string): Promise<string> {
  if (!row.wrappedDataKey) return open({ iv: row.iv, ciphertext: row.ciphertext }, aad);
  return new TextDecoder().decode(await envelopeOpen({ wrappedDataKey: row.wrappedDataKey, iv: row.iv, ciphertext: row.ciphertext, kekVersion: row.kekVersion ?? 1 }, aad));
}
