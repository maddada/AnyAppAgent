import { engineName, type Engine } from "../../../../shared/engines.mts";
import type { ClaudeCheck } from "../../shared/types.ts";
import type { Runner } from "../exec.ts";
import { detectClaude } from "./claude.ts";

export async function detectEngine(engine: Engine, cli: string | undefined, run: Runner, env: NodeJS.ProcessEnv = process.env): Promise<ClaudeCheck> {
  if (!cli) return { state: "needed", installed: false, summary: `Install ${engineName(engine)} to start making apps.` };
  if (engine === "claude") return { ...await detectClaude(cli, run, env), installed: true };
  const result = await run(cli, ["login", "status"], { env, timeoutMs: 15_000 });
  // Codex writes status to stderr. Never surface its output, which can include API key details.
  const output = `${result.stdout}\n${result.stderr}`;
  if (result.code === 0 && /logged in/i.test(output)) return { state: "done", installed: true, summary: "Signed in to Codex" };
  if (/not logged in|not signed in/i.test(output) || result.code === 1 && !result.error) return { state: "needed", installed: true, summary: "Sign in to Codex with your ChatGPT account." };
  return { state: "problem", installed: true, summary: "Could not check Codex sign-in. Try again." };
}
