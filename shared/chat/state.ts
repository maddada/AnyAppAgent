// The one short state line of an app (list row, tile, sheet, chat header), worded into one of the
// four states the theme allows (working, ready, problem, idle). The phone passes what it knows
// about the app on itself (installed version, an install in progress); the PC passes nothing.
import type { App } from "../protocol.ts";

export type StateKind = "working" | "ready" | "problem" | "idle";
export interface StateText {
  kind: StateKind;
  label: string;
}

/** What the phone knows locally. */
export interface OnDevice {
  installedVersion: number | null; // versionCode installed on this phone, null when not installed
  install?: { phase: "waiting" | "downloading" | "checking" | "installing" | "confirm" | "done" | "failed"; progress?: number };
}

/** What the big button for an app should do on the phone right now. */
export type AppAction = "open" | "install" | "update" | "notReady";

export function appAction(app: App, installedVersion: number | null | undefined): AppAction {
  const latest = app.latestApk?.number;
  if (installedVersion == null) return latest ? "install" : "notReady";
  if (latest && latest > installedVersion) return "update";
  return "open";
}

export function describeApp(app: App, device?: OnDevice, now = Date.now()): StateText {
  const install = device?.install;
  if (install) {
    switch (install.phase) {
      case "waiting":
      case "downloading":
        return { kind: "working", label: install.progress ? `Downloading ${Math.round(install.progress * 100)}%` : "Downloading" };
      case "checking":
      case "installing":
      case "confirm":
        return { kind: "working", label: "Installing" };
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
  if (!apk) return { kind: "idle", label: "Waiting for the first version" };
  if (device) {
    const action = appAction(app, device.installedVersion);
    if (action === "update") return { kind: "ready", label: "Update ready" };
    if (action === "install") return { kind: "ready", label: "Ready to install" };
    return { kind: "idle", label: `Version ${device.installedVersion} is on this phone` };
  }
  const fresh = apk.finishedAt && now - Date.parse(apk.finishedAt) < 60 * 60_000;
  return fresh ? { kind: "ready", label: `Version ${apk.number} ready` } : { kind: "idle", label: "Up to date" };
}
