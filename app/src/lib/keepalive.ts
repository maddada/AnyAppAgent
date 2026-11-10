import { AnyAppNative } from "anyapp-native";
import { getState } from "./store";

let running = false;

/**
 * While the PC is making or changing an app, keep AnyAppAgent alive (a quiet ongoing
 * notification) so it hears "ready" even from the background and can announce it.
 */
export function updateKeepAlive() {
  if (!AnyAppNative) return;
  const busy = Object.values(getState().apps).filter((a) => a.status === "creating" || a.status === "working" || a.status === "building");
  if (busy.length > 0) {
    const text = busy.length === 1 ? `Your PC is working on ${busy[0].name}` : `Your PC is working on ${busy.length} apps`;
    // Re-sent when the text changes; Android only allows starting it while we're in front.
    if (!running || lastText !== text) {
      running = AnyAppNative.startKeepAlive(text) || running;
      lastText = text;
    }
  } else if (running) {
    AnyAppNative.stopKeepAlive();
    running = false;
    lastText = "";
  }
}

let lastText = "";
