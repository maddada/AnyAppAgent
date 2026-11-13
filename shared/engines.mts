// Desktop engines. Discovery and ownership follow Ghostex's agent_cli catalog and launch_path.
// No imports from Ghostex. Cloud sessions keep their existing provider and model policy.
import { existsSync, realpathSync, statSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";

export type Engine = "claude" | "codex";
export const engineName = (engine: Engine): string => engine === "codex" ? "Codex" : "Claude";
export const CODEX_MODEL = "gpt-6.1-sol";
export const CODEX_EFFORT = "high";
export const isEngine = (value: unknown): value is Engine => value === "claude" || value === "codex";

export function engineCandidates(engine: Engine, env: NodeJS.ProcessEnv = process.env, platform = process.platform): string[] {
  const override = engine === "claude" ? env.CLAUDE_CODE_EXECUTABLE : env.CODEX_EXECUTABLE;
  if (override) return [override]; // A broken explicit override must not silently run another copy.
  const win = platform === "win32";
  const home = (win ? env.USERPROFILE : env.HOME) ?? env.HOME;
  const names = win ? [`${engine}.exe`, `${engine}.cmd`, `${engine}.bat`] : [engine];
  const path = Object.entries(env).find(([key]) => key.toLowerCase() === "path")?.[1] ?? "";
  const dirs = path.split(win ? ";" : ":").filter(Boolean).map((p) => p.replace(/^"|"$/g, ""));
  // Session wrappers from another host are not the installed CLI.
  const safeDirs = dirs.filter((p) => !/ghostex[\\/].*session-bin/i.test(p));
  if (home) safeDirs.push(join(home, ".local", "bin"));
  if (win && env.LOCALAPPDATA) safeDirs.push(join(env.LOCALAPPDATA, "Programs", "OpenAI", "Codex", "bin"));
  if (win && env.APPDATA) safeDirs.push(join(env.APPDATA, "npm"));
  if (!win) safeDirs.push("/opt/homebrew/bin", "/usr/local/bin", "/usr/bin");
  return [...new Set(safeDirs.flatMap((dir) => names.map((name) => join(dir, name))))];
}

export function findEngine(engine: Engine, env: NodeJS.ProcessEnv = process.env): string | undefined {
  return engineCandidates(engine, env).find((p) => {
    try { return statSync(p).isFile(); } catch { return false; }
  });
}

export interface EngineCommand { command: string; args: string[] }
/** Update the copy actually launched, using its owning manager. Unknown installs are left alone. */
export function engineUpdate(engine: Engine, cli: string, real = (p: string) => realpathSync(p)): EngineCommand | undefined {
  let target: string;
  try { target = real(cli).replace(/\\/g, "/"); } catch { return undefined; }
  const lower = target.toLowerCase();
  const pkg = engine === "claude" ? "@anthropic-ai/claude-code" : "@openai/codex";
  if (lower.includes("/mise/") || lower.includes("/mise/shims/")) return { command: "mise", args: ["upgrade", engine] };
  if (/\/homebrew\/|\/cellar\/|\/caskroom\//.test(lower)) return { command: "brew", args: ["upgrade", "--cask", engine === "claude" ? "claude-code" : "codex"] };
  if (lower.includes("/winget/")) return engine === "claude" ? { command: "winget", args: ["upgrade", "--id", "Anthropic.ClaudeCode", "--exact", "--silent", "--accept-source-agreements"] } : undefined;
  // npm shims live beside node_modules on Windows, or point into lib/node_modules on Unix.
  if (lower.includes("/node_modules/") || existsSync(join(dirname(cli), "node_modules", pkg, "package.json"))) {
    const marker = target.indexOf("/lib/node_modules/");
    const winMarker = target.indexOf("/node_modules/");
    const prefix = marker >= 0 ? target.slice(0, marker) : winMarker >= 0 ? target.slice(0, winMarker) : dirname(cli);
    return { command: process.platform === "win32" ? "npm.cmd" : "npm", args: ["install", "--global", "--prefix", prefix, `${pkg}@latest`] };
  }
  if (engine === "claude" && /\/\.local\/(bin|share\/claude)\//.test(lower) || engine === "codex" && /\/programs\/openai\/codex\/|\/packages\/standalone\//.test(lower)) {
    return { command: cli, args: ["update"] };
  }
  return undefined;
}

export function engineInstaller(engine: Engine, platform = process.platform): { url: string; shell: string; args: (file: string) => string[] } {
  const base = engine === "claude" ? "https://claude.ai" : "https://chatgpt.com/codex";
  return platform === "win32"
    ? { url: `${base}/install.ps1`, shell: "powershell.exe", args: (file) => ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", file] }
    : { url: `${base}/install.sh`, shell: engine === "claude" ? "bash" : "sh", args: (file) => [file] };
}
