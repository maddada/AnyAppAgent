// Pin, hide and delete (shared/protocol.ts): the home grid's two sections and the moves a drag
// makes. Pure functions, no React: dev/pins.test.mjs runs them with `node --test`.
import type { App } from "./protocol";

/** Cloud apps (id from the cloud, 32 hex) can't be pinned: pins live on the PC. */
export function canPin(app: Pick<App, "id" | "cloud">): boolean {
  return !app.cloud && !/^[a-z0-9]{32}$/.test(app.id);
}

/** The grid's apps: what the person sees (not hidden, not a read-only copy, not the cloud's row of a PC app). */
export function visibleApps(apps: Record<string, App>): App[] {
  return Object.values(apps)
    .filter((a) => !a.hidden)
    // A PC copy that moved to the cloud is read-only there; the grid shows the cloud's app instead.
    .filter((a) => !(a.move?.to === "cloud" && a.move.state === "done"))
    // The cloud's row of a PC app (a change while the PC is off) opens from its chat, not the grid.
    .filter((a) => !(a.cloud?.place === "pc" && /^[a-z0-9]{32}$/.test(a.id)));
}

/** Pinned apps in their order, then the rest, last changed first. */
export function homeSections(apps: Record<string, App>): { pinned: App[]; rest: App[] } {
  const all = visibleApps(apps);
  const pinned = all.filter((a) => a.pin !== undefined && canPin(a)).sort((a, b) => a.pin! - b.pin!);
  const rest = all.filter((a) => !(a.pin !== undefined && canPin(a))).sort(byLastChange);
  return { pinned, rest };
}

export function byLastChange(a: Pick<App, "updatedAt">, b: Pick<App, "updatedAt">): number {
  return a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0;
}

/**
 * The Pinned section after a move: `id` put at `index` (pinning it if it was not pinned), or
 * unpinned when index is null. Index past the end means last.
 */
export function movePin(pinnedIds: readonly string[], id: string, index: number | null): string[] {
  const without = pinnedIds.filter((x) => x !== id);
  if (index === null) return without;
  const at = Math.max(0, Math.min(index, without.length));
  return [...without.slice(0, at), id, ...without.slice(at)];
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Where in a grid a point would insert, 0..slots.length: before the slot under it (or the nearest
 * one) when on its left half, after it when on its right half; below the last row means last.
 * -1 when there are no slots.
 */
export function slotAt(slots: readonly Rect[], x: number, y: number): number {
  if (slots.length === 0) return -1;
  const last = slots[slots.length - 1]!;
  if (y > last.y + last.height) return slots.length;
  let best = slots.findIndex((r) => x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height);
  if (best < 0) {
    // The nearest slot in the finger's row (a gap between tiles, the empty place after the last
    // tile), else the nearest of all.
    const inRow = slots.some((r) => y >= r.y && y <= r.y + r.height);
    let bestDistance = Infinity;
    slots.forEach((r, i) => {
      if (inRow && !(y >= r.y && y <= r.y + r.height)) return;
      const d = (r.x + r.width / 2 - x) ** 2 + (r.y + r.height / 2 - y) ** 2;
      if (d < bestDistance) {
        bestDistance = d;
        best = i;
      }
    });
  }
  const r = slots[best]!;
  return x > r.x + r.width / 2 ? best + 1 : best;
}

/**
 * The Pinned section after a drop at insertion point `at` (slotAt over the section as it was when
 * the drag started), or after a drop outside it (null: unpinned).
 */
export function dropPin(pinnedIds: readonly string[], id: string, at: number | null): string[] {
  if (at === null) return movePin(pinnedIds, id, null);
  const from = pinnedIds.indexOf(id);
  return movePin(pinnedIds, id, from >= 0 && at > from ? at - 1 : at);
}

/** Writes a new Pinned section into the apps (pin numbers), as the PC will. */
export function applyPins(apps: Record<string, App>, ids: readonly string[]): Record<string, App> {
  const next: Record<string, App> = {};
  for (const [key, app] of Object.entries(apps)) {
    const index = ids.indexOf(app.id);
    if (index >= 0) next[key] = app.pin === index ? app : { ...app, pin: index };
    else if (app.pin !== undefined) {
      const { pin: _drop, ...rest } = app;
      next[key] = rest;
    } else next[key] = app;
  }
  return next;
}
