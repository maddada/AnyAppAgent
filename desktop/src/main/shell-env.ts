// Linux and macOS: an app started from a desktop launcher, Finder, the Dock or at login does not get
// the PATH the user's shell sets up (~/.bashrc, ~/.zshrc, ~/.config/fish: Homebrew, mise, asdf, nvm,
// npm's global folder, ~/.local/bin where the claude and codex installers put their commands). macOS
// gives such an app only /usr/bin:/bin:/usr/sbin:/sbin.
//
// So before anything looks for claude, codex, node, gh or adb, Kiwimake asks the user's login shell
// once for its environment (the way VS Code and Ghostex do; Ghostex's packages/paths/src/tool_path.rs
// is read only, nothing is imported). PATH becomes: the shell's folders, then the inherited PATH,
// then the usual tool folders that exist, each once, so a profile that is slow or never sets them
// still leaves those tools findable. The shell's folders come first, so the same claude or codex
// runs as in the user's terminal. Other variables the shell sets (JAVA_HOME, ANDROID_HOME, NVM_DIR)
// are added when this process lacks them. An AppImage's own folders are removed from what the
// companion, Gradle and the agents inherit. Windows: nothing changes.
//
// KIWIMAKE_SHELL_ENV=off: do not ask the shell (the usual tool folders are still added).
// ANYAPP_KEEP_PATH=1: leave the environment exactly as inherited.
import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { posix } from "node:path";

// Linux and macOS only: POSIX paths whatever system runs the code (the tests run on Windows too).
const { basename, isAbsolute, join } = posix;

type Env = Record<string, string | undefined>;

const MARK = "__KIWIMAKE_SHELL_ENV__";
/** Shells whose login, interactive and -c flags and printf work the same way. Others (nushell, xonsh) are not asked. */
const KNOWN_SHELLS = new Set(["bash", "zsh", "fish", "sh", "dash", "ksh", "mksh", "yash"]);
/** Never copied from the shell: they describe that shell, not the user's setup. */
const SKIP = /^(_|PWD|OLDPWD|SHLVL|TERM|COLUMNS|LINES|PS[0-9]|PROMPT_COMMAND|HIST.*|BASH.*|ZSH.*|FISH.*|TMUX.*|STY|WINDOW|KIWIMAKE_RESOLVING_ENVIRONMENT|ELECTRON_.*|CHROME_.*|APPDIR|APPIMAGE|ARGV0|OWD)$/;
/** Removed from the probe's environment: they change what rc files print, or make Electron act as Node. */
const PROBE_UNSET = ["NO_COLOR", "CLICOLOR_FORCE", "NODE_DISABLE_COLORS", "ELECTRON_RUN_AS_NODE"];

/** The shells to ask: the user's own first, then the system's. */
export function loginShells(env: Env, platform: NodeJS.Platform = process.platform): string[] {
  const system = platform === "darwin" ? ["/bin/zsh", "/bin/bash", "/bin/sh"] : ["/bin/bash", "/bin/sh"];
  return [...new Set([env.SHELL?.trim(), ...system].filter((s): s is string => !!s && KNOWN_SHELLS.has(basename(s))))];
}

/** A login shell that prints its environment; interactive too for the shells whose rc files usually set PATH. */
export function probeArgs(shell: string): string[] {
  const script = `printf '%s' ${MARK}; command env -0; printf '%s' ${MARK}`;
  return ["sh", "dash"].includes(basename(shell)) ? ["-l", "-c", script] : ["-l", "-i", "-c", script];
}

/** Reads `env -0` output between the two markers (an rc file may print before or after). */
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

/** Folder lists joined with ":", in order, each folder once; relative entries are dropped. */
export function mergePath(...parts: (string | string[] | undefined)[]): string {
  const out = new Set<string>();
  for (const part of parts) {
    for (const dir of Array.isArray(part) ? part : (part ?? "").split(":")) {
      const d = dir.trim();
      if (d.startsWith("/")) out.add(d);
    }
  }
  return [...out].join(":");
}

/** `prefix=` from ~/.npmrc, where `npm install -g` puts commands for a user-level npm. */
export function npmrcPrefix(home: string, read: (p: string) => string = (p) => readFileSync(p, "utf8")): string | undefined {
  try {
    const prefix = read(join(home, ".npmrc")).match(/^\s*prefix\s*=\s*(.+?)\s*$/m)?.[1].replace(/^~(?=\/)/, home);
    return prefix && isAbsolute(prefix) ? prefix : undefined;
  } catch {
    return undefined;
  }
}

export interface DirProbe {
  exists?: (p: string) => boolean;
  list?: (p: string) => string[];
  read?: (p: string) => string;
}

/** Where tool managers and package managers put commands (Ghostex's fallback_tool_dirs and node_tool_dirs), those that exist. */
export function toolDirs(home: string, env: Env, platform: NodeJS.Platform = process.platform, probe: DirProbe = {}): string[] {
  const exists = probe.exists ?? existsSync;
  const list = probe.list ?? safeList;
  const mac = platform === "darwin";
  const data = env.XDG_DATA_HOME || join(home, ".local", "share");
  const dirs: string[] = [];
  if (mac) dirs.push("/opt/homebrew/bin", "/opt/homebrew/sbin");
  dirs.push("/usr/local/bin", "/usr/local/sbin");
  if (!mac) dirs.push("/home/linuxbrew/.linuxbrew/bin");
  dirs.push(
    join(home, ".local", "bin"),
    join(env.MISE_DATA_DIR || join(data, "mise"), "shims"),
    join(env.ASDF_DATA_DIR || join(home, ".asdf"), "shims"),
    join(home, ".nodenv", "shims"),
    join(env.VOLTA_HOME || join(home, ".volta"), "bin"),
  );
  // nvm: the newest installed Node (its default alias is known only to nvm.sh).
  const nvm = join(env.NVM_DIR || join(home, ".nvm"), "versions", "node");
  const newest = list(nvm).filter((v) => /^v\d+\./.test(v)).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0];
  if (newest) dirs.push(join(nvm, newest, "bin"));
  const prefix = npmrcPrefix(home, probe.read);
  if (prefix) dirs.push(join(prefix, "bin"));
  dirs.push(join(home, ".npm-global", "bin"), join(home, ".npm-packages", "bin"));
  dirs.push(join(env.BUN_INSTALL || join(home, ".bun"), "bin"));
  dirs.push(env.PNPM_HOME || (mac ? join(home, "Library", "pnpm") : join(data, "pnpm")));
  dirs.push(join(home, ".cargo", "bin"), join(home, ".nix-profile", "bin"), "/nix/var/nix/profiles/default/bin");
  if (!mac) dirs.push("/snap/bin");
  dirs.push("/usr/bin", "/bin", "/usr/sbin", "/sbin");
  return dirs.filter((d) => exists(d));
}

function safeList(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

/** The AppImage's own folders (AppRun adds them) removed; undefined for a variable left empty. */
export function withoutAppImage(env: Env): Record<string, string | undefined> {
  const appDir = env.APPIMAGE ? env.APPDIR : undefined;
  if (!appDir) return {};
  const strip = (value: string | undefined) => (value ?? "").split(":").filter((d) => d && d !== appDir && !d.startsWith(`${appDir}/`)).join(":") || undefined;
  return {
    PATH: strip(env.PATH),
    LD_LIBRARY_PATH: strip(env.LD_LIBRARY_PATH),
    XDG_DATA_DIRS: strip(env.XDG_DATA_DIRS),
    GSETTINGS_SCHEMA_DIR: strip(env.GSETTINGS_SCHEMA_DIR),
  };
}

/** Asks one shell for its environment. Undefined when it fails or does not answer in time. */
export function readShellEnv(shell: string, env: Env, timeoutMs = 5_000): Promise<Record<string, string> | undefined> {
  return new Promise((resolve) => {
    let out = "";
    let done = false;
    const finish = (value: Record<string, string> | undefined) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(value);
    };
    const clean: Env = { ...env, KIWIMAKE_RESOLVING_ENVIRONMENT: "1" };
    for (const key of PROBE_UNSET) delete clean[key];
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(shell, probeArgs(shell), {
        env: clean as NodeJS.ProcessEnv,
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

/** The first of loginShells() that answers with a PATH, all within one time budget. */
export async function probeShellEnv(env: Env, platform: NodeJS.Platform = process.platform, timeoutMs = 5_000): Promise<{ shell: string; vars: Record<string, string> } | undefined> {
  const deadline = Date.now() + timeoutMs;
  for (const shell of loginShells(env, platform)) {
    const left = deadline - Date.now();
    if (left <= 0) break;
    try {
      if (!statSync(shell).isFile()) continue;
    } catch {
      continue;
    }
    const vars = await readShellEnv(shell, env, left);
    if (vars?.PATH) return { shell, vars };
  }
  return undefined;
}

/**
 * Updates `env` (process.env) in place, so this process and everything it starts (the companion,
 * Claude, Codex, Gradle) see the user's own tools. Runs once at start, before anything looks for a
 * tool. Returns a line for the log.
 */
export async function adoptShellEnv(env: Env = process.env, probe = probeShellEnv, platform: NodeJS.Platform = process.platform, home = env.HOME || homedir()): Promise<string> {
  if (platform === "win32") return "not needed on Windows";
  if (env.ANYAPP_KEEP_PATH) return "kept as inherited (ANYAPP_KEEP_PATH)";
  // process.env turns undefined into "undefined": delete instead.
  for (const [key, value] of Object.entries(withoutAppImage(env))) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  const found = env.KIWIMAKE_SHELL_ENV === "off" ? undefined : await probe(env, platform);
  let adopted = 0;
  for (const [key, value] of Object.entries(found?.vars ?? {})) {
    if (key === "PATH" || SKIP.test(key) || env[key] !== undefined) continue;
    env[key] = value;
    adopted++;
  }
  const before = (env.PATH ?? "").split(":").filter(Boolean).length;
  const shellPath = found ? (withoutAppImage({ ...env, PATH: found.vars.PATH }).PATH ?? found.vars.PATH) : undefined;
  env.PATH = mergePath(shellPath, env.PATH, toolDirs(home, env, platform));
  const after = env.PATH.split(":").length;
  if (found) return `PATH from ${basename(found.shell)} (${after} folders, was ${before}); ${adopted} other variables`;
  return `${env.KIWIMAKE_SHELL_ENV === "off" ? "shell not asked (KIWIMAKE_SHELL_ENV=off)" : "no login shell answered"}; PATH has ${after} folders (was ${before}) with the usual tool folders`;
}
