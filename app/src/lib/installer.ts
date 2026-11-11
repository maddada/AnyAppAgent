import { AppState } from "react-native";
import { Directory, DownloadTask, File, Paths } from "expo-file-system";
import { AnyAppNative, type InstallResult } from "anyapp-native";
import { theme } from "@shared/theme/tokens";
import { apkFor } from "@shared/chat/index";
import type { App, BuildInfo } from "./protocol";
import { getState, setInstall, setState, type InstallProgress } from "./store";
import { loadPrefs, savePrefs, type Prefs } from "./storage";
import { keptAlive, updateKeepAlive } from "./keepalive";

/** The notification icon's tint: the accent from the shared theme (README: color.light.accent). */
const notificationTint = theme.color.light.accent;

/** How long Android may take to answer an install (a confirmation nobody sees must not block the queue). */
export const INSTALL_ANSWER_MS = 3 * 60_000;
/** A download that moved no byte for this long is cut and resumed where it stopped. */
export const STALL_MS = 30_000;
/** Tries in a row that add no byte before the download is given up (each reconnects first). */
const TRIES_WITHOUT_PROGRESS = 4;
const RETRY_DELAYS_MS = [2_000, 5_000, 15_000, 30_000];

const BUSY: ReadonlySet<InstallProgress["phase"]> = new Set(["waiting", "downloading", "checking", "installing", "confirm"]);

/** Set by session.ts: check the link to the PC and rebuild it (Easy Connect tunnel, socket) when it is gone. */
export const installerHooks = { linkTrouble: () => {} };

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

/** This phone's ABIs, best first (empty on an older native module: then the full APK is used). */
export function phoneAbis(): string[] {
  try {
    return AnyAppNative?.supportedAbis?.() ?? [];
  } catch {
    return [];
  }
}

// ---------- offering new builds by themselves, once each

/** Called for `apk.ready`: install an update now, or notify if AnyAppAgent is in the background. */
export async function onApkReady(app: App) {
  await autoInstallIfNew(app);
}

/**
 * Starts the install of a new version of an app that is already on this phone, once per build.
 * An app that is not on this phone never starts by itself (it may have been made on another
 * phone or on the PC, and a first install needs Android's confirmation): its card and tile say
 * "Tap to install".
 */
export async function autoInstallIfNew(app: App) {
  const build = app.latestApk;
  if (!build || !AnyAppNative) return;
  const installed = installedVersion(app);
  if (installed == null || installed >= build.number) return;
  const prefs = getState().prefs;
  if ((prefs.offeredBuilds[app.id] ?? 0) >= build.number) return;
  const offeredBuilds = { ...prefs.offeredBuilds, [app.id]: build.number };
  setState({ prefs: { ...prefs, offeredBuilds } });
  void loadPrefs().then((p) => savePrefs({ ...p, offeredBuilds: { ...p.offeredBuilds, [app.id]: build.number } }));

  // In the background the update still downloads and installs by itself when the keep-alive
  // service runs (it kept AnyAppAgent alive while the PC built it): Android will not freeze the
  // download. Without it, a notification asks for the tap instead.
  if (AppState.currentState !== "active" && !keptAlive()) {
    pendingFromBackground.add(app.id);
    // What changed (docs/VERSIONS.md) says what the update is, in the person's words.
    const changed = build.changes?.changed;
    AnyAppNative.notify(notificationId(app.id), `${app.name} has an update`, changed ? `${changed} Tap to install.` : "Tap to install.", `anyappagent://?install=${encodeURIComponent(app.id)}`, notificationTint);
    return;
  }
  void installApp(app);
}

const pendingFromBackground = new Set<string>();

// ---------- unfinished installs survive a restart of AnyAppAgent

function patchUnfinished(change: (u: Prefs["unfinishedInstalls"]) => Prefs["unfinishedInstalls"]) {
  const prefs = getState().prefs;
  setState({ prefs: { ...prefs, unfinishedInstalls: change({ ...(prefs.unfinishedInstalls ?? {}) }) } });
  void loadPrefs().then((p) => savePrefs({ ...p, unfinishedInstalls: change({ ...(p.unfinishedInstalls ?? {}) }) }));
}

function markUnfinished(appId: string, build: number) {
  patchUnfinished((u) => ({ ...u, [appId]: { build, retried: u[appId]?.build === build ? u[appId].retried : false } }));
}

function clearUnfinished(appId: string) {
  patchUnfinished((u) => {
    delete u[appId];
    return u;
  });
}

let resumedThisRun = false;

/**
 * After AnyAppAgent starts (the first time the app list arrives): carry on, once, with an update
 * that was cut off, for example when AnyAppAgent itself was replaced mid-download. The part
 * already downloaded is kept, so it resumes where it stopped. First installs are not resumed by
 * themselves (they wait for a tap).
 */
export function resumeUnfinishedInstalls() {
  if (resumedThisRun || !AnyAppNative) return;
  resumedThisRun = true;
  const unfinished = getState().prefs.unfinishedInstalls ?? {};
  for (const [appId, entry] of Object.entries(unfinished)) {
    const app = getState().apps[appId];
    const installed = app ? installedVersion(app) : null;
    const stillWanted = installed != null && app?.latestApk && app.latestApk.number >= entry.build && installed < app.latestApk.number;
    if (!app || !stillWanted || entry.retried) {
      clearUnfinished(appId);
      continue;
    }
    patchUnfinished((u) => ({ ...u, [appId]: { build: entry.build, retried: true } }));
    void installApp(app);
  }
}

/** Back in front after a "ready" notification (tapped or not): install what was waiting. */
export async function resumePendingInstall() {
  // An install waiting for the person's yes: Android may have blocked its prompt while AnyAppAgent
  // was in the background, or another prompt covered it. Show it again.
  if (current && getState().installs[current]?.phase === "installing") AnyAppNative?.reopenInstallPrompt?.();
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
/** The app the queue works on now: the others say "Waiting for <its name>". */
let current: string | null = null;

export function installApp(app: App): Promise<void> {
  const now = getState().installs[app.id];
  if (now && BUSY.has(now.phase)) return queue;
  const build = app.latestApk;
  if (!build) return Promise.resolve();
  const ahead = current && current !== app.id ? getState().apps[current]?.name : undefined;
  setInstall(app.id, { buildNumber: build.number, phase: "waiting", ...(ahead ? { waitingFor: ahead } : {}) });
  updateKeepAlive();
  queue = queue.then(() => runInstall(app.id)).catch(() => undefined);
  return queue;
}

async function runInstall(appId: string) {
  current = appId;
  const name = getState().apps[appId]?.name;
  for (const [id, install] of Object.entries(getState().installs)) {
    if (id !== appId && install.phase === "waiting") setInstall(id, { ...install, ...(name ? { waitingFor: name } : {}) });
  }
  try {
    await installOne(appId);
  } finally {
    current = null;
    updateKeepAlive();
  }
}

function apkDirectory() {
  return new Directory(Paths.cache, "apks");
}

function apkFileName(app: App, build: BuildInfo, abi: string | undefined) {
  return `${app.slug || app.id}-${build.number}${abi ? `-${abi}` : ""}.apk`;
}

/** Drops this app's other downloads (older builds): what is kept is only the one in progress. */
function dropOtherDownloads(app: App, keep: string) {
  try {
    const prefix = `${app.slug || app.id}-`;
    for (const entry of apkDirectory().list()) {
      if (entry instanceof File && entry.name.startsWith(prefix) && entry.name !== keep) entry.delete();
    }
  } catch {
    // ignore
  }
}

async function installOne(appId: string) {
  const app = getState().apps[appId];
  const build = app?.latestApk;
  if (!getState().client || !app || !build || !AnyAppNative) {
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

  const want = apkFor(build, phoneAbis());
  const dir = apkDirectory();
  const name = apkFileName(app, build, want.abi);
  const file = new File(dir, name);
  try {
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
    // A part downloaded before (cut off, or AnyAppAgent restarted) is kept and resumed.
    dropOtherDownloads(app, name);
    markUnfinished(appId, build.number);
    await download(appId, build.number, file, want);

    setInstall(appId, { buildNumber: build.number, phase: "checking" });
    if (want.sha256) {
      const sum = await AnyAppNative.sha256File(file.uri);
      if (sum.toLowerCase() !== want.sha256.toLowerCase()) {
        file.delete();
        throw new Error("The download was damaged. Try again.");
      }
    }

    setInstall(appId, { buildNumber: build.number, phase: "installing" });
    let result: InstallResult;
    try {
      result = await answerWithin(AnyAppNative.install(file.uri, INSTALL_ANSWER_MS), INSTALL_ANSWER_MS + 15_000);
    } catch {
      // PackageInstaller refused to even start: hand it to the system installer screen.
      if (AnyAppNative.installWithIntent(file.uri)) {
        setInstall(appId, { buildNumber: build.number, phase: "confirm" });
        watchFallback(app, build.number, name);
        return;
      }
      throw new Error("Android wouldn't start the install.");
    }
    finish(app, build.number, result, name);
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

/** The native side gives up on its own after INSTALL_ANSWER_MS; this is the last word if it never answers. */
function answerWithin(install: Promise<InstallResult>, ms: number): Promise<InstallResult> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve({ status: "timeout", message: "no answer from the native side", packageName: null }), ms);
    install.then(
      (r) => {
        clearTimeout(timer);
        resolve(r);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const sizeOf = (file: File) => {
  try {
    return file.exists ? file.size : 0;
  } catch {
    return 0;
  }
};

/**
 * Downloads `want` into `file`, resuming whatever part is there already (Range, with If-Range on
 * the file's checksum so a newer build never mixes in). A link that moves no byte for STALL_MS
 * is cut and resumed; each retry first has the link to the PC checked and rebuilt. Gives up only
 * after TRIES_WITHOUT_PROGRESS tries in a row that added nothing.
 */
async function download(appId: string, buildNumber: number, file: File, want: { abi?: string; sizeBytes?: number; sha256?: string }) {
  let triesWithoutProgress = 0;
  for (;;) {
    const have = sizeOf(file);
    const total = want.sizeBytes ?? 0;
    if (total > 0 && have === total) return; // all there (a download that finished before a restart)
    if (total > 0 && have > total) {
      file.delete();
      continue;
    }
    const client = getState().client;
    if (!client) throw new Error("not connected to the PC");

    let written = have;
    let size = total;
    let movedAt = Date.now();
    let shownAt = 0;
    const show = (retrying: boolean) => {
      shownAt = Date.now();
      setInstall(appId, {
        buildNumber,
        phase: "downloading",
        bytesWritten: written,
        ...(size > 0 ? { totalBytes: size, progress: Math.min(1, written / size) } : { progress: 0 }),
        ...(retrying ? { retrying: true } : {}),
      });
    };
    show(triesWithoutProgress > 0);
    const onProgress = ({ bytesWritten, totalBytes }: { bytesWritten: number; totalBytes: number }) => {
      if (bytesWritten > written) movedAt = Date.now();
      written = bytesWritten;
      if (totalBytes > 0) size = totalBytes;
      if (Date.now() - shownAt > 400 || (size > 0 && written >= size)) show(false);
    };
    const url = client.apkUrl(appId, want.abi);
    const headers: Record<string, string> = { ...client.authHeaders(), ...(have > 0 && want.sha256 ? { "If-Range": `"${want.sha256}"` } : {}) };
    const task =
      have > 0
        ? DownloadTask.fromSavable({ url, fileUri: file.uri, isDirectory: false, headers, resumeData: String(have) }, { onProgress })
        : File.createDownloadTask(url, file, { headers, onProgress });
    const watchdog = setInterval(() => {
      if (Date.now() - movedAt < STALL_MS || task.state !== "active") return;
      console.warn(`download ${appId}: no byte for ${STALL_MS / 1000} s at ${written}; cutting it to resume`);
      try {
        task.pause();
      } catch {
        // already ended
      }
    }, 2_000);
    try {
      const done = have > 0 ? await task.resumeAsync() : await task.downloadAsync();
      if (done) return;
    } catch (e) {
      console.warn(`download ${appId} from ${have}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      clearInterval(watchdog);
    }
    triesWithoutProgress = sizeOf(file) > have ? 0 : triesWithoutProgress + 1;
    if (triesWithoutProgress >= TRIES_WITHOUT_PROGRESS) throw new Error("The download stopped.");
    written = sizeOf(file);
    show(true);
    installerHooks.linkTrouble();
    await sleep(RETRY_DELAYS_MS[Math.min(triesWithoutProgress, RETRY_DELAYS_MS.length - 1)]);
  }
}

/** Messages thrown above that are already written for people. */
const PLAIN = new Set(["The download was damaged. Try again.", "Android wouldn't start the install."]);

function finish(app: App, buildNumber: number, result: InstallResult, fileName: string) {
  installedVersion(app);
  switch (result.status) {
    case "success":
      clearUnfinished(app.id);
      setInstall(app.id, { buildNumber, phase: "done" });
      cleanup(fileName);
      setTimeout(() => {
        if (getState().installs[app.id]?.phase === "done") setInstall(app.id, null);
      }, 4000);
      return;
    case "cancelled":
      // The person said no: nothing to retry by itself.
      clearUnfinished(app.id);
      setInstall(app.id, null);
      return;
    case "conflict":
      clearUnfinished(app.id);
      setInstall(app.id, {
        buildNumber,
        phase: "failed",
        conflict: true,
        message: "The version on your phone was made differently, so this one can't replace it. Remove it, then install again.",
      });
      return;
    case "timeout":
      // The download is kept: tapping Install again goes straight to installing.
      console.warn(`install ${app.packageName}: ${result.message ?? "timeout"}`);
      setInstall(app.id, { buildNumber, phase: "failed", message: "Android didn't finish installing it. Tap Install to try again." });
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
function watchFallback(app: App, buildNumber: number, fileName: string) {
  const sub = AppState.addEventListener("change", (state) => {
    if (state !== "active") return;
    sub.remove();
    const v = installedVersion(app);
    if (v != null && v >= buildNumber) {
      setInstall(app.id, { buildNumber, phase: "done" });
      cleanup(fileName);
      setTimeout(() => setInstall(app.id, null), 4000);
    } else {
      setInstall(app.id, null);
    }
  });
}

function cleanup(fileName: string) {
  try {
    const f = new File(apkDirectory(), fileName);
    if (f.exists) f.delete();
  } catch {
    // ignore
  }
}
