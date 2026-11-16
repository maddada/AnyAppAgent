// The PATH a Mac user's own Terminal has, for an app started from Finder, the Dock or at login.
//
// macOS starts apps from launchd with PATH=/usr/bin:/bin:/usr/sbin:/sbin, so Homebrew, mise, nvm,
// npm and ~/.local/bin (where the claude and codex installers put their commands) are all missing.
// Ghostex solves the same problem (packages/paths/src/tool_path.rs, read only): ask the user's
// login shell once for its PATH, then add the inherited PATH and the usual tool folders after it,
// so a profile that is slow or never adds them still leaves those tools findable. The folders
// that come first are the ones the user's own shell chose, so the same claude or codex runs as in
// their Terminal.
import { spawnSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

const SENTINEL = "__KIWIMAKE_PATH__=";

type Env = Record<string, string | undefined>;

/** The shells to ask, the user's own first. */
export function loginShells(env: Env): string[] {
  return [...new Set([env.SHELL?.trim(), "/bin/zsh", "/bin/bash", "/bin/sh"].filter((s): s is string => !!s))];
}

/** The arguments that make `shell` a login shell that prints PATH (interactive too for zsh and bash, whose rc files often set it). */
export function probeArgs(shell: string): string[] {
  const script = `printf '\\n${SENTINEL}%s\\n' "$PATH"`;
  const name = shell.split("/").pop() ?? "";
  if (name === "fish") return ["-l", "-i", "-c", script];
  if (name === "zsh" || name === "bash") return ["-lic", script];
  return ["-l", "-c", script];
}

/** The PATH entries from a probe's output (the last sentinel line wins: rc files may print). */
export function parseProbe(stdout: string): string[] {
  const line = stdout.split("\n").reverse().find((l) => l.startsWith(SENTINEL));
  return line ? line.slice(SENTINEL.length).trim().split(":").filter((p) => p.startsWith("/")) : [];
}

/** Asks the login shell for its PATH; [] when no shell answers in time. */
export function probeLoginPath(env: Env, home: string, timeoutMs = 5_000): string[] {
  const deadline = Date.now() + timeoutMs;
  for (const shell of loginShells(env)) {
    const left = deadline - Date.now();
    if (left <= 0) break;
    try {
      if (!statSync(shell).isFile()) continue;
    } catch {
      continue;
    }
    const clean: Env = { ...env, HOME: home };
    for (const key of ["NO_COLOR", "CLICOLOR_FORCE", "NODE_DISABLE_COLORS", "ELECTRON_RUN_AS_NODE"]) delete clean[key];
    const r = spawnSync(shell, probeArgs(shell), { env: clean as NodeJS.ProcessEnv, encoding: "utf8", timeout: left, stdio: ["ignore", "pipe", "ignore"] });
    const entries = parseProbe(r.stdout ?? "");
    if (entries.length) return entries;
  }
  return [];
}

/** `prefix=` from ~/.npmrc, where `npm install -g` puts commands for a user-level npm. */
function npmrcPrefix(home: string): string | undefined {
  try {
    const m = readFileSync(join(home, ".npmrc"), "utf8").match(/^\s*prefix\s*=\s*(.+?)\s*$/m);
    const prefix = m?.[1].replace(/^~(?=\/)/, home);
    return prefix && isAbsolute(prefix) ? prefix : undefined;
  } catch {
    return undefined;
  }
}

/** Where tools usually are on a Mac when no shell said so (Ghostex's fallback_tool_dirs and node_tool_dirs). */
export function fallbackDirs(env: Env, home: string): string[] {
  const dirs = ["/opt/homebrew/bin", "/opt/homebrew/sbin", "/usr/local/bin", "/usr/local/sbin"];
  for (const rel of [".local/bin", ".local/share/mise/shims", ".volta/bin", ".asdf/shims", ".nodenv/shims", ".nix-profile/bin"]) dirs.push(join(home, rel));
  const prefix = npmrcPrefix(home);
  if (prefix) dirs.push(join(prefix, "bin"));
  dirs.push(join(home, ".npm-global", "bin"), join(home, ".npm-packages", "bin"));
  dirs.push(join(env.BUN_INSTALL || join(home, ".bun"), "bin"));
  if (env.PNPM_HOME) dirs.push(env.PNPM_HOME);
  dirs.push(join(home, "Library", "pnpm"));
  dirs.push("/nix/var/nix/profiles/default/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin");
  return dirs;
}

/** Login shell entries, then the inherited PATH, then the fallbacks; each folder once. */
export function userToolPath(login: string[], current: string | undefined, env: Env, home: string): string {
  const all = [...login, ...(current ?? "").split(":"), ...fallbackDirs(env, home)].map((p) => p.trim()).filter(Boolean);
  return [...new Set(all)].join(":");
}

/**
 * Gives this process (and every process it starts: the companion, Claude, Codex, Gradle) the user's
 * own PATH. Runs once at start, before anything looks for a tool. Returns what it set.
 */
export function adoptUserPath(env: Env = process.env, home = homedir()): { path: string; fromShell: number } {
  const login = probeLoginPath(env, home);
  const path = userToolPath(login, env.PATH, env, home);
  env.PATH = path;
  return { path, fromShell: login.length };
}
