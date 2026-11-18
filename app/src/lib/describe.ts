import type { PackageInfo } from "anyapp-native";
import { appAction, describeApp as describeShared, installLabel, isWebOnly, type AppAction, type StateText } from "@shared/chat/index";
import type { App } from "./protocol";
import type { InstallProgress } from "./store";

/**
 * The one short state shown on an app's tile, in its sheet and in the chat header: the shared
 * wording (shared/chat/state.ts, the same as the desktop's) plus what this phone knows about the
 * app on itself (installed version, an install in progress).
 */
export function describeApp(app: App, pkg: PackageInfo | null | undefined, install?: InstallProgress): StateText {
  if (isWebOnly(app)) return describeWeb(app);
  if (hasOldCopyInTheWay(install)) return { kind: "problem", label: REMOVE_OLD_SHORT };
  return describeShared(app, { installedVersion: pkg?.versionCode ?? null, install });
}

/**
 * A web app (docs/WEB-APPS.md): never installed, so never "Tap to install". While it is idle the
 * line says which version is live (or that it opens from the PC when it is not online).
 */
function describeWeb(app: App): StateText {
  const busy = describeShared(app);
  if (app.status !== "idle" || app.changingInCloud) return busy;
  const web = app.web;
  if (web?.publishing && web.publishing > (web.liveBuild ?? 0)) return { kind: "working", label: `Putting version ${web.publishing} online` };
  if (app.waitingForAnswer) return busy;
  if (web?.liveBuild) return web.error ? { kind: "problem", label: `Version ${web.liveBuild} is live. The newest didn't go online` } : { kind: "idle", label: `Version ${web.liveBuild} is live` };
  if (app.latestApk) return { kind: "idle", label: `Version ${app.latestApk.number}, opens from your PC` };
  return busy;
}

/** The tile line of a web app: the version that is live ("V8"), short enough for a half-width tile. */
function webTileState(app: App, waiting: TileStateText | null): TileStateText {
  const web = app.web;
  if (web?.publishing && web.publishing > (web.liveBuild ?? 0)) return { kind: "working", label: "Going online" };
  if (waiting) return waiting;
  if (web?.liveBuild) return { kind: "idle", label: `V${web.liveBuild}` };
  if (app.latestApk) return { kind: "idle", label: `V${app.latestApk.number}` };
  return { kind: "idle", label: "No version yet" };
}

/**
 * The copy on this phone is signed with another key (made on another PC, or by the cloud), so
 * Android refuses to install over it (installer.ts). The one way forward is to remove it first:
 * every place that offers to install the app (the chat's version card, the chat header, the
 * options sheet) offers REMOVE_OLD_AND_INSTALL instead of a plain Install that would fail again.
 */
export function hasOldCopyInTheWay(install?: InstallProgress): boolean {
  return install?.phase === "failed" && !!install.conflict;
}

export const REMOVE_OLD_AND_INSTALL = "Remove old version and install";
/** The same, short enough for a tile, the chat header's state line and the header button. */
export const REMOVE_OLD_SHORT = "Remove old version";

export function actionLabel(action: AppAction, buildNumber?: number): string {
  return action === "install" ? "Install" : action === "update" ? (buildNumber ? `Install version ${buildNumber}` : "Update") : action === "open" ? "Open" : "Not ready yet";
}

/**
 * The state line on a half-width home tile: always one short line ("V6", "Installing V6",
 * "5 of 12 MB", "Tap to install"), so it never wraps or is cut at 360 dp with large text. The
 * sheet and the chat header keep the full sentence from describeApp.
 */
/** The tile line for a plan or question page that waits for the person: short enough for a half-width tile. */
export const NEEDS_YOU = "Needs you";

/** A tile line; `attention` marks the one that waits for the person, drawn in the attention colour. */
export type TileStateText = StateText & { attention?: boolean };

export function tileState(app: App, pkg: PackageInfo | null | undefined, install?: InstallProgress): TileStateText {
  const full = describeApp(app, pkg, install);
  const v = (n: number | undefined) => (n ? `V${n}` : "");
  const webOnly = isWebOnly(app);
  if (install && !webOnly) {
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
        return { kind: "problem", label: install.conflict ? REMOVE_OLD_SHORT : "Didn't install" };
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
  // A plan or question page waits for the person (an update or install to tap still comes first).
  const waiting: TileStateText | null = app.waitingForAnswer ? { kind: "ready", label: NEEDS_YOU, attention: true } : null;
  if (webOnly) return webTileState(app, waiting);
  if (!app.latestApk) return waiting ?? { kind: "idle", label: "No version yet" };
  const action = appAction(app, pkg?.versionCode ?? null);
  if (action === "update") return { kind: "ready", label: `${v(app.latestApk.number)} ready` };
  if (action === "install") return { kind: "ready", label: "Tap to install" };
  if (waiting) return waiting;
  if (pkg) return { kind: "idle", label: v(pkg.versionCode) };
  return full;
}
