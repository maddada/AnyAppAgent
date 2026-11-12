import { AnyAppNative } from "anyapp-native";
import { theme } from "@shared/theme/tokens";
import { getState } from "./store";

let running = false;
let stopTimer: ReturnType<typeof setTimeout> | null = null;
/**
 * How long the service stays after the work ended. A build ends ("idle") a moment before its APK
 * is announced; if the service stopped in between, the download that follows could not start it
 * again from the background (Android refuses) and Android would freeze Kiwimake mid-download.
 */
const LINGER_MS = 30_000;

/**
 * While the PC is making or changing an app, or an APK is on its way to this phone, keep
 * Kiwimake alive (a quiet ongoing notification): it hears "ready" from the background, and
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
    if (stopTimer) clearTimeout(stopTimer);
    stopTimer = null;
    // Started only while we're in front (Android's rule); once it runs, a new text is changed in place.
    if (!running || lastText !== text) {
      running = AnyAppNative.startKeepAlive(text, theme.color.light.accent) || running;
      lastText = text;
    }
  } else if (running && !stopTimer) {
    stopTimer = setTimeout(() => {
      stopTimer = null;
      AnyAppNative?.stopKeepAlive();
      running = false;
      lastText = "";
    }, LINGER_MS);
  }
}

/** True while the keep-alive service runs: Kiwimake will not be frozen, even in the background. */
export function keptAlive(): boolean {
  try {
    return AnyAppNative?.keepAliveRunning?.() ?? false;
  } catch {
    return false;
  }
}

let lastText = "";
