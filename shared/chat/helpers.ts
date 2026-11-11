// Helpers (docs/APP-COORDINATOR.md): the main chat hands real work to helpers, each shown as one row
// in the main chat that opens the helper's own chat (read only, with its own Stop). The wire calls
// them workers (WorkerInfo); everything the person sees says "helper". Shared by the phone app and
// the desktop app; each draws these with its own views.
import type { App, ChatItem, WorkerInfo } from "../protocol.ts";
import { buildRows, type Row } from "./rows.ts";
import type { StateText } from "./state.ts";

/** The app's chat hands work to helpers (the PC says so by setting activeHelpers, 0 or more). */
export function usesHelpers(app: App | undefined): boolean {
  return typeof app?.activeHelpers === "number";
}

/**
 * The main chat itself is answering now, so its Stop applies and a new message waits its turn.
 * With helpers the app can be "working" while only helpers work: that is not the main chat.
 */
export function mainChatReplying(app: App | undefined): boolean {
  if (!app) return false;
  if (typeof app.replying === "boolean" && usesHelpers(app)) return app.replying;
  return app.status === "working";
}

/** The header's words for helpers at work, or null when none are. */
export function helpersAtWork(app: App | undefined): string | null {
  const n = app?.activeHelpers ?? 0;
  if (n <= 0) return null;
  return n === 1 ? "1 helper at work" : `${n} helpers at work`;
}

export type HelperIcon = "clock" | "pen" | "search" | "merge" | "package" | "check" | "alert" | "square";

export interface HelperView {
  title: string;
  /** The state line under the title: a mark and a word (the theme's four states). */
  state: StateText;
  /** The helper's latest line: its current step while it works, its result once it is done. */
  latest?: string;
  icon: HelperIcon;
  /** Waiting, working or building. */
  active: boolean;
}

const COMBINING = /^Fitting its change together/;

/** How one helper row reads (the approved mockup, docs/mockups/worker-chat.html). */
export function helperView(w: WorkerInfo): HelperView {
  const view = helperViewOf(w);
  // A latest line that only repeats the state ("Stopped" under "Stopped") is left out.
  if (view.latest && view.latest.trim().toLowerCase() === view.state.label.toLowerCase()) delete view.latest;
  return view;
}

function helperViewOf(w: WorkerInfo): HelperView {
  const base = { title: w.title, ...(w.latest ? { latest: w.latest } : {}) };
  switch (w.state) {
    case "waiting":
      return { ...base, state: { kind: "idle", label: "Waiting to add its change" }, icon: "clock", active: true };
    case "working":
      if (w.latest && COMBINING.test(w.latest)) return { ...base, state: { kind: "working", label: "Combining changes" }, icon: "merge", active: true };
      return { ...base, state: { kind: "working", label: "Working" }, icon: w.changesApp ? "pen" : "search", active: true };
    case "building":
      return { ...base, state: { kind: "working", label: "Building the new version" }, icon: "package", active: true };
    case "done":
      return { ...base, state: { kind: "ready", label: w.buildNumber ? `Done, in version ${w.buildNumber}` : "Done" }, icon: w.changesApp ? "check" : "search", active: false };
    case "failed":
      return { ...base, state: { kind: "problem", label: "Ran into a problem" }, icon: "alert", active: false };
    case "stopped":
      return { ...base, state: { kind: "idle", label: "Stopped" }, icon: "square", active: false };
  }
}

/** Upserts helpers by id, keeping the order they were started in. Same array when nothing changed. */
export function mergeHelpers(list: readonly WorkerInfo[], incoming: readonly WorkerInfo[]): WorkerInfo[] {
  if (incoming.length === 0) return list as WorkerInfo[];
  const next = [...list];
  for (const w of incoming) {
    const at = next.findIndex((x) => x.id === w.id);
    if (at >= 0) next[at] = w;
    else next.push(w);
  }
  next.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return next;
}

/** The line at the bottom of a helper's chat, where the main chat has its composer. */
export const HELPER_CHAT_FOOTER = "To change what this helper does, tell the main chat.";

/** The label of the card that holds what a helper was asked (its first message is its task). */
export const HELPER_TASK_LABEL = "Task from the main chat";
export const HELPER_FOLLOW_UP_LABEL = "From the main chat";

/**
 * A helper's own chat as rows: the main chat's rows, except that what the helper was told shows as
 * a task card (its task first, then follow-ups the main chat sent it), and a Working line follows
 * while the helper is busy and nothing on screen moves.
 */
export function helperChatRows(items: readonly ChatItem[], worker: WorkerInfo | undefined): Row[] {
  const rows = buildRows(items, undefined);
  let first = true;
  const out: Row[] = rows.map((row) => {
    if (row.type === "item" && row.item.kind === "user") {
      const task: Row = { type: "task", key: row.key, label: first ? HELPER_TASK_LABEL : HELPER_FOLLOW_UP_LABEL, text: row.item.text ?? "" };
      first = false;
      return task;
    }
    return row;
  });
  if (worker && helperView(worker).active) {
    const last = items[items.length - 1];
    const moving = !!last && (last.streaming || (last.kind === "tool" && (last.tool?.status === "pending" || last.tool?.status === "in_progress")));
    if (!moving) out.push({ type: "working", key: "working", label: helperView(worker).state.label });
  }
  return out;
}
