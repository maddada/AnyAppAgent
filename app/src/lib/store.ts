import { create } from "zustand";
import type { PackageInfo } from "anyapp-native";
import { appAction as sharedAppAction, Drafts, mergeHelpers, mergeItems, replaceHistory } from "@shared/chat/index";
import type { Attachment } from "@/chat/attachments";
import { Client } from "./api";
import type { App, ChatItem, TodoItem, WorkerInfo } from "./protocol";
import { defaultPrefs, type Pairing, type Prefs } from "./storage";

export type Connection = "offline" | "connecting" | "online";

export interface InstallProgress {
  buildNumber: number;
  phase: "waiting" | "downloading" | "checking" | "installing" | "confirm" | "done" | "failed";
  progress?: number; // 0..1 while downloading
  bytesWritten?: number; // while downloading: bytes on the phone already
  totalBytes?: number; // while downloading: the whole download
  waitingFor?: string; // while waiting: the app installing before this one
  retrying?: boolean; // while downloading: the link stalled or dropped; reconnecting to carry on
  message?: string; // shown when failed
  conflict?: boolean; // signed differently from the installed app: offer to remove it first
}

export interface State {
  ready: boolean; // pairing and prefs loaded from storage
  pairing: Pairing | null;
  client: Client | null;
  prefs: Prefs;
  connection: Connection;
  /** Why the last Easy Connect dial failed (bridge text, address scrubbed), for Settings. */
  routeError: string | null;
  serverName: string | null;
  authLost: boolean;

  apps: Record<string, App>;
  appsLoaded: boolean;
  chats: Record<string, ChatItem[]>; // sorted by seq
  chatLoaded: Record<string, boolean>;
  helpers: Record<string, WorkerInfo[]>; // appId -> its helpers, in the order they started
  helperChats: Record<string, ChatItem[]>; // workerId -> that helper's own chat, sorted by seq
  helperChatLoaded: Record<string, boolean>;
  todos: Record<string, TodoItem[]>; // appId -> the person's own to-do list (loaded when opened)
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
  routeError: null,
  serverName: null,
  authLost: false,
  apps: {},
  appsLoaded: false,
  chats: {},
  chatLoaded: {},
  helpers: {},
  helperChats: {},
  helperChatLoaded: {},
  todos: {},
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
  setState((s) => ({ chats: { ...s.chats, [appId]: mergeItems(s.chats[appId] ?? [], incoming) } }));
}

/** The server's full history wins; keep any newer item that arrived over the socket meanwhile. */
export function replaceChat(appId: string, items: ChatItem[]) {
  setState((s) => ({ chats: { ...s.chats, [appId]: replaceHistory(s.chats[appId] ?? [], items) } }));
}

// ---------- helpers

export function upsertHelpers(appId: string, incoming: WorkerInfo[]) {
  if (incoming.length === 0) return;
  setState((s) => ({ helpers: { ...s.helpers, [appId]: mergeHelpers(s.helpers[appId] ?? [], incoming) } }));
}

export function upsertHelperItems(workerId: string, incoming: ChatItem[]) {
  if (incoming.length === 0) return;
  setState((s) => ({ helperChats: { ...s.helperChats, [workerId]: mergeItems(s.helperChats[workerId] ?? [], incoming) } }));
}

export function replaceHelperChat(workerId: string, items: ChatItem[]) {
  setState((s) => ({
    helperChats: { ...s.helperChats, [workerId]: replaceHistory(s.helperChats[workerId] ?? [], items) },
    helperChatLoaded: { ...s.helperChatLoaded, [workerId]: true },
  }));
}

// ---------- to-do

export function setTodos(appId: string, todos: TodoItem[]) {
  setState((s) => ({ todos: { ...s.todos, [appId]: todos } }));
}

/** What the user typed but did not send yet, per app, kept while they move between apps. */
export const drafts = new Drafts<Attachment>();

// ---------- installs

export function setInstall(appId: string, progress: InstallProgress | null) {
  setState((s) => {
    const installs = { ...s.installs };
    if (progress) installs[appId] = progress;
    else delete installs[appId];
    return { installs };
  });
}

/** What the big button for an app should do right now (shared/chat/state.ts). */
export type AppAction = "open" | "install" | "update" | "notReady";

export function appAction(app: App, pkg: PackageInfo | null | undefined): AppAction {
  return sharedAppAction(app, pkg?.versionCode ?? null);
}
