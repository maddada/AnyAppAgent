// Downloads with progress and checksum, and zip extraction with Windows' own tar.exe (bsdtar,
// part of Windows 10 and 11), so no extra unzip code ships with the app.
import { createHash } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { run } from "../exec.ts";

export interface DownloadOptions {
  url: string;
  dest: string;
  signal?: AbortSignal;
  onProgress?: (received: number, total: number | undefined) => void;
  /** "sha256:<hex>" or "sha1:<hex>". */
  checksum?: string;
}

const USER_AGENT = "Kiwimake-Desktop";

export async function fetchText(url: string, signal?: AbortSignal): Promise<string> {
  const res = await fetch(url, { signal, headers: { "user-agent": USER_AGENT } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}

export async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  return JSON.parse(await fetchText(url, signal)) as T;
}

export async function download({ url, dest, signal, onProgress, checksum }: DownloadOptions): Promise<void> {
  mkdirSync(dirname(dest), { recursive: true });
  const res = await fetch(url, { signal, headers: { "user-agent": USER_AGENT }, redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}) for ${url}`);
  const total = Number(res.headers.get("content-length")) || undefined;
  const [algo, expected] = checksum ? (checksum.split(":") as [string, string]) : [undefined, undefined];
  const hash = algo ? createHash(algo) : undefined;
  let received = 0;
  let lastReport = 0;
  const meter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      received += chunk.length;
      hash?.update(chunk);
      const now = Date.now();
      if (now - lastReport > 150) {
        lastReport = now;
        onProgress?.(received, total);
      }
      cb(null, chunk);
    },
  });
  const part = `${dest}.part`;
  await pipeline(Readable.fromWeb(res.body as never), meter, createWriteStream(part), { signal });
  onProgress?.(received, total);
  if (hash && expected) {
    const actual = hash.digest("hex");
    if (actual.toLowerCase() !== expected.toLowerCase()) {
      rmSync(part, { force: true });
      throw new Error(`The download of ${url} was damaged (checksum mismatch). Please try again.`);
    }
  }
  rmSync(dest, { force: true });
  renameSync(part, dest);
}

/** Extracts a zip into dest. With `flatten`, a single top-level folder in the zip is removed. */
export async function extractZip(zip: string, dest: string, options: { flatten?: boolean } = {}): Promise<void> {
  const staging = `${dest}.extract`;
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  const tar = process.platform === "win32" ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar";
  const result = await run(tar, ["-xf", zip, "-C", staging], { timeoutMs: 30 * 60_000 });
  if (result.code !== 0) throw new Error(`Could not unpack ${zip}: ${result.stderr || result.error}`);
  let root = staging;
  if (options.flatten) {
    const entries = readdirSync(staging);
    if (entries.length === 1 && statSync(join(staging, entries[0])).isDirectory()) root = join(staging, entries[0]);
  }
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dirname(dest), { recursive: true });
  renameSync(root, dest);
  if (existsSync(staging)) rmSync(staging, { recursive: true, force: true });
}

export function formatBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
  if (n >= 1024 ** 2) return `${Math.round(n / 1024 ** 2)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}
