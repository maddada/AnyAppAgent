// Git and GitHub for an app's project folder. GitHub repos are always PRIVATE and always named
// anyapp-<slug>; nothing else is ever created.
import spawn from "cross-spawn";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export function run(command: string, args: string[], cwd: string, timeoutMs = 120_000): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout?.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr?.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: stderr + error.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

async function git(dir: string, args: string[], timeoutMs?: number): Promise<RunResult> {
  return run("git", args, dir, timeoutMs);
}

function lastLine(result: RunResult): string {
  const text = (result.stderr || result.stdout).trim().split(/\r?\n/).filter(Boolean);
  return text.at(-1) ?? `exit code ${result.code}`;
}

const BASE_IGNORES = [
  "node_modules/",
  ".expo/",
  "dist/",
  "build/",
  "android/app/build/",
  "android/build/",
  "android/.gradle/",
  ".gradle/",
  "*.apk",
  "*.aab",
  "*.jks",
  "*.keystore",
  "*.p12",
  "local.properties",
  ".env",
  ".env.*",
];

/**
 * Build output the real build writes OUTSIDE the template's ignored folders: the Gradle output of
 * local native modules (modules/<name>/android/build, with paths too long for Git on Windows).
 * Without these lines `git add -A` fails and every turn looked like "no files changed".
 */
export const BUILD_OUTPUT_IGNORES = ["modules/*/android/build/", "modules/*/android/.cxx/", "modules/*/android/.gradle/", ".gradle/"];

export function ensureGitignore(dir: string): void {
  const path = join(dir, ".gitignore");
  const current = existsSync(path) ? readFileSync(path, "utf8") : "";
  const have = new Set(current.split(/\r?\n/).map((line) => line.trim().replace(/^\//, "")));
  // A project with its own .gitignore (the template has one) only gets what must never be
  // committed when it is missing; an empty project gets the whole list.
  const wanted = current === "" ? [...BASE_IGNORES, ...BUILD_OUTPUT_IGNORES] : ["node_modules/", ...BUILD_OUTPUT_IGNORES, "*.jks", "*.keystore", "*.p12", ".env"];
  const missing = wanted.filter((line) => !have.has(line) && !(line === ".env" && [...have].some((l) => l.startsWith(".env"))));
  if (missing.length === 0) return;
  const sep = current === "" || current.endsWith("\n") ? "" : "\n";
  writeFileSync(path, `${current}${sep}${current === "" ? "" : "\n# Added by Kiwimake\n"}${missing.join("\n")}\n`);
}

async function identityArgs(dir: string): Promise<string[]> {
  const name = (await git(dir, ["config", "user.name"])).stdout.trim();
  const email = (await git(dir, ["config", "user.email"])).stdout.trim();
  return [
    ...(name ? [] : ["-c", "user.name=Kiwimake"]),
    ...(email ? [] : ["-c", "user.email=anyappagent@localhost"]),
  ];
}

export async function initRepo(dir: string, message: string): Promise<void> {
  ensureGitignore(dir);
  const init = await git(dir, ["init", "-b", "main"]);
  if (init.code !== 0) throw new Error(`git init failed: ${lastLine(init)}`);
  await commitAll(dir, message);
}

/** Before any add: the ignore list is current (apps made earlier get it too) and long paths work. */
async function prepare(dir: string): Promise<void> {
  ensureGitignore(dir);
  await git(dir, ["config", "core.longpaths", "true"]);
}

async function addAll(dir: string): Promise<void> {
  const added = await git(dir, ["add", "-A"]);
  if (added.code !== 0) throw new Error(`git add failed: ${lastLine(added)}`);
}

/** A hash of the whole working tree (tracked + untracked, minus ignored files). */
/**
 * A hash of the whole working tree (tracked + untracked, minus ignored files). When Git cannot
 * read the tree the answer is a unique value, so the caller builds rather than wrongly deciding
 * that nothing changed.
 */
export async function treeSnapshot(dir: string, log: (message: string) => void = () => {}): Promise<string> {
  try {
    await prepare(dir);
    await addAll(dir);
    const tree = await git(dir, ["write-tree"]);
    if (tree.code !== 0) throw new Error(`git write-tree failed: ${lastLine(tree)}`);
    return tree.stdout.trim();
  } catch (error) {
    log(`could not take a snapshot of ${dir} (${(error as Error).message}); treating it as changed`);
    return `unknown-${Date.now()}-${Math.random()}`;
  }
}

export async function commitAll(dir: string, message: string): Promise<boolean> {
  await prepare(dir);
  await addAll(dir);
  const status = await git(dir, ["status", "--porcelain"]);
  if (status.stdout.trim() === "") return false;
  const commit = await git(dir, [...(await identityArgs(dir)), "commit", "-q", "-m", message]);
  if (commit.code !== 0) throw new Error(`git commit failed: ${lastLine(commit)}`);
  return true;
}

/** The cloud runner pushes its own way (a one-repo token it holds, never the agent): docs/CLOUD.md. */
let pushImpl: ((dir: string) => Promise<string | null>) | undefined;
export function setPushImpl(fn: ((dir: string) => Promise<string | null>) | undefined): void {
  pushImpl = fn;
}

export async function push(dir: string): Promise<string | null> {
  if (pushImpl) return pushImpl(dir);
  const remotes = await git(dir, ["remote"]);
  if (!remotes.stdout.split(/\s+/).includes("origin")) return null;
  const result = await git(dir, ["push", "-q", "-u", "origin", "HEAD"], 90_000);
  return result.code === 0 ? null : lastLine(result);
}

export const REPO_NAME_PATTERN = /^anyapp-[a-z0-9-]+$/;

/** Creates the PRIVATE GitHub repo `repoName` from `dir` and pushes. Returns its URL. */
export async function createGithubRepo(dir: string, repoName: string): Promise<string> {
  if (!REPO_NAME_PATTERN.test(repoName)) throw new Error(`Refusing to create a repository named ${repoName}`);
  const created = await run(
    "gh",
    ["repo", "create", repoName, "--private", "--source", dir, "--remote", "origin", "--push"],
    dir,
    120_000,
  );
  if (created.code !== 0) throw new Error(lastLine(created));
  const url = `${created.stdout}\n${created.stderr}`.match(/https:\/\/github\.com\/[^\s]+/);
  if (url) return url[0].replace(/\.git$/, "");
  const view = await run("gh", ["repo", "view", repoName, "--json", "url", "-q", ".url"], dir);
  return view.stdout.trim();
}

/** The commit HEAD points at, or undefined. */
export async function headCommit(dir: string): Promise<string | undefined> {
  const head = await git(dir, ["rev-parse", "HEAD"]);
  return head.code === 0 ? head.stdout.trim() : undefined;
}

/**
 * Puts the app's files back as they were in `commit` (Versions, docs/VERSIONS.md) and commits that as
 * one new commit, so history is never rewritten and every version stays reachable. `keep` paths (the
 * agent's notes about the person) stay as they are now. Returns the commit before, for taking it back.
 */
export async function restoreTree(dir: string, commit: string, message: string, keep: string[] = []): Promise<{ before: string; changed: boolean }> {
  await commitAll(dir, "Notes before going back");
  const before = await headCommit(dir);
  if (!before) throw new Error("This app has no saved history yet.");
  const known = await git(dir, ["cat-file", "-e", `${commit}^{commit}`]);
  if (known.code !== 0) throw new Error("The PC does not have the code of that version any more.");
  const restored = await git(dir, ["restore", "--source", commit, "--staged", "--worktree", "--", ".", ...keep.map((p) => `:(exclude)${p}`)]);
  if (restored.code !== 0) throw new Error(`git restore failed: ${lastLine(restored)}`);
  const changed = await commitAll(dir, message);
  return { before, changed };
}

/** Takes a go-back out again when it did not build (the commit before is kept). */
export async function resetKeep(dir: string, commit: string): Promise<boolean> {
  return (await git(dir, ["reset", "--keep", commit])).code === 0;
}
