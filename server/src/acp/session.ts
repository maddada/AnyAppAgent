import { findEngine, type Engine } from "../../../shared/engines.mts";
import type { Config } from "../config.ts";
import { ClaudeSession, claudeLaunchSpec, type ClaudeSessionOptions } from "./claude-session.ts";
import { CodexSession } from "./codex-session.ts";
import { CodexModels } from "./codex-model.ts";

export type AgentSession = ClaudeSession | CodexSession;
export const selectedEngine = (config: Pick<Config, "cloud" | "engine">): Engine => config.cloud ? "claude" : config.engine ?? "claude";
export interface SessionRecord { sessionId?: string; sessionEngine?: Engine; engineSessions?: Partial<Record<Engine, string>> }
export function resumeFor(record: SessionRecord, engine: Engine): string | undefined {
  return record.engineSessions?.[engine] ?? ((record.sessionEngine ?? "claude") === engine ? record.sessionId : undefined);
}
export function rememberSession(record: SessionRecord, engine: Engine, id: string): void {
  record.engineSessions ??= {};
  if (record.sessionId) record.engineSessions[record.sessionEngine ?? "claude"] = record.sessionId;
  record.engineSessions[engine] = id;
  record.sessionId = id; record.sessionEngine = engine;
}
export function createSession(config: Config, options: Omit<ClaudeSessionOptions, "launch">): AgentSession {
  if (selectedEngine(config) === "codex") {
    const cli = findEngine("codex");
    if (!cli) throw new Error("Codex is missing. Install it in Kiwimake Setup.");
    return new CodexSession({ ...options, models: new CodexModels(config.stateDir), launch: { command: cli, args: ["app-server", "--listen", "stdio://"] } });
  }
  // Cloud keeps its pinned engine. Desktop always passes the detected system Claude to ACP.
  const cli = config.cloud ? undefined : findEngine("claude");
  if (!config.cloud && !cli) throw new Error("Claude is missing. Install it in Kiwimake Setup.");
  return new ClaudeSession({ ...options, env: { ...options.env, ...(cli ? { CLAUDE_CODE_EXECUTABLE: cli } : {}) }, launch: claudeLaunchSpec(config.acpLaunch, config.cloud?.agentPrefix) });
}
