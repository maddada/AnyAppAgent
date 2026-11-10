import type { App, ChatItem } from "@/lib/protocol";

export type Row =
  | { type: "item"; key: string; item: ChatItem }
  | { type: "tools"; key: string; items: ChatItem[] }
  | { type: "working"; key: string; label: string }
  | { type: "rebuild"; key: string };

const isTool = (i: ChatItem) => i.kind === "tool";
export const toolActive = (i: ChatItem) => i.tool?.status === "pending" || i.tool?.status === "in_progress";

/** Turns chat items into rows: consecutive tool calls fold into one row, like bb's bundles. */
export function buildRows(items: ChatItem[], app: App | undefined): Row[] {
  const rows: Row[] = [];
  let run: ChatItem[] = [];
  const flush = () => {
    if (run.length === 1) rows.push({ type: "item", key: run[0].id, item: run[0] });
    else if (run.length > 1) rows.push({ type: "tools", key: `g-${run[0].id}`, items: run });
    run = [];
  };
  for (const item of items) {
    if (isTool(item)) {
      run.push(item);
      continue;
    }
    flush();
    rows.push({ type: "item", key: item.id, item });
  }
  flush();

  const label = workingLabel(items, app);
  if (label) rows.push({ type: "working", key: "working", label });
  else if (turnEndedWithoutBuild(items, app)) rows.push({ type: "rebuild", key: "rebuild" });
  return rows;
}

/**
 * The last turn answered but no build followed (the PC decided nothing changed, or skipped it):
 * offer to build again, so a change never gets stuck on the PC.
 */
function turnEndedWithoutBuild(items: ChatItem[], app: App | undefined): boolean {
  if (!app || app.status !== "idle") return false;
  let lastUser = -1;
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i].kind === "user") {
      lastUser = i;
      break;
    }
  }
  if (lastUser < 0) return false;
  // A build the PC started after this message counts, even before its chat item arrives.
  const asked = Date.parse(items[lastUser].createdAt);
  if (app.latestBuild && Date.parse(app.latestBuild.startedAt) >= asked) return false;
  const after = items.slice(lastUser + 1);
  return after.some((i) => i.kind === "assistant") && !after.some((i) => i.kind === "build");
}

/** bb's "Working" line, shown while the agent is busy but nothing on screen is moving. */
function workingLabel(items: ChatItem[], app: App | undefined): string | null {
  if (!app) return null;
  if (app.status === "creating") return items.length === 0 ? "Setting up your app" : null;
  if (app.status !== "working") return null;
  const last = items[items.length - 1];
  if (!last) return "Working";
  if (last.streaming) return null;
  if (last.kind === "tool" && toolActive(last)) return null;
  if (last.kind === "permission" && !last.permission?.selectedOptionId) return null;
  return "Working";
}

/**
 * One line for a folded run of finished tool rows ("Edited 3 files, ran a command"). Files are
 * counted once each, however often they were edited or read: the same rule and words as the
 * desktop app (desktop/src/renderer/src/chatText.ts summarizeTools).
 */
export function summarizeTools(items: ChatItem[]): string {
  const tools = items.map((i) => i.tool).filter((t): t is NonNullable<ChatItem["tool"]> => !!t);
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

export function seconds(item: ChatItem): number {
  const ms = Date.parse(item.updatedAt) - Date.parse(item.createdAt);
  return Number.isFinite(ms) ? Math.max(0, Math.round(ms / 1000)) : 0;
}

export function duration(s: number): string {
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}
