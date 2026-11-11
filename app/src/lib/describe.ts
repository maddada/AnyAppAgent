import type { PackageInfo } from "anyapp-native";
import { appAction, describeApp as describeShared, installLabel, type AppAction, type StateText } from "@shared/chat/index";
import type { App } from "./protocol";
import type { InstallProgress } from "./store";

/**
 * The one short state shown on an app's tile, in its sheet and in the chat header: the shared
 * wording (shared/chat/state.ts, the same as the desktop's) plus what this phone knows about the
 * app on itself (installed version, an install in progress).
 */
export function describeApp(app: App, pkg: PackageInfo | null | undefined, install?: InstallProgress): StateText {
  return describeShared(app, { installedVersion: pkg?.versionCode ?? null, install });
}

export function actionLabel(action: AppAction, buildNumber?: number): string {
  return action === "install" ? "Install" : action === "update" ? (buildNumber ? `Install version ${buildNumber}` : "Update") : action === "open" ? "Open" : "Not ready yet";
}

/**
 * The state line on a half-width home tile: always one short line ("V6", "Installing V6",
 * "5 of 12 MB", "Tap to install"), so it never wraps or is cut at 360 dp with large text. The
 * sheet and the chat header keep the full sentence from describeApp.
 */
export function tileState(app: App, pkg: PackageInfo | null | undefined, install?: InstallProgress): StateText {
  const full = describeApp(app, pkg, install);
  const v = (n: number | undefined) => (n ? `V${n}` : "");
  if (install) {
    switch (install.phase) {
      case "waiting":
        return { kind: "working", label: "Waiting" };
      case "downloading":
        return { kind: "working", label: installLabel(install, true) ?? "Downloading" };
      case "checking":
        return { kind: "working", label: "Checking" };
      case "installing":
      case "confirm":
        return { kind: "working", label: `Installing ${v(install.buildNumber)}`.trim() };
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
      const n = app.activeHelpers ?? 0;
      if (n > 0) return { kind: "working", label: n === 1 ? "1 helper" : `${n} helpers` };
      if (typeof app.activeHelpers === "number" && app.replying) return { kind: "working", label: "Answering" };
      return { kind: "working", label: "Working" };
    }
    case "building":
      return app.latestBuild?.status === "succeeded"
        ? { kind: "working", label: `Saving ${v(app.latestBuild.number)}` }
        : { kind: "working", label: `Building ${v(app.latestBuild?.number)}`.trim() };
    case "error":
      return { kind: "problem", label: app.latestBuild?.status === "failed" ? "Couldn't build" : "Went wrong" };
  }
  const built = app.latestBuild;
  if (built?.status === "succeeded" && built.number > (app.latestApk?.number ?? 0)) return { kind: "working", label: `Saving ${v(built.number)}` };
  if (!app.latestApk) return { kind: "idle", label: "No version yet" };
  const action = appAction(app, pkg?.versionCode ?? null);
  if (action === "update") return { kind: "ready", label: `${v(app.latestApk.number)} ready` };
  if (action === "install") return { kind: "ready", label: "Tap to install" };
  if (pkg) return { kind: "idle", label: v(pkg.versionCode) };
  return full;
}
