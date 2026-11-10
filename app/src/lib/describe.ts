import type { PackageInfo } from "anyapp-native";
import type { StateKind } from "@/ui/StateLine";
import type { App } from "./protocol";
import { appAction, type InstallProgress } from "./store";

/**
 * The one short state shown on an app's tile, in its sheet and in the chat header, worded into
 * one of the four states the theme allows (working, ready, problem, idle).
 */
export function describeApp(app: App, pkg: PackageInfo | null | undefined, install?: InstallProgress): { kind: StateKind; label: string } | null {
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
    case "working":
      return { kind: "working", label: "Making changes" };
    case "building":
      return { kind: "working", label: app.latestBuild ? `Building version ${app.latestBuild.number}` : "Building" };
    case "error":
      return { kind: "problem", label: app.latestBuild?.status === "failed" ? "Couldn't build" : "Something went wrong" };
  }
  const action = appAction(app, pkg);
  if (action === "update") return { kind: "ready", label: "Update ready" };
  if (action === "install") return { kind: "ready", label: "Ready to install" };
  if (pkg) return { kind: "idle", label: `Version ${pkg.versionCode} is on this phone` };
  return null;
}

export function actionLabel(action: ReturnType<typeof appAction>, buildNumber?: number): string {
  return action === "install" ? "Install" : action === "update" ? (buildNumber ? `Install version ${buildNumber}` : "Update") : action === "open" ? "Open" : "Not ready yet";
}
