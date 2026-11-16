// Shared pieces of Kiwimake's over-the-air update tooling (ota-export.mjs, ota-publish.mjs). Pure
// functions plus defaults, tested by dev/ota-lib.test.mjs. Copied from Ghostex's
// tooling/release-mobile/ota-release-lib.mjs (read only, never imported).
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";

export const DEFAULT_SERVER = "https://ota.kiwimake.ai";
export const DEFAULT_CHANNEL = "production";
export const PLATFORM = "android";
/** Where the release PC keeps the private key and the upload token (docs/RELEASING.md). Never in Git. */
export const RELEASE_DIR = path.join(homedir(), ".anyappagent-release");
export const DEFAULT_KEY_FILE = path.join(RELEASE_DIR, "ota-signing", "private-key.pem");
export const DEFAULT_TOKEN_FILE = path.join(RELEASE_DIR, "ota-upload-token");

export function otaServer(env = process.env) {
  return (env.KIWIMAKE_OTA_SERVER || DEFAULT_SERVER).replace(/\/+$/, "");
}

/**
 * The key an update manifest gives an asset. The app looks an asset up by Metro's MD5, which
 * `expo export` also uses as the file name; a SHA-256 key makes the asset unreachable (Ghostex
 * issue #393), so a file whose name is not its MD5 is refused.
 */
export function manifestAssetKey(bytes, exportedPath) {
  const md5 = createHash("md5").update(bytes).digest("hex");
  const name = path.basename(exportedPath);
  if (name !== md5) {
    throw new Error(`${exportedPath}: expo export named it ${name}, but its MD5 (the key the app looks it up by) is ${md5}`);
  }
  return md5;
}

/** Asset keys in a signed manifest the app cannot look up (anything but a Metro MD5). */
export function unreachableAssetKeys(manifest) {
  return (manifest.assets ?? []).map((asset) => asset.key).filter((key) => !/^[0-9a-f]{32}$/.test(key ?? ""));
}

/**
 * What the update server gives phones on a runtime, read from its Expo Updates v1 manifest answer.
 * @returns {{ kind: 'none' } | { kind: 'rollBackToEmbedded' } | { kind: 'update', id: string, createdAt: string, version: string | null }}
 */
export function parseManifestResponse(status, contentType, text) {
  if (status === 204 || status === 404) return { kind: "none" };
  if (status !== 200) throw new Error(`the update server answered ${status}: ${text.slice(0, 200)}`);
  const boundary = /boundary=("?)([^";]+)\1/i.exec(contentType ?? "")?.[2];
  if (!boundary) throw new Error(`the update server sent ${contentType}, not a multipart manifest`);
  for (const part of text.split(`--${boundary}`)) {
    const split = part.indexOf("\r\n\r\n");
    if (split === -1) continue;
    const headers = part.slice(0, split).toLowerCase();
    const body = part.slice(split + 4).replace(/\r\n$/, "");
    if (headers.includes('name="directive"')) return { kind: "rollBackToEmbedded" };
    if (!headers.includes('name="manifest"')) continue;
    const manifest = JSON.parse(body);
    const version = manifest.extra?.kiwimake?.version ?? manifest.extra?.expoClient?.version ?? null;
    return { kind: "update", id: manifest.id, createdAt: manifest.createdAt, version: typeof version === "string" ? version : null };
  }
  throw new Error("the update server sent a multipart answer with neither a manifest nor a directive");
}

/** What the server gives phones on `runtime` now (the public route phones use; no token). */
export async function fetchServed({ runtime, channel = DEFAULT_CHANNEL, server = otaServer(), fetchImpl = fetch }) {
  const response = await fetchImpl(`${server}/v1/manifest/${channel}`, {
    headers: { accept: "multipart/mixed", "expo-protocol-version": "1", "expo-platform": PLATFORM, "expo-runtime-version": runtime },
  });
  return parseManifestResponse(response.status, response.headers.get("content-type"), await response.text());
}

/** "What's new": a JSON array of short lines, or one line, or nothing. */
export function parseWhatsNew(value) {
  if (value === undefined || value === null || value === "") return [];
  const trimmed = String(value).trim();
  if (!trimmed.startsWith("[")) return [trimmed];
  const lines = JSON.parse(trimmed);
  if (!Array.isArray(lines) || lines.some((line) => typeof line !== "string")) throw new Error("What's new must be a JSON array of strings");
  return lines.map((line) => line.trim()).filter(Boolean);
}

/** The em dash is never used in Kiwimake's text (AGENTS.md). */
export function assertNoEmDash(lines) {
  for (const line of lines) if (line.includes("\u2014")) throw new Error(`What's new has an em dash: ${line}`);
}
