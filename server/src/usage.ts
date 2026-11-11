// The usage meter (docs/TRUST.md, "Usage meter"): how much each app and each change used, from what
// Claude Code reports through ACP, and the Claude plan's limits only as Claude reports them.
//   - Each turn's tokens: the ACP PromptResponse.usage of session/prompt (claude-agent-acp fills it
//     with inputTokens, outputTokens, cachedReadTokens, cachedWriteTokens for that turn).
//   - The plan's limits: the "_claude/rateLimit" _meta of a usage_update (Claude Code's own
//     rate_limit_event: status, rateLimitType, utilization 0..1, resetsAt in Unix seconds).
// Nothing here is estimated: a limit Claude did not report is simply not there.
// Kept in <state>/usage.json.
import { join } from "node:path";
import type { AppUsage, PlanLimit, TokenUsage, UsageState } from "../../shared/protocol.ts";
import { isJsonObject } from "./acp/acp-client.ts";
import { nowIso, readJson, writeJsonAtomic } from "./fs-util.ts";

export const ZERO_USAGE: TokenUsage = { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0 };

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

/** The tokens of one turn from a session/prompt result, or null when the agent reported none. */
export function promptUsage(result: unknown): TokenUsage | null {
  if (!isJsonObject(result) || !isJsonObject(result["usage"])) return null;
  const u = result["usage"];
  const usage: TokenUsage = {
    inputTokens: count(u["inputTokens"]),
    outputTokens: count(u["outputTokens"]),
    cacheWriteTokens: count(u["cachedWriteTokens"]),
    cacheReadTokens: count(u["cachedReadTokens"]),
  };
  return totalTokens(usage) + usage.cacheReadTokens > 0 ? usage : null;
}

/** A plan limit from a usage_update's _meta, or null when it carries none. */
export function planLimitFrom(update: unknown, seenAt = nowIso()): PlanLimit | null {
  if (!isJsonObject(update) || update["sessionUpdate"] !== "usage_update" || !isJsonObject(update["_meta"])) return null;
  const info = update["_meta"]["_claude/rateLimit"];
  if (!isJsonObject(info)) return null;
  const status = info["status"];
  if (status !== "allowed" && status !== "allowed_warning" && status !== "rejected") return null;
  const kind = typeof info["rateLimitType"] === "string" && /^[a-z0-9_]{1,40}$/.test(info["rateLimitType"]) ? info["rateLimitType"] : "plan";
  const limit: PlanLimit = { kind, status, seenAt };
  const used = info["utilization"];
  if (typeof used === "number" && Number.isFinite(used) && used >= 0 && used <= 1.5) limit.usedPercent = Math.min(100, Math.round(used * 100));
  const resets = info["resetsAt"];
  if (typeof resets === "number" && Number.isFinite(resets) && resets > 0) {
    // Claude Code sends Unix seconds; accept milliseconds too.
    limit.resetsAt = new Date(resets < 1e12 ? resets * 1000 : resets).toISOString();
  }
  return limit;
}

/** New work: what counts toward the plan at full weight (cache reads are kept apart). */
export function totalTokens(u: TokenUsage): number {
  return u.inputTokens + u.outputTokens + u.cacheWriteTokens;
}

export function addUsage(a: TokenUsage | undefined, b: TokenUsage): TokenUsage {
  const base = a ?? ZERO_USAGE;
  return {
    inputTokens: base.inputTokens + b.inputTokens,
    outputTokens: base.outputTokens + b.outputTokens,
    cacheWriteTokens: base.cacheWriteTokens + b.cacheWriteTokens,
    cacheReadTokens: base.cacheReadTokens + b.cacheReadTokens,
  };
}

export function monthKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

interface UsageFile {
  apps: Record<string, AppUsage>;
  plan: PlanLimit[];
  month: { key: string; usage: TokenUsage };
}

/** A limit reported this long ago no longer says anything about now. */
const PLAN_STALE_MS = 7 * 24 * 3600_000;

export class UsageMeter {
  private readonly path: string;
  private readonly data: UsageFile;
  private timer: NodeJS.Timeout | undefined;
  /** The plan (or the month total) changed: clients get a new CareState. */
  onChange: () => void = () => {};
  private readonly now: () => Date;

  constructor(stateDir: string, now: () => Date = () => new Date()) {
    this.path = join(stateDir, "usage.json");
    this.now = now;
    const read = readJson<Partial<UsageFile>>(this.path, {});
    this.data = {
      apps: read.apps ?? {},
      plan: Array.isArray(read.plan) ? read.plan : [],
      month: read.month ?? { key: monthKey(now()), usage: { ...ZERO_USAGE } },
    };
  }

  /** The app's usage as App.usage shows it (this month rolled over when the month changed). */
  app(appId: string): AppUsage | undefined {
    const u = this.data.apps[appId];
    if (!u) return undefined;
    const key = monthKey(this.now());
    if (u.monthKey !== key) return { ...u, month: { ...ZERO_USAGE }, monthKey: key };
    return u;
  }

  /** Counts one turn's tokens for the app; `newChange`: the first usage of a message from the person. */
  add(appId: string, usage: TokenUsage, newChange: boolean): AppUsage {
    const key = monthKey(this.now());
    const current = this.app(appId);
    const next: AppUsage = {
      total: addUsage(current?.total, usage),
      month: addUsage(current?.month, usage),
      monthKey: key,
      changes: (current?.changes ?? 0) + (newChange ? 1 : 0),
      since: current?.since ?? nowIso(),
    };
    this.data.apps[appId] = next;
    if (this.data.month.key !== key) this.data.month = { key, usage: { ...ZERO_USAGE } };
    this.data.month.usage = addUsage(this.data.month.usage, usage);
    this.save();
    this.onChange();
    return next;
  }

  notePlan(limit: PlanLimit): void {
    const before = JSON.stringify(this.data.plan.find((p) => p.kind === limit.kind) ?? null);
    const rest = this.data.plan.filter((p) => p.kind !== limit.kind);
    this.data.plan = [...rest, limit].sort((a, b) => a.kind.localeCompare(b.kind));
    this.save();
    const { seenAt: _a, ...was } = (JSON.parse(before) ?? {}) as Partial<PlanLimit>;
    const { seenAt: _b, ...now } = limit;
    if (JSON.stringify(was) !== JSON.stringify(now)) this.onChange();
  }

  state(): UsageState {
    const key = monthKey(this.now());
    const cutoff = this.now().getTime() - PLAN_STALE_MS;
    const plan = this.data.plan.filter((p) => {
      const seen = Date.parse(p.seenAt);
      // A limit that has reset since Claude reported it no longer holds.
      if (p.resetsAt && Date.parse(p.resetsAt) < this.now().getTime()) return false;
      return Number.isFinite(seen) && seen >= cutoff;
    });
    return { plan, month: this.data.month.key === key ? this.data.month.usage : { ...ZERO_USAGE }, monthKey: key };
  }

  /** An app restored from a backup brings what it used on the old PC (once). */
  seed(appId: string, usage: AppUsage): void {
    if (appId in this.data.apps) return;
    this.data.apps[appId] = usage;
    this.save();
  }

  private save(): void {
    this.timer ??= setTimeout(() => this.flush(), 500);
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    writeJsonAtomic(this.path, this.data);
  }
}
