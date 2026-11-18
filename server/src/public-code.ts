// "Publish the code too" (docs/GALLERY.md, "Public code"): a shared app can also have a public code
// repo, <owner>/anyapp-<slug>-source, separate from its private anyapp-<slug> (which keeps its whole
// history and stays private). The public repo never gets that history: it starts with one commit,
// the code of the first version published after the switch went on, and each later stable Publish
// adds exactly one commit with that version's code. Every commit holds exactly the files of the
// version's code zip (<slug>-source.zip: no APP_MEMORY.md, .env files or keys, scanned for secrets),
// is made by the GitHub account with its noreply address (never the PC's Git name or email), and
// is tagged v<version>-b<build>. A version whose code mentions this PC's folders is refused before
// anything is published (pcPathHits).
import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { homedir, tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { readZip } from "./apk-scan.ts";
import { extractZip } from "./release-source.ts";
import { gitWithToken, run } from "./git.ts";
import type { SecretHit } from "./secrets.ts";

export function publicCodeRepoName(slug: string): string {
  return `anyapp-${slug}-source`;
}

export function publicCodeRepoUrl(owner: string, slug: string): string {
  return `https://github.com/${owner}/${publicCodeRepoName(slug)}`;
}

const BINARY = /\.(png|jpe?g|webp|gif|ico|ttf|otf|woff2?|mp3|ogg|wav|mp4|jar|so|zip|apk|keystore|jks)$/i;

/**
 * Text that points at this PC's folders: its home folder, the apps folder, or any user's home
 * (/home/<name>/, /Users/<name>/, C:\Users\<name>\). Such a line tells strangers who the owner is
 * and how their PC is laid out, so the code does not go public with it.
 */
export function pcPathPatterns(extra: string[] = []): RegExp[] {
  const literal = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const own = [homedir(), ...extra].filter((p) => p && p.length > 3).map((p) => new RegExp(literal(p), "i"));
  let user = "";
  try {
    user = userInfo().username;
  } catch {
    // no user name: the generic patterns still apply
  }
  return [
    ...own,
    /(^|[^A-Za-z0-9_])\/home\/[A-Za-z0-9._-]+\//,
    /(^|[^A-Za-z0-9_])\/Users\/[A-Za-z0-9._-]+\//,
    /[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s"'`]+/i,
    ...(user.length > 2 ? [new RegExp(`[\\\\/]${literal(user)}[\\\\/]`, "i")] : []),
  ];
}

/** Files in a code zip whose text names this PC's folders (as secret hits, so the publish refuses). */
export function pcPathHits(zip: Buffer, extra: string[] = []): SecretHit[] {
  const patterns = pcPathPatterns(extra);
  const hits: SecretHit[] = [];
  for (const e of readZip(zip)) {
    if (e.name.endsWith("/") || BINARY.test(e.name)) continue;
    const text = e.data().toString("utf8");
    if (text.includes("\u0000")) continue;
    const lines = text.split(/\r?\n/);
    const at = lines.findIndex((line) => patterns.some((p) => p.test(line)));
    if (at >= 0) hits.push({ kind: "a folder path on this PC", where: `${e.name} (line ${at + 1})`, preview: "" });
  }
  return hits;
}

/** git without any GIT_AUTHOR_* or GIT_COMMITTER_* this process may carry: only the account's identity. */
function gitClean(args: string[], cwd: string): Promise<{ code: number; stdout: string; stderr: string }> {
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
  for (const k of Object.keys(env)) if (/^GIT_(AUTHOR|COMMITTER)_/.test(k) || k === "EMAIL") delete env[k];
  return new Promise((resolve) => {
    const child = spawn("git", args, { cwd, env, windowsHide: true });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill(), 120_000);
    child.stdout?.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr?.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: stderr + e.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

/** What pushing needs from GitHub; tests give a local bare repo instead. */
export interface CodeRepoApi {
  /** The GitHub account: login and its noreply address (`<id>+<login>@users.noreply.github.com`). */
  identity(): Promise<{ login: string; email: string }>;
  exists(full: string): Promise<boolean>;
  createPublic(full: string, description: string): Promise<void>;
  /** Where git clones and pushes the repo. */
  remote(full: string): string;
  /** Runs git for a clone or a push (with the account's token on the real one). */
  git(args: string[], cwd: string): Promise<{ code: number; err: string }>;
}

export interface CodeCommit {
  full: string; // owner/anyapp-<slug>-source
  appName: string;
  version: string;
  build: number;
  zip: Buffer; // the version's <slug>-source.zip
}

/**
 * Puts one version's code into the public code repo as one new commit (the first one creates the
 * repo). Returns "created", "committed" or "unchanged" (the same files as the last commit).
 */
export async function pushPublicCode(c: CodeCommit, api: CodeRepoApi): Promise<"created" | "committed" | "unchanged"> {
  const who = await api.identity();
  const dir = mkdtempSync(join(tmpdir(), "anyapp-code-"));
  // Every identity setting git knows, so no global author.email or user.email of this PC can slip in.
  const identity = ["user", "author", "committer"].flatMap((k) => ["-c", `${k}.name=${who.login}`, "-c", `${k}.email=${who.email}`]);
  const git = async (args: string[]) => {
    const r = await gitClean(["-c", "safe.directory=*", "-c", "commit.gpgsign=false", "-c", "tag.gpgsign=false", ...identity, ...args], dir);
    if (r.code !== 0) throw new Error(`git ${args[0]}: ${(r.stderr || r.stdout).trim().split(/\r?\n/).at(-1)}`);
    return r.stdout;
  };
  try {
    const existed = await api.exists(c.full);
    if (existed) {
      const cloned = await api.git(["clone", "--quiet", "--depth", "1", api.remote(c.full), "."], dir);
      if (cloned.code !== 0) throw new Error(`clone: ${cloned.err.trim().split(/\r?\n/).at(-1)}`);
      // The new version replaces every file: what the version no longer has goes too.
      for (const name of readdirSync(dir)) if (name !== ".git") rmSync(join(dir, name), { recursive: true, force: true });
    } else {
      await api.createPublic(c.full, `${c.appName}: the code of each published version (made with Kiwimake)`);
      await git(["init", "--quiet", "-b", "main"]);
    }
    extractZip(c.zip, dir);
    await git(["add", "-A"]);
    const status = await git(["status", "--porcelain"]);
    if (existed && status.trim() === "") return "unchanged";
    const message = existed ? `${c.appName} ${c.version} (build ${c.build})` : `${c.appName} ${c.version} (build ${c.build}): the code as published`;
    await git(["commit", "--quiet", "-m", message]);
    await git(["tag", `v${c.version}-b${c.build}`]);
    const pushed = await api.git(["push", "--quiet", api.remote(c.full), "HEAD:refs/heads/main", "--tags"], dir);
    if (pushed.code !== 0) throw new Error(`push: ${pushed.err.trim().split(/\r?\n/).at(-1)}`);
    return existed ? "committed" : "created";
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The real one: the gh CLI's account and token. */
export function realCodeRepoApi(gh: { visibility(full: string): Promise<string | null>; createPublic(full: string, description: string): Promise<void> }): CodeRepoApi {
  let token: string | null = null;
  const ghOut = async (args: string[]) => {
    const r = await run("gh", args, tmpdir(), 30_000);
    if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim().split(/\r?\n/).at(-1) ?? "gh failed");
    return r.stdout.trim();
  };
  return {
    identity: async () => {
      const [id, login] = (await ghOut(["api", "user", "--jq", ".id,.login"])).split(/\s+/);
      if (!id || !login) throw new Error("GitHub did not say who is signed in.");
      return { login, email: `${id}+${login}@users.noreply.github.com` };
    },
    exists: async (full) => (await gh.visibility(full)) !== null,
    createPublic: gh.createPublic,
    remote: (full) => `https://github.com/${full}.git`,
    git: async (args, cwd) => {
      token ??= await ghOut(["auth", "token"]);
      return gitWithToken(args, cwd, token);
    },
  };
}

