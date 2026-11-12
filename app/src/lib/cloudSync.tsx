// Keeps the store in step with the Kiwimake account while signed in: the account (credits, plan,
// GitHub, linked PCs), the cloud apps (one grid with the PC's), and each open cloud chat and its
// helpers. Convex's live queries replace the PC's socket for cloud apps: no polling. A new build of a
// cloud app reaches the installer the way the PC's apk.ready does.
import { useEffect } from "react";
import { useConvexAuth } from "convex/react";
import { api, CloudClient, convex } from "./cloud";
import { autoInstallIfNew, onApkReady, refreshPackages } from "./installer";
import type { App, ChatItem, WorkerInfo } from "./protocol";
import { dropPlace, getState, replaceChat, replaceHelperChat, setApps, setState, upsertHelpers, type Account } from "./store";
import { updateKeepAlive } from "./keepalive";

type Unsub = () => void;

let appsWatch: Unsub | null = null;
let meWatch: Unsub | null = null;
const chatWatches = new Map<string, Unsub>();
const helperWatches = new Map<string, Unsub>();
/** The newest build number each cloud app had when we last looked (to notice a new one). */
const seenBuilds = new Map<string, number>();

function watch<T>(fn: unknown, args: Record<string, unknown>, onValue: (value: T) => void): Unsub {
  const w = convex!.watchQuery(fn as never, args as never);
  const tick = () => {
    try {
      const v = w.localQueryResult() as T | undefined;
      if (v !== undefined) onValue(v);
    } catch (e) {
      console.warn(`cloud: ${(e as Error).message.split("\n")[0]}`);
    }
  };
  const unsub = w.onUpdate(tick);
  tick();
  return unsub;
}

function onCloudApps(list: App[]) {
  const first = !getState().cloudAppsLoaded;
  setApps(list, "cloud");
  refreshPackages();
  updateKeepAlive();
  for (const app of list) {
    const n = app.latestApk?.fileUrls?.length ? app.latestApk.number : 0;
    const before = seenBuilds.get(app.id);
    seenBuilds.set(app.id, Math.max(before ?? 0, n));
    if (!n) continue;
    // A build that arrived while we watch: install it as the PC's apk.ready does. At start (or a new
    // app we had not seen): the usual "offered once" rule decides.
    if (!first && before !== undefined && n > before) void onApkReady(app);
    else void autoInstallIfNew(app);
  }
}

function start() {
  if (!convex || appsWatch) return;
  setState({ cloudClient: new CloudClient((id) => getState().apps[id]) });
  meWatch = watch<Account | null>(api.accounts.me, {}, (me) => setState({ account: me }));
  appsWatch = watch<App[]>(api.apps.list, {}, onCloudApps);
  // Chats that were open before sign-in (or a reconnect) are watched again.
  for (const id of Object.keys(getState().chatLoaded)) if (getState().chatLoaded[id] && /^[a-z0-9]{32}$/.test(id)) watchCloudChat(id);
}

function stop() {
  appsWatch?.();
  meWatch?.();
  appsWatch = meWatch = null;
  for (const u of chatWatches.values()) u();
  for (const u of helperWatches.values()) u();
  chatWatches.clear();
  helperWatches.clear();
  seenBuilds.clear();
  dropPlace("cloud");
  setState({ account: null, cloudClient: null, cloudAppsLoaded: false });
}

/** A cloud app's chat and its helpers, live, while the app is in use. */
export function watchCloudChat(appId: string) {
  if (!convex || chatWatches.has(appId)) return;
  const a = watch<ChatItem[]>(api.chat.messages, { appId }, (items) => {
    replaceChat(appId, items);
    setState((s) => ({ chatLoaded: { ...s.chatLoaded, [appId]: true } }));
  });
  const b = watch<WorkerInfo[]>(api.chat.helpers, { appId }, (list) => upsertHelpers(appId, list));
  chatWatches.set(appId, () => {
    a();
    b();
  });
}

/** One helper's own chat (read only), live. */
export function watchCloudHelperChat(appId: string, workerId: string) {
  if (!convex || helperWatches.has(workerId)) return;
  helperWatches.set(workerId, watch<ChatItem[]>(api.chat.messages, { appId, workerId }, (items) => replaceHelperChat(workerId, items)));
}

/** Mounted once inside ConvexAuthProvider: follows sign-in and starts or stops the sync. */
export function CloudBridge() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  useEffect(() => {
    const auth = isLoading ? "loading" : isAuthenticated ? "signedIn" : "signedOut";
    setState({ cloudAuth: auth });
    if (auth === "signedIn") start();
    else if (auth === "signedOut") stop();
  }, [isAuthenticated, isLoading]);
  return null;
}
