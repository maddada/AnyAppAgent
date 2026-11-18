// Web apps on the phone (docs/WEB-APPS.md): a web-only app never downloads or installs anything.
// Its tile opens the web screen (src/app/web/index.tsx), which runs it full screen in a WebView at
// its address (or from the PC when it is not online) with the window.kiwimake bridge. "Add to home
// screen" pins a shortcut that opens that screen straight away, also while the PC is off.
import { Share } from "react-native";
import { router } from "expo-router";
import { Directory, File, Paths } from "expo-file-system";
import { AnyAppNative } from "anyapp-native";
import { isWebOnly, shortAddress } from "@shared/chat/index";
import { launchApp } from "./installer";
import type { App } from "./protocol";
import { clientFor, getState, useStore } from "./store";
import { isCloudId } from "./cloud";

export { isWebOnly };

/** What the web screen needs to open an app without the PC, kept on the phone. */
export interface KnownWebApp {
  slug: string;
  name: string;
  address: string; // https://<login>.github.io/anyapp-<slug>-web/ (from the PC's app list only)
}

// ---------- the web apps this phone knows (their addresses come only from the PC's app list)

const knownFile = () => new File(Paths.document, "web-apps.json");
let known: Record<string, KnownWebApp> | null = null;

function loadKnown(): Record<string, KnownWebApp> {
  if (known) return known;
  try {
    const f = knownFile();
    known = f.exists ? (JSON.parse(f.textSync()) as Record<string, KnownWebApp>) : {};
  } catch {
    known = {};
  }
  return known;
}

function saveKnown(next: Record<string, KnownWebApp>) {
  known = next;
  try {
    knownFile().write(JSON.stringify(next));
  } catch {
    // best effort: the app list has them again once the PC answers
  }
}

/**
 * An address a web app may live at: https (GitHub Pages), or http on this phone itself (a local
 * stand-in for GitHub Pages reached through adb reverse, docs/WEB-APPS.md; never another host).
 */
export function isSiteAddress(url: string): boolean {
  return /^https:\/\//i.test(url) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//i.test(url);
}

/** Keeps the saved addresses in step with the app list (called once at start). */
export function initWebApps() {
  let last: Record<string, App> | null = null;
  const sync = (apps: Record<string, App>) => {
    if (apps === last) return;
    last = apps;
    const now = loadKnown();
    let changed = false;
    const next = { ...now };
    for (const app of Object.values(apps)) {
      const address = app.web?.address;
      if (!address || !isSiteAddress(address)) {
        // It has no address any more (a site the PC took down): forget it.
        if (next[app.id] && !app.web) {
          delete next[app.id];
          changed = true;
        }
        continue;
      }
      const entry = { slug: app.slug, name: app.name, address };
      const had = next[app.id];
      if (!had || had.slug !== entry.slug || had.name !== entry.name || had.address !== entry.address) {
        next[app.id] = entry;
        changed = true;
      }
    }
    if (changed) saveKnown(next);
  };
  sync(getState().apps);
  useStore.subscribe((s) => sync(s.apps));
}

/**
 * The person's own web app as far as this phone can tell: from the app list, else what was saved
 * from it before (the PC is off). Null when this phone has never seen it with an address.
 */
export function knownWebApp(appId: string): KnownWebApp | null {
  const app = getState().apps[appId];
  if (app?.web?.address) return { slug: app.slug, name: app.name, address: app.web.address };
  return loadKnown()[appId] ?? null;
}

// ---------- AI (modules/anyapp-ai, AiWebCalls.kt)

/** The AI usage key of an app's web version: Settings lists it as "<App name> (web)". */
export const webAiKey = (slug: string) => `web:${slug}`;
export const webAiLabel = (name: string) => `${name} (web)`;

// ---------- opening

/** Opens the web screen for an app (a web app, or the web version of an app with both). */
export function openWebApp(app: Pick<App, "id">) {
  router.push({ pathname: "/web", params: { app: app.id } });
}

/** "Open": the web screen for a web app, the installed Android app for the others. */
export function openApp(app: App): boolean {
  if (isWebOnly(app)) {
    openWebApp(app);
    return true;
  }
  return launchApp(app);
}

/** The link a home screen shortcut opens: what the web screen needs, without the PC. */
export function webLink(appId: string, address: string | undefined, name: string): string {
  const q = [`app=${encodeURIComponent(appId)}`, ...(address ? [`url=${encodeURIComponent(address)}`] : []), `name=${encodeURIComponent(name)}`];
  return `anyappagent://web?${q.join("&")}`;
}

/** Android's share sheet with the address. */
export function shareAddress(address: string, name?: string) {
  void Share.share({ message: address, ...(name ? { title: name } : {}) }).catch(() => undefined);
}

export { shortAddress };

/** Whether this phone's launcher can pin shortcuts (false on an older native build). */
export function canAddToHomeScreen(): boolean {
  try {
    return !!AnyAppNative?.pinWebShortcut && (AnyAppNative.canPinShortcuts?.() ?? true);
  } catch {
    return false;
  }
}

/**
 * "Add to home screen": the app's icon from the PC (saved to a cache file for the launcher), then
 * the launcher's own confirmation. Returns a sentence when it could not, else null.
 */
export async function addToHomeScreen(app: App): Promise<string | null> {
  if (!AnyAppNative?.pinWebShortcut) return "This Kiwimake can't add shortcuts. Update it and try again.";
  const address = app.web?.address;
  let iconPath: string | null = null;
  const client = clientFor(app.id);
  if (client && !isCloudId(app.id)) {
    try {
      const dir = new Directory(Paths.cache, "shortcut-icons");
      if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
      const file = new File(dir, `${app.slug || "app"}-${app.iconVersion}.png`);
      if (!file.exists) await File.downloadFileAsync(client.iconUrl(app.id), file, { headers: client.authHeaders(), idempotent: true });
      iconPath = file.uri;
    } catch {
      iconPath = null; // the PC is off: Kiwimake's own icon stands in
    }
  }
  try {
    const ok = AnyAppNative.pinWebShortcut(`web-${app.id}`, app.name, webLink(app.id, address, app.name), iconPath);
    return ok ? null : "Your home screen doesn't take shortcuts from apps.";
  } catch {
    return "Your home screen didn't take the shortcut. Try again.";
  }
}
