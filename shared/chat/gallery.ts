// Ready apps: the gallery of official Kiwimake apps (docs/GALLERY.md). The list (gallery.json) is
// served by kiwimake.ai and kept in the Kiwimake repository; each app lives in its public
// <owner>/anyapp-<slug>-releases repo (APKs, update.json, the code of each version). The phone and
// the desktop read the list with these functions; the companion serves it at GET /api/gallery.
//
// The mark ("Official Kiwimake App") is earned, not typed: an APK is installed only when its signing
// certificate is the one the list names, and a copy already on the phone shows the mark only when
// its certificate matches too. A lookalike with the same package or a copied releases repo never
// gets it. Plain functions, no I/O: test/gallery.test.ts.
import type { GalleryApp, GalleryList } from "../protocol.ts";

export type { GalleryApp, GalleryList };

/** The badge on every gallery card (the user's words). */
export const OFFICIAL_BADGE = "Official Kiwimake App";
/** Who the gallery's apps are by, unless the list names someone. */
export const GALLERY_MAKER = "Kiwimake";
/** Where the list is read from, first that answers. */
export const GALLERY_URLS = ["https://kiwimake.ai/gallery.json", "https://raw.githubusercontent.com/maddada/Kiwimake/main/website/public/gallery.json"];
export const GALLERY_FORMAT = 1;
/** More than this many apps in a list is not a list we made. */
const MAX_APPS = 60;

const PACKAGE = /^com\.anyapp\.[a-z][a-z0-9]{0,40}$/;
const REPO = /^[A-Za-z0-9-]{1,39}\/anyapp-[a-z0-9-]+-releases$/;
const CODE_REPO = /^[A-Za-z0-9-]{1,39}\/anyapp-[a-z0-9-]+$/;
const SHA256 = /^[0-9a-f]{64}$/;
/** Addresses a test list may use without https: the emulator's way to the PC, and this PC. */
const LOCAL_HOSTS = new Set(["10.0.2.2", "127.0.0.1", "localhost"]);

/** https, or plain http to this PC (test lists only). */
export function allowedUrl(text: unknown): text is string {
  if (typeof text !== "string" || text.length > 2000) return false;
  try {
    const url = new URL(text);
    return url.protocol === "https:" || (url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname));
  } catch {
    return false;
  }
}

function allowedIcon(text: unknown): text is string {
  return allowedUrl(text) || (typeof text === "string" && text.length < 300_000 && /^data:image\/(png|webp|jpeg);base64,[A-Za-z0-9+/=]+$/.test(text));
}

/** One line of plain text: no line breaks, no em dashes (the user's rule), at most `max` characters. */
function plain(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/\s*\u2014\s*/g, ", ").replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function readApp(value: unknown): GalleryApp | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  const packageName = typeof v.package === "string" ? v.package : "";
  const repo = typeof v.repo === "string" ? v.repo : "";
  const cert = typeof v.certSha256 === "string" ? v.certSha256.toLowerCase().replace(/:/g, "") : "";
  const name = plain(v.name, 50);
  if (!PACKAGE.test(packageName) || !REPO.test(repo) || !SHA256.test(cert) || !name) return null;
  const latest = typeof v.latest === "object" && v.latest !== null ? (v.latest as Record<string, unknown>) : {};
  const build = Number(latest.build);
  return {
    package: packageName,
    name,
    line: plain(v.line, 140),
    ...(allowedIcon(v.icon) ? { icon: v.icon } : {}),
    repo,
    ...(typeof v.code === "string" && CODE_REPO.test(v.code) ? { code: v.code } : {}),
    certSha256: cert,
    latest: {
      version: plain(latest.version, 30),
      build: Number.isInteger(build) && build > 0 ? build : 0,
    },
    ...(allowedUrl(v.feed) && /\.json(\?|$)/.test(v.feed) ? { feed: v.feed } : {}),
    ...(allowedUrl(v.installUrl) ? { installUrl: v.installUrl } : {}),
  };
}

/**
 * Reads gallery.json. Throws on something that is not a gallery list at all; drops single apps that
 * are not valid (a typo in one entry hides that app, not the gallery), and repeats of a package.
 */
export function readGallery(body: unknown): GalleryList {
  if (typeof body !== "object" || body === null) throw new Error("The list of ready apps is not readable.");
  const b = body as Record<string, unknown>;
  if (b.format !== GALLERY_FORMAT || !Array.isArray(b.apps)) throw new Error("The list of ready apps is from a newer Kiwimake. Update Kiwimake to see it.");
  const seen = new Set<string>();
  const apps: GalleryApp[] = [];
  for (const raw of b.apps.slice(0, MAX_APPS)) {
    const app = readApp(raw);
    if (!app || seen.has(app.package)) continue;
    seen.add(app.package);
    apps.push(app);
  }
  return {
    format: GALLERY_FORMAT,
    ...(typeof b.updatedAt === "string" ? { updatedAt: b.updatedAt.slice(0, 40) } : {}),
    maker: plain(b.maker, 60) || GALLERY_MAKER,
    apps,
  };
}

/** `anyapp-waterglass-releases` -> `waterglass`. */
export function gallerySlug(app: Pick<GalleryApp, "repo">): string {
  return /\/anyapp-([a-z0-9-]+)-releases$/.exec(app.repo)?.[1] ?? "";
}

/** The update feed the app's own updater reads (docs/DISTRIBUTION.md stage 3). */
export function galleryFeedUrl(app: Pick<GalleryApp, "repo" | "feed">): string {
  return app.feed ?? `https://github.com/${app.repo}/releases/latest/download/update.json`;
}

/** The latest full APK, for a link or a QR code (the same link Share makes). */
export function galleryInstallUrl(app: Pick<GalleryApp, "repo" | "installUrl">): string {
  return app.installUrl ?? `https://github.com/${app.repo}/releases/latest/download/${gallerySlug(app)}.apk`;
}

export function galleryReleasesUrl(app: Pick<GalleryApp, "repo">): string {
  return `https://github.com/${app.repo}`;
}

// ---------- the update feed (update.json) of a gallery app

export interface FeedApk {
  abi: string;
  url: string;
  size: number;
  sha256: string;
}

export interface GalleryFeed {
  build: number;
  version: string;
  notes: string;
  signer: string;
  blocked: number[];
  apks: FeedApk[];
}

/** Reads an update.json; APK addresses are relative to the feed's own address. */
export function readFeed(body: unknown, feedUrl: string): GalleryFeed {
  if (typeof body !== "object" || body === null) throw new Error("The app's release could not be read.");
  const b = body as Record<string, unknown>;
  const build = Number(b.build);
  if (b.format !== 1 || !Number.isInteger(build) || build <= 0 || !Array.isArray(b.apks)) throw new Error("The app's release could not be read.");
  const apks: FeedApk[] = [];
  for (const raw of b.apks) {
    if (typeof raw !== "object" || raw === null) continue;
    const a = raw as Record<string, unknown>;
    const name = typeof a.name === "string" ? a.name : "";
    const size = Number(a.size);
    const sha = typeof a.sha256 === "string" ? a.sha256.toLowerCase() : "";
    if (!/^[A-Za-z0-9._-]+\.apk$/.test(name) || !Number.isInteger(size) || size <= 0 || !SHA256.test(sha)) continue;
    const url = new URL(name, feedUrl).toString();
    if (!allowedUrl(url)) continue;
    apks.push({ abi: typeof a.abi === "string" ? a.abi : "universal", url, size, sha256: sha });
  }
  return {
    build,
    version: plain(b.version, 30) || String(build),
    notes: plain(b.notes, 500),
    signer: typeof b.signer === "string" ? b.signer.toLowerCase() : "",
    blocked: Array.isArray(b.blocked) ? b.blocked.filter((n): n is number => Number.isInteger(n)) : [],
    apks,
  };
}

/** The APK for a phone with these ABIs (best first): its own, else the full one. */
export function pickFeedApk(feed: GalleryFeed, abis: string[]): FeedApk | null {
  for (const abi of abis) {
    const own = feed.apks.find((a) => a.abi === abi);
    if (own) return own;
  }
  return feed.apks.find((a) => a.abi === "universal") ?? null;
}

/**
 * Why a feed must not be installed for this gallery app, in a sentence, or null when it may: its
 * signer must be the list's certificate (a copied or taken-over releases repo cannot pass), and its
 * build must not be one that was pulled back.
 */
export function feedProblem(app: Pick<GalleryApp, "certSha256" | "name">, feed: GalleryFeed): string | null {
  if (feed.signer !== app.certSha256) return `This ${app.name} is not signed by Kiwimake, so it was not installed.`;
  if (feed.blocked.includes(feed.build)) return `This version of ${app.name} was pulled back. Try again later.`;
  return null;
}

// ---------- what a card shows

export interface InstalledCopy {
  versionCode: number;
  /** SHA-256 of the installed copy's signing certificate; null when Android did not say. */
  certSha256: string | null;
}

/**
 * - `install`: not on this phone.
 * - `open`: the official copy, up to date as far as the list knows.
 * - `update`: the official copy, and the list (or its feed) has a newer build.
 * - `notOfficial`: an app with this package is on the phone, signed by another key: no badge, and
 *   Kiwimake will not install over it (Android would refuse anyway).
 * - `unknown`: on the phone, but Android did not tell its certificate (very old Android).
 */
export type GalleryState = "install" | "open" | "update" | "notOfficial" | "unknown";

export function galleryState(app: Pick<GalleryApp, "certSha256" | "latest">, installed: InstalledCopy | null | undefined, newestBuild?: number): GalleryState {
  if (!installed) return "install";
  if (installed.certSha256 === null) return "unknown";
  if (installed.certSha256.toLowerCase() !== app.certSha256) return "notOfficial";
  const newest = Math.max(app.latest.build, newestBuild ?? 0);
  return newest > installed.versionCode ? "update" : "open";
}

/** The badge shows on a card unless the copy on this phone is signed by someone else. */
export function showsBadge(state: GalleryState): boolean {
  return state !== "notOfficial";
}

/** The card's state line, or null when the card says enough without one. */
export function galleryStateLine(app: Pick<GalleryApp, "name" | "latest">, state: GalleryState): { kind: "ready" | "problem" | "idle"; text: string } | null {
  switch (state) {
    case "open":
      return { kind: "ready", text: "On this phone" };
    case "update":
      return { kind: "idle", text: app.latest.version ? `Version ${app.latest.version} is ready` : "A new version is ready" };
    case "notOfficial":
      return { kind: "problem", text: `The ${app.name} on this phone is not the official one. Remove it to install Kiwimake's.` };
    case "unknown":
      return { kind: "idle", text: "On this phone" };
    default:
      return null;
  }
}

/** `29881800` -> `28.5 MB` (download progress). */
export function formatGallerySize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}
