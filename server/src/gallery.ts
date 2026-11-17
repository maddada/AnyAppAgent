// Ready apps (docs/GALLERY.md): the companion reads the gallery list for the phone and the desktop
// (GET /api/gallery) and keeps it a few minutes, so opening the gallery again does not fetch it again.
// ANYAPP_GALLERY_URL points a test install at its own list: an http(s) address or a file on this PC.
import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import type { ServerResponse } from "node:http";
import type { GalleryList } from "../../shared/protocol.ts";
import { GALLERY_URLS, readGallery } from "../../shared/chat/gallery.ts";
import { HttpError } from "./http-error.ts";

const KEEP_MS = 10 * 60_000;
const TIMEOUT_MS = 10_000;

export interface GalleryOptions {
  /** Where to read the list, first that answers (default GALLERY_URLS, or ANYAPP_GALLERY_URL). */
  sources?: string[];
  fetch?: typeof fetch;
  keepMs?: number;
  now?: () => number;
}

export class Gallery {
  private readonly sources: string[];
  private readonly fetchImpl: typeof fetch;
  private readonly keepMs: number;
  private readonly now: () => number;
  private kept: { at: number; list: GalleryList } | null = null;
  private inFlight: Promise<GalleryList> | null = null;

  constructor(options: GalleryOptions = {}) {
    const fromEnv = process.env.ANYAPP_GALLERY_URL?.trim();
    this.sources = options.sources ?? (fromEnv ? [fromEnv] : GALLERY_URLS);
    this.fetchImpl = options.fetch ?? fetch;
    this.keepMs = options.keepMs ?? KEEP_MS;
    this.now = options.now ?? Date.now;
  }

  /** The list, from the first source that answers; the last good one when none does. */
  list(): Promise<GalleryList> {
    if (this.kept && this.now() - this.kept.at < this.keepMs) return Promise.resolve(this.kept.list);
    this.inFlight ??= this.read().finally(() => (this.inFlight = null));
    return this.inFlight;
  }

  private async read(): Promise<GalleryList> {
    let problem = "The list of ready apps could not be read. Try again later.";
    for (const source of this.sources) {
      try {
        const list = readGallery(await this.fetchSource(source));
        this.kept = { at: this.now(), list };
        return list;
      } catch (error) {
        if (error instanceof Error && /newer Kiwimake/.test(error.message)) problem = error.message;
      }
    }
    if (this.kept) return this.kept.list;
    throw new HttpError(502, problem);
  }

  private async fetchSource(source: string): Promise<unknown> {
    if (isAbsolute(source)) return JSON.parse(await readFile(source, "utf8"));
    const response = await this.fetchImpl(source, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }
}

let shared: Gallery | null = null;

/** GET /api/gallery for http.ts. */
export async function galleryRoute(res: ServerResponse, method: string, send: (res: ServerResponse, status: number, body: unknown) => void): Promise<void> {
  if (method !== "GET") throw new HttpError(405, "Method not allowed.");
  shared ??= new Gallery();
  send(res, 200, await shared.list());
}
