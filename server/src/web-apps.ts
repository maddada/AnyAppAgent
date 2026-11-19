// Web apps in the companion (docs/WEB-APPS.md, decisions of 18 Nov 2026): the web half of a build,
// putting every successful build online (web-host.ts), "Web, Android or Both" (the plan page's
// switch, set by the app's agent with its set_app_kind tool), and opening the newest web build from
// this PC when the app is not online.
//
// A web app (preset "web") has its web project at the app's root; an app with both targets keeps
// the Android app at the root and its web version in <app>/web. Both are built after every change.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join, normalize, sep } from "node:path";
import { randomUUID } from "node:crypto";
import type { App, AppTarget, BuildInfo, WebBuildInfo, WebOpenResponse } from "../../shared/protocol.ts";
import { appTargets } from "../../shared/chat/build.ts";
import type { Builder } from "./builder.ts";
import * as git from "./git.ts";
import { HttpError } from "./http-error.ts";
import { contentType, WebPublisher, WebPublishRefused, type WebHost } from "./web-host.ts";

export { appTargets };

/** Root files that belong to the app, not to its template: kept when the kind changes. */
const KEPT_ON_RESCAFFOLD = new Set([".git", ".claude", "overview.md", "APP_MEMORY.md", "FAKE_BUILD_FAIL"]);

const KEEP_WEB_BUILDS = 3;

export interface WebAppsHost {
  stateDir: string;
  builder: Builder;
  log(...parts: unknown[]): void;
  /** Where the app's builds are kept (store.apkDir). */
  buildsDir(appId: string): string;
  /** The app's record changed (broadcast app.updated, save). */
  touch(appId: string): void;
  /** The build's chat card changed. */
  updateBuildCard(appId: string, rowId: string, build: BuildInfo): void;
  /** Whether the app still exists (not deleted). */
  alive(appId: string): boolean;
}

export interface WebAppRecord {
  app: App;
  dir: string;
}

export function webProjectDir(record: WebAppRecord): string {
  return record.app.preset === "web" ? record.dir : join(record.dir, "web");
}

export function webBuildDir(buildsDir: string, number: number): string {
  return join(buildsDir, `web-${number}`);
}

export class WebApps {
  readonly publisher: WebPublisher;
  private readonly host: WebAppsHost;
  /** One publish at a time per app (they share the site's folder); the newest build goes last. */
  private readonly publishing = new Map<string, Promise<void>>();

  constructor(host: WebAppsHost, webHost: WebHost | null, fetchImpl?: typeof fetch) {
    this.host = host;
    this.publisher = new WebPublisher({ stateDir: host.stateDir, host: webHost, ...(fetchImpl ? { fetch: fetchImpl } : {}) });
  }

  /** True when this PC puts web apps online (GitHub, or the local stand-in). */
  get online(): boolean {
    return this.publisher.host !== null;
  }

  // ---------- the web half of a build

  /** Builds the web version and keeps it with the app's builds. Rejects like buildApk (the agent fixes it). */
  async build(record: WebAppRecord, number: number, onLog: (line: string) => void): Promise<WebBuildInfo> {
    if (!this.host.builder.buildWeb) throw new Error("This PC's builder cannot build web apps yet. Update Kiwimake on your PC.");
    const dir = webProjectDir(record);
    if (!existsSync(dir)) throw new Error(`The web version is missing: there is no ${record.app.preset === "web" ? "web project" : "web/ folder"} in the app.`);
    onLog("Building the web version");
    const result = await this.host.builder.buildWeb({ dir, buildNumber: number, onLog });
    const buildsDir = this.host.buildsDir(record.app.id);
    const target = webBuildDir(buildsDir, number);
    rmSync(target, { recursive: true, force: true });
    mkdirSync(buildsDir, { recursive: true });
    cpSync(result.distDir, target, { recursive: true });
    this.prune(buildsDir, number);
    return { sizeBytes: result.sizeBytes, files: result.files.length, state: this.online ? "publishing" : "local" };
  }

  private prune(buildsDir: string, newest: number): void {
    for (const name of readdirSync(buildsDir)) {
      const m = /^web-(\d+)$/.exec(name);
      if (m && Number(m[1]) <= newest - KEEP_WEB_BUILDS) rmSync(join(buildsDir, name), { recursive: true, force: true });
    }
  }

  /**
   * Puts a successful build online (every successful build goes live). The push is awaited; GitHub
   * Pages then takes about a minute, which is waited for in the background: the card says
   * "going online" until the address serves this version, then "live".
   */
  goLive(record: WebAppRecord, build: BuildInfo, rowId: string): Promise<void> {
    const id = record.app.id;
    const next = (this.publishing.get(id) ?? Promise.resolve()).then(() => this.goLiveNow(record, build, rowId));
    const tail = next.catch(() => {});
    this.publishing.set(id, tail);
    void tail.then(() => {
      if (this.publishing.get(id) === tail) this.publishing.delete(id);
    });
    return next;
  }

  private async goLiveNow(record: WebAppRecord, build: BuildInfo, rowId: string): Promise<void> {
    if (!build.web || !this.online || !this.host.alive(record.app.id)) return;
    const app = record.app;
    const distDir = webBuildDir(this.host.buildsDir(app.id), build.number);
    const update = (web: WebBuildInfo) => {
      build.web = web;
      if (app.latestBuild?.number === build.number) app.latestBuild = { ...app.latestBuild, web };
      if (app.latestApk?.number === build.number) app.latestApk = { ...app.latestApk, web };
      this.host.updateBuildCard(app.id, rowId, { ...build, web });
      this.host.touch(app.id);
    };
    const base = { sizeBytes: build.web.sizeBytes, files: build.web.files };
    if (app.web) app.web.publishing = build.number;
    update({ ...base, state: "publishing" });
    let address: string;
    try {
      const site = await this.publisher.publish({
        appId: app.id,
        slug: app.slug,
        distDir,
        build: build.number,
        ...(build.changes?.changed ? { changed: build.changes.changed } : {}),
        ...(app.web ? { site: { repo: app.web.repo, repoUrl: app.web.repoUrl, address: app.web.address } } : {}),
      });
      address = site.address;
      app.web = { ...(app.web ?? { since: new Date().toISOString() }), address: site.address, repo: site.repo, repoUrl: site.repoUrl, publishing: build.number };
      delete app.web.error;
      this.host.log(`[${app.slug}] web version ${build.number} pushed to ${site.repo}`);
    } catch (error) {
      const message = error instanceof WebPublishRefused ? error.message : `It could not go online just now (${firstLine((error as Error).message)}). The version before stays online.`;
      this.host.log(`[${app.slug}] web version ${build.number} not published: ${firstLine((error as Error).message)}`);
      if (app.web) {
        delete app.web.publishing;
        app.web.error = message;
      }
      update({ ...base, state: "failed", error: message });
      return;
    }
    update({ ...base, state: "publishing", address });
    void this.publisher.waitLive(address, build.number, { cancelled: () => !this.host.alive(app.id) }).then((live) => {
      if (!this.host.alive(app.id) || !app.web) return;
      if (app.web.publishing === build.number) delete app.web.publishing;
      if (live) {
        if ((app.web.liveBuild ?? 0) <= build.number) app.web.liveBuild = build.number;
        this.host.log(`[${app.slug}] web version ${build.number} is live at ${address}`);
        update({ ...base, state: "live", address });
      } else {
        const message = "GitHub Pages has not shown this version yet. It usually takes a minute; it goes live by itself.";
        app.web.error = message;
        update({ ...base, state: "failed", address, error: message });
      }
    });
  }

  /** Deletes the app's site (an app deleted for good). A plain sentence when GitHub refused. */
  async remove(app: App): Promise<string | undefined> {
    this.publisher.forget(app.id);
    if (!app.web || !this.publisher.host) return undefined;
    try {
      await this.publisher.host.remove({ repo: app.web.repo });
      return undefined;
    } catch (error) {
      return `GitHub didn't delete ${app.web.repo}: ${(error as Error).message}. You can delete it on github.com.`;
    }
  }

  // ---------- Web, Android or Both

  /**
   * Sets what the app's builds make. A new app (at most one version: the template, before the plan
   * was confirmed) can become anything: its folder is made again from the right template, keeping
   * its Git history and notes. Later, an Android app can add a web version beside it (Both) or drop
   * it again; a web app cannot become an Android app (another codebase: a new app).
   */
  async setTargets(record: WebAppRecord, wanted: AppTarget[]): Promise<{ app: App; note: string }> {
    const targets = normalizeTargets(wanted);
    const app = record.app;
    const current = appTargets(app);
    if (same(current, targets)) return { app, note: `It already is ${kindWords(targets)}. Nothing changed.` };
    if (app.preset === "game") {
      if (targets.length === 1 && targets[0] === "android") return { app, note: "It is a game, an Android app. Nothing changed." };
      throw new HttpError(409, "Games are Android apps for now. They are made ready for iPhone and the web, but Kiwimake cannot build those versions yet.");
    }
    if (app.preset === "kotlin" || app.preset === "expo-exact") {
      throw new HttpError(409, `${app.preset === "kotlin" ? "Kotlin" : "Expo Exact"} apps stay Android apps; a web version is made for React Native apps. Make a new app for the web.`);
    }
    const fresh = (app.latestApk?.number ?? 0) <= 1;
    const { builder } = this.host;
    const isWeb = app.preset === "web";
    if (targets.length === 1 && targets[0] === "web") {
      if (!fresh) throw new HttpError(409, "This Android app already has versions, and a web app is a separate codebase. Pick Both to add a web version beside it, or make a new app for the web.");
      await this.rescaffold(record, "web", false);
      app.preset = "web";
      delete app.targets;
      await git.commitAll(record.dir, "Made it a web app");
      return { app, note: "This is now a web app (Vite and React) at the root of the project. Read AGENTS.md again before you change anything: it replaced the Android template's." };
    }
    if (targets.length === 1 && targets[0] === "android") {
      if (isWeb) {
        if (!fresh) throw new HttpError(409, "A web app with versions cannot become an Android app: that is a rewrite. Make a new app for Android.");
        await this.rescaffold(record, "react-native", false);
        app.preset = "react-native";
        delete app.targets;
        await git.commitAll(record.dir, "Made it an Android app");
        return { app, note: "This is now an Android app (React Native) at the root of the project. Read AGENTS.md again before you change anything." };
      }
      rmSync(join(record.dir, "web"), { recursive: true, force: true });
      delete app.targets;
      await git.commitAll(record.dir, "Took the web version out");
      return { app, note: "The web version is out of the project. Its last version stays online at its address until the app is deleted." };
    }
    // Both.
    if (isWeb) {
      if (!fresh) throw new HttpError(409, "A web app with versions cannot add an Android app beside it: that is a rewrite. Make a new app for Android.");
      await this.rescaffold(record, "react-native", true);
      app.preset = "react-native";
    } else {
      if (!builder.addWebVersion) throw new HttpError(409, "This PC's builder cannot make web versions yet. Update Kiwimake on your PC.");
      if (!existsSync(join(record.dir, "web"))) await builder.addWebVersion({ dir: record.dir, name: app.name, slug: app.slug });
    }
    app.targets = ["android", "web"];
    await git.commitAll(record.dir, "Added a web version");
    return { app, note: "This app is now Both: the Android app at the root as before, and a web version in web/ (Vite and React). Read web/AGENTS.md before you change it, and keep the two in step: every change the person asks for goes into both, as far as the web can do it. Both are built after every change." };
  }

  /**
   * set_app_kind "game": a new app (at most one version) is made again from the game template
   * (template-game/: Kotlin and Compose Multiplatform), keeping its Git history and notes.
   */
  async makeGame(record: WebAppRecord): Promise<{ app: App; note: string }> {
    const app = record.app;
    if (app.preset === "game") return { app, note: "It already is a game. Nothing changed." };
    if ((app.latestApk?.number ?? 0) > 1) throw new HttpError(409, "This app already has versions, and a game is a separate codebase. Make a new app for the game.");
    if (app.preset === "expo-exact") throw new HttpError(409, "An Expo Exact app cannot become a game. Make a new app for the game.");
    await this.rescaffold(record, "game", false);
    app.preset = "game";
    delete app.targets;
    await git.commitAll(record.dir, "Made it a game");
    return {
      app,
      note: "This is now a game: Kotlin and Compose Multiplatform, the game in game/ (kept free of Android, so it can move to iPhone and the web later) and the Android app around it in app/. Read AGENTS.md again before you change anything: it replaced the starter's, and its rules on what may go in game/ hold for every change. ANDROID.md is the guide to the Android app around the game.",
    };
  }

  /** Makes the app's folder again from a template, keeping its Git history and notes. */
  private async rescaffold(record: WebAppRecord, preset: "web" | "react-native" | "game", withWeb: boolean): Promise<void> {
    const { builder } = this.host;
    const app = record.app;
    const tmp = `${record.dir}.kind-${randomUUID().slice(0, 8)}`;
    try {
      await builder.createApp({ dir: tmp, name: app.name, slug: app.slug, packageName: app.packageName, preset });
      if (withWeb) {
        if (!builder.addWebVersion) throw new HttpError(409, "This PC's builder cannot make web versions yet. Update Kiwimake on your PC.");
        await builder.addWebVersion({ dir: tmp, name: app.name, slug: app.slug });
      }
      for (const entry of readdirSync(record.dir)) if (!KEPT_ON_RESCAFFOLD.has(entry)) rmSync(join(record.dir, entry), { recursive: true, force: true });
      for (const entry of readdirSync(tmp)) {
        if (KEPT_ON_RESCAFFOLD.has(entry) && existsSync(join(record.dir, entry))) continue;
        renameSync(join(tmp, entry), join(record.dir, entry));
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }

  // ---------- opening the newest web build from this PC

  open(record: WebAppRecord): WebOpenResponse {
    const build = newestWebBuild(record.app);
    if (!build || !existsSync(webBuildDir(this.host.buildsDir(record.app.id), build))) throw new HttpError(404, "This app has no web version on this PC yet.");
    const { ticket, expiresAt } = this.publisher.ticket(record.app.id);
    return { path: `/web/${encodeURIComponent(record.app.id)}/${ticket}/`, build, expiresAt };
  }

  /** GET /web/<appId>/<ticket>/<file>: no Bearer token, the ticket is the grant. False when not ours. */
  route(req: IncomingMessage, res: ServerResponse, rawPath: string, find: (appId: string) => WebAppRecord | undefined): boolean {
    const m = /^\/web\/([^/]+)\/([^/]+)(\/.*)?$/.exec(rawPath);
    if (!m) return false;
    const appId = decodeURIComponent(m[1]!);
    const record = find(appId);
    const deny = (status: number, text: string) => {
      res.writeHead(status, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
      res.end(text);
      return true;
    };
    if (req.method !== "GET" && req.method !== "HEAD") return deny(405, "Method not allowed.");
    if (!record || !this.publisher.checkTicket(appId, m[2]!)) return deny(403, "This link has expired. Open the app from Kiwimake again.");
    if (!m[3]) {
      res.writeHead(301, { location: `${rawPath}/` });
      res.end();
      return true;
    }
    const build = newestWebBuild(record.app);
    if (!build) return deny(404, "This app has no web version on this PC yet.");
    const root = webBuildDir(this.host.buildsDir(appId), build);
    let rel = decodeURIComponent(m[3]).replace(/^\/+/, "");
    if (rel === "" || rel.endsWith("/")) rel += "index.html";
    const file = normalize(join(root, rel));
    if (!file.startsWith(root + sep) || !existsSync(file) || !statSync(file).isFile()) return deny(404, "Not found.");
    const body = readFileSync(file);
    res.writeHead(200, {
      "content-type": contentType(file),
      "content-length": body.length,
      "cache-control": /\/(index\.html|sw\.js|version\.json)$/.test(file.replace(/\\/g, "/")) ? "no-cache" : "max-age=600",
      "x-content-type-options": "nosniff",
    });
    res.end(req.method === "HEAD" ? undefined : body);
    return true;
  }
}

/** The newest build of the app that made a web version (its latest successful build). */
function newestWebBuild(app: App): number | undefined {
  return app.latestApk?.web ? app.latestApk.number : undefined;
}

export function normalizeTargets(wanted: unknown): AppTarget[] {
  if (!Array.isArray(wanted)) throw new HttpError(400, '"targets" must be ["web"], ["android"] or ["android", "web"].');
  const set = new Set<AppTarget>();
  for (const t of wanted) {
    if (t !== "android" && t !== "web") throw new HttpError(400, '"targets" must be ["web"], ["android"] or ["android", "web"].');
    set.add(t);
  }
  if (set.size === 0) throw new HttpError(400, '"targets" must be ["web"], ["android"] or ["android", "web"].');
  return (["android", "web"] as const).filter((t) => set.has(t));
}

function same(a: AppTarget[], b: AppTarget[]): boolean {
  return a.length === b.length && a.every((t) => b.includes(t));
}

export function kindWords(targets: AppTarget[]): string {
  return targets.length === 2 ? "Both (an Android app and a web version)" : targets[0] === "web" ? "a web app" : "an Android app";
}

/** The set_app_kind tool's argument: "web", "android" or "both" ("game" is WebApps.makeGame). */
export function targetsFromKind(kind: unknown): AppTarget[] {
  if (kind === "web") return ["web"];
  if (kind === "android") return ["android"];
  if (kind === "both") return ["android", "web"];
  throw new HttpError(400, 'kind must be "web", "android" or "both".');
}

function firstLine(text: string, max = 200): string {
  const line = text.split(/\r?\n/).find((l) => l.trim() !== "")?.trim() ?? "";
  return line.length > max ? `${line.slice(0, max - 1)}...` : line;
}
