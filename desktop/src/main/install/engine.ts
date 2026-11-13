import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { engineInstaller, engineName, engineUpdate, type Engine } from "../../../../shared/engines.mts";
import type { Runner } from "../exec.ts";
import { fetchText } from "./download.ts";

export async function installEngine(engine: Engine, toolsDir: string, runner: Runner, env: NodeJS.ProcessEnv): Promise<void> {
  const plan = engineInstaller(engine);
  const dir = join(toolsDir, "engine-installers");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${engine}.${process.platform === "win32" ? "ps1" : "sh"}`);
  writeFileSync(file, await fetchText(plan.url, AbortSignal.timeout(60_000)));
  const result = await runner(plan.shell, plan.args(file), { env: { ...env, CODEX_NON_INTERACTIVE: "1" }, timeoutMs: 15 * 60_000 });
  if (result.code !== 0) throw new Error(`${engineName(engine)} installation did not finish. Check your connection and try again.`);
}

export async function updateEngine(engine: Engine, cli: string, runner: Runner, env: NodeJS.ProcessEnv): Promise<string> {
  const plan = engineUpdate(engine, cli);
  if (!plan) return `This ${engineName(engine)} installation is managed outside Kiwimake. Update it with the tool that installed it.`;
  const result = await runner(plan.command, plan.args, { env: { ...env, CODEX_NON_INTERACTIVE: "1" }, timeoutMs: 10 * 60_000 });
  if (result.code !== 0) throw new Error(`${engineName(engine)} could not update. Your current installation is still selected. Try again later.`);
  return `${engineName(engine)} is up to date. New sessions use the installed version.`;
}
