// Quick Settings tiles (declared in app.json, see modules/abilities/app.plugin.js). A tap runs
// the tile's action in the background ("run"), opens the app with it ("open"), or switches the
// tile on and off and then runs it with data.on ("toggle").
import { native } from './native';

/** Changes what tile [id] shows. Leave a field out to keep it; subtitle "" clears it. */
export function updateTile(id: string, change: { label?: string; subtitle?: string; on?: boolean }): void {
  native.updateTile(id, change.label ?? null, change.subtitle ?? null, change.on ?? null);
}

/** Whether toggle tile [id] is on. */
export function isTileOn(id: string): boolean {
  return native.isTileOn(id);
}
