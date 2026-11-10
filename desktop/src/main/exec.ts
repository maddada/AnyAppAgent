// Small process helpers: run a command and collect its output, with a timeout, never showing a
// console window. Detection code takes a Runner so tests can fake every command.
import { spawn, spawnSync, type ChildProcess, type SpawnOptions } from "node:child_process";

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  /** Spawning failed (ENOENT and the like). */
  error?: string;
}

export type Runner = (command: string, args: string[], options?: { env?: NodeJS.ProcessEnv; timeoutMs?: number; cwd?: string }) => Promise<RunResult>;

/** Windows needs a shell for .cmd/.bat files; everything else runs directly. */
function needsShell(command: string): boolean {
  return process.platform === "win32" && /\.(cmd|bat)$/i.test(command);
}

/** Quotes one argument for cmd.exe (used only for .cmd/.bat files). */
export function cmdQuote(arg: string): string {
  if (arg === "") return '""';
  // `;`, `,` and `=` split batch-file arguments (sdkmanager.bat gets "platforms;android-37.0").
  if (!/[\s"&|<>^()%!;,=]/.test(arg)) return arg;
  return `"${arg.replace(/"/g, '""')}"`;
}

/** Spawns command; for .cmd/.bat goes through cmd.exe with quoted arguments. */
export function spawnHidden(command: string, args: string[], options: SpawnOptions = {}): ChildProcess {
  if (needsShell(command)) {
    const line = [cmdQuote(command), ...args.map(cmdQuote)].join(" ");
    return spawn(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", `"${line}"`], {
      ...options,
      windowsHide: true,
      windowsVerbatimArguments: true,
    });
  }
  return spawn(command, args, { ...options, windowsHide: true });
}

export const run: Runner = (command, args, options = {}) =>
  new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let child: ChildProcess;
    try {
      child = spawnHidden(command, args, { env: options.env ?? process.env, cwd: options.cwd, stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      resolve({ code: null, stdout, stderr, error: (error as Error).message });
      return;
    }
    const timer = setTimeout(() => {
      if (settled) return;
      killTree(child);
      settled = true;
      resolve({ code: null, stdout, stderr, error: "timed out" });
    }, options.timeoutMs ?? 20_000);
    child.stdout?.on("data", (chunk) => (stdout += chunk));
    child.stderr?.on("data", (chunk) => (stderr += chunk));
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr, error: error.message });
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });

/** Kills a process and everything it started (Windows: taskkill /T). */
export function killTree(child: ChildProcess | undefined): void {
  if (!child || child.pid === undefined || child.exitCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
  } else {
    child.kill("SIGTERM");
  }
}
