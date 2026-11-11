// Turning the timeline into the rows both apps draw: runs of tool calls fold into one row (bb's
// bundles), and the "Working" and "No new version" lines are added at the end when they apply.
import type { App, ChatItem } from "../protocol.ts";
import { summarizeTools, toolActive } from "./tools.ts";

export type Row =
  | { type: "item"; key: string; item: ChatItem }
  /** Two or more tool calls in a row. Folded into `summary` once none is active; while one is, every row shows. */
  | { type: "tools"; key: string; items: ChatItem[]; active: boolean; failed: boolean; summary: string }
  | { type: "working"; key: string; label: string }
  | { type: "rebuild"; key: string };

/** How long the "No new version this time" line waits after the turn ends (a build may still be on its way). */
export const REBUILD_SETTLE_MS = 5000;

export function buildRows(items: readonly ChatItem[], app: App | undefined): Row[] {
  const rows: Row[] = [];
  let run: ChatItem[] = [];
  const flush = () => {
    if (run.length === 1) rows.push({ type: "item", key: run[0].id, item: run[0] });
    else if (run.length > 1) {
      rows.push({
        type: "tools",
        key: `g-${run[0].id}`,
        items: run,
        active: run.some(toolActive),
        failed: run.some((i) => i.tool?.status === "failed"),
        summary: summarizeTools(run),
      });
    }
    run = [];
  };
  for (const item of items) {
    if (item.kind === "tool") {
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
export function turnEndedWithoutBuild(items: readonly ChatItem[], app: App | undefined): boolean {
  if (!app || app.status !== "idle") return false;
  let lastUser = -1;
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i].kind === "user" && !items[i].dropped) {
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
export function workingLabel(items: readonly ChatItem[], app: App | undefined): string | null {
  if (!app) return null;
  if (app.status === "creating") return items.length === 0 ? "Setting up your app" : null;
  if (app.status !== "working") return null;
  // Queued messages wait at the end of the timeline; what moves is the item before them.
  let end = items.length - 1;
  while (end >= 0 && items[end].kind === "user" && items[end].queued) end--;
  const last = items[end];
  if (!last) return "Working";
  if (last.streaming) return null;
  if (last.kind === "tool" && toolActive(last)) return null;
  if (last.kind === "permission" && !last.permission?.selectedOptionId) return null;
  return "Working";
}

/** The small line under a user's message: waiting in the queue, or dropped by Stop. */
export function userNote(item: ChatItem): { kind: "queued" | "dropped"; text: string } | null {
  if (item.kind !== "user") return null;
  if (item.dropped) return { kind: "dropped", text: "Not sent, you stopped the agent" };
  if (item.queued) return { kind: "queued", text: "Queued, sends when the agent is free" };
  return null;
}
