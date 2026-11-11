import { AnyAppNative } from "anyapp-native";
import { theme } from "@shared/theme/tokens";
import { getState } from "./store";

let running = false;

/**
 * While the PC is making or changing an app, or an APK is on its way to this phone, keep
 * AnyAppAgent alive (a quiet ongoing notification): it hears "ready" from the background, and
 * Android does not freeze it halfway through a download.
 */
export function updateKeepAlive() {
  if (!AnyAppNative) return;
  const { apps, installs } = getState();
  const busy = Object.values(apps).filter((a) => a.status === "creating" || a.status === "working" || a.status === "building");
  const fetching = Object.entries(installs)
    .filter(([, i]) => i.phase === "waiting" || i.phase === "downloading" || i.phase === "checking" || i.phase === "installing")
    .map(([id]) => apps[id]?.name ?? "your app");
  if (busy.length > 0 || fetching.length > 0) {
    const text =
      fetching.length > 0
        ? fetching.length === 1
          ? `Getting ${fetching[0]} onto your phone`
          : `Getting ${fetching.length} apps onto your phone`
        : busy.length === 1
          ? `Your PC is working on ${busy[0].name}`
          : `Your PC is working on ${busy.length} apps`;
    // Re-sent when the text changes; Android only allows starting it while we're in front.
    if (!running || lastText !== text) {
      running = AnyAppNative.startKeepAlive(text, theme.color.light.accent) || running;
      lastText = text;
    }
  } else if (running) {
    AnyAppNative.stopKeepAlive();
    running = false;
    lastText = "";
  }
}

let lastText = "";
