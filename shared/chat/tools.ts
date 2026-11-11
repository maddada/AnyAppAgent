// Words for tool-call rows and the thinking row: plain titles, the detail that opens below, the
// summary line of a folded run. The raw command line or path never becomes a row title; it shows
// only when the row is opened.
import type { ChatItem, ToolCallInfo } from "../protocol.ts";

const RAW_COMMAND = /(&&|\|\||[|;<>$=]|^"|^(cd|npm|npx|node|git|mkdir|cat|ls|rm|cp|mv|echo|powershell|pwsh|cmd|gradlew|\.\/gradlew)\b|[A-Za-z]:[\\/])/;

export const toolActive = (item: ChatItem): boolean => item.tool?.status === "pending" || item.tool?.status === "in_progress";
export const toolFinished = (item: ChatItem): boolean => item.kind === "tool" && !toolActive(item);

/**
 * The row title: the companion's plain title ("Checked the app"). Chat history from before the
 * companion gave command rows plain titles can still carry a raw command line as the title; those
 * read "Ran a command" and keep the command for the opened row. A long path in a title is cut to
 * its file name ("Write AlarmModule.kt").
 */
export function plainToolTitle(tool: Pick<ToolCallInfo, "title" | "kind" | "detail">): string {
  const first = tool.title.split(/\r?\n/)[0].trim();
  if (!first) return tool.kind === "execute" ? "Ran a command" : "A step";
  if (tool.kind === "search" && /^(grep|rg|find|findstr|Select-String)\b/.test(first)) return "Searched the app";
  if (tool.kind !== "execute") {
    const m = first.match(/^(\S+)\s+(.*[\\/].+)$/);
    return m ? `${m[1]} ${m[2].split(/[\\/]/).filter(Boolean).pop()}` : first;
  }
  return first === tool.detail?.split(/\r?\n/)[0].trim() || RAW_COMMAND.test(first) ? "Ran a command" : first;
}

/**
 * What goes beside the title and what opens below it. Only a short result goes on the row
 * ("+48 -6", "14 passed"); a command line, a path or a long title opens below when the row is
 * tapped or clicked. A detail that only restates the title adds nothing and is dropped.
 */
export function toolDetail(tool: Pick<ToolCallInfo, "title" | "kind" | "detail">): { inline?: string; block?: string } {
  const title = tool.title.trim();
  const shown = plainToolTitle(tool);
  const norm = (v: string) => v.split("\\").join("/").toLowerCase();
  const raw = tool.detail?.trim() ?? "";
  const detail = raw && raw !== title && !norm(title).includes(norm(raw)) ? raw : "";
  // The full title opens below whenever the row shows a shorter one.
  const titleExtra = title && title !== shown ? title : "";
  const looksLikeResult = /^[+\-\u2212]\d+(\s+[+\-\u2212]\d+)?$/.test(detail) || /^\d+ (passed|failed|errors?|warnings?)\b/i.test(detail);
  if (detail && looksLikeResult && detail.length <= 24) return { inline: detail, block: titleExtra || undefined };
  const block = [titleExtra, detail].filter(Boolean).join("\n\n");
  return { block: block || undefined };
}

/**
 * One line for a folded run of finished tool rows ("Edited 3 files, ran a command"). Files are
 * counted once each, however often they were edited or read.
 */
export function summarizeTools(items: readonly ChatItem[]): string {
  const tools = items.map((i) => i.tool).filter((t): t is ToolCallInfo => !!t);
  const files = (kinds: string[]) => new Set(tools.filter((t) => kinds.includes(t.kind)).map((t) => t.detail || t.title)).size;
  const count = (kind: string) => tools.filter((t) => t.kind === kind).length;
  const plural = (k: number, one: string, many: string) => (k === 1 ? one : many.replace("#", String(k)));
  const parts: string[] = [];
  const edited = files(["edit", "delete", "move"]);
  const read = files(["read"]);
  if (edited) parts.push(plural(edited, "edited a file", "edited # files"));
  if (read) parts.push(plural(read, "read a file", "read # files"));
  if (count("execute")) parts.push(plural(count("execute"), "ran a command", "ran # commands"));
  if (count("search")) parts.push(plural(count("search"), "searched once", "searched # times"));
  const known = ["edit", "delete", "move", "read", "execute", "search"];
  const rest = tools.filter((t) => !known.includes(t.kind)).length;
  if (rest > 0) parts.push(plural(rest, "one more step", "# more steps"));
  const text = parts.join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** How long an item was live, in whole seconds (a thought: how long the agent thought). */
export function seconds(item: Pick<ChatItem, "createdAt" | "updatedAt">): number {
  const ms = Date.parse(item.updatedAt) - Date.parse(item.createdAt);
  return Number.isFinite(ms) ? Math.max(0, Math.round(ms / 1000)) : 0;
}

export function duration(s: number): string {
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

/** The thinking row's words: "Thinking" while live, then "Thought for 12s". */
export function thoughtLabel(item: ChatItem): string {
  if (item.streaming) return "Thinking";
  const s = seconds(item);
  return s > 1 ? `Thought for ${duration(s)}` : "Thought";
}

/** The plan box's count line. */
export function planCount(item: ChatItem): string {
  const entries = item.plan ?? [];
  return `${entries.filter((e) => e.status === "completed").length} of ${entries.length} done`;
}
