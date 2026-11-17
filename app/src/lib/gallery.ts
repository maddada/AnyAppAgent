// Ready apps, the gallery of official Kiwimake apps (docs/GALLERY.md), on the phone: the list, which
// of its apps are on this phone and whether they are the official copies, and Install.
//
// The list comes from the paired PC (GET /api/gallery) when it is connected, else straight from
// kiwimake.ai (or the Kiwimake repository on GitHub). Install needs no PC: it reads the app's
// update.json on its public releases repo, downloads the APK for this phone, checks its size and
// SHA-256, checks that its signing certificate is the one the list names, and only then hands it
// to Android. A copy already on the phone shows the official mark only when its certificate is the
// list's too. Updates come from the maker's Publish, through the updater inside every app, so
// Kiwimake tells the apps it installed from here that it does not handle their updates.
import { File, Paths } from "expo-file-system";
import { create } from "zustand";
import { AnyAppNative } from "anyapp-native";
import { feedProblem, galleryFeedUrl, galleryState, GALLERY_URLS, pickFeedApk, readFeed, readGallery, type GalleryState, type InstalledCopy } from "@shared/chat/gallery";
import type { GalleryApp, GalleryList } from "./protocol";
import { getState as appState } from "./store";
import { INSTALL_ANSWER_MS, phoneAbis } from "./installer";

/** The list is read again after this long (opening the gallery, coming back to Home). */
const KEEP_MS = 10 * 60_000;

export type GalleryInstall =
  | { phase: "downloading"; bytes: number; total: number }
  | { phase: "checking" }
  | { phase: "installing" }
  | { phase: "failed"; message: string; permission?: boolean };

type State = {
  list: GalleryList | null;
  loading: boolean;
  error: string | null;
  at: number;
  /** Package -> the copy on this phone (null: not installed). */
  installed: Record<string, InstalledCopy | null>;
  /** Package -> the newest build its update.json named (read at Install, or Update). */
  newest: Record<string, number>;
  installs: Record<string, GalleryInstall>;
};

export const useGallery = create<State>(() => ({ list: null, loading: false, error: null, at: 0, installed: {}, newest: {}, installs: {} }));

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function readList(): Promise<GalleryList> {
  const { client, connection } = appState();
  if (client && connection === "online") {
    try {
      return readGallery(await client.gallery());
    } catch (error) {
      // An older PC (404) or one that cannot reach the internet: try the list itself.
      console.log(`gallery: the PC did not give the list (${errorMessage(error)}); reading it directly`);
    }
  }
  let problem: unknown = null;
  for (const url of GALLERY_URLS) {
    try {
      return readGallery(await fetchJson(url));
    } catch (error) {
      problem = error;
    }
  }
  throw new Error(problem instanceof Error && /newer Kiwimake/.test(problem.message) ? problem.message : "Couldn't get the list of ready apps. Check the internet connection.");
}

let loading: Promise<void> | null = null;

/** Reads the list (again when it is older than KEEP_MS, or `force`), then what is on this phone. */
export function loadGallery(force = false): Promise<void> {
  const s = useGallery.getState();
  if (!force && s.list && Date.now() - s.at < KEEP_MS) {
    refreshInstalled();
    return Promise.resolve();
  }
  loading ??= (async () => {
    useGallery.setState({ loading: true });
    try {
      const list = await readList();
      useGallery.setState({ list, error: null, at: Date.now() });
      refreshInstalled();
    } catch (error) {
      useGallery.setState({ error: errorMessage(error) });
    } finally {
      useGallery.setState({ loading: false });
      loading = null;
    }
  })();
  return loading;
}

/** Asks Android which gallery apps are here and who signed them; tells the native side which came from here. */
export function refreshInstalled(): void {
  const list = useGallery.getState().list;
  if (!list || !AnyAppNative) return;
  const installed: Record<string, InstalledCopy | null> = {};
  let infos: Record<string, { versionCode: number; apkVersionCode?: number } | null> = {};
  try {
    infos = AnyAppNative.getPackagesInfo(list.apps.map((a) => a.package));
  } catch {
    return;
  }
  for (const app of list.apps) {
    const info = infos[app.package];
    if (!info) {
      installed[app.package] = null;
      continue;
    }
    let cert: string | null = null;
    try {
      cert = AnyAppNative.signingCertSha256?.(app.package) ?? null;
    } catch {
      cert = null;
    }
    installed[app.package] = { versionCode: info.apkVersionCode ?? info.versionCode, certSha256: cert };
  }
  useGallery.setState({ installed });
  // The official copies of apps that are not the person's own: their maker's updates reach them
  // through their own updater, so Kiwimake must not say it handles them.
  const own = new Set(Object.values(appState().apps).map((a) => a.packageName));
  const fromGallery = list.apps.filter((a) => !own.has(a.package) && galleryState(a, installed[a.package]) !== "notOfficial" && installed[a.package]).map((a) => a.package);
  try {
    AnyAppNative.setGalleryApps?.(fromGallery);
  } catch {
    // an older native module: nothing to tell
  }
}

/** What the card for this app shows. */
export function useGalleryState(app: GalleryApp): GalleryState {
  const installed = useGallery((s) => s.installed[app.package]);
  const newest = useGallery((s) => s.newest[app.package]);
  return galleryState(app, installed, newest);
}

function setInstall(pkg: string, install: GalleryInstall | null) {
  useGallery.setState((s) => {
    const installs = { ...s.installs };
    if (install) installs[pkg] = install;
    else delete installs[pkg];
    return { installs };
  });
}

const BUSY = new Set(["downloading", "checking", "installing"]);

/** Install (or Update): the official signed APK from the app's releases repo, checked before Android sees it. */
export async function installFromGallery(app: GalleryApp): Promise<void> {
  const now = useGallery.getState().installs[app.package];
  if (now && BUSY.has(now.phase)) return;
  if (!AnyAppNative) return setInstall(app.package, { phase: "failed", message: "Installing needs the Kiwimake app on Android." });
  if (!AnyAppNative.canInstallPackages()) {
    return setInstall(app.package, { phase: "failed", permission: true, message: "Allow Kiwimake to install apps, then tap Install again." });
  }
  const file = new File(Paths.cache, `gallery-${app.package}.apk`);
  try {
    setInstall(app.package, { phase: "downloading", bytes: 0, total: 0 });
    const feedUrl = galleryFeedUrl(app);
    let feed;
    try {
      feed = readFeed(await fetchJson(feedUrl), feedUrl);
    } catch {
      throw new Error(`Couldn't get ${app.name} from GitHub. Check the internet connection and try again.`);
    }
    const problem = feedProblem(app, feed);
    if (problem) throw new Error(problem);
    useGallery.setState((s) => ({ newest: { ...s.newest, [app.package]: feed.build } }));
    const apk = pickFeedApk(feed, phoneAbis());
    if (!apk) throw new Error(`${app.name} has no version for this phone yet.`);
    if (file.exists) file.delete();
    setInstall(app.package, { phase: "downloading", bytes: 0, total: apk.size });
    const got = await File.downloadFileAsync(apk.url, file, {
      idempotent: true,
      onProgress: ({ bytesWritten, totalBytes }) => setInstall(app.package, { phase: "downloading", bytes: bytesWritten, total: totalBytes > 0 ? totalBytes : apk.size }),
    });
    setInstall(app.package, { phase: "checking" });
    if (got.size !== apk.size) throw new Error("The download was incomplete. Try again.");
    const sum = await AnyAppNative.sha256File(got.uri);
    if (sum.toLowerCase() !== apk.sha256) throw new Error("The download was damaged. Try again.");
    // The mark is earned here: the APK itself must be signed with the certificate the list names.
    const cert = AnyAppNative.apkCertSha256?.(got.uri) ?? null;
    if (cert === null || cert !== app.certSha256) throw new Error(`This download of ${app.name} is not signed by Kiwimake, so it was not installed.`);
    if (AnyAppNative.signedLikeInstalled?.(got.uri, app.package) === false) {
      throw new Error(`The ${app.name} on this phone is not the official one. Remove it, then install Kiwimake's.`);
    }
    setInstall(app.package, { phase: "installing" });
    console.log(`gallery: installing ${app.package} build ${feed.build} (certificate checked)`);
    const result = await AnyAppNative.install(got.uri, INSTALL_ANSWER_MS);
    if (result.status === "success") {
      setInstall(app.package, null);
      console.log(`gallery: ${app.package} installed`);
    } else if (result.status === "cancelled") {
      setInstall(app.package, null);
    } else {
      throw new Error(result.status === "storage" ? "The phone is out of space." : result.status === "conflict" ? `The ${app.name} on this phone is not the official one. Remove it, then install Kiwimake's.` : "Android didn't install it. Try again.");
    }
  } catch (error) {
    setInstall(app.package, { phase: "failed", message: errorMessage(error) });
  } finally {
    try {
      if (file.exists) file.delete();
    } catch {
      // ignore
    }
    refreshInstalled();
  }
}

export function openGalleryApp(app: GalleryApp): boolean {
  return AnyAppNative?.launch(app.package) ?? false;
}
