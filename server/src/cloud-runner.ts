// The cloud runner (docs/CLOUD.md section 3, "The runner"): the companion's work loop on a cloud
// box, for one thread (one app). It is main.ts without pairing, Easy Connect or `gh`: AppManager
// does the work as on a PC, its ServerEvents go to Convex instead of a WebSocket, and its commands
// come from Convex's inbox. The agent and Gradle run as another Unix user (cloud-settings.ts
// agentPrefix); this process holds the runner token, signs builds with a one-time key ticket, and
// pushes with a one-repo token, none of which the agent can read.
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { App, ChatItem, ImageUpload, ServerEvent } from "../../shared/protocol.ts";
import { usageTaps } from "./acp/claude-session.ts";
import { oneTimeKey, openWith, sealTo, type Sealed } from "./cloud-transport.ts";
import { AppManager } from "./apps.ts";
import { Auth } from "./auth.ts";
import { loadBuilder, type Builder, type BuildResult } from "./builder.ts";
import { loadConfig, REPO_DIR, type Config } from "./config.ts";
import { EasyConnect } from "./easy-connect/controller.ts";
import * as git from "./git.ts";
import { startHttpServer } from "./http.ts";
import { Store } from "./store.ts";

/** The runner's line to Convex (cloud/runner/convex-link.mjs). */
export interface RunnerLink {
  emit(event: unknown): void;
  flush(): Promise<void>;
  take(): Promise<InboxItem | null>;
  post<T = any>(route: string, body?: unknown): Promise<T>;
  uploadFile(bytes: Uint8Array, contentType: string): Promise<string>;
  recordBuild(build: unknown): Promise<unknown>;
}

export interface InboxItem {
  id: string;
  kind: "prompt" | "permission" | "cancel" | "page-answers" | "stop-helper" | "rebuild" | "restore" | "undo" | "fix-crash";
  payload: any;
}

export interface Hello {
  threadId: string;
  appId: string;
  name: string;
  slug: string;
  packageName: string;
  preset: string;
  repo: string | null;
  buildHigh: number;
  latestApk?: App["latestApk"] | null;
  restore?: boolean;
  certSha256: string | null;
  aiMode: string;
}

type Log = (...parts: unknown[]) => void;

type SignedFile = { path: string; sizeBytes: number; sha256: string };
type KeyInfo = { storeFile: string; keyAlias: string; storePassword: string; keyPassword: string; certSha256: string };
/** builder/lib/external-sign.mjs, loaded at run time. */
interface ExternalSign {
  newAppKey(javaHome: string, storeFile: string, packageName: string): Promise<KeyInfo>;
  signOutputs(args: { javaHome: string; sdk: string; key: KeyInfo; apks: string[]; ota: string | null }): Promise<{ certSha256: string; apks: SignedFile[]; ota: SignedFile | null }>;
}

/** Where a key may sit for seconds: a tmpfs only this Unix user can read. */
function secretDir(): string {
  const base = existsSync("/dev/shm") ? "/dev/shm" : tmpdir();
  return mkdtempSync(join(base, "kiwi-key-"));
}

/** Runs a command as the agent's Unix user (or as ourselves when there is no prefix, on a PC). */
function runAs(prefix: string[], argv: string[], env: Record<string, string>, cwd: string, onLine: (line: string) => void, timeoutMs = 45 * 60_000): Promise<{ code: number; out: string }> {
  const vars = Object.entries(env).map(([k, v]) => `${k}=${v}`);
  const [cmd, ...args] = prefix.length > 0 ? [...prefix, "env", ...vars, ...argv] : argv;
  return new Promise((resolve) => {
    const child = spawn(cmd!, args, { cwd, env: prefix.length > 0 ? process.env : { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let partial = "";
    const take = (chunk: Buffer) => {
      const text = partial + chunk.toString("utf8");
      const lines = text.split("\n");
      partial = lines.pop() ?? "";
      for (const line of lines) {
        out += `${line}\n`;
        onLine(line);
      }
    };
    child.stdout.on("data", take);
    child.stderr.on("data", take);
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (partial) out += partial;
      resolve({ code: code ?? 1, out });
    });
  });
}

/** The JSON object the builder CLI prints last. */
function lastJson<T>(out: string): T {
  const at = out.lastIndexOf("\n{");
  const text = at >= 0 ? out.slice(at + 1) : out.slice(out.indexOf("{"));
  return JSON.parse(text) as T;
}

const NETWORK_FAILURE = /handshake|Could not resolve|Connection reset|Broken pipe|ECONNRESET|ETIMEDOUT|Read timed out|Could not GET|Could not HEAD/i;

/**
 * The builder for the cloud: createApp and buildApk run builder/cli.mjs as the agent's Unix user
 * with ANYAPP_SIGN_EXTERNAL=1 (Gradle and the builder never see the key); then this process signs
 * the outputs with a one-time ticket from Convex (builder/lib/external-sign.mjs).
 */
export class CloudBuilder implements Builder {
  readonly kind = "real" as const;
  private readonly real: Builder;
  private readonly prefix: string[];
  private readonly link: RunnerLink;
  private readonly cert: () => string | null;
  private readonly log: Log;
  private readonly threadId: string;
  constructor(real: Builder, prefix: string[], link: RunnerLink, cert: () => string | null, log: Log, threadId: string) {
    this.threadId = threadId;
    this.real = real;
    this.prefix = prefix;
    this.link = link;
    this.cert = cert;
    this.log = log;
  }

  private cli(): string {
    return join(REPO_DIR, "builder", "cli.mjs");
  }

  async createApp(args: Parameters<Builder["createApp"]>[0]): Promise<void> {
    const r = await runAs(
      this.prefix,
      [process.execPath, this.cli(), "create", args.dir, "--name", args.name, "--slug", args.slug, "--package", args.packageName, "--preset", args.preset ?? "react-native"],
      { ANYAPP_SIGN_EXTERNAL: "1" },
      REPO_DIR,
      (line) => args.onLog?.(line),
    );
    if (r.code !== 0) throw new Error(`The app could not be made: ${r.out.trim().split("\n").slice(-3).join(" ")}`);
  }

  async buildApk(args: Parameters<Builder["buildApk"]>[0]): Promise<BuildResult> {
    const cert = this.cert();
    if (!cert) throw new Error("This app has no signing key yet.");
    const argv = [process.execPath, this.cli(), "build", args.dir, "--build-number", String(args.buildNumber)];
    if (args.updateFeed) argv.push("--update-feed", args.updateFeed);
    let r = await runAs(this.prefix, argv, { ANYAPP_SIGN_EXTERNAL: "1", ANYAPP_SIGN_CERT: cert }, REPO_DIR, (line) => args.onLog?.(line));
    // Instabox's proxy sometimes refuses HTTPS for a minute or two (docs/CLOUD.md): try once more
    // before it counts as a failed build (and before a fix turn is spent on it).
    if (r.code !== 0 && NETWORK_FAILURE.test(r.out)) {
      this.log("build failed on downloads; trying again in 60 s");
      args.onLog?.("Downloads failed for a moment; trying again");
      await new Promise((res) => setTimeout(res, 60_000));
      r = await runAs(this.prefix, argv, { ANYAPP_SIGN_EXTERNAL: "1", ANYAPP_SIGN_CERT: cert }, REPO_DIR, (line) => args.onLog?.(line));
    }
    if (r.code !== 0) {
      const tail = r.out.trim().split("\n").slice(-40).join("\n");
      throw new Error(`Build #${args.buildNumber} failed.\n${tail}`);
    }
    const result = lastJson<BuildResult & { unsigned?: boolean }>(r.out);
    if (!result.unsigned) throw new Error("The builder signed the build itself; refusing it (the cloud signs outside the builder).");
    return this.sign(args.buildNumber, result, args.onLog);
  }

  /** Copies the unsigned outputs to our own folder, signs them with a one-time ticket, wipes the key. */
  private async sign(build: number, result: BuildResult, onLog?: (line: string) => void): Promise<BuildResult> {
    const t0 = Date.now();
    const own = mkdtempSync(join(tmpdir(), `kiwi-sign-${build}-`));
    const copy = (src: string) => {
      const dst = join(own, `${randomBytes(4).toString("hex")}-${src.split(/[\\/]/).pop()}`);
      writeFileSync(dst, readFileSync(src));
      return dst;
    };
    const apk = copy(result.apkPath);
    const variants = (result.variants ?? []).map((v) => ({ ...v, apkPath: copy(v.apkPath) }));
    const ota = result.ota ? { ...result.ota, path: copy(result.ota.path) } : undefined;
    const keyDir = secretDir();
    try {
      // The key comes sealed to a key made for this one request; only this process can open it.
      const once = await oneTimeKey();
      const answer = await this.link.post<{ box: Sealed; certSha256: string }>("/runner/sign-ticket", { build, runnerKey: once.publicRaw });
      const inner = JSON.parse(new TextDecoder().decode(await openWith(once.key, answer.box, `ticket:${this.threadId}:${build}`))) as { p12: string; storePassword: string; keyAlias: string };
      const ticket = { ...inner, certSha256: answer.certSha256 };
      const storeFile = join(keyDir, "key.p12");
      writeFileSync(storeFile, Buffer.from(ticket.p12, "base64"), { mode: 0o600 });
      const ext = (await import(pathToFileURL(join(REPO_DIR, "builder", "lib", "external-sign.mjs")).href)) as ExternalSign;
      const env = (await import(pathToFileURL(join(REPO_DIR, "builder", "lib", "env.mjs")).href)) as { androidEnv(): { javaHome: string; sdk: string } };
      const { javaHome, sdk } = env.androidEnv();
      const signed = await ext.signOutputs({
        javaHome,
        sdk,
        key: { storeFile, keyAlias: ticket.keyAlias, storePassword: ticket.storePassword, keyPassword: ticket.storePassword, certSha256: ticket.certSha256 },
        apks: [apk, ...variants.map((v) => v.apkPath)],
        ota: ota?.path ?? null,
      });
      const [main, ...rest] = signed.apks;
      await this.link.post("/runner/signed", {
        build,
        files: [
          { what: "apk universal", sha256: main!.sha256 },
          ...rest.map((s, i) => ({ what: `apk ${variants[i]!.abi}`, sha256: s.sha256 })),
          ...(signed.ota ? [{ what: "quick update", sha256: signed.ota.sha256 }] : []),
        ],
      });
      onLog?.(`Signed in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
      return {
        ...result,
        apkPath: apk,
        sizeBytes: main!.sizeBytes,
        sha256: main!.sha256,
        ...(variants.length ? { variants: variants.map((v, i) => ({ ...v, sizeBytes: rest[i]!.sizeBytes, sha256: rest[i]!.sha256 })) } : {}),
        ...(ota && signed.ota ? { ota: { ...ota, sizeBytes: signed.ota.sizeBytes, sha256: signed.ota.sha256 } } : {}),
        signing: { kind: "own", certSha256: signed.certSha256 },
      };
    } finally {
      rmSync(keyDir, { recursive: true, force: true });
    }
  }

  getIconPath(args: { dir: string }): string | null {
    return this.real.getIconPath(args);
  }
}

/** Makes the app's signing key before the agent starts on it, hands it to Convex once, deletes it here. */
async function makeAppKey(link: RunnerLink, threadId: string, packageName: string, log: Log): Promise<string> {
  const keyDir = secretDir();
  try {
    const ext = (await import(pathToFileURL(join(REPO_DIR, "builder", "lib", "external-sign.mjs")).href)) as ExternalSign;
    const env = (await import(pathToFileURL(join(REPO_DIR, "builder", "lib", "env.mjs")).href)) as { androidEnv(): { javaHome: string } };
    const key = await ext.newAppKey(env.androidEnv().javaHome, join(keyDir, "key.p12"), packageName);
    // Sealed to Convex's transport key: the key is readable nowhere between here and Convex.
    const { publicRaw } = await link.post<{ publicRaw: string }>("/runner/transport-key");
    if (!publicRaw) throw new Error("Convex has no transport key");
    const inner = JSON.stringify({ p12: readFileSync(key.storeFile).toString("base64"), storePassword: key.storePassword, keyAlias: key.keyAlias });
    const box = await sealTo(publicRaw, new TextEncoder().encode(inner), `appkey-upload:${threadId}`);
    const stored = await link.post<{ certSha256: string }>("/runner/key", { box, certSha256: key.certSha256 });
    if (stored.certSha256 !== key.certSha256) throw new Error("Convex kept another key for this app");
    log(`signing key for ${packageName} made and stored (${key.certSha256.slice(0, 12)})`);
    return key.certSha256;
  } finally {
    rmSync(keyDir, { recursive: true, force: true });
  }
}

async function imagesOf(payload: any): Promise<ImageUpload[]> {
  const out: ImageUpload[] = [];
  for (const im of Array.isArray(payload?.images) ? payload.images : []) {
    if (!im?.url) continue;
    const res = await fetch(im.url, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) continue;
    out.push({ mimeType: String(im.mimeType), data: Buffer.from(await res.arrayBuffer()).toString("base64"), ...(im.width ? { width: im.width } : {}), ...(im.height ? { height: im.height } : {}) });
  }
  return out;
}

export interface RunnerOptions {
  link: RunnerLink;
  hello: Hello;
  log: Log;
  /** Set when the runner should stop (tests). */
  stopped?: () => boolean;
}

/** Runs until the runner token stops working. */
export async function runCloudRunner({ link, hello, log, stopped }: RunnerOptions): Promise<void> {
  const config: Config = loadConfig();
  if (!config.cloud) throw new Error("ANYAPP_CLOUD=1 is not set");
  mkdirSync(config.stateDir, { recursive: true });
  mkdirSync(config.appsDir, { recursive: true });
  const store = new Store(config.stateDir);
  const real = await loadBuilder("real");
  let cert = hello.certSha256;
  const builder = new CloudBuilder(real, config.cloud.agentPrefix, link, () => cert, log, hello.threadId);

  // Which local app is this thread's (one thread, one app).
  const mapFile = join(config.stateDir, "kiwi-thread.json");
  let localId: string | null = existsSync(mapFile) ? (JSON.parse(readFileSync(mapFile, "utf8")) as { localId: string }).localId : null;

  let busy = false;
  const sentPages = new Set<string>();
  const uploads: Promise<void>[] = [];
  const apps = new AppManager({
    store,
    builder,
    config,
    log,
    broadcast: (event: ServerEvent) => {
      link.emit(event);
      if (event.type === "app.updated" || event.type === "apk.ready") {
        const working = event.app.status === "working" || event.app.status === "building" || event.app.status === "creating" || Boolean(event.app.activeHelpers);
        if (working !== busy) {
          busy = working;
          link.emit({ type: "runner.state", busy });
        }
      }
      if (event.type === "apk.ready") uploads.push(deliver(event.app).catch((e: Error) => log("upload failed:", e.message)));
      // A page the agent published: its HTML goes to Convex, which serves it to the phone.
      if (event.type === "chat.item" && event.item.kind === "page" && event.item.page && !sentPages.has(event.item.page.id) && localId) {
        const page = event.item.page;
        sentPages.add(page.id);
        const served = apps.pages.servedHtml(localId, page.id);
        if (served) {
          uploads.push(
            link
              .post("/runner/page", { pageId: page.id, info: served.page, html: served.html })
              .then(() => log(`page ${page.id} "${page.title}" sent to Convex`))
              .catch((e: Error) => {
                sentPages.delete(page.id);
                log("page upload failed:", e.message);
              }),
          );
        }
      }
    },
  });

  /** After a build: the phone's APKs (arm64-v8a, x86_64) and the quick update go to Convex storage. */
  async function deliver(app: App): Promise<void> {
    const build = app.latestApk;
    if (!build || !localId) return;
    const t0 = Date.now();
    const files: { abi: string; fileId: string; sizeBytes: number; sha256: string }[] = [];
    for (const abi of ["arm64-v8a", "x86_64"]) {
      const f = apps.apkFile(localId, abi);
      if (!f || "missing" in f || !f.abi) continue;
      const bytes = readFileSync(f.path);
      files.push({ abi, fileId: await link.uploadFile(bytes, "application/vnd.android.package-archive"), sizeBytes: bytes.length, sha256: f.sha256 ?? "" });
    }
    if (files.length === 0) {
      const f = apps.apkFile(localId);
      if (f && !("missing" in f)) {
        const bytes = readFileSync(f.path);
        files.push({ abi: "universal", fileId: await link.uploadFile(bytes, "application/vnd.android.package-archive"), sizeBytes: bytes.length, sha256: f.sha256 ?? "" });
      }
    }
    // The app's own icon, for the phone's grid (it changes rarely: sent with each build, small).
    let iconFileId: string | undefined;
    try {
      const icon = apps.icon(localId);
      const png = "png" in icon ? icon.png : readFileSync(icon.path);
      iconFileId = await link.uploadFile(png, "image/png");
    } catch (e) {
      log("icon upload failed:", (e as Error).message);
    }
    const ota = apps.otaFile(localId);
    const otaFileId = ota ? await link.uploadFile(readFileSync(ota.path), "application/zip") : undefined;
    const record = apps.get(localId);
    const dir = join(config.appsDir, record.slug);
    const commit = await git.headCommit(dir);
    await link.recordBuild({
      number: build.number,
      delivery: build.delivery === "quick" ? "quick" : "apk",
      files,
      ...(otaFileId ? { otaFileId } : {}),
      ...(iconFileId ? { iconFileId } : {}),
      ...(build.runtime ? { runtime: build.runtime } : {}),
      info: build,
      ...(commit ? { commit } : {}),
      pushed: lastPush.commit === commit && lastPush.ok,
      seconds: Math.round((Date.now() - t0) / 1000),
    });
    log(`build ${build.number} delivered in ${((Date.now() - t0) / 1000).toFixed(1)} s (${files.map((f) => f.abi).join(", ")}${otaFileId ? ", quick update" : ""})`);
  }

  // Pushing: the runner's own way, with a one-repo token it asks Convex for (docs/CLOUD.md).
  const lastPush = { commit: undefined as string | undefined, ok: false };
  git.setPushImpl(async (dir) => {
    const commit = await git.headCommit(dir);
    const t0 = Date.now();
    const error = await pushWithToken(link, dir, log);
    if (!error) log(`pushed ${commit?.slice(0, 7)} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    lastPush.commit = commit;
    lastPush.ok = error === null;
    return error;
  });

  // Every turn's usage, priced in Convex with its model and tagged with its helper and level.
  usageTaps.add((u) => {
    link.emit({ type: "usage", ...u });
    log(`usage ${u.tag.role ?? "?"}${u.tag.level ? ` ${u.tag.level}` : ""} ${u.model ?? "?"}/${u.effort ?? "?"}: in ${u.usage.inputTokens}, out ${u.usage.outputTokens}, cache write ${u.usage.cacheWriteTokens}, cache read ${u.usage.cacheReadTokens}`);
  });

  // Memory while the box works (docs/CLOUD.md: an orchestrator, helpers and a Gradle build on 8 GiB).
  const memLog = join(config.stateDir, "..", "mem.log");
  const memTimer = setInterval(() => {
    if (!busy || !existsSync("/proc/meminfo")) return;
    const info = readFileSync("/proc/meminfo", "utf8");
    const kb = (k: string) => Number(new RegExp(String.raw`^${k}:\s+(\d+)`, "m").exec(info)?.[1] ?? 0);
    const used = (kb("MemTotal") - kb("MemAvailable")) / 1048576;
    const helpers = localId ? (apps.workers?.list(localId).filter((w) => w.state === "working" || w.state === "building").length ?? 0) : 0;
    try {
      writeFileSync(memLog, `${new Date().toISOString()} used ${used.toFixed(2)} GiB (available ${(kb("MemAvailable") / 1048576).toFixed(2)}), helpers ${helpers}
`, { flag: "a" });
    } catch {}
  }, 10_000);
  memTimer.unref();

  // The agents' tools (pages, helpers, versions) are served on loopback only; no phone reaches it.
  const adminToken = randomBytes(24).toString("base64url");
  const auth = new Auth(config.stateDir, adminToken);
  const easyConnect = new EasyConnect({ stateDir: config.stateDir, port: config.port, auth, log: (m) => log(m) });
  const http = startHttpServer({ host: "127.0.0.1", port: config.port, version: config.version, auth, apps, easyConnect });
  await http.ready;
  apps.recover();
  // A fresh machine for an app made before (its snapshot expired or was lost): the code comes back
  // from GitHub, the chat from Convex, and the build numbers carry on above the last one.
  if (!localId && hello.restore) {
    localId = await restoreFromGithub(link, hello, config, apps, log);
    writeFileSync(mapFile, JSON.stringify({ localId }));
  }
  apps.startWork();
  log(`runner ready for ${hello.slug} (${hello.packageName}); local app ${localId ?? "not made yet"}`);

  while (!stopped?.()) {
    let item: InboxItem | null;
    try {
      item = await link.take();
    } catch (e) {
      if ((e as { fatal?: boolean }).fatal) break;
      log("take failed:", (e as Error).message);
      continue;
    }
    if (!item) continue;
    try {
      await handle(item);
    } catch (e) {
      log(`${item.kind} failed:`, (e as Error).message);
      link.emit({ type: "inbox.done", inboxId: item.id });
      link.emit({ type: "runner.note", text: (e as Error).message.slice(0, 300) });
    }
    await link.flush();
  }

  async function handle(item: InboxItem): Promise<void> {
    switch (item.kind) {
      case "prompt": {
        const images = await imagesOf(item.payload);
        if (item.payload?.create && !localId) {
          const c = item.payload.create as { name: string; slug: string; packageName: string; preset: string; askMore: boolean };
          if (!cert) cert = await makeAppKey(link, hello.threadId, c.packageName, log);
          const app = apps.create(c.name, String(item.payload.text ?? ""), c.preset, c.askMore, images, false, { slug: c.slug, packageName: c.packageName });
          localId = app.id;
          writeFileSync(mapFile, JSON.stringify({ localId }));
        } else {
          if (!localId) throw new Error("This app is not on its machine yet.");
          apps.sendMessage(localId, String(item.payload?.text ?? ""), images);
        }
        link.emit({ type: "inbox.done", inboxId: item.id });
        return;
      }
      case "cancel":
        if (localId) apps.cancel(localId);
        return;
      case "permission":
        if (localId) apps.answerPermission(localId, String(item.payload.requestId), String(item.payload.optionId));
        return;
      case "stop-helper":
        if (localId) apps.workers?.stop(localId, String(item.payload.workerId));
        return;
      case "rebuild":
        if (localId) apps.rebuild(localId);
        return;
      case "page-answers": {
        if (!localId) return;
        const r = apps.pages.answerFromCloud(localId, String(item.payload.pageId), item.payload.answers);
        if (!r.ok) log(`page answers refused: ${r.error}`);
        return;
      }
      default:
        log(`inbox ${item.kind}: not handled yet`);
    }
  }

  await Promise.allSettled(uploads);
  http.close();
  await apps.shutdown();
}

/** A one-repo token for this thread's app (Contents write, 1 hour), and the repo it is for. */
async function repoToken(link: RunnerLink): Promise<{ token: string; repo: string }> {
  const t = await link.post<{ token?: string; repo?: string; error?: string }>("/runner/github-token");
  if (!t.token || !t.repo) throw new Error(t.error ?? "no GitHub token");
  return { token: t.token, repo: t.repo };
}

/** Runs git with the token given through this process's own child's environment only. */
function gitWithToken(args: string[], cwd: string, token: string): Promise<{ code: number; err: string }> {
  const helper = "!f() { echo username=x-access-token; echo password=$KIWI_GH_TOKEN; }; f";
  const full = ["-c", "safe.directory=*", "-c", "credential.helper=", "-c", `credential.helper=${helper}`, ...args];
  return new Promise((resolve) => {
    const child = spawn("git", full, { cwd, env: { ...process.env, KIWI_GH_TOKEN: token, GIT_TERMINAL_PROMPT: "0" }, stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    child.stderr.on("data", (d: Buffer) => (err += d.toString("utf8")));
    child.on("close", (code) => resolve({ code: code ?? 1, err }));
  });
}

/**
 * Clones the app's repo into its folder, brings its chat back from Convex and registers it with
 * AppManager, its next build numbered above the highest one the phone has.
 */
async function restoreFromGithub(link: RunnerLink, hello: Hello, config: Config, apps: AppManager, log: Log): Promise<string> {
  const t0 = Date.now();
  const dir = join(config.appsDir, hello.slug);
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  const { token, repo } = await repoToken(link);
  const r = await gitWithToken(["clone", "-q", `https://github.com/${repo}.git`, dir], config.appsDir, token);
  if (r.code !== 0) throw new Error(`could not clone ${repo}: ${r.err.trim().split("\n").pop()}`);
  const cloned = Date.now();
  const { items } = await link.post<{ items: ChatItem[] }>("/runner/chat");
  const now = new Date().toISOString();
  const last = hello.latestApk ?? undefined;
  const high = Math.max(hello.buildHigh, last?.number ?? 0);
  const app: App = {
    id: randomUUID(),
    name: hello.name,
    slug: hello.slug,
    packageName: hello.packageName,
    preset: (hello.preset as App["preset"]) ?? "react-native",
    status: "idle",
    iconVersion: 1,
    ...(last ? { latestApk: last } : {}),
    latestBuild: last && last.number === high ? last : { number: high, status: "succeeded", startedAt: now, finishedAt: now },
    createdAt: now,
    updatedAt: now,
  };
  const made = apps.adoptCloudApp(app, dir, items);
  log(`restored ${hello.slug} from ${repo}: clone ${((cloned - t0) / 1000).toFixed(1)} s, ${items.length} chat items, next build ${high + 1}`);
  return made.id;
}

/**
 * Pushes HEAD to the app's repo on the person's GitHub with a one-repo token Convex mints for this
 * push. The token is given to git through an environment variable of this process's own child
 * only, never a file, a command line or the agent.
 */
export async function pushWithToken(link: RunnerLink, dir: string, log: Log): Promise<string | null> {
  let token: string;
  let repo: string;
  try {
    ({ token, repo } = await repoToken(link));
  } catch (e) {
    return `no GitHub token: ${(e as Error).message}`;
  }
  for (let attempt = 1; attempt <= 3; attempt++) {
    const r = await gitWithToken(["push", "-q", `https://github.com/${repo}.git`, "HEAD:refs/heads/main"], dir, token);
    if (r.code === 0) return null;
    log(`push attempt ${attempt} failed: ${r.err.trim().split("\n").pop()}`);
    if (attempt < 3) await new Promise((res) => setTimeout(res, 5000 * attempt));
    else return r.err.trim().split("\n").pop() ?? "push failed";
  }
  return "push failed";
}

export const _test = { lastJson, runAs, randomUUID };
