import { create } from "zustand";
import type { PackageInfo } from "anyapp-native";
import { appAction as sharedAppAction, Drafts, mergeHelpers, mergeItems, replaceHistory } from "@shared/chat/index";
import type { Attachment } from "@/chat/attachments";
import { Client } from "./api";
import { CloudClient, isCloudApp, isCloudId, type AppClient } from "./cloud";
import type { App, CareState, ChatItem, Suggestion, TodoItem, WorkerInfo } from "./protocol";
import { defaultPrefs, type Pairing, type Prefs } from "./storage";

export type Connection = "offline" | "connecting" | "online";

/** The Kiwimake account (Convex accounts:me), when signed in. */
export interface Account {
  id: string;
  name: string | null;
  email: string | null;
  anonymous: boolean;
  cloud: { added: boolean; since: number | null; github: { login: string; connected: boolean } | null };
  pcOffSwitch: boolean;
  plan: { id: "free" | "starter" | "pro" | "max" | "ownKey"; name: string; interval?: "month" | "year"; status?: string; renewsAt?: number; cancelAtPeriodEnd?: boolean };
  credits: number;
  pcs: { id: string; name: string; linkedFrom: string; lastSeenAt: number | null }[];
}

/** Signed in to the account (Convex Auth): "off" when this build has no cloud. */
export type CloudAuth = "off" | "loading" | "signedOut" | "signedIn";

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
  quick?: boolean; // a quick update (docs/FAST-LANE.md): handed to the app, no install
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
  suggestions: Record<string, Suggestion[]>; // appId -> "From others" (docs/CHANGE-THIS-APP.md), loaded when opened
  packages: Record<string, PackageInfo | null>; // packageName -> installed info
  installs: Record<string, InstallProgress>; // appId -> install in progress or last result
  needInstallPermission: string | null; // appId waiting for "install unknown apps"
  /** The usage meter, the monthly health reminder and the backup (docs/TRUST.md); null on older PCs. */
  care: CareState | null;
  /** The cloud (docs/CLOUD.md): sign-in state, the account, the client for cloud apps. */
  cloudAuth: CloudAuth;
  account: Account | null;
  cloudClient: CloudClient | null;
  cloudAppsLoaded: boolean;
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
  suggestions: {},
  care: null,
  packages: {},
  installs: {},
  needInstallPermission: null,
  cloudAuth: "off",
  account: null,
  cloudClient: null,
  cloudAppsLoaded: false,
}));

export const getState = useStore.getState;
export const setState = useStore.setState;

// ---------- apps

/** Where an app is made: "cloud" apps come from the account, the others from the paired PC. */
export function placeOf(app: Pick<App, "id" | "cloud">): "cloud" | "pc" {
  return isCloudApp(app) ? "cloud" : "pc";
}

/**
 * One place's whole list (the PC's after a resync, the cloud's from its live query): the other
 * place's apps stay as they are (one grid, docs/CLOUD.md "One grid").
 */
export function setApps(list: App[], place: "pc" | "cloud" = "pc") {
  setState((s) => {
    const apps: Record<string, App> = {};
    for (const app of Object.values(s.apps)) if (placeOf(app) !== place) apps[app.id] = app;
    for (const app of list) apps[app.id] = app;
    return place === "pc" ? { apps, appsLoaded: true } : { apps, cloudAppsLoaded: true };
  });
}

/** Forgets one place's apps (unpairing the PC, signing out of the cloud). */
export function dropPlace(place: "pc" | "cloud") {
  setState((s) => {
    const apps: Record<string, App> = {};
    for (const app of Object.values(s.apps)) if (placeOf(app) !== place) apps[app.id] = app;
    return { apps };
  });
}

/** The client for one app: the cloud's for a cloud app, the PC's otherwise. */
export function clientFor(appId: string): AppClient | null {
  const s = getState();
  return isCloudId(appId) ? s.cloudClient : s.client;
}

/** Can this app's place take a message now: the PC connected, or the account signed in. */
export function useOnlineFor(appId: string | undefined): boolean {
  return useStore((s) => (appId && isCloudId(appId) ? s.cloudAuth === "signedIn" : s.connection === "online"));
}

/** The same, as a hook (it follows sign-in and pairing). */
export function useClientFor(appId: string | undefined): AppClient | null {
  const pc = useStore((s) => s.client);
  const cloud = useStore((s) => s.cloudClient);
  if (!appId) return pc;
  return isCloudId(appId) ? cloud : pc;
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

export function setSuggestions(appId: string, list: Suggestion[]) {
  setState((s) => ({ suggestions: { ...s.suggestions, [appId]: list } }));
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
