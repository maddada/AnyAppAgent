import { create } from "zustand";
import type { PackageInfo } from "anyapp-native";
import { Client } from "./api";
import type { App, ChatItem } from "./protocol";
import { defaultPrefs, type Pairing, type Prefs } from "./storage";

export type Connection = "offline" | "connecting" | "online";

export interface InstallProgress {
  buildNumber: number;
  phase: "waiting" | "downloading" | "checking" | "installing" | "confirm" | "done" | "failed";
  progress?: number; // 0..1 while downloading
  message?: string; // shown when failed
  conflict?: boolean; // signed differently from the installed app: offer to remove it first
}

export interface State {
  ready: boolean; // pairing and prefs loaded from storage
  pairing: Pairing | null;
  client: Client | null;
  prefs: Prefs;
  connection: Connection;
  serverName: string | null;
  authLost: boolean;

  apps: Record<string, App>;
  appsLoaded: boolean;
  chats: Record<string, ChatItem[]>; // sorted by seq
  chatLoaded: Record<string, boolean>;
  packages: Record<string, PackageInfo | null>; // packageName -> installed info
  installs: Record<string, InstallProgress>; // appId -> install in progress or last result
  needInstallPermission: string | null; // appId waiting for "install unknown apps"
}

export const useStore = create<State>(() => ({
  ready: false,
  pairing: null,
  client: null,
  prefs: defaultPrefs,
  connection: "offline",
  serverName: null,
  authLost: false,
  apps: {},
  appsLoaded: false,
  chats: {},
  chatLoaded: {},
  packages: {},
  installs: {},
  needInstallPermission: null,
}));

export const getState = useStore.getState;
export const setState = useStore.setState;

// ---------- apps

export function setApps(list: App[]) {
  const apps: Record<string, App> = {};
  for (const app of list) apps[app.id] = app;
  setState({ apps, appsLoaded: true });
}

export function upsertApp(app: App) {
  setState((s) => ({ apps: { ...s.apps, [app.id]: app } }));
}

export function removeApp(appId: string) {
  setState((s) => {
    const apps = { ...s.apps };
    delete apps[appId];
    const chats = { ...s.chats };
    delete chats[appId];
    return { apps, chats };
  });
}

/** Newest first, by last change. */
export function sortedApps(apps: Record<string, App>): App[] {
  return Object.values(apps).sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}

// ---------- chat

export function upsertChatItems(appId: string, incoming: ChatItem[]) {
  if (incoming.length === 0) return;
  setState((s) => {
    const list = [...(s.chats[appId] ?? [])];
    for (const item of incoming) {
      const at = list.findIndex((x) => x.id === item.id);
      if (at >= 0) {
        list[at] = item;
      } else {
        // Usually appended at the end; insert in seq order otherwise.
        let i = list.length;
        while (i > 0 && list[i - 1].seq > item.seq) i--;
        list.splice(i, 0, item);
      }
    }
    return { chats: { ...s.chats, [appId]: list } };
  });
}

/** The server's full history wins; keep any newer item that arrived over the socket meanwhile. */
export function replaceChat(appId: string, items: ChatItem[]) {
  const sorted = [...items].sort((a, b) => a.seq - b.seq);
  const ids = new Set(sorted.map((i) => i.id));
  const maxSeq = sorted.length ? sorted[sorted.length - 1].seq : -1;
  const newer = (getState().chats[appId] ?? []).filter((i) => !ids.has(i.id) && i.seq > maxSeq);
  setState((s) => ({ chats: { ...s.chats, [appId]: [...sorted, ...newer] } }));
}

// ---------- installs

export function setInstall(appId: string, progress: InstallProgress | null) {
  setState((s) => {
    const installs = { ...s.installs };
    if (progress) installs[appId] = progress;
    else delete installs[appId];
    return { installs };
  });
}

/** What the big button for an app should do right now. */
export type AppAction = "open" | "install" | "update" | "notReady";

export function appAction(app: App, pkg: PackageInfo | null | undefined): AppAction {
  const latest = app.latestApk?.number;
  if (!pkg) return latest ? "install" : "notReady";
  if (latest && latest > pkg.versionCode) return "update";
  return "open";
}
