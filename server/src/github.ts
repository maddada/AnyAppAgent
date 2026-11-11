// The GitHub calls sharing needs, through the `gh` CLI that onboarding signed in (docs/DISTRIBUTION.md,
// "GitHub"). Only repos named anyapp-<slug>-releases are ever created, made public, made private or
// written to here; nothing is ever deleted.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
