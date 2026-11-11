import type { PackageInfo } from "anyapp-native";
import { describeApp as describeShared, type AppAction, type StateText } from "@shared/chat/index";
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
