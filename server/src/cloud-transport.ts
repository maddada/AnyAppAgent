// The runner's half of the key transport (cloud/convex/lib/transport.ts is Convex's half, the same
// code): ECDH P-256 with a fresh ephemeral key per message, HKDF SHA-256, AES-256-GCM, with `info`
// binding each message to its purpose. Used for a new app's key going up to Convex and a signing
// ticket coming down to a key the runner made for that one request (docs/CLOUD.md section 6).
const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();
const ECDH = { name: "ECDH", namedCurve: "P-256" } as const;

export type Sealed = { epk: string; iv: string; ct: string };

const b64 = (u: Uint8Array) => Buffer.from(u).toString("base64");
const unb64 = (s: string) => new Uint8Array(Buffer.from(s, "base64"));

async function aesKey(priv: CryptoKey, peerRaw: Uint8Array, info: string): Promise<CryptoKey> {
  const peer = await subtle.importKey("raw", peerRaw as Uint8Array<ArrayBuffer>, ECDH, false, []);
  const bits = await subtle.deriveBits({ name: "ECDH", public: peer }, priv, 256);
  const hk = await subtle.importKey("raw", bits, "HKDF", false, ["deriveKey"]);
  return subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info: enc.encode(`kiwimake transport v1:${info}`) },
    hk,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** A key pair for one request: send `publicRaw`, open the answer with `key`. */
export async function oneTimeKey(): Promise<{ publicRaw: string; key: CryptoKey }> {
  const pair = (await subtle.generateKey(ECDH, true, ["deriveBits"])) as { publicKey: CryptoKey; privateKey: CryptoKey };
  return { publicRaw: b64(new Uint8Array(await subtle.exportKey("raw", pair.publicKey))), key: pair.privateKey };
}

export async function sealTo(recipientPublicRaw: string, plaintext: Uint8Array, info: string): Promise<Sealed> {
  const eph = (await subtle.generateKey(ECDH, true, ["deriveBits"])) as { publicKey: CryptoKey; privateKey: CryptoKey };
  const key = await aesKey(eph.privateKey, unb64(recipientPublicRaw), info);
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(info) }, key, plaintext as Uint8Array<ArrayBuffer>));
  return { epk: b64(new Uint8Array(await subtle.exportKey("raw", eph.publicKey))), iv: b64(iv), ct: b64(ct) };
}

export async function openWith(priv: CryptoKey, box: Sealed, info: string): Promise<Uint8Array> {
  const key = await aesKey(priv, unb64(box.epk), info);
  return new Uint8Array(await subtle.decrypt({ name: "AES-GCM", iv: unb64(box.iv), additionalData: enc.encode(info) }, key, unb64(box.ct)));
}
