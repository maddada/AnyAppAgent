// The GitHub calls sharing needs, through the `gh` CLI that onboarding signed in (docs/DISTRIBUTION.md,
// "GitHub"). Only repos named anyapp-<slug>-releases are ever created, made public, made private or
// written to here; nothing is ever deleted.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run, type RunResult } from "./git.ts";

export const RELEASES_REPO_PATTERN = /^anyapp-[a-z0-9-]+-releases$/;

function lastLine(result: RunResult): string {
  const text = (result.stderr || result.stdout).trim().split(/\r?\n/).filter(Boolean);
  return text.at(-1) ?? `exit code ${result.code}`;
}

async function gh(args: string[], timeoutMs = 60_000): Promise<RunResult> {
  return run("gh", args, tmpdir(), timeoutMs);
}

function checkName(full: string): void {
  const [, name] = full.split("/");
  if (!name || !RELEASES_REPO_PATTERN.test(name)) throw new Error(`Refusing to touch the repository ${full}`);
}

/** The GitHub account `gh` is signed in with. */
export async function ghLogin(): Promise<string> {
  const result = await gh(["api", "user", "-q", ".login"]);
  const login = result.stdout.trim();
  if (result.code !== 0 || !login) throw new Error("GitHub is not signed in on this PC. Sign in again in the setup steps.");
  return login;
}

/** The repo's visibility ("PUBLIC" / "PRIVATE"), or null when it does not exist. */
export async function repoVisibility(full: string): Promise<"PUBLIC" | "PRIVATE" | "INTERNAL" | null> {
  const result = await gh(["repo", "view", full, "--json", "visibility", "-q", ".visibility"]);
  if (result.code !== 0) {
    if (/Could not resolve|not found|404/i.test(result.stderr)) return null;
    throw new Error(lastLine(result));
  }
  return result.stdout.trim() as "PUBLIC" | "PRIVATE" | "INTERNAL";
}

export async function createPublicRepo(full: string, description: string): Promise<void> {
  checkName(full);
  const result = await gh(["repo", "create", full, "--public", "--description", description]);
  if (result.code !== 0) throw new Error(lastLine(result));
}

export async function setVisibility(full: string, visibility: "public" | "private"): Promise<void> {
  checkName(full);
  const result = await gh(["repo", "edit", full, "--visibility", visibility, "--accept-visibility-change-consequences"]);
  if (result.code !== 0) throw new Error(lastLine(result));
}

/** Creates or replaces one file on the default branch (contents API; works on an empty repo). */
export async function putFile(full: string, path: string, content: Buffer, message: string): Promise<void> {
  checkName(full);
  const existing = await gh(["api", `repos/${full}/contents/${path}`, "-q", ".sha"]);
  const sha = existing.code === 0 ? existing.stdout.trim() : "";
  const dir = mkdtempSync(join(tmpdir(), "anyapp-gh-"));
  try {
    const body = join(dir, "body.json");
    writeFileSync(body, JSON.stringify({ message, content: content.toString("base64"), ...(sha ? { sha } : {}) }));
    const result = await gh(["api", "-X", "PUT", `repos/${full}/contents/${path}`, "--input", body], 120_000);
    if (result.code !== 0) throw new Error(lastLine(result));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export interface ReleaseAssetInfo {
  name: string;
  size: number;
  downloads: number;
}
export interface ReleaseInfo {
  tag: string;
  prerelease: boolean;
  assets: ReleaseAssetInfo[];
}

/** A release with its files; `latest` makes it what releases/latest points at. */
export async function createRelease(
  full: string,
  tag: string,
  opts: { title: string; notesFile: string; files: string[]; prerelease: boolean; latest: boolean },
): Promise<void> {
  checkName(full);
  const args = ["release", "create", tag, ...opts.files, "--repo", full, "--title", opts.title, "--notes-file", opts.notesFile];
  if (opts.prerelease) args.push("--prerelease", "--latest=false");
  else args.push(`--latest=${opts.latest}`);
  const result = await gh(args, 30 * 60_000);
  if (result.code !== 0) throw new Error(lastLine(result));
}

/** Replaces files on an existing release (same names are overwritten). */
export async function uploadAssets(full: string, tag: string, files: string[]): Promise<void> {
  checkName(full);
  const result = await gh(["release", "upload", tag, ...files, "--repo", full, "--clobber"], 30 * 60_000);
  if (result.code !== 0) throw new Error(lastLine(result));
}

export async function editRelease(full: string, tag: string, opts: { title?: string; prerelease?: boolean; latest?: boolean }): Promise<void> {
  checkName(full);
  const args = ["release", "edit", tag, "--repo", full];
  if (opts.title !== undefined) args.push("--title", opts.title);
  if (opts.prerelease !== undefined) args.push(`--prerelease=${opts.prerelease}`);
  if (opts.latest !== undefined) args.push(`--latest=${opts.latest}`);
  const result = await gh(args);
  if (result.code !== 0) throw new Error(lastLine(result));
}

export async function releaseExists(full: string, tag: string): Promise<boolean> {
  const result = await gh(["release", "view", tag, "--repo", full, "--json", "tagName"]);
  return result.code === 0;
}

/** Every release with its files and download counts (GitHub counts downloads, not people). */
export async function listReleases(full: string): Promise<ReleaseInfo[]> {
  const result = await gh(["api", `repos/${full}/releases?per_page=100`]);
  if (result.code !== 0) throw new Error(lastLine(result));
  const list = JSON.parse(result.stdout) as { tag_name: string; prerelease: boolean; assets: { name: string; size: number; download_count: number }[] }[];
  return list.map((r) => ({ tag: r.tag_name, prerelease: r.prerelease, assets: r.assets.map((a) => ({ name: a.name, size: a.size, downloads: a.download_count })) }));
}

/** One file of a release, as text (small files such as update.json). */
export async function downloadAsset(full: string, tag: string, name: string): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "anyapp-gh-"));
  try {
    const result = await gh(["release", "download", tag, "--repo", full, "--pattern", name, "--dir", dir]);
    if (result.code !== 0) throw new Error(lastLine(result));
    return readFileSync(join(dir, name), "utf8");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Replaces one release file with `content`. */
export async function writeAsset(full: string, tag: string, name: string, content: string): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "anyapp-gh-"));
  try {
    const file = join(dir, name);
    writeFileSync(file, content);
    await uploadAssets(full, tag, [file]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
