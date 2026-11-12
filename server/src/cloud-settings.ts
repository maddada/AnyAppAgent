// The cloud's settings for the companion's work loop (docs/CLOUD.md section 3, "Models"): each app's
// chat is an orchestrator on Opus 5.5 high, and each helper runs at one of three levels. Only the
// cloud runner turns them on (ANYAPP_CLOUD=1); a PC runs as it always did.

export type HelperLevel = "deep" | "focused" | "simple";
export const HELPER_LEVELS: readonly HelperLevel[] = ["deep", "focused", "simple"];

export interface ModelChoice {
  model: string; // an Anthropic model id, e.g. claude-opus-5-5
  effort: string; // the ACP "effort" option: "high", "medium", ...
}

export interface CloudSettings {
  orchestrator: ModelChoice;
  levels: Record<HelperLevel, ModelChoice>;
  /** Starts the agent as another Unix user, e.g. ["sudo", "-n", "-u", "agent", "-H", "/opt/kiwi/agent.sh"]. */
  agentPrefix: string[];
}

export const DEFAULT_CLOUD: CloudSettings = {
  orchestrator: { model: "claude-opus-5-5", effort: "high" },
  levels: {
    deep: { model: "claude-opus-5-5", effort: "high" },
    focused: { model: "claude-opus-5-5", effort: "medium" },
    simple: { model: "claude-sonnet-5-5", effort: "high" },
  },
  agentPrefix: [],
};

export function cloudSettingsFromEnv(env: NodeJS.ProcessEnv): CloudSettings | undefined {
  if (env.ANYAPP_CLOUD !== "1") return undefined;
  let agentPrefix: string[] = [];
  if (env.ANYAPP_AGENT_PREFIX) {
    const parsed = JSON.parse(env.ANYAPP_AGENT_PREFIX) as unknown;
    if (!Array.isArray(parsed) || !parsed.every((p) => typeof p === "string")) throw new Error("ANYAPP_AGENT_PREFIX must be a JSON array of strings");
    agentPrefix = parsed;
  }
  return { ...DEFAULT_CLOUD, agentPrefix };
}

/** The model and effort a helper at `level` gets (an unknown level: focused). */
export function levelChoice(settings: CloudSettings, level: string | undefined): ModelChoice {
  return settings.levels[(HELPER_LEVELS as readonly string[]).includes(level ?? "") ? (level as HelperLevel) : "focused"];
}
