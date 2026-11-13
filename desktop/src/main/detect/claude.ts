// Probe the installed Claude CLI used by the companion through CLAUDE_CODE_EXECUTABLE.
// auth status --json is also how the ACP adapter checks its sign-in.
import { engineCandidates } from "../../../../shared/engines.mts";
import type { ClaudeCheck } from "../../shared/types.ts";
import type { Runner } from "../exec.ts";

export interface ClaudeStatusJson {
  loggedIn?: boolean;
  authMethod?: string; // "claude.ai" | "console" | "none" | ...
  apiProvider?: string;
  email?: string;
  subscriptionType?: string; // "max" | "pro" | "team" | "enterprise" | ...
  orgName?: string;
}

/** Candidate paths of the Claude CLI binary, most specific first. */
export function claudeCliCandidates(serverDir: string, env: NodeJS.ProcessEnv, platform = process.platform, arch = process.arch): string[] {
  return engineCandidates("claude", env, platform);
}

export function planLabel(status: ClaudeStatusJson): string | undefined {
  if (status.authMethod === "console" || status.authMethod === "api_key") return "API billing";
  const sub = status.subscriptionType?.toLowerCase();
  if (!sub) return undefined;
  const names: Record<string, string> = { max: "Max", pro: "Pro", team: "Team", enterprise: "Enterprise", free: "Free" };
  return names[sub] ?? sub.charAt(0).toUpperCase() + sub.slice(1);
}

/** Turns `claude auth status --json` output into a check. Pure, unit tested. */
export function interpretClaudeStatus(stdout: string): ClaudeCheck {
  let parsed: ClaudeStatusJson;
  try {
    parsed = JSON.parse(stdout) as ClaudeStatusJson;
  } catch {
    return { state: "problem", summary: "Could not tell whether Claude is signed in.", error: "unreadable status" };
  }
  if (typeof parsed !== "object" || parsed === null || typeof parsed.loggedIn !== "boolean") {
    return { state: "problem", summary: "Could not tell whether Claude is signed in.", error: "unexpected status" };
  }
  const external = parsed.apiProvider && parsed.apiProvider !== "firstParty";
  if (!parsed.loggedIn && !external) {
    return { state: "needed", summary: "Claude is not signed in on this PC yet." };
  }
  const plan = planLabel(parsed);
  if (plan === "Free") {
    return {
      state: "needed",
      summary: "Signed in, but this Claude account has no paid plan. Claude Pro or Max is needed.",
      email: parsed.email,
      plan,
    };
  }
  return {
    state: "done",
    summary: parsed.email ? `Signed in as ${parsed.email}` : "Signed in",
    email: parsed.email,
    plan: external ? "Your company's Claude" : plan,
  };
}

export async function detectClaude(cli: string | undefined, runner: Runner, env: NodeJS.ProcessEnv = process.env): Promise<ClaudeCheck> {
  if (!cli) {
    return { state: "needed", installed: false, summary: "Install Claude to start making apps." };
  }
  const result = await runner(cli, ["auth", "status", "--json"], { env, timeoutMs: 15_000 });
  // `auth status` exits 1 when signed out but still prints the JSON.
  if (result.stdout.trim().startsWith("{")) return interpretClaudeStatus(result.stdout);
  return {
    state: "problem",
    summary: "Could not tell whether Claude is signed in.",
    error: result.error ?? (result.stderr.trim() || `exit ${result.code}`),
  };
}

/** Extracts the sign-in link from `claude auth login` output (it may be wrapped in an OSC 8 hyperlink). */
export function extractLoginUrl(output: string): string | undefined {
  const osc = output.match(/\u001b\]8;;(https:\/\/[^\u0007\u001b\s]+)/);
  if (osc) return osc[1];
  const plain = output.match(/https:\/\/(?:claude\.ai|claude\.com|console\.anthropic\.com|platform\.claude\.com)\/[^\s\u0007\u001b]+/);
  return plain?.[0];
}
