// The build card's words and state, the same on the phone and the PC. Only the last line differs
// where the two really know different things: the phone knows whether the app is installed on it,
// the PC knows whether the version has gone out to the phone.
import type { App, AppTarget, BuildInfo, ChatItem } from "../protocol.ts";
import { changeLines, type ChangeLine } from "./history.ts";

export type BuildCard =
  | { state: "running"; number: number; title: string; sub: string }
  | { state: "failed"; number: number; title: string; sub: string; canRetry: boolean }
  | { state: "ready"; number: number; title: string; sub: string; sent: boolean; installed: boolean; changes: ChangeLine[]; web?: WebCardPart }
  | { state: "older"; number: number; title: string; changes: ChangeLine[] };

/**
 * The web version on a build card (docs/WEB-APPS.md): its address with Open, Copy link and a QR code
 * when it is online. On a web app's card it is the whole card; on an app with both targets it is a
 * line under the Android part.
 */
export interface WebCardPart {
  state: "publishing" | "live" | "failed" | "local";
  address?: string; // set when live: what Open, Copy link and the QR use
  line: string; // one plain line about the web version
}

/** What an app's builds make (App.targets; absent means Android, or web for a web app). */
export function appTargets(app: Pick<App, "preset" | "targets"> | undefined): AppTarget[] {
  if (app?.targets && app.targets.length > 0) return app.targets;
  return app?.preset === "web" ? ["web"] : ["android"];
}

/** A web app only (no APK): the phone opens it, never installs it. */
export function isWebOnly(app: Pick<App, "preset" | "targets"> | undefined): boolean {
  const targets = appTargets(app);
  return targets.includes("web") && !targets.includes("android");
}

/** The address without "https://" and the last "/", for showing: "maddada.github.io/anyapp-teatimer-web". */
export function shortAddress(address: string): string {
  return address.replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

function webPart(b: BuildInfo): WebCardPart | undefined {
  const w = b.web;
  if (!w) return undefined;
  if (w.state === "live") return { state: "live", ...(w.address ? { address: w.address } : {}), line: "Open copies reload by themselves." };
  if (w.state === "publishing") return { state: "publishing", line: "Putting it online, usually under a minute." };
  if (w.state === "failed") return { state: "failed", line: w.error?.trim() || "It could not go online just now. The version before stays online." };
  return { state: "local", line: "Not online: this PC does not put web apps online (GitHub is not set up). It opens from your PC." };
}

export function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${Math.round(bytes / 1024 / 1024)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * The APK a phone downloads for a build: the variant for the first of its ABIs (best first, as
 * Android lists them) that the build has, else the full APK. `abi` is set for a variant.
 */
export function apkFor(build: BuildInfo, abis: readonly string[] = []): { abi?: string; sizeBytes?: number; sha256?: string } {
  for (const abi of abis) {
    const variant = build.variants?.find((v) => v.abi === abi);
    if (variant) return variant;
  }
  return { ...(build.sizeBytes !== undefined ? { sizeBytes: build.sizeBytes } : {}), ...(build.sha256 ? { sha256: build.sha256 } : {}) };
}

/**
 * @param side "phone" or "pc".
 * @param abis the phone's ABIs (phone only): the size shown is what this phone downloads.
 * @param installedVersion the versionCode of this app on this phone (phone only; null when not installed).
 */
export function buildCard(item: ChatItem, app: App | undefined, side: "phone" | "pc", installedVersion?: number | null, abis?: readonly string[]): BuildCard | null {
  const b = item.build;
  if (!b) return null;
  if (b.status === "running") {
    const title = b.restoredFrom ? `Going back to version ${b.restoredFrom}` : `Building version ${b.number}`;
    return { state: "running", number: b.number, title, sub: item.text?.trim() || "Usually about two minutes" };
  }
  if (b.status === "failed") {
    // Only the newest build can be tried again, and only while nothing else runs.
    const newest = (app?.latestBuild?.number ?? b.number) <= b.number;
    const idle = app?.status === "idle" || app?.status === "error";
    return { state: "failed", number: b.number, title: `Version ${b.number} didn't build`, sub: b.error?.trim() || "Ask for a fix in a message below, or try again.", canRetry: !!app && newest && idle };
  }
  // Succeeded. Only the newest build gets the card; older ones are a quiet line. The companion
  // says "idle" a moment before apk.ready, so app.latestApk can still be the older build here: a
  // succeeded build at least as new as it is the newest one.
  const newest = (app?.latestApk?.number ?? 0) <= b.number;
  // "What changed" (docs/VERSIONS.md): on the newest card in full; an older line keeps its first line.
  const changes = changeLines(b.changes);
  if (!app || !newest) return { state: "older", number: b.number, title: `Version ${b.number} was ready`, changes: changes.slice(0, 1) };
  const sent = (app.latestApk?.number ?? 0) >= b.number;
  const web = webPart(b);
  // A web app (docs/WEB-APPS.md): nothing to install. The card says where it is online.
  if (isWebOnly(app) && web) {
    const title = b.restoredFrom
      ? `Back to version ${b.restoredFrom}`
      : web.state === "live"
        ? `Version ${b.number} is live`
        : web.state === "publishing"
          ? `Version ${b.number} is going online`
          : web.state === "failed"
            ? `Version ${b.number} is not online`
            : `Version ${b.number} is ready`;
    const size = b.web?.sizeBytes ? `, ${formatSize(b.web.sizeBytes)}` : "";
    return { state: "ready", number: b.number, title, sub: `Web app, version ${b.number}${size}`, sent: web.state === "live", installed: false, changes, web };
  }
  const installed = installedVersion != null && installedVersion >= b.number;
  const bytes = side === "phone" ? apkFor(b, abis).sizeBytes : b.sizeBytes;
  const size = bytes ? `, ${formatSize(bytes)}` : "";
  // An app that is not on this phone yet never installs by itself: the card asks for the tap.
  const sub =
    side === "phone"
      ? installed
        ? `Version ${b.number}. Installed`
        : installedVersion == null
          ? `Version ${b.number}${size}. Tap Install to put it on this phone`
          : `Version ${b.number}${size}`
      : sent
        ? `Version ${b.number}${size}. Sent to your phone`
        : `Version ${b.number}${size}. Saving it, then it goes to your phone`;
  // The fast lane (docs/FAST-LANE.md): a quick update goes to the app over the air, no install.
  // A phone without the app (or with older native parts) still gets the APK, as above.
  if (b.delivery === "quick" && b.ota && (side === "pc" || installedVersion != null)) {
    const quickSub =
      side === "phone"
        ? installed
          ? `Version ${b.number}. No install needed: tap Reload in the app`
          : `Version ${b.number}, ${formatSize(b.ota.sizeBytes)}. No install needed`
        : sent
          ? `Version ${b.number}, ${formatSize(b.ota.sizeBytes)}. No install needed`
          : `Version ${b.number}. Saving it, then it goes to your phone`;
    return { state: "ready", number: b.number, title: b.restoredFrom ? `Back to version ${b.restoredFrom}` : "Sent as a quick update", sub: quickSub, sent, installed, changes, ...(web ? { web } : {}) };
  }
  const title = b.restoredFrom ? `Back to version ${b.restoredFrom}` : "Your app is ready";
  return { state: "ready", number: b.number, title, sub, sent, installed, changes, ...(web ? { web } : {}) };
}
