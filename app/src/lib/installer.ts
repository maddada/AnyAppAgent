import { AppState } from "react-native";
import { Directory, File, Paths } from "expo-file-system";
import { AnyAppNative, type InstallResult } from "anyapp-native";
import { theme } from "@shared/theme/tokens";
import type { App } from "./protocol";
import { getState, setInstall, setState } from "./store";
import { loadPrefs, savePrefs } from "./storage";

/** The notification icon's tint: the accent from the shared theme (README: color.light.accent). */
const notificationTint = theme.color.light.accent;

// ---------- what is installed

export function refreshPackages() {
  if (!AnyAppNative) return;
  const names = Object.values(getState().apps).map((a) => a.packageName);
  if (names.length === 0) return;
  try {
    const info = AnyAppNative.getPackagesInfo(names);
    setState((s) => ({ packages: { ...s.packages, ...info } }));
  } catch {
    // ignore
  }
}

function installedVersion(app: App): number | null {
  if (!AnyAppNative) return null;
  const info = AnyAppNative.getPackageInfo(app.packageName);
  setState((s) => ({ packages: { ...s.packages, [app.packageName]: info } }));
  return info ? info.versionCode : null;
}

export function launchApp(app: App): boolean {
  return AnyAppNative?.launch(app.packageName) ?? false;
}

// ---------- offering new builds by themselves, once each

/** Called for `apk.ready`: install it now, or notify if AnyAppAgent is in the background. */
export async function onApkReady(app: App) {
  await autoInstallIfNew(app, true);
}

/**
 * Starts the install of a build the user has not been offered yet, if it is newer than what is
 * on the phone. Each build is offered by itself only once; after that the tile says "Update ready".
 */
export async function autoInstallIfNew(app: App, fresh = false) {
  const build = app.latestApk;
  if (!build || !AnyAppNative) return;
  const installed = installedVersion(app);
  if (installed != null && installed >= build.number) return;
  // On opening AnyAppAgent, only updates of apps already on the phone start by themselves.
  if (!fresh && installed == null) return;
  const prefs = getState().prefs;
  if ((prefs.offeredBuilds[app.id] ?? 0) >= build.number) return;
  const offeredBuilds = { ...prefs.offeredBuilds, [app.id]: build.number };
  setState({ prefs: { ...prefs, offeredBuilds } });
  void loadPrefs().then((p) => savePrefs({ ...p, offeredBuilds: { ...p.offeredBuilds, [app.id]: build.number } }));

  if (AppState.currentState !== "active") {
    pendingFromBackground.add(app.id);
    AnyAppNative.notify(
      notificationId(app.id),
      installed == null ? `${app.name} is ready` : `${app.name} has an update`,
      "Tap to install.",
      `anyappagent://?install=${encodeURIComponent(app.id)}`,
      notificationTint,
    );
    return;
  }
  void installApp(app);
}

const pendingFromBackground = new Set<string>();

/** Back in front after a "ready" notification (tapped or not): install what was waiting. */
export async function resumePendingInstall() {
  const waiting = getState().needInstallPermission;
  if (waiting && AnyAppNative?.canInstallPackages()) {
    setState({ needInstallPermission: null });
    const app = getState().apps[waiting];
    if (app) void installApp(app);
  }
  for (const appId of [...pendingFromBackground]) {
    pendingFromBackground.delete(appId);
    const app = getState().apps[appId];
    if (app) void installApp(app);
  }
}

/** The notification was tapped (deep link anyappagent://?install=<appId>). */
export function installFromLink(appId: string) {
  pendingFromBackground.delete(appId);
  const app = getState().apps[appId];
  if (app) void installApp(app);
  else pendingFromBackground.add(appId); // apps not loaded yet: picked up on the next resume
}

export function notificationId(appId: string): number {
  let h = 7;
  for (let i = 0; i < appId.length; i++) h = (h * 31 + appId.charCodeAt(i)) | 0;
  return Math.abs(h % 100000) + 1000;
}

// ---------- download, check, install (one at a time)

let queue: Promise<void> = Promise.resolve();

export function installApp(app: App): Promise<void> {
  const current = getState().installs[app.id];
  if (current && ["waiting", "downloading", "checking", "installing", "confirm"].includes(current.phase)) {
    return queue;
  }
  const build = app.latestApk;
  if (!build) return Promise.resolve();
  setInstall(app.id, { buildNumber: build.number, phase: "waiting" });
  queue = queue.then(() => runInstall(app.id)).catch(() => undefined);
  return queue;
}

async function runInstall(appId: string) {
  const { client } = getState();
  const app = getState().apps[appId];
  const build = app?.latestApk;
  if (!client || !app || !build || !AnyAppNative) {
    setInstall(appId, null);
    return;
  }
  AnyAppNative.cancelNotification(notificationId(appId));

  if (!AnyAppNative.canInstallPackages()) {
    // The UI shows a one-line explanation with a button to the system setting.
    setInstall(appId, null);
    setState({ needInstallPermission: appId });
    return;
  }

  const dir = new Directory(Paths.cache, "apks");
  const file = new File(dir, `${app.slug || app.id}-${build.number}.apk`);
  try {
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
    if (file.exists) file.delete();

    setInstall(appId, { buildNumber: build.number, phase: "downloading", progress: 0 });
    const task = File.createDownloadTask(client.apkUrl(appId), file, {
      headers: client.authHeaders(),
      onProgress: ({ bytesWritten, totalBytes }) => {
        const total = totalBytes > 0 ? totalBytes : (build.sizeBytes ?? 0);
        if (total > 0) setInstall(appId, { buildNumber: build.number, phase: "downloading", progress: Math.min(1, bytesWritten / total) });
      },
    });
    const downloaded = await task.downloadAsync();
    if (!downloaded) throw new Error("The download stopped.");

    setInstall(appId, { buildNumber: build.number, phase: "checking" });
    if (build.sha256) {
      const sum = await AnyAppNative.sha256File(file.uri);
      if (sum.toLowerCase() !== build.sha256.toLowerCase()) {
        throw new Error("The download was damaged. Try again.");
      }
    }

    setInstall(appId, { buildNumber: build.number, phase: "installing" });
    let result: InstallResult;
    try {
      result = await AnyAppNative.install(file.uri);
    } catch {
      // PackageInstaller refused to even start: hand it to the system installer screen.
      if (AnyAppNative.installWithIntent(file.uri)) {
        setInstall(appId, { buildNumber: build.number, phase: "confirm" });
        watchFallback(app, build.number);
        return;
      }
      throw new Error("Android wouldn't start the install.");
    }
    finish(app, build.number, result);
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e);
    if (!PLAIN.has(raw)) console.warn(`install ${app.packageName}: ${raw}`);
    setInstall(appId, {
      buildNumber: build.number,
      phase: "failed",
      message: PLAIN.has(raw) ? raw : "The download stopped. Check the connection to your PC, then tap Install to try again.",
    });
  }
}

/** Messages thrown above that are already written for people. */
const PLAIN = new Set(["The download was damaged. Try again.", "Android wouldn't start the install."]);

function finish(app: App, buildNumber: number, result: InstallResult) {
  installedVersion(app);
  switch (result.status) {
    case "success":
      setInstall(app.id, { buildNumber, phase: "done" });
      cleanup(app, buildNumber);
      setTimeout(() => {
        if (getState().installs[app.id]?.phase === "done") setInstall(app.id, null);
      }, 4000);
      return;
    case "cancelled":
      setInstall(app.id, null);
      return;
    case "conflict":
      setInstall(app.id, {
        buildNumber,
        phase: "failed",
        conflict: true,
        message: "The version on your phone was made differently, so this one can't replace it. Remove it, then install again.",
      });
      return;
    default:
      // Android's own message (INSTALL_PARSE_FAILED_..., file paths) is for logs, not for people.
      if (result.message) console.warn(`install ${app.packageName}: ${result.status}: ${result.message}`);
      setInstall(app.id, { buildNumber, phase: "failed", message: plainInstallError(result) });
  }
}

function plainInstallError(result: InstallResult): string {
  switch (result.status) {
    case "storage":
      return "Your phone is out of space. Free some space, then tap Install again.";
    case "invalid":
      return "This version isn't a file Android can install. Ask for a change, or tap Install to try again.";
    case "incompatible":
      return "This version doesn't work on this phone's Android.";
    case "blocked":
      return "Android blocked the install. Check that installing apps is allowed in Settings.";
    default:
      return "Android couldn't install it. Tap Install to try again.";
  }
}

/** With the system installer screen there is no result callback: look when we're back in front. */
function watchFallback(app: App, buildNumber: number) {
  const sub = AppState.addEventListener("change", (state) => {
    if (state !== "active") return;
    sub.remove();
    const v = installedVersion(app);
    if (v != null && v >= buildNumber) {
      setInstall(app.id, { buildNumber, phase: "done" });
      cleanup(app, buildNumber);
      setTimeout(() => setInstall(app.id, null), 4000);
    } else {
      setInstall(app.id, null);
    }
  });
}

function cleanup(app: App, buildNumber: number) {
  try {
    const f = new File(new Directory(Paths.cache, "apks"), `${app.slug || app.id}-${buildNumber}.apk`);
    if (f.exists) f.delete();
  } catch {
    // ignore
  }
}
