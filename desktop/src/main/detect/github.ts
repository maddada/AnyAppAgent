// GitHub through the `gh` CLI: find it, read who is signed in (never changing anything), and
// parse the device-flow output of `gh auth login --web`.
import { join } from "node:path";
import type { GitHubCheck } from "../../shared/types.ts";
import type { Runner } from "../exec.ts";

export interface GhLocation {
  path: string;
  source: "system" | "tools";
}

export function ghCandidates(toolsDir: string, env: NodeJS.ProcessEnv): GhLocation[] {
  const exe = process.platform === "win32" ? "gh.exe" : "gh";
  const list: GhLocation[] = [];
  for (const dir of (env.PATH ?? env.Path ?? "").split(process.platform === "win32" ? ";" : ":")) {
    if (dir.trim()) list.push({ path: join(dir.trim(), exe), source: "system" });
  }
  if (process.platform === "win32") {
    list.push({ path: join(env.ProgramFiles ?? "C:\\Program Files", "GitHub CLI", exe), source: "system" });
    if (env.LOCALAPPDATA) list.push({ path: join(env.LOCALAPPDATA, "Programs", "GitHub CLI", exe), source: "system" });
  }
  list.push({ path: join(toolsDir, "gh", "bin", exe), source: "tools" });
  return list;
}

/**
 * Reads `gh auth status --hostname github.com` output (text; older gh has no --json for it).
 * Returns the account name when signed in, null when signed out.
 */
export function parseGhAuthStatus(output: string): { login: string } | null {
  // gh >= 2.40: "✓ Logged in to github.com account maddada (keyring)"
  const modern = output.match(/Logged in to github\.com account ([A-Za-z0-9-]+)/);
  if (modern) return { login: modern[1] };
  // Older gh: "✓ Logged in to github.com as maddada (oauth_token)"
  const older = output.match(/Logged in to github\.com as ([A-Za-z0-9-]+)/);
  if (older) return { login: older[1] };
  return null;
}

export async function detectGitHub(gh: GhLocation | undefined, runner: Runner, skipped: boolean, env: NodeJS.ProcessEnv = process.env): Promise<GitHubCheck> {
  const optional = skipped ? "skipped" : "needed";
  if (!gh) {
    return { state: optional, summary: skipped ? "Skipped. Your apps are kept on this PC only." : "Not set up yet.", source: "none" };
  }
  const result = await runner(gh.path, ["auth", "status", "--hostname", "github.com"], { env, timeoutMs: 15_000 });
  const who = parseGhAuthStatus(`${result.stdout}\n${result.stderr}`);
  if (who) return { state: "done", summary: `Connected as ${who.login}`, login: who.login, source: gh.source };
  if (result.error) return { state: "problem", summary: "Could not check your GitHub account.", source: gh.source, error: result.error };
  return { state: optional, summary: skipped ? "Skipped. Your apps are kept on this PC only." : "Not connected yet.", source: gh.source };
}

/** Pulls the one-time code and the URL from `gh auth login --web` output. */
export function parseDeviceFlow(output: string): { code?: string; url?: string } {
  const code = output.match(/one-time code:\s*([A-Z0-9]{4}-[A-Z0-9]{4})/i)?.[1];
  const url = output.match(/https:\/\/github\.com\/login\/device\S*/)?.[0];
  return { code, url };
}

/** Name of the portable gh zip for this PC in a GitHub release (cli/cli). */
export function ghAssetName(version: string, arch = process.arch): string {
  const a = arch === "arm64" ? "arm64" : arch === "ia32" ? "386" : "amd64";
  return `gh_${version.replace(/^v/, "")}_windows_${a}.zip`;
}
