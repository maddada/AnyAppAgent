// Each helper that changes an app works in its own copy of it: a git worktree of the app's repository
// at <appsDir>\.helpers\<slug>-<helperId>, on its own branch helper/<helperId>, with its own copy of
// node_modules (copied the way builder/ copies its deps cache: robocopy, never hard links, so no copy
// can change another's packages). Its work lands back in the app one change at a time: the helper's
// branch first takes in what landed meanwhile (a merge in its own copy), then the app fast-forwards
// to it. A merge that conflicts is undone and handed back to the helper to resolve in its copy.
// See docs/APP-COORDINATOR.md.
import { existsSync, statSync } from "node:fs";
import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { commitAll, run, type RunResult } from "./git.ts";

export function helperBranch(helperId: string): string {
  return `helper/${helperId}`;
}

export function helperCopyDir(appsDir: string, slug: string, helperId: string): string {
  return join(appsDir, ".helpers", `${slug}-${helperId}`);
}

function lastLine(result: RunResult): string {
  return (result.stderr || result.stdout).trim().split(/\r?\n/).filter(Boolean).at(-1) ?? `exit code ${result.code}`;
}

async function git(dir: string, args: string[], timeoutMs?: number): Promise<RunResult> {
  return run("git", args, dir, timeoutMs);
}

async function identity(dir: string): Promise<string[]> {
  const name = (await git(dir, ["config", "user.name"])).stdout.trim();
  const email = (await git(dir, ["config", "user.email"])).stdout.trim();
  return [...(name ? [] : ["-c", "user.name=Kiwimake"]), ...(email ? [] : ["-c", "user.email=anyappagent@localhost"])];
}

/** The app's own branch (usually main). */
export async function appBranch(appDir: string): Promise<string> {
  const head = await git(appDir, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const name = head.stdout.trim();
  return head.code === 0 && name !== "" && name !== "HEAD" ? name : "main";
}

async function headOf(dir: string, ref = "HEAD"): Promise<string> {
  return (await git(dir, ["rev-parse", ref])).stdout.trim();
}

/** Robocopy on Windows (fast, real copies), fs.cp elsewhere. Same as builder/lib/template.mjs copyTree. */
async function copyTree(src: string, dest: string): Promise<void> {
  if (process.platform === "win32") {
    const result = await run("robocopy", [src, dest, "/E", "/MT:32", "/NFL", "/NDL", "/NJH", "/NJS", "/NP", "/R:2", "/W:1"], dirname(src), 15 * 60_000);
    if (result.code < 0 || result.code >= 8) throw new Error(`Copying node_modules failed (robocopy ${result.code}): ${lastLine(result)}`);
    return;
  }
  await cp(src, dest, { recursive: true, verbatimSymlinks: true });
}

/**
 * Makes sure the helper's copy exists: a worktree on helper/<id> starting from the app's current
 * state, with node_modules copied from the app. An existing copy is kept as it is (a follow-up or a
 * restart carries on where it was). Returns how long the setup took, or 0 when it existed.
 */
export async function ensureHelperCopy(appDir: string, copyDir: string, helperId: string, log: (m: string) => void): Promise<number> {
  if (existsSync(join(copyDir, ".git"))) return 0;
  const started = Date.now();
  await mkdir(dirname(copyDir), { recursive: true });
  await rm(copyDir, { recursive: true, force: true });
  await git(appDir, ["worktree", "prune"]);
  await git(appDir, ["config", "core.longpaths", "true"]);
  // Start from everything the app has, including notes the main chat wrote and has not saved yet.
  await commitAll(appDir, "Notes from the main chat");
  const base = await appBranch(appDir);
  const added = await git(appDir, ["worktree", "add", "-B", helperBranch(helperId), copyDir, base]);
  if (added.code !== 0) throw new Error(`Could not make the helper's copy of the app: ${lastLine(added)}`);
  const modules = join(appDir, "node_modules");
  if (existsSync(modules)) {
    await copyTree(modules, join(copyDir, "node_modules"));
    // The copy must own its files (builder/test/isolation.test.mjs proves the same for apps).
    for (const probe of ["react/package.json", "expo/package.json"]) {
      const path = join(copyDir, "node_modules", probe);
      if (existsSync(path) && statSync(path).nlink > 1) throw new Error(`${path} is a hard link; a helper's copy must be independent`);
    }
  }
  log(`helper copy ${copyDir} ready in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  return Date.now() - started;
}

/** Saves the helper's work on its branch. True when its branch now has work the app does not have. */
export async function saveHelperWork(appDir: string, copyDir: string, message: string): Promise<boolean> {
  await commitAll(copyDir, message);
  const base = await appBranch(appDir);
  const ahead = await git(copyDir, ["rev-list", "--count", `${base}..HEAD`]);
  return Number(ahead.stdout.trim()) > 0;
}

export type LandResult = { ok: true; before: string; after: string } | { ok: false; conflict: string[] } | { ok: false; error: string };

/**
 * Lands the helper's branch in the app (the caller holds the app's landing slot): the app's own
 * unsaved notes are saved, the helper's copy merges in what landed meanwhile, and the app
 * fast-forwards to the helper's branch. A conflicting merge is undone and its files returned.
 */
export async function landHelperWork(appDir: string, copyDir: string, helperId: string, message: string): Promise<LandResult> {
  await commitAll(appDir, "Notes from the main chat");
  await commitAll(copyDir, message);
  const base = await appBranch(appDir);
  const before = await headOf(appDir);
  const merged = await git(copyDir, [...(await identity(copyDir)), "merge", "--no-edit", "-m", `Bring in what landed before "${message}"`, base]);
  if (merged.code !== 0) {
    const files = (await git(copyDir, ["diff", "--name-only", "--diff-filter=U"])).stdout.split(/\r?\n/).map((f) => f.trim()).filter(Boolean);
    await git(copyDir, ["merge", "--abort"]);
    if (files.length > 0) return { ok: false, conflict: files };
    return { ok: false, error: `merge failed: ${lastLine(merged)}` };
  }
  const ff = await git(appDir, ["merge", "--ff-only", helperBranch(helperId)]);
  if (ff.code !== 0) return { ok: false, error: `could not move the app forward: ${lastLine(ff)}` };
  return { ok: true, before, after: await headOf(appDir) };
}

/** After a build fix in the helper's copy: the app (still held by this helper) takes the fix too. */
export async function landFix(appDir: string, copyDir: string, helperId: string, message: string): Promise<boolean> {
  await commitAll(copyDir, message);
  const ff = await git(appDir, ["merge", "--ff-only", helperBranch(helperId)]);
  return ff.code === 0;
}

/** Undoes a landing whose build failed for good: the app goes back to `before`, unsaved notes kept. */
export async function undoLanding(appDir: string, before: string): Promise<boolean> {
  return (await git(appDir, ["reset", "--keep", before])).code === 0;
}

/** Files in the helper's copy that still hold conflict markers (a merge left half done). */
export async function leftoverConflictMarkers(copyDir: string): Promise<string[]> {
  // Tracked files in the working tree, including one still unmerged in the index.
  const found = await git(copyDir, ["grep", "-l", "-I", "-E", "^(<{7}|>{7})( |$)"]);
  const lines = found.stdout.split(/\r?\n/).map((f) => f.trim()).filter(Boolean);
  return [...new Set(lines)];
}

/** Removes a helper's copy and its branch (its work already landed, or it never changed anything). */
export async function removeHelperCopy(appDir: string, copyDir: string, helperId: string): Promise<void> {
  await git(appDir, ["worktree", "remove", "--force", copyDir], 5 * 60_000);
  if (existsSync(copyDir)) await rm(copyDir, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined);
  // The cloud: the agent is another Unix user and its build tools make folders only it may empty;
  // the agent's own rm takes them (ANYAPP_AGENT_PREFIX, server/src/cloud-settings.ts).
  if (existsSync(copyDir) && process.env.ANYAPP_AGENT_PREFIX) {
    const prefix = JSON.parse(process.env.ANYAPP_AGENT_PREFIX) as string[];
    if (prefix.length > 0) await run(prefix[0]!, [...prefix.slice(1), "rm", "-rf", "--", copyDir], dirname(copyDir), 5 * 60_000);
  }
  if (existsSync(copyDir)) throw new Error(`could not remove ${copyDir}`);
  await git(appDir, ["worktree", "prune"]);
  await git(appDir, ["branch", "-D", helperBranch(helperId)]);
}
