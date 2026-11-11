// The build card's words and state, the same on the phone and the PC. Only the last line differs
// where the two really know different things: the phone knows whether the app is installed on it,
// the PC knows whether the version has gone out to the phone.
import type { App, BuildInfo, ChatItem } from "../protocol.ts";

export type BuildCard =
  | { state: "running"; number: number; title: string; sub: string }
  | { state: "failed"; number: number; title: string; sub: string; canRetry: boolean }
  | { state: "ready"; number: number; title: string; sub: string; sent: boolean; installed: boolean }
  | { state: "older"; number: number; title: string };

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
  if (b.status === "running") return { state: "running", number: b.number, title: `Building version ${b.number}`, sub: item.text?.trim() || "Usually about two minutes" };
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
  if (!app || !newest) return { state: "older", number: b.number, title: `Version ${b.number} was ready` };
  const sent = (app.latestApk?.number ?? 0) >= b.number;
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
  return { state: "ready", number: b.number, title: "Your app is ready", sub, sent, installed };
}
