// Web apps on the PC (docs/WEB-APPS.md): the words of a web app's state line, and what the build
// card's web part shows. Plain functions, so the tests read them without a window.
import type { App } from "../../shared/types.ts";
import { describeApp, isWebOnly, shortAddress, type StateKind, type WebCardPart } from "../../../../shared/chat/index.ts";
import { isOpenableUrl } from "../../shared/links.ts";

/**
 * A web app's state line (app list row, chat header): "Live on the web, version 8" where an Android
 * app says "Version 8 ready" or "Up to date". Null for an app that makes an Android app (it keeps
 * the shared words). Busy, problem and waiting lines are the same as for any app.
 */
export function webAppState(app: App, now = Date.now()): { state: StateKind; text: string } | null {
  if (!isWebOnly(app)) return null;
  // The words live in shared/chat describeApp, so the phone says the same.
  const st = describeApp(app, undefined, now);
  return { state: st.kind, text: st.label };
}

/** What a build card's web part draws. */
export interface WebPartView {
  heading?: string; // over the part on an app with both targets
  /** Online: the short address with Open, Copy link and the QR code of `address`. */
  live?: { address: string; short: string };
  state: StateKind; // for the line when it is not online
  line: string;
}

/** @param both the app also makes an Android app: the web part sits under the Android card. */
export function webPartView(part: WebCardPart, both: boolean): WebPartView {
  const heading = both ? "Web version" : undefined;
  const base = { ...(heading ? { heading } : {}), line: part.line };
  if (part.state === "live" && part.address && isOpenableUrl(part.address)) return { ...base, live: { address: part.address, short: shortAddress(part.address) }, state: "ready" };
  const state: StateKind = part.state === "publishing" ? "working" : part.state === "failed" ? "problem" : part.state === "live" ? "ready" : "idle";
  return { ...base, state };
}
