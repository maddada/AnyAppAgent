import { AppState, PermissionsAndroid, Platform } from "react-native";
import * as Device from "expo-device";
import { AnyAppNative } from "anyapp-native";
import { ApiError, Client, health, pair as pairRequest, pairEasyConnect, UNREACHABLE } from "./api";
import { toBaseUrl } from "./address";
import { decodeEasyConnectCode } from "./easyConnectCode";
import { dialEasyConnect, RouteError, routeBaseUrl, usesEasyConnect } from "./route";
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
  AnyAppNative?.addListener("onNetworkChanged", () => onNetworkChanged());
}

function applyPairing(pairing: Pairing, client?: Client) {
  setState({
    pairing,
    // Easy Connect's base URL is only known once the tunnel is up (connect() dials it).
    client: client ?? (usesEasyConnect(pairing) ? null : new Client(pairing.baseUrl, pairing.token)),
    serverName: pairing.serverName,
    authLost: false,
    routeError: null,
  });
  void connect();
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

/**
 * Easy Connect pairing (docs/EASY-CONNECT.md 4.3): decode the code, open the tunnel with this
 * phone's client key, trade the one-time secret for a token. About 3 s later the PC restarts its
 * helper with this phone on the allow-list, which drops the tunnel once; the socket's reconnect
 * ladder redials it (the contract's "reconnect once after pairing").
 */
export async function pairWithEasyConnect(text: string, onStep?: (step: string) => void): Promise<void> {
  const code = decodeEasyConnectCode(text);
  if (!code) throw new PairError("That isn't an AnyAppAgent code. On your PC, choose Connect a phone and use the code it shows.");
  if (!AnyAppNative || !AnyAppNative.easyConnectAvailable()) {
    throw new PairError("This copy of AnyAppAgent can't use Easy Connect. Connect another way, on the same Wi-Fi.");
  }
  onStep?.(`Reaching ${code.name}…`);
  let clientKey: string;
  let base: string;
  try {
    clientKey = await AnyAppNative.easyConnectClientKey();
    base = await dialEasyConnect(code.address, code.port, true);
  } catch {
    throw new PairError(`Can't reach ${code.name}. Keep AnyAppAgent open on your PC and check that both have internet, then try again.`);
  }
  onStep?.(`Connecting to ${code.name}…`);
  try {
    const deviceName = Device.deviceName ?? Device.modelName ?? "Android phone";
    const res = await pairEasyConnect(base, { secret: code.secret, deviceName, clientKey });
    const pairing: Pairing = { baseUrl: "", via: "easy", easy: { address: code.address, port: code.port }, token: res.token, serverName: res.serverName };
    await savePairing(pairing);
    disconnectSocket();
    setState({ apps: {}, appsLoaded: false, chats: {}, chatLoaded: {}, installs: {} });
    applyPairing(pairing, new Client(base, res.token));
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      throw new PairError("That code is used up. A code works once, for 5 minutes. On your PC, show a new code, then scan it.");
    }
    if (e instanceof ApiError && e.status === 429) throw new PairError("Too many tries. Wait a minute, then try again.");
    if (e instanceof ApiError && !e.unreachable) throw new PairError(e.message);
    throw new PairError(`Reached ${code.name}, but AnyAppAgent there did not answer. Keep it open on your PC and try again.`);
  }
}

export async function unpair() {
  disconnectSocket();
  if (usesEasyConnect(getState().pairing)) await AnyAppNative?.easyConnectStop().catch(() => undefined);
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

// ---------- the socket (over the same network, or through the Easy Connect tunnel)

let socket: WebSocket | null = null;
let connecting = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let healthTimer: ReturnType<typeof setInterval> | null = null;
let attempts = 0;
let healthFailures = 0;
/** The next dial stops the old tunnel first (after a drop, a stall or a network change). */
let resetNextDial = false;
let lastRepair = 0;

// Retry ladders. Same network: 1, 2, 4, 8, 15 s. Easy Connect, from Ghostex: right after a drop the
// PC's helper is usually restarting (a code was made, used or expired), so retry quickly first
// (redialAfterServerStop: 2.5, 2, 2.5, 3, 5, 8 s), then its normal ladder (15, 30 s, repeating).
const LAN_DELAYS = [1000, 2000, 4000, 8000, 15000];
const EASY_DELAYS = [2500, 2000, 2500, 3000, 5000, 8000, 15000, 30000];

async function connect() {
  const pairing = getState().pairing;
  if (!pairing || getState().authLost) return;
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  if (socket || connecting) return;
  connecting = true;
  setState({ connection: "connecting" });
  let client: Client;
  try {
    const reset = resetNextDial;
    resetNextDial = false;
    const base = await routeBaseUrl(pairing, { reset });
    if (getState().pairing !== pairing) return; // disconnected meanwhile
    client = getState().client ?? new Client(base, pairing.token);
    if (client.baseUrl !== base) client = new Client(base, pairing.token);
    if (getState().client !== client) setState({ client });
  } catch (e) {
    connecting = false;
    if (getState().pairing !== pairing) return;
    setState({ connection: "offline", routeError: e instanceof RouteError ? e.message : String(e) });
    resetNextDial = usesEasyConnect(pairing);
    scheduleReconnect();
    return;
  }
  connecting = false;
  if (socket) return;
  const ws = new WebSocket(client.socketUrl());
  socket = ws;
  ws.onopen = () => {
    if (socket !== ws) return;
    attempts = 0;
    healthFailures = 0;
    setState({ connection: "online", routeError: null });
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
    // Through Easy Connect a drop usually means the PC's helper restarted: rebuild the tunnel.
    if (usesEasyConnect(getState().pairing)) resetNextDial = true;
    scheduleReconnect();
  };
  ws.onerror = () => {
    // onclose follows
  };
  startHealthChecks();
}

function scheduleReconnect() {
  if (!getState().pairing || getState().authLost) return;
  if (retryTimer) return;
  attempts++;
  const ladder = usesEasyConnect(getState().pairing) ? EASY_DELAYS : LAN_DELAYS;
  const delay = ladder[Math.min(attempts - 1, ladder.length - 1)];
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void connect();
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

/** Drop the socket (and, through Easy Connect, the tunnel) and dial again at once. */
function repair() {
  const now = Date.now();
  if (now - lastRepair < 5000) return; // Ghostex: at most one repair every 5 s
  lastRepair = now;
  if (usesEasyConnect(getState().pairing)) resetNextDial = true;
  const ws = socket;
  socket = null;
  try {
    ws?.close();
  } catch {
    // ignore
  }
  setState({ connection: "offline" });
  attempts = 0;
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  void connect();
}

/**
 * A socket can look open long after the PC (or the tunnel) went away; a cheap HTTP check with a
 * 5 s timeout notices. Through Easy Connect one miss is enough to rebuild the tunnel (Ghostex's
 * chat link does the same after 5 s of silence); on the same network, two misses.
 */
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
      if (healthFailures >= (usesEasyConnect(getState().pairing) ? 1 : 2)) {
        healthFailures = 0;
        repair();
      }
    }
  }, 15000);
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
  if (!getState().pairing || getState().authLost) return;
  attempts = 0;
  if (socket && getState().connection === "online") {
    void verifyThenResync();
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
  void connect();
}

/** Back in front, or pulled to refresh: check the link really answers before trusting it. */
async function verifyThenResync() {
  const client = getState().client;
  if (!client) return;
  try {
    await health(client.baseUrl);
    void resync();
  } catch {
    repair();
  }
}

/** The phone switched networks: the tunnel's path is gone, redial at once (Ghostex onNetworkChanged). */
function onNetworkChanged() {
  if (!getState().pairing || getState().authLost) return;
  if (usesEasyConnect(getState().pairing)) {
    lastRepair = 0;
    repair();
  } else {
    reconnectNow();
  }
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
