// Plain words for the usage meter, the Claude plan's limits, the heads-up before a big job and
// "Keep my apps healthy" (docs/TRUST.md), the same on the phone and the PC.
// Honest numbers only: a plan percentage is shown only when Claude reported it.
import type { AppUsage, HealthReminder, PlanLimit, TokenUsage, UsageState } from "../protocol.ts";

/** New work: what counts toward the plan at full weight (cache reads are shown apart). */
export function newTokens(u: TokenUsage): number {
  return u.inputTokens + u.outputTokens + u.cacheWriteTokens;
}

/** 850, 12k, 1.2M. */
export function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n < 1000) return String(Math.round(n));
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  if (n < 10_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  return `${Math.round(n / 1_000_000)}M`;
}

/** Under a message: "Used 52k tokens". */
export function usageLine(u: TokenUsage | undefined): string | null {
  if (!u) return null;
  const n = newTokens(u);
  if (n <= 0 && u.cacheReadTokens <= 0) return null;
  return `Used ${formatTokens(n)} tokens`;
}

/** The longer form: "plus 1.1M read again from Claude's memory of this chat, which counts for much less". */
export function cacheLine(u: TokenUsage | undefined): string | null {
  if (!u || u.cacheReadTokens <= 0) return null;
  return `Plus ${formatTokens(u.cacheReadTokens)} read again from Claude's memory of the chat, which counts for much less.`;
}

const LIMIT_NAMES: Record<string, string> = {
  five_hour: "5-hour limit",
  seven_day: "weekly limit",
  seven_day_opus: "weekly Opus limit",
  seven_day_sonnet: "weekly Sonnet limit",
  seven_day_overage_included: "weekly limit",
  overage: "extra usage",
};

export function limitName(kind: string): string {
  return LIMIT_NAMES[kind] ?? "plan limit";
}

/** "16:00" today, "Tue 09:00" later this week, "14 Nov" after that. */
export function resetLabel(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return time;
  const days = (d.getTime() - now.getTime()) / 86_400_000;
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  if (days > 0 && days < 6) return `${DAYS[d.getDay()]} ${time}`;
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

export interface PlanLine {
  text: string;
  kind: "ok" | "near" | "out";
  percent?: number; // only when Claude reported it
}

/** One line per limit Claude reported: "5-hour limit: 62% used, resets at 16:00". */
export function planLine(limit: PlanLimit, now: Date = new Date()): PlanLine {
  const name = limitName(limit.kind);
  const Name = name[0].toUpperCase() + name.slice(1);
  const resets = limit.resetsAt ? resetLabel(limit.resetsAt, now) : "";
  if (limit.status === "rejected") {
    return { text: `${Name} is used up${resets ? ` until ${resets}` : ""}. Changes wait until then.`, kind: "out", ...(limit.usedPercent !== undefined ? { percent: limit.usedPercent } : {}) };
  }
  if (limit.usedPercent !== undefined) {
    const near = limit.status === "allowed_warning" || limit.usedPercent >= 80;
    return { text: `${Name}: ${limit.usedPercent}% used${resets ? `, resets at ${resets}` : ""}`, kind: near ? "near" : "ok", percent: limit.usedPercent };
  }
  if (limit.status === "allowed_warning") return { text: `Claude says you are close to your ${name}${resets ? ` (it resets at ${resets})` : ""}.`, kind: "near" };
  return { text: `${Name}: Claude says there is room${resets ? `, resets at ${resets}` : ""}.`, kind: "ok" };
}

export const PLAN_UNKNOWN = "Claude has not shared your plan's limits yet, so this shows what your apps used, not a percentage of your plan.";

export function planLines(usage: UsageState | undefined, now: Date = new Date()): PlanLine[] {
  return (usage?.plan ?? []).map((p) => planLine(p, now));
}

export interface AppUsageRow {
  appId: string;
  name: string;
  tokens: number; // this month
  share: number; // 0..1 of the biggest app this month (for a bar), never of the plan
  changes: number;
  perChange: number | null;
}

/** This month's use per app, biggest first, for the meter's list. */
export function usageRows(apps: { id: string; name: string; usage?: AppUsage }[]): AppUsageRow[] {
  const rows = apps
    .filter((a) => a.usage)
    .map((a) => {
      const u = a.usage!;
      const total = newTokens(u.total);
      return {
        appId: a.id,
        name: a.name,
        tokens: newTokens(u.month),
        share: 0,
        changes: u.changes,
        perChange: u.changes > 0 ? Math.round(total / u.changes) : null,
      };
    })
    .filter((r) => r.tokens > 0 || r.changes > 0)
    .sort((a, b) => b.tokens - a.tokens);
  const top = rows[0]?.tokens ?? 0;
  for (const r of rows) r.share = top > 0 ? r.tokens / top : 0;
  return rows;
}

// ---------- the heads-up before a big job

const BIG_WORDS = /\b(rewrite|redesign|rebuild|re-?do|from scratch|start over|whole app|entire app|every screen|all (?:the )?screens|completely|overhaul|new version)\b/i;
export const BIG_TEXT_CHARS = 400;

export interface HeadsUp {
  title: string;
  body: string;
  send: string; // the button that goes ahead
}

/**
 * A heads-up before a big job (a new app, "Update it", or a long or sweeping change), or whenever
 * the plan's limit is used up. Null when the job looks small and the plan has room.
 */
export function headsUp(args: { text: string; newApp?: boolean; keepHealthy?: boolean; usage?: UsageState; appUsage?: AppUsage; now?: Date }): HeadsUp | null {
  const lines = planLines(args.usage, args.now);
  const out = lines.find((l) => l.kind === "out");
  const near = lines.find((l) => l.kind === "near");
  const big = args.newApp === true || args.keepHealthy === true || args.text.trim().length >= BIG_TEXT_CHARS || BIG_WORDS.test(args.text);
  if (!big && !out) return null;
  const parts: string[] = [];
  if (args.newApp) parts.push("Making a new app is the biggest job there is: it uses more of your Claude plan than any change.");
  else if (args.keepHealthy) parts.push("Bringing an app up to date touches much of it, so it uses more of your Claude plan than a small change.");
  else if (big) parts.push("This looks like a big change, so it may use a good part of your Claude plan.");
  const u = args.appUsage;
  if (u && u.changes >= 2) parts.push(`Changes to this app have used about ${formatTokens(Math.round(newTokens(u.total) / u.changes))} tokens each so far.`);
  if (out) parts.push(out.text);
  else if (near) parts.push(`${near.text}.`.replace(/\.\.$/, "."));
  else if (lines.length > 0) parts.push(`${lines[0].text}.`.replace(/\.\.$/, "."));
  else parts.push("Claude has not shared how much of your plan is left.");
  return {
    title: out ? "Your Claude plan needs a rest" : "A big job",
    body: parts.join(" "),
    send: args.newApp ? "Make it" : args.keepHealthy ? "Update it" : "Send anyway",
  };
}

// ---------- keep my apps healthy

/** The monthly reminder's words, or null when it is not due. */
export function reminderText(h: HealthReminder | undefined): { title: string; body: string } | null {
  if (!h?.due || h.behind <= 0) return null;
  return {
    title: "Your monthly app check",
    body:
      h.behind === 1
        ? "One app is behind the newest version of AnyAppAgent's template. Tap the yellow sign on it to update it."
        : `${h.behind} apps are behind the newest version of AnyAppAgent's template. Tap the yellow sign on one to update it.`,
  };
}

export const BEHIND_LABEL = "Needs an update";
