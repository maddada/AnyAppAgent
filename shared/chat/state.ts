// The one short state line of an app (list row, tile, sheet, chat header), worded into one of the
// four states the theme allows (working, ready, problem, idle). The phone passes what it knows
// about the app on itself (installed version, an install in progress); the PC passes nothing.
import type { App } from "../protocol.ts";

export type StateKind = "working" | "ready" | "problem" | "idle";
export interface StateText {
  kind: StateKind;
  label: string;
}

/** An install on the phone, as far as its words go. */
export interface InstallOnDevice {
  phase: "waiting" | "downloading" | "checking" | "installing" | "confirm" | "done" | "failed";
  progress?: number; // 0..1 while downloading
  bytesWritten?: number; // while downloading: what is on the phone already
  totalBytes?: number; // while downloading: the whole download
  waitingFor?: string; // while waiting: the name of the app installing before this one
  retrying?: boolean; // while downloading: the link stalled or dropped, it reconnects and carries on
}

/** What the phone knows locally. */
export interface OnDevice {
  installedVersion: number | null; // versionCode installed on this phone, null when not installed
  install?: InstallOnDevice;
}

/** "34 of 85 MB", one decimal under 10 MB. */
export function bytesOf(done: number, total: number): string {
  const mb = (n: number) => (total < 10 * 1048576 ? (n / 1048576).toFixed(1) : String(Math.floor(n / 1048576)));
  return `${mb(Math.min(done, total))} of ${total < 10 * 1048576 ? (total / 1048576).toFixed(1) : Math.round(total / 1048576)} MB`;
}

/**
 * The words for an install that is under way (button and state line), or null when none is.
 * `compact`: for a half-width tile ("34 of 85 MB" beside the spinner, "Waiting").
 */
export function installLabel(install: InstallOnDevice | undefined, compact = false): string | null {
  switch (install?.phase) {
    case "waiting":
      if (compact) return "Waiting";
      return install.waitingFor ? `Waiting for ${install.waitingFor}` : "Getting ready";
    case "downloading":
      if (install.retrying && (compact || !install.totalBytes)) return "Reconnecting";
      if (install.totalBytes) {
        const amount = bytesOf(install.bytesWritten ?? 0, install.totalBytes);
        return compact ? amount : `${install.retrying ? "Reconnecting at" : "Downloading"} ${amount}`;
      }
      return install.progress ? `Downloading ${Math.round(install.progress * 100)}%` : "Downloading";
    case "checking":
      return compact ? "Checking" : "Checking the download";
    case "installing":
    case "confirm":
      return "Installing";
    default:
      return null;
  }
}

/** What the big button for an app should do on the phone right now. */
export type AppAction = "open" | "install" | "update" | "notReady";

export function appAction(app: App, installedVersion: number | null | undefined): AppAction {
  const latest = app.latestApk?.number;
  if (installedVersion == null) return latest ? "install" : "notReady";
  if (latest && latest > installedVersion) return "update";
  return "open";
}

/** The state line while a plan or question page waits for the person (App.waitingForAnswer). */
export const WAITING_FOR_ANSWER = "Waiting for your answer";
/** The same on a half-width phone tile, which keeps to one short line. */
export const WAITING_FOR_ANSWER_SHORT = "Your answer";

export function describeApp(app: App, device?: OnDevice, now = Date.now()): StateText {
  const install = device?.install;
  if (install) {
    const busy = installLabel(install);
    if (busy) return { kind: "working", label: busy };
    switch (install.phase) {
      case "done":
        return { kind: "ready", label: "Installed" };
      case "failed":
        return { kind: "problem", label: "Didn't install" };
    }
  }
  switch (app.status) {
    case "creating":
      return { kind: "working", label: "Setting up" };
    case "working": {
      // With helpers: say how many are at work (the main chat alone answering is "Answering").
      const n = app.activeHelpers ?? 0;
      if (n > 0) return { kind: "working", label: n === 1 ? "1 helper at work" : `${n} helpers at work` };
      if (typeof app.activeHelpers === "number" && app.replying) return { kind: "working", label: "Answering" };
      return { kind: "working", label: "Making changes" };
    }
    case "building":
      // After the build itself the companion still commits and pushes before it announces the APK.
      return app.latestBuild?.status === "succeeded"
        ? { kind: "working", label: `Saving version ${app.latestBuild.number}` }
        : { kind: "working", label: app.latestBuild ? `Building version ${app.latestBuild.number}` : "Building" };
    case "error":
      return { kind: "problem", label: app.latestBuild?.status === "failed" ? "Couldn't build" : "Something went wrong" };
  }
  const apk = app.latestApk;
  const built = app.latestBuild;
  // A finished build that is not announced yet is still on its way, never "ready" or "waiting".
  if (built?.status === "succeeded" && built.number > (apk?.number ?? 0)) return { kind: "working", label: `Saving version ${built.number}` };
  // A plan or question page waits for the person (an update or install to tap still comes first).
  const waiting: StateText | null = app.waitingForAnswer ? { kind: "ready", label: WAITING_FOR_ANSWER } : null;
  if (!apk) return waiting ?? { kind: "idle", label: "Waiting for the first version" };
  if (device) {
    const action = appAction(app, device.installedVersion);
    if (action === "update") return { kind: "ready", label: "Update ready" };
    // Not on this phone yet: it never installs by itself, so the line asks for the tap.
    if (action === "install") return { kind: "ready", label: "Tap to install" };
    return waiting ?? { kind: "idle", label: `Version ${device.installedVersion} is on this phone` };
  }
  if (waiting) return waiting;
  const fresh = apk.finishedAt && now - Date.parse(apk.finishedAt) < 60 * 60_000;
  return fresh ? { kind: "ready", label: `Version ${apk.number} ready` } : { kind: "idle", label: "Up to date" };
}
