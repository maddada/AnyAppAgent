// A newer Kiwimake APK (docs/RELEASING.md, "Updates of the phone app"): the last check, the download
// in flight, and the automatic checks. Copied from Ghostex's src/updates/appUpdateStore.ts and
// androidApkInstall.ts (read only, never imported), for the one kind of install Kiwimake has: the
// side-loaded APK from GitHub.
//
// A newer release only counts when its JavaScript cannot arrive over the air (new native code): a
// release the update server already gives this APK needs no install (overTheAir.ts).
//
// Taking it downloads the APK for this phone's processor into the cache, checks its size and the
// SHA-256 GitHub lists for it, checks it is signed with the same key as this Kiwimake, then opens
// Android's installer on it. Android replaces Kiwimake in place: its data (the pairing with the PC,
// the apps list, the settings) stays, and the installer offers Open when it is done.
//
// initAppUpdates checks at start and whenever Kiwimake comes back to the front, at most once every
// CHECK_INTERVAL_MS (the time is kept in a file, so a restart does not reset it). Only release builds
// check (app.config.js `extra.selfUpdate`): a debug-signed copy could never take the release APK.
import * as Application from "expo-application";
import Constants from "expo-constants";
import { File, Paths } from "expo-file-system";
import { AppState, type AppStateStatus } from "react-native";
import { create } from "zustand";
import { AnyAppNative } from "anyapp-native";
import { describeFeedFailure, isNewerVersion, readRelease, type ReleaseApk } from "./releaseFeed";
import { checkForOverTheAirUpdate, overTheAirReleaseVersion, type OverTheAirCheckOutcome } from "./overTheAir";
import { phoneAbis } from "./installer";

/** Automatic checks run at most this often; Check for updates in Settings ignores it. */
export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

const extra = (Constants.expoConfig?.extra ?? {}) as { selfUpdate?: unknown; releaseFeed?: unknown };
export const SELF_UPDATE_ENABLED = extra.selfUpdate === true && typeof extra.releaseFeed === "string";
const RELEASE_FEED = typeof extra.releaseFeed === "string" ? extra.releaseFeed : "";

/** A newer Kiwimake to install. */
export type NewApp = { version: string; apk: ReleaseApk };

export type CheckState =
  | { phase: "idle" }
  | { phase: "checking" }
  | { phase: "checked"; newApp: NewApp | null; at: number }
  | { phase: "error"; message: string; at: number };

export type DownloadState =
  | { phase: "idle" }
  | { phase: "downloading"; version: string; bytesWritten: number; totalBytes: number }
  | { phase: "ready"; version: string; fileUri: string; installError: string | null }
  | { phase: "error"; version: string; message: string };

/** What Check for updates found on both sides, for its one plain line. */
export type CheckResult = {
  at: number;
  overTheAir: OverTheAirCheckOutcome;
  app: { kind: "off" } | { kind: "none" } | { kind: "newApp"; version: string } | { kind: "error"; message: string };
};

type State = {
  check: CheckState;
  download: DownloadState;
  /** The last tap on Check for updates, while it runs and after. */
  manualCheck: { running: boolean; result: CheckResult | null };
  /** The home notice was closed for this version (until Kiwimake restarts). */
  dismissed: string | null;
  checkForNewApp: () => Promise<void>;
  checkEverything: () => Promise<void>;
  takeNewApp: () => Promise<void>;
  cancelDownload: () => void;
  dismiss: (version: string) => void;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The newer APK from the last successful check, or null. */
export function availableApp(check: CheckState): NewApp | null {
  return check.phase === "checked" ? check.newApp : null;
}

/** The versionName of the installed APK (`0.3.3`). */
export function installedVersion(): string {
  return Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? "0.0.0";
}

/** The installed package: com.anyappagent, or a test build's own one. */
function ownPackage(): string {
  return Application.applicationId ?? "com.anyappagent";
}

/** The newest release, when it is newer than this APK and cannot arrive over the air. */
async function findNewApp(): Promise<NewApp | null> {
  let response: Response;
  try {
    response = await fetch(RELEASE_FEED, { headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" } });
  } catch {
    throw new Error("Couldn't reach GitHub. Check the internet connection.");
  }
  if (!response.ok) throw new Error(describeFeedFailure(response.status, response.headers.get("x-ratelimit-remaining"), response.headers.get("x-ratelimit-reset")));
  const latest = readRelease(await response.json(), phoneAbis());
  if (!isNewerVersion(latest.version, installedVersion())) return null;
  const served = await overTheAirReleaseVersion();
  if (served !== null && !isNewerVersion(latest.version, served)) return null; // it arrives over the air
  if (latest.apk === null) throw new Error(`Kiwimake ${latest.version} has no phone app to download yet.`);
  return { version: latest.version, apk: latest.apk };
}

/** Where the downloaded APK lives: one file in the cache, replaced by the next download. */
function apkFile(): File {
  return new File(Paths.cache, "kiwimake-update.apk");
}

async function downloadApk(apk: ReleaseApk, onProgress: (bytes: number, total: number) => void, signal: AbortSignal): Promise<File> {
  const destination = apkFile();
  if (destination.exists) destination.delete();
  const file = await File.downloadFileAsync(apk.url, destination, {
    idempotent: true,
    signal,
    onProgress: ({ bytesWritten, totalBytes }) => onProgress(bytesWritten, totalBytes > 0 ? totalBytes : apk.size),
  });
  if (file.size !== apk.size) {
    const actual = file.size;
    file.delete();
    throw new Error(`The download was incomplete (${actual} of ${apk.size} bytes). Try again.`);
  }
  if (apk.sha256 && AnyAppNative) {
    const sum = await AnyAppNative.sha256File(file.uri);
    if (sum.toLowerCase() !== apk.sha256) {
      file.delete();
      throw new Error("The download was damaged. Try again.");
    }
  }
  // Android would refuse an APK signed with another key; say so before its installer opens.
  if (AnyAppNative?.signedLikeInstalled?.(file.uri, ownPackage()) === false) {
    file.delete();
    throw new Error("This download isn't signed like your Kiwimake, so it was not installed.");
  }
  return file;
}

let checkInFlight: Promise<void> | null = null;
let downloadAbort: AbortController | null = null;

/** The last automatic check: when, and the newer APK it found (shown again after a restart). */
type Stamp = { at: number; newApp: NewApp | null };
const stampFile = () => new File(Paths.document, "app-update-check.json");

function rememberCheck(stamp: Stamp) {
  try {
    stampFile().write(JSON.stringify(stamp));
  } catch {
    // best effort
  }
}

async function lastCheck(): Promise<Stamp | null> {
  try {
    const file = stampFile();
    if (!file.exists) return null;
    const stamp = JSON.parse(await file.text()) as Stamp;
    return typeof stamp.at === "number" ? stamp : null;
  } catch {
    return null;
  }
}

export const useAppUpdate = create<State>()((set, get) => ({
  check: { phase: "idle" },
  download: { phase: "idle" },
  manualCheck: { running: false, result: null },
  dismissed: null,

  checkForNewApp: () => {
    if (!SELF_UPDATE_ENABLED) return Promise.resolve();
    if (checkInFlight !== null) return checkInFlight;
    checkInFlight = (async () => {
      set({ check: { phase: "checking" } });
      const at = Date.now();
      try {
        const newApp = await findNewApp();
        set({ check: { phase: "checked", newApp, at } });
        const { download } = get();
        // A finished download of this same release is still installable: offer Install at once.
        const file = apkFile();
        if (newApp !== null && download.phase !== "downloading" && file.exists && file.size === newApp.apk.size) {
          set({ download: { phase: "ready", version: newApp.version, fileUri: file.uri, installError: null } });
        } else if (newApp === null && download.phase !== "downloading") {
          set({ download: { phase: "idle" } });
          if (file.exists) file.delete();
        }
        rememberCheck({ at, newApp });
      } catch (error) {
        set({ check: { phase: "error", message: errorMessage(error), at } });
        rememberCheck({ at, newApp: null });
      } finally {
        checkInFlight = null;
      }
    })();
    return checkInFlight;
  },

  checkEverything: async () => {
    if (get().manualCheck.running) return;
    set((s) => ({ manualCheck: { running: true, result: s.manualCheck.result } }));
    const [overTheAir] = await Promise.all([checkForOverTheAirUpdate(), get().checkForNewApp()]);
    const { check } = get();
    const app: CheckResult["app"] = !SELF_UPDATE_ENABLED
      ? { kind: "off" }
      : check.phase === "error"
        ? { kind: "error", message: check.message }
        : check.phase === "checked" && check.newApp !== null
          ? { kind: "newApp", version: check.newApp.version }
          : { kind: "none" };
    set({ manualCheck: { running: false, result: { at: Date.now(), overTheAir, app } } });
  },

  takeNewApp: async () => {
    const newApp = availableApp(get().check);
    if (newApp === null || get().download.phase === "downloading") return;
    let { download } = get();
    if (download.phase !== "ready" || download.version !== newApp.version || !new File(download.fileUri).exists) {
      downloadAbort?.abort();
      const abort = new AbortController();
      downloadAbort = abort;
      set({ download: { phase: "downloading", version: newApp.version, bytesWritten: 0, totalBytes: newApp.apk.size } });
      try {
        const file = await downloadApk(
          newApp.apk,
          (bytesWritten, totalBytes) => {
            if (!abort.signal.aborted) set({ download: { phase: "downloading", version: newApp.version, bytesWritten, totalBytes } });
          },
          abort.signal,
        );
        if (abort.signal.aborted) return;
        download = { phase: "ready", version: newApp.version, fileUri: file.uri, installError: null };
        set({ download });
      } catch (error) {
        if (!abort.signal.aborted) set({ download: { phase: "error", version: newApp.version, message: errorMessage(error) } });
        return;
      } finally {
        if (downloadAbort === abort) downloadAbort = null;
      }
    }
    if (download.phase !== "ready") return;
    // Android's own installer: it asks once to allow installs from Kiwimake (already allowed for
    // the apps it makes), replaces Kiwimake keeping its data, and offers Open when it is done.
    const opened = AnyAppNative?.installWithIntent(download.fileUri) ?? false;
    set({ download: { ...download, installError: opened ? null : "Android's installer didn't open. Try again." } });
  },

  cancelDownload: () => {
    downloadAbort?.abort();
    downloadAbort = null;
    set({ download: { phase: "idle" } });
  },

  dismiss: (version) => set({ dismissed: version }),
}));

async function checkIfDue(): Promise<void> {
  const last = await lastCheck();
  if (last === null || Date.now() - last.at >= CHECK_INTERVAL_MS) return useAppUpdate.getState().checkForNewApp();
  // Checked a moment ago: show what that check found, while it is still newer than this APK.
  const newApp = last.newApp && isNewerVersion(last.newApp.version, installedVersion()) ? last.newApp : null;
  if (useAppUpdate.getState().check.phase === "idle") useAppUpdate.setState({ check: { phase: "checked", newApp, at: last.at } });
}

let started = false;

/** Starts the automatic checks for a newer APK (release builds only). */
export function initAppUpdates(): void {
  if (started || !SELF_UPDATE_ENABLED) return;
  started = true;
  void checkIfDue();
  AppState.addEventListener("change", (status: AppStateStatus) => {
    if (status === "active") void checkIfDue();
  });
}
