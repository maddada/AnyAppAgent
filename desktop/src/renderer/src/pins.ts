// Pin, hide and delete on the Apps page: the two sections of the list and the new pin order after
// a drop. Plain functions (no React), tested in test/pins.test.ts.
import type { App } from "../../../../shared/protocol.ts";

/** The app list as the Apps page shows it: Pinned (in pin order), then the rest (last changed first). Hidden apps are left out. */
export function appSections(apps: readonly App[]): { pinned: App[]; rest: App[] } {
  const shown = apps.filter((a) => !a.hidden);
  const pinned = shown.filter((a) => a.pin !== undefined).sort((a, b) => a.pin! - b.pin! || a.name.localeCompare(b.name));
  const rest = shown.filter((a) => a.pin === undefined).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return { pinned, rest };
}

/** Where a drop lands among rows whose vertical middles are `mids` (top to bottom): 0 before the first, mids.length after the last. */
export function dropIndex(mids: readonly number[], y: number): number {
  let i = 0;
  while (i < mids.length && y > mids[i]) i++;
  return i;
}

/**
 * The Pinned section after `id` is dropped at slot `index` (0..ids.length, counted in `ids` as it is
 * now, the dragged app included when it is already pinned). An app from the rest of the list is pinned there.
 */
export function placePin(ids: readonly string[], id: string, index: number): string[] {
  const from = ids.indexOf(id);
  let at = Math.max(0, Math.min(index, ids.length));
  if (from >= 0 && from < at) at--;
  const next = ids.filter((x) => x !== id);
  next.splice(at, 0, id);
  return next;
}

/** The Pinned section without `id`. */
export function unpin(ids: readonly string[], id: string): string[] {
  return ids.filter((x) => x !== id);
}

/** True when two pin orders are the same (nothing to send). */
export function samePins(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}
