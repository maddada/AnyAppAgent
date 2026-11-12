// "Use the cloud when my PC is off" on the PC side (docs/CLOUD.md section 3, cloud milestone 9).
// With the switch on and this PC linked, every app is kept ready in the cloud: after each new
// version its code goes to its private repo anyapp-cloud-<slug> (a one-repo token, given to git
// only through its own child's environment) and its key goes up once, sealed to Convex's transport
// key. A change made in the cloud while the PC was off comes back when the PC is on again: the
// commits (fast-forward, or a merge, or a prompt to the agent when both sides changed the same
// lines), the chat rows marked "Made in the cloud", and the build number. One place at a time: the
// PC pulls a change back before it takes one of its own for that app.
import type { App, ChatItem } from "../../shared/protocol.ts";
import type { AppManager } from "./apps.ts";
import type { CloudLink } from "./cloud-link.ts";
import type { MoveKeys } from "./cloud-move.ts";
import { sealTo } from "./cloud-transport.ts";
import { gitWithToken, headCommit, run } from "./git.ts";
import { HttpError } from "./http-error.ts";

type Log = (...parts: unknown[]) => void;

type Ready = { off: true } | { off: false; inCloud: true; appId: string } | { off: false; inCloud?: undefined; appId: string; hasKey: boolean; pushedCommit: string | null; pcOff: { since: number } | null };
type PullItem = { appId: string; pcAppId: string | null; packageName: string; repo: string | null; buildHigh: number; busy: boolean };

export class KeepReady {
  private readonly deps: { apps: AppManager; link: CloudLink; keys: MoveKeys | null; log: Log; remote?: (repo: string) => string };
  private readonly queue = new Map<string, Promise<void>>();
  private switchOn = true;
  /** Packages with a change made in the cloud still to come back (from the last list). */
  private readonly pending = new Set<string>();

  constructor(deps: { apps: AppManager; link: CloudLink; keys: MoveKeys | null; log: Log; remote?: (repo: string) => string }) {
    this.deps = deps;
  }

  private remote(repo: string): string {
    return this.deps.remote?.(repo) ?? `https://github.com/${repo}.git`;
  }

  private canKeep(app: App): boolean {
    return Boolean(app.latestApk) && (!app.signing || app.signing === "own") && !app.move;
  }

  /** After a new version (or at start): push the code and the key once. One run per app at a time. */
  keep(appId: string): Promise<void> {
    const before = this.queue.get(appId) ?? Promise.resolve();
    const next = before
      .then(() => this.keepNow(appId))
      .catch((e: Error) => this.deps.log(`keep ready: ${e.message}`))
      .finally(() => {
        if (this.queue.get(appId) === next) this.queue.delete(appId);
      });
    this.queue.set(appId, next);
    return next;
  }

  private async keepNow(appId: string): Promise<void> {
    const { apps, link, log } = this.deps;
    if (!link.linked() || !link.info().scopes?.includes("move")) return;
    const app = apps.list().find((a) => a.id === appId);
    if (!app || !this.canKeep(app)) return;
    const buildHigh = Math.max(app.latestBuild?.number ?? 0, app.latestApk?.number ?? 0);
    const r = await link.call<Ready>("/pc/ready", { pcAppId: app.id, name: app.name, slug: app.slug, packageName: app.packageName, preset: app.preset ?? "react-native", buildHigh });
    this.switchOn = !r.off;
    if (r.off || r.inCloud) return;
    // A change made in the cloud comes back first (one place at a time).
    if (r.pcOff) return this.pullBackAll();
    const dir = apps.dirOf(appId);
    const head = await headCommit(dir);
    if (head && head !== r.pushedCommit) {
      const { token, repo } = await link.call<{ token: string; repo: string }>("/pc/ready/repo-token", { appId: r.appId });
      const p = await gitWithToken(["push", "-q", "--force", this.remote(repo), "HEAD:refs/heads/main"], dir, token);
      if (p.code !== 0) throw new Error(`could not push ${app.slug}: ${p.err.trim().split("\n").pop()}`);
      await link.call("/pc/ready/code", { appId: r.appId, commit: head });
      log(`[${app.slug}] kept ready in the cloud at ${head.slice(0, 7)}`);
    }
    if (!r.hasKey && this.deps.keys) {
      const entry = await this.deps.keys.exportOne(app.packageName);
      const info = entry?.info as { keyAlias?: string; storePassword?: string; certSha256?: string; kind?: string } | undefined;
      const files = entry?.files as { store?: string; lineage?: string } | undefined;
      if (!entry || !files?.store || files.lineage || !info?.keyAlias || !info.storePassword || !info.certSha256) return;
      const { publicRaw } = await link.call<{ publicRaw: string }>("/pc/move/transport-key");
      const inner = new TextEncoder().encode(JSON.stringify({ p12: files.store, storePassword: info.storePassword, keyAlias: info.keyAlias }));
      const box = await sealTo(publicRaw, inner, `appkey-ready:${r.appId}`);
      inner.fill(0);
      await link.call("/pc/ready/key", { appId: r.appId, box, certSha256: info.certSha256 });
      log(`[${app.slug}] its key is in the cloud (sealed), for changes while this PC is off`);
    }
  }

  /** At start and every check: every app (cheap when nothing changed). */
  async keepAll(): Promise<void> {
    await this.pullBackAll();
    if (!this.switchOn) return;
    for (const app of this.deps.apps.list()) {
      if (!this.switchOn) return;
      if (this.canKeep(app)) await this.keep(app.id);
    }
  }

  /** One place at a time: refuses a change here while one made in the cloud is still coming back. */
  guard(app: App): void {
    if (!this.pending.has(app.packageName)) return;
    void this.pullBackAll();
    throw new HttpError(409, "A change made in the cloud while your PC was off is coming back to this PC first. Try again in a minute.");
  }

  /** Brings back every change the cloud made while this PC was off. */
  async pullBackAll(): Promise<void> {
    const { apps, link, log } = this.deps;
    if (!link.linked()) return;
    let list: PullItem[];
    try {
      list = (await link.call<{ apps: PullItem[] }>("/pc/pull-back/list")).apps;
    } catch (e) {
      return log("pull back:", (e as Error).message);
    }
    this.pending.clear();
    for (const item of list) this.pending.add(item.packageName);
    for (const item of list) {
      if (item.busy || !item.repo) continue;
      const app = apps.list().find((a) => a.id === item.pcAppId) ?? apps.list().find((a) => a.packageName === item.packageName && !a.move);
      if (!app) continue;
      try {
        await this.pullBack(app, item);
      } catch (e) {
        log(`[${app.slug}] pull back stopped: ${(e as Error).message}`);
      }
    }
  }

  private async pullBack(app: App, item: PullItem): Promise<void> {
    const { apps, link, log } = this.deps;
    const dir = apps.dirOf(app.id);
    const { token, repo } = await link.call<{ token: string; repo: string }>("/pc/ready/repo-token", { appId: item.appId });
    const f = await gitWithToken(["fetch", "-q", this.remote(repo), "main"], dir, token);
    if (f.code !== 0) throw new Error(`could not fetch: ${f.err.trim().split("\n").pop()}`);
    const theirs = (await run("git", ["rev-parse", "FETCH_HEAD"], dir)).stdout.trim();
    const mine = await headCommit(dir);
    let merged = "fast-forward";
    if (mine && mine !== theirs) {
      const behind = (await run("git", ["merge-base", "--is-ancestor", mine, theirs], dir)).code === 0;
      const ahead = (await run("git", ["merge-base", "--is-ancestor", theirs, mine], dir)).code === 0;
      if (behind) {
        const m = await run("git", ["-c", "safe.directory=*", "merge", "-q", "--ff-only", theirs], dir);
        if (m.code !== 0) throw new Error(`could not take the cloud's commits: ${m.stderr.trim().split("\n").pop()}`);
      } else if (!ahead) {
        // Both sides changed: merge; if the same lines changed, the agent merges (its prompt says how).
        const m = await run("git", ["-c", "user.name=Kiwimake", "-c", "user.email=kiwimake@localhost", "merge", "-q", "--no-edit", "-m", "Bring back the change made in the cloud", theirs], dir);
        if (m.code !== 0) {
          await run("git", ["merge", "--abort"], dir);
          await run("git", ["branch", "-f", "made-in-the-cloud", theirs], dir);
          merged = "to the agent";
          apps.sendMessage(
            app.id,
            "Bring back the change made in the cloud while my PC was off.",
            [],
            "While this PC was off, a change was made in the cloud. Its commits are on the branch `made-in-the-cloud`; this PC also has changes of its own since then. Merge `made-in-the-cloud` into the current branch, keeping what both sides did, run the checks, and commit.",
          );
        } else merged = "merged";
      } else merged = "already here";
    }
    const { items } = await link.call<{ items: ChatItem[] }>("/pc/pull-back/chat", { appId: item.appId });
    apps.importCloudItems(app.id, items);
    apps.raiseBuildNumber(app.id, item.buildHigh);
    const head = (await headCommit(dir)) ?? theirs;
    await link.call("/pc/pull-back/done", { appId: item.appId, commit: merged === "to the agent" ? theirs : head });
    this.pending.delete(item.packageName);
    log(`[${app.slug}] pulled back the change made in the cloud (${merged}, ${items.length} chat rows, next build ${item.buildHigh + 1})`);
  }
}
