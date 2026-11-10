import type { PackageInfo } from "anyapp-native";
import type { App } from "./protocol";
import { appAction, type InstallProgress } from "./store";

export type Tone = "busy" | "ready" | "problem" | "quiet";

/** The one short state shown on an app's tile and in its sheet. */
export function describeApp(app: App, pkg: PackageInfo | null | undefined, install?: InstallProgress): { label: string; tone: Tone; live: boolean } | null {
  if (install) {
    switch (install.phase) {
      case "waiting":
      case "downloading":
        return {
          label: install.progress ? `Downloading ${Math.round(install.progress * 100)}%` : "Downloading",
          tone: "busy",
          live: true,
        };
      case "checking":
      case "installing":
      case "confirm":
        return { label: "Installing", tone: "busy", live: true };
      case "done":
        return { label: "Installed", tone: "ready", live: false };
      case "failed":
        return { label: "Didn't install", tone: "problem", live: false };
    }
  }
  switch (app.status) {
    case "creating":
      return { label: "Making it", tone: "busy", live: true };
    case "working":
      return { label: "Working", tone: "busy", live: true };
    case "building":
      return { label: "Building", tone: "busy", live: true };
    case "error":
      return { label: "Problem", tone: "problem", live: false };
  }
  const action = appAction(app, pkg);
  if (action === "update") return { label: "Update ready", tone: "ready", live: false };
  if (action === "install") return { label: "Ready to install", tone: "ready", live: false };
  return null;
}

export function actionLabel(action: ReturnType<typeof appAction>): string {
  return action === "install" ? "Install" : action === "update" ? "Update" : action === "open" ? "Open" : "Not ready yet";
}
