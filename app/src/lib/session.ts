import { AppState, PermissionsAndroid, Platform } from "react-native";
import * as Device from "expo-device";
import { AnyAppNative } from "anyapp-native";
import { ApiError, Client, health, pair as pairRequest, UNREACHABLE } from "./api";
import { toBaseUrl } from "./address";
import type { ChatItem, ServerEvent } from "./protocol";
import {
  getState,
  removeApp,
  replaceChat,
  setApps,
  setState,
  upsertApp,
  upsertChatItems,
} from "./store";
import { loadPairing, loadPrefs, savePairing, savePrefs, type Pairing, type Prefs } from "./storage";
import { autoInstallIfNew, onApkReady, refreshPackages, resumePendingInstall } from "./installer";
import { updateKeepAlive } from "./keepalive";

// ---------- startup, pairing

export async function boot() {
  const [pairing, prefs] = await Promise.all([loadPairing(), loadPrefs()]);
  setState({ prefs, ready: true });
  if (pairing) applyPairing(pairing);
  AppState.addEventListener("change", (state) => {
    if (state === "active") onForeground();
  });
}

function applyPairing(pairing: Pairing) {
  setState({
    pairing,
    client: new Client(pairing.baseUrl, pairing.token),
    serverName: pairing.serverName,
    authLost: false,
  });
  connect();
}

export class PairError extends Error {}

/** Checks the PC is there, then trades the 6-digit code for a token. */
export async function pairWith(address: string, code: string): Promise<void> {
  const baseUrl = toBaseUrl(address);
  if (!baseUrl) throw new PairError("That address doesn't look right. It looks like 192.168.1.20:8787.");
  try {
    await health(baseUrl);
  } catch {
    throw new PairError(`Can't find your PC at ${address.trim()}. Check that AnyAppAgent is running on it and that both are on the same Wi-Fi.`);
  }
  try {
    const deviceName = Device.deviceName ?? Device.modelName ?? "Android phone";
    const res = await pairRequest(baseUrl, { code, deviceName });
    const pairing: Pairing = { baseUrl, token: res.token, serverName: res.serverName };
    await savePairing(pairing);
    disconnectSocket();
    setState({ apps: {}, appsLoaded: false, chats: {}, chatLoaded: {}, installs: {} });
    applyPairing(pairing);
  } catch (e) {
    if (e instanceof ApiError && !e.unreachable) {
      if (e.status === 400 || e.status === 401 || e.status === 403 || e.status === 404) {
        throw new PairError(e.message && !e.message.startsWith("Your PC answered") ? e.message : "That code didn't work. Check the code on your PC and try again.");
      }
      throw new PairError(e.message);
    }
    throw new PairError(UNREACHABLE);
  }
}

export async function unpair() {
  disconnectSocket();
  await savePairing(null);
  AnyAppNative?.stopKeepAlive();
  setState({
    pairing: null,
    client: null,
    serverName: null,
    connection: "offline",
    apps: {},
    appsLoaded: false,
    chats: {},
    chatLoaded: {},
    installs: {},
    authLost: false,
  });
}

export function updatePrefs(change: Partial<Prefs>) {
  const prefs = { ...getState().prefs, ...change };
  setState({ prefs });
  void savePrefs(prefs);
}

/**
 * Notifications: asked at the first moment it matters (the first prompt). If the question was
 * only dismissed (no real answer), it is asked once more next time; Android allows two asks.
 */
export async function askForNotificationsOnce() {
  const { prefs } = getState();
  if (Platform.OS !== "android" || Platform.Version < 33 || prefs.askedNotifications || prefs.notificationAsks >= 2) return;
  updatePrefs({ notificationAsks: prefs.notificationAsks + 1 });
  try {
    const result = await PermissionsAndroid.request("android.permission.POST_NOTIFICATIONS" as never);
    if (result !== "denied") updatePrefs({ askedNotifications: true });
  } catch {
    // ignore
  }
}

// ---------- the socket

let socket: WebSocket | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let healthTimer: ReturnType<typeof setInterval> | null = null;
let attempts = 0;
let healthFailures = 0;

function connect() {
  const client = getState().client;
  if (!client) return;
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  if (socket) return;
  setState({ connection: "connecting" });
  const ws = new WebSocket(client.socketUrl());
  socket = ws;
  ws.onopen = () => {
    if (socket !== ws) return;
    attempts = 0;
    healthFailures = 0;
    setState({ connection: "online" });
    void resync();
  };
  ws.onmessage = (event) => {
    if (socket !== ws) return;
    try {
      handleEvent(JSON.parse(String(event.data)) as ServerEvent);
    } catch {
      // ignore a malformed frame
    }
  };
  ws.onclose = () => {
    if (socket !== ws) return;
    socket = null;
    setState({ connection: "offline" });
    scheduleReconnect();
  };
  ws.onerror = () => {
    // onclose follows
  };
  startHealthChecks();
}

function scheduleReconnect() {
  if (!getState().client || getState().authLost) return;
  if (retryTimer) return;
  attempts++;
  const delay = Math.min(1000 * 2 ** Math.min(attempts - 1, 4), 15000);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    connect();
    // The socket API can't tell "wrong token" from "PC is off"; ask over HTTP (first failure, then every third).
    if (attempts === 1 || attempts % 3 === 0) void checkAuth();
  }, delay);
}

function disconnectSocket() {
  const ws = socket;
  socket = null;
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  if (healthTimer) clearInterval(healthTimer);
  healthTimer = null;
  try {
    ws?.close();
  } catch {
    // ignore
  }
}

/** A socket can look open long after the PC went away; a cheap HTTP check notices. */
function startHealthChecks() {
  if (healthTimer) return;
  healthTimer = setInterval(async () => {
    const client = getState().client;
    if (!client || AppState.currentState !== "active" || !socket) return;
    try {
      await health(client.baseUrl);
      healthFailures = 0;
    } catch {
      healthFailures++;
      if (healthFailures >= 2) {
        healthFailures = 0;
        const ws = socket;
        socket = null;
        setState({ connection: "offline" });
        try {
          ws?.close();
        } catch {
          // ignore
        }
        scheduleReconnect();
      }
    }
  }, 20000);
}

async function checkAuth() {
  const client = getState().client;
  if (!client) return;
  try {
    await client.listApps();
  } catch (e) {
    if (e instanceof ApiError && e.unauthorized) onAuthLost();
  }
}

export function onAuthLost() {
  disconnectSocket();
  setState({ authLost: true, connection: "offline" });
}

/** Reconnect now (pull to refresh, retry button, app back in front). */
export function reconnectNow() {
  if (!getState().client || getState().authLost) return;
  attempts = 0;
  if (socket && getState().connection === "online") {
    void resync();
    return;
  }
  if (socket) {
    const ws = socket;
    socket = null;
    try {
      ws.close();
    } catch {
      // ignore
    }
  }
  connect();
}

function onForeground() {
  refreshPackages();
  reconnectNow();
  void resumePendingInstall();
}

function handleEvent(event: ServerEvent) {
  switch (event.type) {
    case "hello":
      setState({ serverName: event.serverName });
      break;
    case "app.updated":
      upsertApp(event.app);
      updateKeepAlive();
      break;
    case "app.deleted":
      removeApp(event.appId);
      updateKeepAlive();
      break;
    case "chat.item":
      upsertChatItems(event.item.appId, [event.item]);
      break;
    case "apk.ready":
      upsertApp(event.app);
      updateKeepAlive();
      void onApkReady(event.app);
      break;
  }
}

/** After (re)connecting: the socket only carries what happens from now on, so catch up. */
async function resync() {
  const client = getState().client;
  if (!client) return;
  try {
    const apps = await client.listApps();
    setApps(apps);
    refreshPackages();
    updateKeepAlive();
    for (const app of apps) void autoInstallIfNew(app);
    void resumePendingInstall();
    const { chatLoaded } = getState();
    await Promise.all(Object.keys(chatLoaded).filter((id) => chatLoaded[id] && apps.some((a) => a.id === id)).map((id) => loadChat(id)));
  } catch (e) {
    if (e instanceof ApiError && e.unauthorized) onAuthLost();
  }
}

/**
 * Loads a chat's whole history. An updated item keeps its seq, so `afterSeq` would miss
 * changes to older items (text that finished streaming, a tool that completed): live updates
 * come over the socket, and after every reconnect the full history is loaded again.
 */
export async function loadChat(appId: string): Promise<void> {
  const client = getState().client;
  if (!client) return;
  let items: ChatItem[];
  try {
    items = await client.messages(appId);
  } catch (e) {
    if (e instanceof ApiError && e.unauthorized) onAuthLost();
    throw e;
  }
  replaceChat(appId, items);
  setState((s) => ({ chatLoaded: { ...s.chatLoaded, [appId]: true } }));
}
