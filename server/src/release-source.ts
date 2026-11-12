// The code of a published version ("Change this app", docs/CHANGE-THIS-APP.md). A shared app's
// releases carry <slug>-source.zip: that version's files, made with `git archive` from the commit
// the version was built from, without what must stay private (SOURCE_LEFT_OUT). A friend's PC
// downloads it to make their own version (POST /api/clones), and any app's agent can fetch it to
// copy a piece of it (`anyapp copy`). Downloads are anonymous: the releases repo is public.
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, normalize, resolve, sep } from "node:path";
import { readZip } from "./apk-scan.ts";
import { run } from "./git.ts";
import { findSecrets, type SecretHit } from "./secrets.ts";

/** The suffix of the code file on a release: <slug>-source.zip. */
export const SOURCE_ZIP_SUFFIX = "-source.zip";

/**
 * What the code zip never holds, in plain words (shown on the PC and in the docs) and as Git
 * pathspecs. Git only archives committed files, so build output, node_modules and the generated
 * android/ folder (all git-ignored) are never in it either.
 */
export const SOURCE_LEFT_OUT: { words: string; specs: string[] }[] = [
  { words: "the app's private notes about you (APP_MEMORY.md)", specs: [":(exclude,glob)**/APP_MEMORY.md"] },
  { words: ".env files", specs: [":(exclude,glob)**/.env", ":(exclude,glob)**/.env.*"] },
  { words: "signing keys and certificates", specs: ["*.p12", "*.jks", "*.keystore", "*.p8", "*.pem", "*.key"].map((g) => `:(exclude,glob)**/${g}`) },
  { words: "your chat with the app's agent, the Git history and the build output (never in it)", specs: [] },
];

export const REPO_RE = /^[A-Za-z0-9-]{1,39}\/anyapp-[a-z0-9-]+-releases$/;
const MAX_ZIP = 200 * 1024 * 1024;
const MAX_FILES = 20_000;

/** Makes the code zip of `commit` in `dir`, then refuses it if anything in it looks like a secret. */
export async function makeSourceZip(dir: string, commit: string, out: string): Promise<{ hits: SecretHit[]; files: number }> {
  mkdirSync(dirname(out), { recursive: true });
  const specs = SOURCE_LEFT_OUT.flatMap((x) => x.specs);
  const result = await run("git", ["archive", "--format=zip", "-o", out, commit, "--", ".", ...specs], dir, 120_000);
  if (result.code !== 0) throw new Error(`git archive failed: ${(result.stderr || result.stdout).trim().split(/\r?\n/).at(-1)}`);
  const hits = scanSourceZip(out);
  return { hits, files: readZip(readFileOrThrow(out)).length };
}

function readFileOrThrow(path: string): Buffer {
  return readFileSync(path);
}

const BINARY = /\.(png|jpe?g|webp|gif|ico|ttf|otf|woff2?|mp3|ogg|wav|mp4|jar|so|zip|apk)$/i;

/** Secrets in the text files of a code zip. */
export function scanSourceZip(path: string): SecretHit[] {
  const hits: SecretHit[] = [];
  for (const e of readZip(readFileOrThrow(path))) {
    if (e.name.endsWith("/") || BINARY.test(e.name)) continue;
    const data = e.data();
    if (data.length > 4 * 1024 * 1024) continue;
    hits.push(...findSecrets(data.toString("utf8"), e.name));
  }
  return hits;
}

export function sha256File(path: string): string {
  return createHash("sha256").update(readFileOrThrow(path)).digest("hex");
}

/**
 * Unpacks a code zip into `dest` (made empty first by the caller). Refuses paths that would land
 * outside it, and zips that are too big.
 */
export function extractZip(buf: Buffer, dest: string, opts: { readOnly?: boolean } = {}): number {
  if (buf.length > MAX_ZIP) throw new Error("The code file is too big.");
  const root = resolve(dest);
  const entries = readZip(buf);
  if (entries.length > MAX_FILES) throw new Error("The code file holds too many files.");
  let total = 0;
  let files = 0;
  for (const e of entries) {
    const name = e.name.replace(/\\/g, "/");
    if (name.endsWith("/")) continue;
    const target = resolve(root, normalize(name));
    if (!target.startsWith(root + sep)) throw new Error(`The code file has a bad path: ${name}`);
    const data = e.data();
    total += data.length;
    if (total > 4 * MAX_ZIP) throw new Error("The code file unpacks too big.");
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, data);
    files++;
  }
  if (opts.readOnly) makeReadOnly(root);
  return files;
}

/** Marks every file under `dir` read only (a copy to read and take from, never to change). */
export function makeReadOnly(dir: string): void {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) makeReadOnly(p);
    else chmodSync(p, 0o444);
  }
}

// ---------- finding and downloading a published version's code

export interface ReleaseSource {
  repo: string;
  tag: string;
  version: string; // from update.json, or the tag
  build: number | null;
  zipName: string;
  zipUrl: string;
  sha256?: string; // from update.json, when it lists the source
  packageName?: string;
}

type Fetch = typeof fetch;

interface GhRelease {
  tag_name: string;
  prerelease: boolean;
  draft?: boolean;
  assets: { name: string; browser_download_url: string; size: number }[];
}

/** A plain sentence for the person (thrown as an Error with `status`). */
export class SourceError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * The published version to take the code from: the one with this build number when given and
 * published, else the latest stable one. Throws SourceError 404 when it carries no code (it was
 * published before code was included), 502 when GitHub cannot be reached.
 */
export async function findReleaseSource(repo: string, build: number | undefined, fetchImpl: Fetch = fetch): Promise<ReleaseSource> {
  if (!REPO_RE.test(repo)) throw new SourceError(400, "That is not the releases page of an app made with Kiwimake.");
  let list: GhRelease[];
  try {
    const res = await fetchImpl(`https://api.github.com/repos/${repo}/releases?per_page=100`, {
      headers: { accept: "application/vnd.github+json", "user-agent": "Kiwimake" },
    });
    if (res.status === 404) throw new SourceError(404, "That app is not shared any more (its releases page is gone or private).");
    if (!res.ok) throw new SourceError(502, `GitHub answered ${res.status}. Try again in a while.`);
    list = (await res.json()) as GhRelease[];
  } catch (error) {
    if (error instanceof SourceError) throw error;
    throw new SourceError(502, `GitHub could not be reached (${(error as Error).message.split(/\r?\n/)[0]}).`);
  }
  const stable = list.filter((r) => !r.draft && !r.prerelease);
  const wanted = (build ? stable.find((r) => r.tag_name.endsWith(`-b${build}`)) : undefined) ?? stable[0];
  if (!wanted) throw new SourceError(404, "This app has no published version yet.");
  const zip = wanted.assets.find((a) => a.name.endsWith(SOURCE_ZIP_SUFFIX));
  if (!zip) throw new SourceError(404, "This version has no code in it: it was published before versions carried their code. Ask for a newer version.");
  const tagBuild = /-b(\d+)$/.exec(wanted.tag_name);
  let source: ReleaseSource = {
    repo,
    tag: wanted.tag_name,
    version: wanted.tag_name.replace(/^v/, "").replace(/-b\d+$/, ""),
    build: tagBuild ? Number(tagBuild[1]) : null,
    zipName: zip.name,
    zipUrl: zip.browser_download_url,
  };
  const feed = wanted.assets.find((a) => a.name === "update.json");
  if (feed) {
    try {
      const res = await fetchImpl(feed.browser_download_url, { headers: { "user-agent": "Kiwimake" } });
      if (res.ok) {
        const doc = (await res.json()) as { version?: string; build?: number; package?: string; source?: { name?: string; sha256?: string } };
        source = {
          ...source,
          ...(doc.version ? { version: doc.version } : {}),
          ...(typeof doc.build === "number" ? { build: doc.build } : {}),
          ...(doc.package ? { packageName: doc.package } : {}),
          ...(doc.source?.name === zip.name && doc.source.sha256 ? { sha256: doc.source.sha256 } : {}),
        };
      }
    } catch {
      // update.json is only a cross-check; the zip is still checked by its own contents.
    }
  }
  return source;
}

/** Downloads the code zip, checks its SHA-256 when update.json gave one. */
export async function downloadSource(source: ReleaseSource, fetchImpl: Fetch = fetch): Promise<Buffer> {
  let buf: Buffer;
  try {
    const res = await fetchImpl(source.zipUrl, { headers: { "user-agent": "Kiwimake" } });
    if (!res.ok) throw new SourceError(502, `GitHub answered ${res.status} for the code file.`);
    buf = Buffer.from(await res.arrayBuffer());
  } catch (error) {
    if (error instanceof SourceError) throw error;
    throw new SourceError(502, `The code could not be downloaded (${(error as Error).message.split(/\r?\n/)[0]}).`);
  }
  if (buf.length > MAX_ZIP) throw new SourceError(400, "The code file is too big.");
  if (source.sha256 && createHash("sha256").update(buf).digest("hex") !== source.sha256) {
    throw new SourceError(400, "The code file was damaged on the way (its check did not match). Try again.");
  }
  return buf;
}

/** "maddada/anyapp-tea-releases" from that, a github.com address of it, or its install link. */
export function repoFromText(text: string): string | null {
  const t = text.trim();
  if (REPO_RE.test(t)) return t;
  const m = /github\.com\/([A-Za-z0-9-]{1,39})\/(anyapp-[a-z0-9-]+-releases)\b/.exec(t);
  return m ? `${m[1]}/${m[2]}` : null;
}
