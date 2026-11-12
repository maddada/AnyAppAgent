// Moving an app between this PC and the cloud (docs/CLOUD.md section 3, "Moving an app", cloud
// milestone 8): the PC's half, through the PC link (its `move` scope). Convex keeps the move's row
// and steps (cloud/convex/moves.ts), so a move that stopped halfway resumes where it was.
//
// To the cloud: Convex makes the repo; this PC pushes the code with its whole history using a
// one-repo token (in the environment of its own git child only), uploads the app's key sealed to
// Convex's transport key, copies the chat and to-dos, and reports its highest build number. The
// PC keeps a read-only copy marked "Moved to the cloud".
// To the PC: this PC clones the repo, takes the key sealed to a key it made for this request,
// imports the chat and to-dos, and the app joins the PC's list with its next build above the
// cloud's.
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { App, AppMove, ChatItem, TodoItem } from "../../shared/protocol.ts";
import type { AppManager } from "./apps.ts";
import type { Builder, KeyEntry } from "./builder.ts";
import type { CloudLink } from "./cloud-link.ts";
import { oneTimeKey, openWith, sealTo, type Sealed } from "./cloud-transport.ts";
import { commitAll, gitWithToken, headCommit } from "./git.ts";
import { HttpError } from "./http-error.ts";

type Log = (...parts: unknown[]) => void;
type Steps = { code?: number; key?: number; chat?: number };
const CHAT_BATCH = 100;

/** What moving a key needs from the builder (the real one's keys API; tests pass their own). */
export interface MoveKeys {
  exportOne(packageName: string): Promise<KeyEntry | null>;
  importOne(entry: KeyEntry): Promise<{ added: string[]; same: string[]; conflicts: { id: string; reason: string }[] }>;
}

export function builderKeys(builder: Builder): MoveKeys | null {
  const k = builder.keys;
  if (!k?.exportEntries || !k.importEntries) return null;
  return {
    exportOne: async (packageName) => (await k.exportEntries!()).find((e) => e.id === packageName) ?? null,
    importOne: (entry) => k.importEntries!([entry], new Date().toISOString()),
  };
}

export class CloudMover {
  private readonly running = new Set<string>();
  private readonly deps: { apps: AppManager; link: CloudLink; keys: MoveKeys | null; appsDir: string; log: Log; remote?: (repo: string) => string };
  constructor(deps: { apps: AppManager; link: CloudLink; keys: MoveKeys | null; appsDir: string; log: Log; remote?: (repo: string) => string }) {
    this.deps = deps;
  }

  private remote(repo: string): string {
    return this.deps.remote?.(repo) ?? `https://github.com/${repo}.git`;
  }

  /** A move that was running when the companion stopped: it shows as stopped; Move again resumes it. */
  recover(): void {
    for (const app of this.deps.apps.list()) {
      if (app.move?.state === "running") this.set(app.id, { to: app.move.to, state: "failed", error: "The PC stopped during the move. Move it again to go on.", at: new Date().toISOString() });
    }
  }

  private set(appId: string, move: AppMove | undefined): void {
    this.deps.apps.setMove(appId, move);
  }

  /** Starts moving a PC app to the cloud; progress shows on the app (App.move). */
  startToCloud(appId: string): App {
    const app = this.deps.apps.get(appId);
    if (!this.deps.link.linked()) throw new HttpError(409, "Link this PC to your Kiwimake account first (Settings, Account).");
    if (!this.deps.link.info().scopes?.includes("move")) throw new HttpError(403, "This PC's link may not move apps.");
    if (app.move?.to === "cloud" && app.move.state === "done") throw new HttpError(409, "This app is in the cloud already.");
    if (this.running.has(appId)) return app;
    if (app.status === "working" || app.status === "building" || app.status === "creating") throw new HttpError(409, "This app is busy. Move it when it is done.");
    if (!app.latestApk) throw new HttpError(409, "This app has no version yet. Move it once it has one.");
    if (app.signing && app.signing !== "own") throw new HttpError(409, "This app is signed with this PC's older shared key, so it cannot move yet. It needs its own key first.");
    this.running.add(appId);
    this.set(appId, { to: "cloud", state: "running", step: "Getting ready", at: new Date().toISOString() });
    void this.toCloud(appId)
      .catch((e: Error) => {
        this.deps.log(`[${app.slug}] move to the cloud stopped: ${e.message}`);
        this.set(appId, { to: "cloud", state: "failed", error: e.message.slice(0, 300), at: new Date().toISOString() });
      })
      .finally(() => this.running.delete(appId));
    return this.deps.apps.get(appId);
  }

  private async toCloud(appId: string): Promise<void> {
    const { apps, link, log } = this.deps;
    const app = apps.get(appId);
    const dir = apps.dirOf(appId);
    const step = (s: string) => this.set(appId, { to: "cloud", state: "running", step: s, at: new Date().toISOString() });
    const buildHigh = Math.max(app.latestBuild?.number ?? 0, app.latestApk?.number ?? 0);
    const start = await link.call<{ moveId: string; appId: string; repo: string; resumed: boolean; steps: Steps }>("/pc/move/to-cloud", {
      pcAppId: app.id,
      name: app.name,
      slug: app.slug,
      packageName: app.packageName,
      preset: app.preset ?? "react-native",
      buildHigh,
    });
    const { moveId } = start;
    log(`[${app.slug}] moving to the cloud (${start.repo}${start.resumed ? ", resumed" : ""})`);

    if (!start.steps.code) {
      step("Copying the code to your GitHub");
      await commitAll(dir, "Before moving to the cloud");
      const commit = await headCommit(dir);
      if (!commit) throw new Error("This app has no code history to move.");
      const { token, repo } = await link.call<{ token: string; repo: string }>("/pc/move/repo-token", { moveId });
      const r = await gitWithToken(["push", "-q", this.remote(repo), "HEAD:refs/heads/main"], dir, token);
      if (r.code !== 0) throw new Error(`Could not push the code: ${r.err.trim().split("\n").pop()}`);
      await link.call("/pc/move/code", { moveId, commit });
    }

    if (!start.steps.key) {
      step("Moving the signing key");
      if (!this.deps.keys) throw new Error("This PC's builder cannot hand over signing keys.");
      const entry = await this.deps.keys.exportOne(app.packageName);
      if (!entry) throw new Error("This app has no signing key of its own on this PC.");
      const info = entry.info as { keyAlias?: string; storePassword?: string; certSha256?: string; kind?: string };
      const files = entry.files as { store?: string; lineage?: string };
      if (files.lineage || info.kind === "moved") throw new Error("This app's key was rotated on this PC, which the cloud cannot sign with yet.");
      if (!files.store || !info.keyAlias || !info.storePassword || !info.certSha256) throw new Error("This app's signing key is not complete.");
      const { publicRaw } = await link.call<{ publicRaw: string }>("/pc/move/transport-key");
      const inner = new TextEncoder().encode(JSON.stringify({ p12: files.store, storePassword: info.storePassword, keyAlias: info.keyAlias }));
      const box = await sealTo(publicRaw, inner, `appkey-move:${moveId}`);
      inner.fill(0);
      await link.call("/pc/move/key", { moveId, box, certSha256: info.certSha256 });
    }

    if (!start.steps.chat) {
      step("Copying the chat and to-dos");
      const items = apps.messages(appId, 0).filter((i) => !i.workerId);
      const todos = apps.todos(appId);
      for (let i = 0; i < items.length || i === 0; i += CHAT_BATCH) {
        const last = i + CHAT_BATCH >= items.length;
        await link.call("/pc/move/chat", { moveId, items: items.slice(i, i + CHAT_BATCH), ...(last ? { todos } : {}), last });
      }
    }

    step("Handing it to the cloud");
    // The version on the phone: its number and when (no files: the next build is the cloud's).
    const last = app.latestApk ? { number: app.latestApk.number, status: app.latestApk.status, startedAt: app.latestApk.startedAt, finishedAt: app.latestApk.finishedAt } : undefined;
    await link.call("/pc/move/finish", { moveId, buildHigh, ...(last ? { latestApk: last } : {}) });
    this.set(appId, { to: "cloud", state: "done", at: new Date().toISOString(), cloudAppId: start.appId });
    log(`[${app.slug}] moved to the cloud; this PC keeps a read-only copy`);
  }

  /** Moves a cloud app to this PC (the phone waits for it: a clone and a few calls). */
  async toPc(cloudAppId: string): Promise<App> {
    const { apps, link, log } = this.deps;
    if (!link.linked()) throw new HttpError(409, "Link this PC to your Kiwimake account first (Settings, Account).");
    if (!this.deps.keys) throw new HttpError(409, "This PC's builder cannot take signing keys.");
    if (this.running.has(cloudAppId)) throw new HttpError(409, "This app is already moving.");
    this.running.add(cloudAppId);
    try {
      const m = await link.call<{
        moveId: string;
        name: string;
        slug: string;
        packageName: string;
        preset: App["preset"];
        repo: string;
        buildHigh: number;
        certSha256: string | null;
      }>("/pc/move/to-pc", { appId: cloudAppId });
      const { moveId } = m;
      try {
        // An app this PC moved to the cloud before: its read-only copy makes way for the real one.
        const here = apps.list().find((a) => a.packageName === m.packageName);
        if (here && !(here.move?.to === "cloud" && here.move.state === "done")) throw new HttpError(409, "This PC already has this app.");
        let dir = join(this.deps.appsDir, m.slug);
        for (let n = 2; existsSync(dir) && apps.list().some((a) => apps.dirOf(a.id) === dir); n++) dir = join(this.deps.appsDir, `${m.slug}-${n}`);
        if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });

        const { token } = await link.call<{ token: string }>("/pc/move/repo-token", { moveId });
        const r = await gitWithToken(["clone", "-q", this.remote(m.repo), dir], this.deps.appsDir, token);
        if (r.code !== 0) throw new Error(`Could not copy the code from GitHub: ${r.err.trim().split("\n").pop()}`);
        await link.call("/pc/move/step", { moveId, step: "code" });

        const mine = await oneTimeKey();
        const down = await link.call<{ box: Sealed; certSha256: string }>("/pc/move/key-down", { moveId, pcKey: mine.publicRaw });
        const plain = await openWith(mine.key, down.box, `appkey-down:${moveId}`);
        const inner = JSON.parse(new TextDecoder().decode(plain)) as { p12: string; storePassword: string; keyAlias: string };
        plain.fill(0);
        const result = await this.deps.keys.importOne({
          id: m.packageName,
          info: { keyAlias: inner.keyAlias, storePassword: inner.storePassword, keyPassword: inner.storePassword, certSha256: down.certSha256 },
          files: { store: inner.p12 },
        });
        if (result.conflicts.length) throw new Error(result.conflicts[0]!.reason);
        await link.call("/pc/move/step", { moveId, step: "key" });

        const chat = await link.call<{ items: ChatItem[]; todos: TodoItem[] }>("/pc/move/chat-down", { moveId });
        const now = new Date().toISOString();
        const app = apps.adoptMovedApp(
          {
            id: crypto.randomUUID(),
            name: m.name,
            slug: m.slug,
            packageName: m.packageName,
            preset: m.preset ?? "react-native",
            status: "idle",
            iconVersion: 1,
            // The phone has the cloud's last build installed: the next build here goes above it.
            latestBuild: { number: m.buildHigh, status: "succeeded", startedAt: now, finishedAt: now },
            signing: "own",
            createdAt: now,
            updatedAt: now,
          },
          dir,
          chat.items,
          chat.todos,
        );
        await link.call("/pc/move/step", { moveId, step: "chat" });
        await link.call("/pc/move/finish", { moveId, pcAppId: app.id });
        // Only now does the read-only copy go (its folder stays, as a deleted app's does).
        if (here) await apps.delete(here.id);
        log(`[${m.slug}] moved here from the cloud: ${chat.items.length} chat items, next build ${m.buildHigh + 1}`);
        return apps.get(app.id);
      } catch (e) {
        // The Convex row stays as it was (the app is still the cloud's); the move can start again.
        await link.call("/pc/move/fail", { moveId, error: (e as Error).message }).catch(() => {});
        throw e instanceof HttpError ? e : new HttpError(502, (e as Error).message);
      }
    } finally {
      this.running.delete(cloudAppId);
    }
  }
}
