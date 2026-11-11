// The chat timeline as data: merging the companion's ChatItem stream (upsert by id, ordered by seq).
// Shared by the phone app (app/) and the desktop app (desktop/). Plain TypeScript, no imports
// beyond the wire types, no platform APIs.
import type { ChatItem } from "../protocol.ts";

/**
 * Upserts items into a timeline that is sorted by seq. An item with a known id replaces the old
 * one in place (an update keeps its seq); a new one is inserted in seq order, usually at the end.
 * Returns the same array when nothing changed, so React can skip a render.
 */
export function mergeItems(list: readonly ChatItem[], incoming: readonly ChatItem[]): ChatItem[] {
  if (incoming.length === 0) return list as ChatItem[];
  const next = [...list];
  for (const item of incoming) {
    const at = next.findIndex((x) => x.id === item.id);
    if (at >= 0) {
      next[at] = item;
      continue;
    }
    let i = next.length;
    while (i > 0 && next[i - 1].seq > item.seq) i--;
    next.splice(i, 0, item);
  }
  return next;
}

/**
 * The companion's full history wins over what is on screen, except items that arrived over the
 * socket after the history was read (newer seq, not in the history yet): those are kept.
 */
export function replaceHistory(current: readonly ChatItem[], history: readonly ChatItem[]): ChatItem[] {
  const sorted = [...history].sort((a, b) => a.seq - b.seq);
  const ids = new Set(sorted.map((i) => i.id));
  const maxSeq = sorted.length ? sorted[sorted.length - 1].seq : -1;
  const newer = current.filter((i) => !ids.has(i.id) && i.seq > maxSeq);
  return [...sorted, ...newer];
}

/** The newest seq in a timeline (the afterSeq to ask the companion for), or 0 when empty. */
export function lastSeq(list: readonly ChatItem[]): number {
  return list.length ? list[list.length - 1].seq : 0;
}
