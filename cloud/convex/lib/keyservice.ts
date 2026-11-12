// The master key (docs/CLOUD.md section 6, "Encryption (envelope)"): it only ever wraps and unwraps
// data keys; it is never in Convex's database. Two versions:
//   1: KEYS_KEK, 32 bytes in a Convex environment variable (the dev deployment);
//   2: a Google Cloud KMS key (GCP_KMS_KEY = projects/../locations/../keyRings/../cryptoKeys/..,
//      GCP_KMS_SA = the service account's JSON key, allowed only encrypt and decrypt on that key).
// New data keys are wrapped with the newest configured version; old rows keep theirs and still open.
import { b64, open, seal, unb64 } from './crypto.ts';

export type KekVersion = 1 | 2;

export function currentKekVersion(): KekVersion {
  return process.env.GCP_KMS_KEY && process.env.GCP_KMS_SA ? 2 : 1;
}

/** Wraps a data key (raw bytes) for `aad`. Returns the wrapped form and its version. */
export async function wrapDataKey(dataKey: Uint8Array, aad: string): Promise<{ wrapped: string; version: KekVersion }> {
  const version = currentKekVersion();
  if (version === 2) return { wrapped: await kmsEncrypt(dataKey, aad), version };
  const w = await seal(b64(dataKey), `dek:${aad}`);
  return { wrapped: `${w.iv}.${w.ciphertext}`, version };
}

export async function unwrapDataKey(wrapped: string, aad: string, version: number): Promise<Uint8Array> {
  if (version === 2) return kmsDecrypt(wrapped, aad);
  if (version !== 1) throw new Error(`unknown key version ${version}`);
  const [iv, ciphertext] = wrapped.split('.');
  return unb64(await open({ iv: iv!, ciphertext: ciphertext! }, `dek:${aad}`));
}

// ---------- Google Cloud KMS (REST, a service account's own token)

const enc = new TextEncoder();
const b64url = (u: Uint8Array) => b64(u).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

let cachedToken: { token: string; until: number } | null = null;

async function kmsToken(): Promise<string> {
  if (cachedToken && cachedToken.until > Date.now() + 60_000) return cachedToken.token;
  const sa = JSON.parse(process.env.GCP_KMS_SA ?? '{}') as { client_email?: string; private_key?: string; token_uri?: string };
  if (!sa.client_email || !sa.private_key) throw new Error('GCP_KMS_SA is not a service account key');
  const der = unb64(sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''));
  const key = await crypto.subtle.importKey('pkcs8', der as Uint8Array<ArrayBuffer>, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(enc.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const body = b64url(
    enc.encode(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/cloudkms', aud: sa.token_uri ?? 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })),
  );
  const sig = b64url(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(`${head}.${body}`))));
  const res = await fetch(sa.token_uri ?? 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${head}.${body}.${sig}`,
  });
  const t = (await res.json()) as { access_token?: string; expires_in?: number; error?: string };
  if (!t.access_token) throw new Error(`KMS sign-in refused: ${t.error ?? res.status}`);
  cachedToken = { token: t.access_token, until: Date.now() + (t.expires_in ?? 3600) * 1000 };
  return t.access_token;
}

async function kmsCall(op: 'encrypt' | 'decrypt', body: Record<string, string>): Promise<Record<string, string>> {
  const res = await fetch(`https://cloudkms.googleapis.com/v1/${process.env.GCP_KMS_KEY}:${op}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await kmsToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = (await res.json()) as Record<string, string> & { error?: { message?: string } };
  if (!res.ok) throw new Error(`KMS ${op} refused (${res.status}): ${j.error?.message ?? ''}`.trim());
  return j;
}

async function kmsEncrypt(dataKey: Uint8Array, aad: string): Promise<string> {
  const r = await kmsCall('encrypt', { plaintext: b64(dataKey), additionalAuthenticatedData: b64(enc.encode(`dek:${aad}`)) });
  return r.ciphertext!;
}

async function kmsDecrypt(wrapped: string, aad: string): Promise<Uint8Array> {
  const r = await kmsCall('decrypt', { ciphertext: wrapped, additionalAuthenticatedData: b64(enc.encode(`dek:${aad}`)) });
  return unb64(r.plaintext!);
}
