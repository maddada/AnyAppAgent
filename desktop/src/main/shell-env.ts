// Linux (and macOS): an app started from a desktop launcher does not get the PATH the user's shell
// sets up in ~/.bashrc, ~/.zshrc or ~/.config/fish (mise, asdf, nvm, npm's global folder, ~/.local/bin).
// So before looking for claude, codex, node, gh or adb, Kiwimake asks the user's login shell once for
// its environment, the way VS Code does, and adds the usual tool folders that exist as a fallback.
// An AppImage also puts its own folders on PATH and LD_LIBRARY_PATH; those are removed from what the
// companion, Gradle and the agents inherit.
import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, delimiter, join } from "node:path";

const MARK = "__KIWIMAKE_SHELL_ENV__";
/** Shells whose `-i -l -c` and printf work the same way. Others (nushell, xonsh) are not asked. */
const KNOWN_SHELLS = new Set(["bash", "zsh", "fish", "sh", "dash", "ksh", "mksh", "yash"]);
/** Never copied from the shell: they describe that shell, not the user's setup. */
const SKIP = /^(_|PWD|OLDPWD|SHLVL|TERM|COLUMNS|LINES|PS[0-9]|PROMPT_COMMAND|HIST.*|BASH.*|ZSH.*|FISH.*|TMUX.*|STY|WINDOW|KIWIMAKE_RESOLVING_ENVIRONMENT|ELECTRON_.*|CHROME_.*|APPDIR|APPIMAGE|ARGV0|OWD)$/;

/** Reads `env -0` output between two markers (the shell's own greeting may come before it). */
export function parseEnvBlock(output: string): Record<string, string> | undefined {
  const start = output.indexOf(MARK);
  const end = output.lastIndexOf(MARK);
  if (start < 0 || end <= start) return undefined;
  const result: Record<string, string> = {};
  for (const entry of output.slice(start + MARK.length, end).split("\0")) {
    const eq = entry.indexOf("=");
    if (eq > 0) result[entry.slice(0, eq)] = entry.slice(eq + 1);
  }
  return result;
}

/** The shell's PATH order first, then what we had that it lacks, then the extra folders. No repeats. */
export function mergePath(...parts: (string | string[] | undefined)[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of parts) {
    const list = Array.isArray(part) ? part : (part ?? "").split(delimiter);
    for (const dir of list) {
      if (!dir || seen.has(dir)) continue;
      seen.add(dir);
      out.push(dir);
    }
  }
  return out.join(delimiter);
}

/** Where tool managers and package managers put commands, when they exist on this PC. */
export function wellKnownBinDirs(home: string, env: NodeJS.ProcessEnv, exists: (p: string) => boolean = existsSync, list: (p: string) => string[] = safeList): string[] {
  const data = env.XDG_DATA_HOME || join(home, ".local", "share");
  const dirs = [
    join(home, ".local", "bin"),
    join(data, "mise", "shims"),
    join(env.ASDF_DATA_DIR || join(home, ".asdf"), "shims"),
    join(env.VOLTA_HOME || join(home, ".volta"), "bin"),
    join(home, ".npm-global", "bin"),
    join(home, ".npm-packages", "bin"),
    join(env.BUN_INSTALL || join(home, ".bun"), "bin"),
    join(env.PNPM_HOME || join(data, "pnpm")),
    join(home, ".cargo", "bin"),
    "/usr/local/bin",
    "/snap/bin",
    "/home/linuxbrew/.linuxbrew/bin",
  ];
  // nvm: the newest installed Node (its default alias is only known to nvm.sh).
  const nvm = join(env.NVM_DIR || join(home, ".nvm"), "versions", "node");
  const newest = list(nvm).filter((v) => /^v\d+\./.test(v)).sort((a, b) => compareVersions(b, a))[0];
  if (newest) dirs.push(join(nvm, newest, "bin"));
  return dirs.filter((d) => exists(d));
}

function safeList(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, "").split(".").map(Number);
  const pb = b.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
}

/** Removes the AppImage's own folders (AppRun adds them) from the variables children inherit. */
export function withoutAppImage(env: NodeJS.ProcessEnv): Record<string, string | undefined> {
  const appDir = env.APPIMAGE ? env.APPDIR : undefined;
  if (!appDir) return {};
  const strip = (value: string | undefined) => (value ?? "").split(delimiter).filter((d) => d && d !== appDir && !d.startsWith(`${appDir}/`)).join(delimiter) || undefined;
  return {
    PATH: strip(env.PATH),
    LD_LIBRARY_PATH: strip(env.LD_LIBRARY_PATH),
    XDG_DATA_DIRS: strip(env.XDG_DATA_DIRS),
    GSETTINGS_SCHEMA_DIR: strip(env.GSETTINGS_SCHEMA_DIR),
  };
}

/** Asks the login shell for its environment. Undefined when it is unknown, slow or fails. */
export function readShellEnv(shell: string, env: NodeJS.ProcessEnv, timeoutMs = 5_000): Promise<Record<string, string> | undefined> {
  if (!KNOWN_SHELLS.has(basename(shell))) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    let out = "";
    let done = false;
    const finish = (value: Record<string, string> | undefined) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(value);
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(shell, ["-i", "-l", "-c", `printf '%s' ${MARK}; command env -0; printf '%s' ${MARK}`], {
        env: { ...env, KIWIMAKE_RESOLVING_ENVIRONMENT: "1" },
        stdio: ["ignore", "pipe", "ignore"],
        detached: true, // its own process group, so a timeout also stops what the rc files started
      });
    } catch {
      resolve(undefined);
      return;
    }
    const timer = setTimeout(() => {
      try {
        if (child.pid) process.kill(-child.pid, "SIGKILL");
      } catch {
        // already gone
      }
      finish(undefined);
    }, timeoutMs);
    child.stdout?.on("data", (chunk) => (out += chunk));
    child.on("error", () => finish(undefined));
    child.on("close", () => finish(parseEnvBlock(out)));
  });
}

/**
 * Updates `env` (process.env) in place: the shell's PATH and any variable it sets that we lack, the
 * well-known tool folders, and no AppImage folders. Returns a line for the log. Windows: nothing.
 */
export async function adoptShellEnv(env: NodeJS.ProcessEnv = process.env, read = readShellEnv): Promise<string> {
  if (process.platform === "win32") return "not needed on Windows";
  if (env.KIWIMAKE_SHELL_ENV === "off") return "skipped (KIWIMAKE_SHELL_ENV=off)";
  // process.env turns undefined into "undefined": delete instead.
  for (const [key, value] of Object.entries(withoutAppImage(env))) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  const shell = env.SHELL || "/bin/sh";
  const fromShell = await read(shell, env);
  let adopted = 0;
  if (fromShell) {
    for (const [key, value] of Object.entries(fromShell)) {
      if (key === "PATH" || SKIP.test(key) || env[key] !== undefined) continue;
      env[key] = value;
      adopted++;
    }
  }
  const home = env.HOME || homedir();
  const before = (env.PATH ?? "").split(delimiter).filter(Boolean).length;
  const shellPath = fromShell?.PATH ? withoutAppImage({ ...env, PATH: fromShell.PATH }).PATH ?? fromShell.PATH : undefined;
  env.PATH = mergePath(shellPath, env.PATH, wellKnownBinDirs(home, env));
  const after = env.PATH.split(delimiter).length;
  return fromShell
    ? `PATH from ${basename(shell)} (${after} folders, was ${before}); ${adopted} other variables`
    : `${basename(shell)} did not answer; PATH has ${after} folders (was ${before}) with the usual tool folders`;
}
