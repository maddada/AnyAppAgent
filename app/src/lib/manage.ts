// Pin, hide and delete (shared/protocol.ts): what the home grid, the app sheet and Settings do.
// Pins and hiding live on the PC, so every phone and the desktop show the same grid.
import { AnyAppNative } from "anyapp-native";
import type { App, DeleteAppResult } from "./protocol";
import { applyPins, canPin, homeSections } from "./pins";
import { clientFor, getState, removeApp, setState, upsertApp } from "./store";
import { CloudClient } from "./cloud";

/** The Pinned section's ids now, in order. */
export function pinnedIds(): string[] {
  return homeSections(getState().apps).pinned.map((a) => a.id);
}

/** Sends the whole Pinned section; the grid moves at once and goes back if the PC says no. */
export async function setPinned(ids: string[]): Promise<void> {
  const client = getState().client;
  if (!client) throw new Error("Your PC is not connected.");
  const before = getState().apps;
  setState({ apps: applyPins(before, ids) });
  try {
    for (const app of await client.setPins(ids)) upsertApp(app);
  } catch (e) {
    // Back to what the PC has (an older PC answers 404: it can't pin yet).
    setState((s) => ({ apps: applyPins(s.apps, homeSections(before).pinned.map((a) => a.id)) }));
    throw e;
  }
}

export function pinApp(app: App): Promise<void> {
  if (!canPin(app)) return Promise.resolve();
  return setPinned([...pinnedIds().filter((id) => id !== app.id), app.id]);
}

export function unpinApp(app: App): Promise<void> {
  return setPinned(pinnedIds().filter((id) => id !== app.id));
}

export async function setHidden(app: App, hidden: boolean): Promise<void> {
  const client = getState().client;
  if (!client) throw new Error("Your PC is not connected.");
  upsertApp(await client.hideApp(app.id, hidden));
}

/** Deletes this phone started, so their app.deleted (uninstall: true) doesn't ask Android twice. */
const ownUninstalls = new Set<string>();

function installed(app: App): boolean {
  return !!getState().packages[app.packageName] || AnyAppNative?.getPackageInfo(app.packageName) != null;
}

/**
 * Delete from the sheet. List only: it waits in Recently deleted. uninstall: Android's uninstall
 * prompt for the copy on this phone. forGood: the PC also deletes its folder, chat and GitHub repos.
 */
export async function deleteApp(app: App, opts: { uninstall: boolean; forGood: boolean }): Promise<DeleteAppResult | undefined> {
  const client = clientFor(app.id);
  if (!client) throw new Error("Your PC is not connected.");
  let result: DeleteAppResult | undefined;
  if (client instanceof CloudClient) {
    await client.deleteApp(app.id);
  } else {
    if (opts.uninstall) ownUninstalls.add(app.id);
    try {
      result = await client.deleteAppWith(app.id, opts);
    } catch (e) {
      ownUninstalls.delete(app.id);
      throw e;
    }
  }
  if (opts.uninstall && installed(app)) AnyAppNative?.requestUninstall(app.packageName);
  removeApp(app.id);
  if (getState().trash) void loadTrash();
  return result;
}

/** app.deleted from the PC: another phone or the desktop deleted it, maybe asking to uninstall it here. */
export function onAppDeleted(appId: string, uninstall: boolean | undefined): void {
  const app = getState().apps[appId];
  const mine = ownUninstalls.delete(appId);
  if (app && uninstall && !mine && installed(app)) AnyAppNative?.requestUninstall(app.packageName);
  removeApp(appId);
}

/** Recently deleted, from the PC. Null on an older PC (it has no bin). */
export async function loadTrash(): Promise<void> {
  const client = getState().client;
  if (!client) return setState({ trash: null });
  try {
    setState({ trash: await client.trash() });
  } catch {
    setState({ trash: null });
  }
}

export async function restoreApp(id: string): Promise<void> {
  const client = getState().client;
  if (!client) throw new Error("Your PC is not connected.");
  upsertApp(await client.restoreDeleted(id));
  setState((s) => ({ trash: s.trash ? s.trash.filter((a) => a.id !== id) : s.trash }));
}

export async function emptyTrash(): Promise<void> {
  const client = getState().client;
  if (!client) throw new Error("Your PC is not connected.");
  await client.emptyTrash();
  setState({ trash: [] });
}
