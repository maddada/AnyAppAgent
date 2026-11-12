import { answerDiaryRequest, sendCrashes, startReports } from "./reports";
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
  upsertHelperItems,
  setTodos,
  setSuggestions,
  useStore,
  upsertHelpers,
  replaceHelperChat,
} from "./store";
import { loadPairing, loadPrefs, savePairing, savePrefs, type Pairing, type Prefs } from "./storage";
import { autoInstallIfNew, installerHooks, onApkReady, onAppReport, refreshPackages, resumePendingInstall, resumeUnfinishedInstalls } from "./installer";
import { updateKeepAlive } from "./keepalive";

// ---------- startup, pairing

export async function boot() {
  startReports();
  const [pairing, prefs] = await Promise.all([loadPairing(), loadPrefs()]);
  setState({ prefs });
  // Pairing first, then ready: a cold start straight into a screen that needs the pairing (the
  // anyappagent://settings link apps open for "AI for your apps") must never render without it.
  if (pairing) applyPairing(pairing);
  setState({ ready: true });
  AppState.addEventListener("change", (state) => {
    if (state === "active") onForeground();
  });
  bootedAt = Date.now();
  // A download that stalled or dropped has the link checked (and the tunnel rebuilt) before it resumes.
  installerHooks.linkTrouble = () => reconnectNow();
  startUnpairRetries();
  AnyAppNative?.addListener("onNetworkChanged", () => onNetworkChanged());
  AnyAppNative?.addListener("onAppReport", (e) => onAppReport(e.packageName));
  // "Change this app" (docs/CHANGE-THIS-APP.md): apps ask Kiwimake whether they are this
  // person's own, so their row shows even when hidden from others. Kept in step with the app list.
  let ownKey = "";
  const syncOwn = (apps: Record<string, { packageName: string }>) => {
    const list = Object.values(apps).map((a) => a.packageName).sort();
    const key = list.join(",");
    if (key === ownKey) return;
    ownKey = key;
    try {
      AnyAppNative?.setOwnApps?.(list);
    } catch {
      // an older native module: the rows follow the owner's switch only
    }
  };
  syncOwn(getState().apps);
  useStore.subscribe((s) => syncOwn(s.apps));
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

/**
 * The name the PC shows for this phone: the name the user gave the phone when Android has one
 * (Settings, About phone, Device name), otherwise maker and model ("Pixel 8", "Samsung SM-S918B"),
 * and "Android emulator" for an emulator, never a build code like "sdk_gphone64_x86_64".
 */
export function friendlyDeviceName(): string {
  const saved = getState().prefs.deviceName;
  if (saved) return saved;
  const name = pickDeviceName();
  updatePrefs({ deviceName: name });
  return name;
}

function pickDeviceName(): string {
  const model = (Device.modelName ?? "").trim();
  const maker = (Device.manufacturer ?? Device.brand ?? "").trim();
  const given = (Device.deviceName ?? "").trim();
  const looksLikeCode = (v: string) => !v || /^sdk_|_x86|^generic|^[a-z0-9]+_[a-z0-9_]+$/i.test(v);
  if (given && given !== model && !looksLikeCode(given)) return given;
  if (Device.isDevice === false || /^sdk_gphone|emulator/i.test(model)) return "Android emulator";
  if (!model) return maker ? `${maker} phone` : "Android phone";
  if (!maker || model.toLowerCase().startsWith(maker.toLowerCase()) || /^pixel/i.test(model)) return model;
  return `${maker.charAt(0).toUpperCase()}${maker.slice(1)} ${model}`;
}

/**
 * Is the PC there? Patient on purpose: the very first request after a fresh install can stall for
 * seconds while Android brings up the app's networking, so try three times (10 s each, 1.5 s
 * apart) before saying the PC can't be found.
 */
async function findPc(baseUrl: string): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await health(baseUrl, 10000);
      return true;
    } catch {
      if (attempt < 2) await new Promise((r) => setTimeout(r, 1500));
    }
  }
  return false;
}

/** Checks the PC is there, then trades the 6-digit code for a token. */
export async function pairWith(address: string, code: string, onStep?: (step: string) => void): Promise<void> {
  const baseUrl = toBaseUrl(address);
  if (!baseUrl) throw new PairError("That address doesn't look right. It looks like 192.168.1.20:8787.");
  onStep?.("Looking for your PC…");
  if (!(await findPc(baseUrl))) {
    throw new PairError(`Can't find your PC at ${address.trim()}. Check that Kiwimake is running on it and that both are on the same Wi-Fi.`);
  }
  onStep?.("Connecting…");
  try {
    const deviceName = friendlyDeviceName();
    // A pairing request that never reached the PC is safe to send again (the code is not used up).
    const res = await pairRequest(baseUrl, { code, deviceName }).catch(async (e) => {
      if (e instanceof ApiError && e.unreachable) {
        await new Promise((r) => setTimeout(r, 1500));
        return pairRequest(baseUrl, { code, deviceName });
      }
      throw e;
    });
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
  if (!code) throw new PairError("That isn't a Kiwimake code. On your PC, choose Connect a phone and use the code it shows.");
  if (!AnyAppNative || !AnyAppNative.easyConnectAvailable()) {
    throw new PairError("This copy of Kiwimake can't use Easy Connect. Connect another way, on the same Wi-Fi.");
  }
  onStep?.(`Reaching ${code.name}…`);
  let clientKey: string;
  let base: string;
  try {
    clientKey = await AnyAppNative.easyConnectClientKey();
    base = await dialEasyConnect(code.address, code.port, true);
  } catch {
    throw new PairError(`Can't reach ${code.name}. Keep Kiwimake open on your PC and check that both have internet, then try again.`);
  }
  onStep?.(`Connecting to ${code.name}…`);
  try {
    const deviceName = friendlyDeviceName();
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
    throw new PairError(`Reached ${code.name}, but Kiwimake there did not answer. Keep it open on your PC and try again.`);
  }
}

export async function unpair() {
  // Tell the PC first (POST /api/unpair, phone token), so it forgets this phone and its Easy Connect
  // key. If the PC is off or does not have that route yet, carry on: the phone forgets it anyway.
  // Over the same network this is a fresh connection to the PC, and a first connection can stall
  // for seconds (8 s measured on the emulator): the old 5 s limit gave up before it reached the PC.
  // Three tries of 8 s while the PC is reachable, one short one when it is not.
  // If it still has not answered after two tries, the request is remembered and sent again in the
  // background until the PC answers (same network only: an Easy Connect tunnel ends with the pairing).
  const client = getState().client;
  const pairing = getState().pairing;
  if (client) {
    let told = false;
    for (let i = 0; i < 2 && !told; i++) {
      told = await tellPcToForget(client, 8000);
      if (!told) console.log(`unpair: try ${i + 1} did not reach the PC`);
    }
    if (!told && pairing && !usesEasyConnect(pairing)) {
      const pending = [...(getState().prefs.pendingUnpairs ?? []), { baseUrl: client.baseUrl, token: client.token }];
      updatePrefs({ pendingUnpairs: pending });
      console.log("unpair: will keep telling the PC in the background");
    }
  }
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

/** POST /api/unpair. True once the PC has answered: 204, or 401 (it already forgot this phone). */
async function tellPcToForget(client: Client, timeoutMs: number): Promise<boolean> {
  try {
    await client.unpair(timeoutMs);
    console.log("unpair: the PC forgot this phone");
    return true;
  } catch (e) {
    if (e instanceof ApiError && !e.unreachable) {
      console.log(`unpair: the PC answered ${e.status}, nothing more to do`);
      return true;
    }
    return false;
  }
}

let unpairTimer: ReturnType<typeof setInterval> | null = null;
let flushing = false;

/** Sends remembered disconnects again (at start, every 20 s while the app is in front). */
async function flushPendingUnpairs() {
  const pending = getState().prefs.pendingUnpairs ?? [];
  if (flushing || pending.length === 0 || AppState.currentState !== "active") return;
  flushing = true;
  try {
    for (const p of pending) {
      if (await tellPcToForget(new Client(p.baseUrl, p.token), 10000)) {
        updatePrefs({ pendingUnpairs: (getState().prefs.pendingUnpairs ?? []).filter((x) => x.token !== p.token) });
      }
    }
  } finally {
    flushing = false;
  }
}

function startUnpairRetries() {
  if (unpairTimer) return;
  void flushPendingUnpairs();
  unpairTimer = setInterval(() => void flushPendingUnpairs(), 20000);
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
let healthTicks = 0;
/** The next dial stops the old tunnel first (after a drop, a stall or a network change). */
let resetNextDial = false;
let lastRepair = 0;

// Retry ladders. Same network: 1, 2, 4, 8, 15 s. Easy Connect, from Ghostex: right after a drop the
// PC's helper is usually restarting (a code was made, used or expired), so retry quickly first
// (redialAfterServerStop: 2.5, 2, 2.5, 3, 5, 8 s), then its normal ladder (15, 30 s, repeating).
// Measured: a growing backoff (1, 2, 4, 8, 15 s) plus sockets that hung while opening kept the
// phone on "Connecting" for 99 s after the PC restarted. Now: retry every few seconds for the first
// two minutes offline (a PC restart takes seconds), then slow down to save battery.
const LAN_DELAYS = [1000, 1000, 2000, 2000, 3000];
const EASY_DELAYS = [1500, 2000, 2500, 3000];
const FAST_FOR_MS = 2 * 60 * 1000;
const SLOW_DELAY = { lan: 10000, easy: 15000 };
/** A socket that has not opened by then is dropped and tried again (a fresh connection is usually instant). */
const OPEN_TIMEOUT_MS = 12000;
let offlineSince = 0;
let bootedAt = 0;

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
    if (getState().pairing !== pairing) {
      connecting = false; // disconnected meanwhile
      return;
    }
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
  console.log(`link: opening the socket (${usesEasyConnect(pairing) ? "Easy Connect" : "same Wi-Fi"})`);
  // A socket that neither opens nor fails would leave the app waiting for ever.
  const openTimer = setTimeout(() => {
    if (socket === ws && ws.readyState !== WebSocket.OPEN) {
      console.log(`link: the socket did not open in ${OPEN_TIMEOUT_MS / 1000} s, trying again`);
      socket = null;
      try {
        ws.close();
      } catch {
        // ignore
      }
      setState({ connection: "offline" });
      if (usesEasyConnect(getState().pairing)) resetNextDial = true;
      scheduleReconnect();
    }
  }, OPEN_TIMEOUT_MS);
  ws.onopen = () => {
    clearTimeout(openTimer);
    if (socket !== ws) return;
    console.log(offlineSince ? `link: socket open, back after ${((Date.now() - offlineSince) / 1000).toFixed(1)} s` : "link: socket open");
    offlineSince = 0;
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
  ws.onclose = (e) => {
    clearTimeout(openTimer);
    if (socket !== ws) return;
    console.log(`link: socket closed (${e.code}), reconnecting`);
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
  startLivenessPings();
}

function scheduleReconnect() {
  if (!getState().pairing || getState().authLost) return;
  if (retryTimer) return;
  attempts++;
  if (!offlineSince) offlineSince = Date.now();
  const easy = usesEasyConnect(getState().pairing);
  const ladder = easy ? EASY_DELAYS : LAN_DELAYS;
  const delay =
    Date.now() - offlineSince < FAST_FOR_MS ? ladder[Math.min(attempts - 1, ladder.length - 1)] : easy ? SLOW_DELAY.easy : SLOW_DELAY.lan;
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
  console.log("link: the PC stopped answering, reconnecting");
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
 * When the PC's process is killed, the close may never reach the phone (the Android emulator's
 * network does not pass it on; some routers and sleeping Wi-Fi do the same), so the socket looks
 * open for minutes while nothing arrives. Writing to it reveals that at once: a write on a dead
 * connection fails and the socket closes, which starts the reconnect. The companion ignores
 * these frames (shared/protocol.ts). Only while Kiwimake is in front.
 */
let livenessTimer: ReturnType<typeof setInterval> | null = null;
function startLivenessPings() {
  if (livenessTimer) return;
  livenessTimer = setInterval(() => {
    const ws = socket;
    if (!ws || ws.readyState !== WebSocket.OPEN || AppState.currentState !== "active") return;
    try {
      ws.send("ping");
    } catch {
      // the close handler reconnects
    }
  }, 5000);
}

/**
 * A socket can look open long after the PC (or the tunnel) went away; a cheap HTTP check with a
 * 5 s timeout notices. Through Easy Connect one miss is enough to rebuild the tunnel (Ghostex's
 * chat link does the same after 5 s of silence); on the same network, two misses.
 */
function startHealthChecks() {
  if (healthTimer) return;
  // Every 5 s while Kiwimake is in front (one tiny request). If the PC stopped answering and
  // answers again, it restarted: its old socket is dead even when the phone was never told (the
  // emulator's network never passes the close on), so reconnect at once instead of waiting.
  healthTimer = setInterval(async () => {
    const client = getState().client;
    if (!client || AppState.currentState !== "active" || !socket) return;
    healthTicks++;
    try {
      await health(client.baseUrl, 4000);
      const wasDown = healthFailures > 0;
      healthFailures = 0;
      if (wasDown) {
        console.log("link: the PC answers again after a gap, reconnecting");
        lastRepair = 0;
        repair();
        return;
      }
      if (healthTicks % 3 === 0 && getState().connection === "online" && (await socketMissedSomething())) {
        console.log("link: the PC has changes the socket did not deliver, reconnecting");
        lastRepair = 0;
        repair();
      }
    } catch {
      healthFailures++;
      // Through Easy Connect the tunnel itself is suspect at once; on the same network wait for a
      // second miss (the "answers again" rule above catches the restart either way).
      if (healthFailures >= (usesEasyConnect(getState().pairing) ? 1 : 2)) repair();
    }
  }, 5000);
}

/**
 * A socket can stay "open" on the phone after the PC stopped sending on it. The PC's app list is
 * the truth: if it holds a change newer than anything the socket delivered, the socket is dead.
 */
async function socketMissedSomething(): Promise<boolean> {
  const client = getState().client;
  if (!client) return false;
  try {
    const remote = await client.listApps();
    const local = getState().apps;
    return remote.some((a) => !local[a.id] || Date.parse(a.updatedAt) > Date.parse(local[a.id].updatedAt) + 2000);
  } catch {
    return false;
  }
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
  // A socket that is still opening is left alone: closing it would only start the wait again
  // (its own open timeout drops it if it hangs).
  if (socket || connecting) return;
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
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
  // Android reports the current network once when the listener is registered at start: that is
  // not a change, and reacting to it closed the first socket while it was opening.
  if (Date.now() - bootedAt < 3000) return;
  if (usesEasyConnect(getState().pairing) && getState().connection === "online") {
    // The tunnel's path may be gone with the old network: check it, rebuild only if it fails.
    void verifyThenResync();
  } else {
    reconnectNow();
  }
}

function onForeground() {
  refreshPackages();
  void sendCrashes();
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
    case "worker.updated":
      upsertHelpers(event.worker.appId, [event.worker]);
      break;
    case "worker.item":
      if (event.item.workerId) upsertHelperItems(event.item.workerId, [event.item]);
      break;
    case "todos.updated":
      setTodos(event.appId, event.todos);
      break;
    case "care.updated":
      setState({ care: event.care });
      break;
    case "diary.request":
      void answerDiaryRequest(event);
      break;
    case "suggestions.updated":
      setSuggestions(event.appId, event.suggestions);
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
    // An older PC has no usage meter: care stays null and nothing shows.
    void client.care().then((care) => setState({ care }), () => {});
    refreshPackages();
    updateKeepAlive();
    resumeUnfinishedInstalls();
    for (const app of apps) void autoInstallIfNew(app);
    void sendCrashes();
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
  // Helpers come with the chat (an older PC has none: an empty list).
  void client.helpers(appId).then((list) => upsertHelpers(appId, list), () => {});
}

/** A helper's own chat (read only): its history, then the socket keeps it current. */
export async function loadHelperChat(appId: string, workerId: string): Promise<void> {
  const client = getState().client;
  if (!client) return;
  let items: ChatItem[];
  try {
    items = await client.helperMessages(appId, workerId);
  } catch (e) {
    if (e instanceof ApiError && e.unauthorized) onAuthLost();
    throw e;
  }
  replaceHelperChat(workerId, items);
}
