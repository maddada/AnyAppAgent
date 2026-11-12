// Sealing a signing key for one hop between Convex and a box (docs/CLOUD.md section 6): a new
// app's key goes up sealed to Convex's transport key; a signing ticket comes down sealed to a key
// the runner made for that one request. ECDH P-256 with a fresh ephemeral key per message, HKDF
// SHA-256, AES-256-GCM; `info` binds the message to its purpose (and thread, build). TLS stays
// underneath; this keeps the key unreadable to anything that only sees the HTTP bodies.
// server/src/cloud-transport.ts is the same code for the runner (tests check they agree).
import { b64, unb64 } from './crypto.ts';

const enc = new TextEncoder();
const ECDH = { name: 'ECDH', namedCurve: 'P-256' } as const;

export type Sealed = { epk: string; iv: string; ct: string };

async function aesKey(priv: CryptoKey, peerRaw: Uint8Array, info: string): Promise<CryptoKey> {
  const peer = await crypto.subtle.importKey('raw', peerRaw as Uint8Array<ArrayBuffer>, ECDH, false, []);
  const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: peer }, priv, 256);
  const hk = await crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: enc.encode(`kiwimake transport v1:${info}`) },
    hk,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** A new P-256 key pair: the private key as PKCS#8 base64, the public one raw base64. */
export async function newTransportKey(): Promise<{ privatePkcs8: string; publicRaw: string; key: CryptoKey }> {
  const pair = (await crypto.subtle.generateKey(ECDH, true, ['deriveBits'])) as { publicKey: CryptoKey; privateKey: CryptoKey };
  const priv = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  return { privatePkcs8: b64(priv), publicRaw: b64(pub), key: pair.privateKey };
}

export async function importPrivate(pkcs8B64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('pkcs8', unb64(pkcs8B64) as Uint8Array<ArrayBuffer>, ECDH, false, ['deriveBits']);
}

/** Seals `plaintext` to the holder of `recipientPublicRaw` (base64). */
export async function sealTo(recipientPublicRaw: string, plaintext: Uint8Array, info: string): Promise<Sealed> {
  const eph = (await crypto.subtle.generateKey(ECDH, true, ['deriveBits'])) as { publicKey: CryptoKey; privateKey: CryptoKey };
  const key = await aesKey(eph.privateKey, unb64(recipientPublicRaw), info);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(info) }, key, plaintext as Uint8Array<ArrayBuffer>));
  return { epk: b64(new Uint8Array(await crypto.subtle.exportKey('raw', eph.publicKey))), iv: b64(iv), ct: b64(ct) };
}

export async function openWith(priv: CryptoKey, box: Sealed, info: string): Promise<Uint8Array> {
  const key = await aesKey(priv, unb64(box.epk), info);
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.iv), additionalData: enc.encode(info) }, key, unb64(box.ct)));
}
