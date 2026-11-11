// The app manager: creating apps, one Claude Code session per app, a build after every turn,
// Git/GitHub, and the chat timeline. Every change goes out as a ServerEvent.
import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { App, AppPreset, AppStatus, BuildInfo, ChatImage, ImageUpload, ServerEvent, WorkerInfo } from "../../shared/protocol.ts";
import { checkImages, imageExtension, IMAGE_TYPES, picturesLabel } from "../../shared/chat/images.ts";
import type { PromptImage } from "./acp/claude-session.ts";
import { ClaudeSession, claudeLaunchSpec, pickAllowOption, type PermissionAsk } from "./acp/claude-session.ts";
import { ChatTranslator, type ChatDraft } from "./acp/translate.ts";
import type { AcpAgentRequestResponder } from "./acp/agent-connection.ts";
import type { Builder, BuildResult } from "./builder.ts";
import { runBuildCycle, type BuildAttempt } from "./build-cycle.ts";
import { BuildProgress, isEnvironmentFailure, plainBuildError } from "./build-progress.ts";
import type { Config } from "./config.ts";
import { nowIso } from "./fs-util.ts";
import * as git from "./git.ts";
import { placeholderIconPng } from "./icon.ts";
import { appPlaybook, buildFixPrompt } from "./playbook.ts";
import type { AppRecord, Store } from "./store.ts";
import { COORDINATOR_PLAYBOOK_VERSION, coordinatorPlaybook, reportPrompt } from "./coordinator-playbook.ts";
import { isWorkerToolCall, workerToolsMcpServer } from "./worker-http.ts";
import { WorkerManager, type BuildChangeOutcome } from "./workers.ts";
import { isJsonObject } from "./acp/acp-client.ts";

export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// itemId: the user's chat item for a prompt the user sent, marked `queued` while it waits.
// A report carries finished helpers' reports to the coordinator (never dropped by Stop).
type Job =
  | { kind: "prompt"; text: string; itemId?: string; images?: PromptImage[] }
  | { kind: "build" }
  | { kind: "report"; workerId: string; text: string };

interface BuildCycleOptions {
  /** Sends a build failure to an agent; resolves with the stop reason. Default: the app's main session. */
  fix?(prompt: string): Promise<string>;
  cancelled?(): boolean;
  /** The commit message summary. Default: the main chat's last message. */
  summary?: string;
}

interface PendingPermission {
  responder: AcpAgentRequestResponder;
  itemId: string;
}

interface Runtime {
  translator: ChatTranslator;
  session?: ClaudeSession;
  starting?: Promise<ClaudeSession>;
  queue: Job[];
  running: boolean;
  /** While the app is being created: jobs wait until the first prompt is in front of them. */
  held: boolean;
  cancelRequested: boolean;
  permissions: Map<string, PendingPermission>;
  /** ACP tool call ids of the coordinator's own worker tools: their worker rows stand for them. */
  hiddenTools: Set<string>;
  /** True while a prompt to the app's own session runs. */
  turnActive: boolean;
}

interface ReadyRecord extends AppRecord {
  ready?: boolean;
  /** The coordinator playbook version this app's session was given (docs/APP-COORDINATOR.md). */
  coordinatorPlaybook?: number;
}

/** The presets the phone may ask for (shared/protocol.ts AppPreset). */
export const PRESETS: readonly AppPreset[] = ["react-native", "kotlin", "expo-exact"];

const JAVA_KEYWORDS = new Set(
  "abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while true false null var record yield".split(
    " ",
  ),
);

export function slugify(name: string): string {
  let slug = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 30);
  if (slug === "") slug = "app";
  if (/^[0-9]/.test(slug)) slug = `app${slug}`.slice(0, 30);
  if (JAVA_KEYWORDS.has(slug)) slug = `${slug}app`;
  return slug;
}

/** The user's rule: no em dashes anywhere, so texts the server derives from the agent lose them too. */
export function withoutEmDashes(text: string): string {
  return text.replace(/\s*\u{2014}\s*/gu, ", ");
}

function shorten(text: string, max: number): string {
  const flat = withoutEmDashes(text).replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function firstLine(text: string, max = 300): string {
  const line = text.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? text;
  return shorten(line, max);
}

export class AppManager {
  private readonly store: Store;
  private readonly builder: Builder;
  private readonly config: Config;
  private readonly broadcast: (event: ServerEvent) => void;
  private readonly log: (...parts: unknown[]) => void;
  private readonly runtimes = new Map<string, Runtime>();
  /** A plain sentence when the builder cannot run on this PC (no Android toolchain), else null. */
  private readonly checkToolchain: () => string | null;
  /** Each app's workers, when its main chat is a coordinator (config.coordinator). */
  readonly workers: WorkerManager | undefined;

  constructor(deps: {
    store: Store;
    builder: Builder;
    config: Config;
    broadcast: (event: ServerEvent) => void;
    log: (...parts: unknown[]) => void;
    checkToolchain?: () => string | null;
  }) {
    this.store = deps.store;
    this.builder = deps.builder;
    this.config = deps.config;
    this.broadcast = deps.broadcast;
    this.log = deps.log;
    this.checkToolchain = deps.checkToolchain ?? (() => null);
    this.workers = this.config.coordinator
      ? new WorkerManager({
          config: this.config,
          stateDir: this.store.stateDir,
          log: this.log,
          broadcast: this.broadcast,
          record: (appId) => this.store.find(appId),
          emitMain: (record, draft) => this.emitItem(record, draft),
          buildChange: (record, opts) => this.buildCycle(record, opts),
          report: (record, workerId, text) => this.enqueue(record, { kind: "report", workerId, text }),
          activityChanged: (record) => this.activityChanged(record),
        })
      : undefined;
  }

  /** After the server listens: workers that were running when it stopped carry on. */
  startWork(): void {
    const ready = this.store.apps().filter((r) => (r as ReadyRecord).ready);
    this.workers?.resume(ready.map((r) => r.app.id));
    for (const record of ready) this.activityChanged(record);
  }

  // ---------- startup / shutdown

  /** After a restart nothing is running: settle whatever was in flight when the server stopped. */
  recover(): void {
    for (const record of this.store.apps()) {
      const app = record.app;
      const chat = this.store.chat(app.id);
      for (const item of chat.all()) {
        if (item.streaming) chat.upsert({ id: item.id, kind: item.kind, streaming: false });
        // A message that waited in the queue when the companion stopped never reached the agent.
        if (item.queued) chat.upsert({ id: item.id, kind: item.kind, queued: false, dropped: true });
        if (item.tool && (item.tool.status === "pending" || item.tool.status === "in_progress")) {
          chat.upsert({ id: item.id, kind: "tool", tool: { ...item.tool, status: "failed" } });
        }
        if (item.build?.status === "running") {
          chat.upsert({
            id: item.id,
            kind: "build",
            build: { ...item.build, status: "failed", finishedAt: nowIso(), error: "The PC companion restarted during this build." },
          });
        }
        if (item.permission && item.permission.selectedOptionId === undefined) {
          chat.upsert({ id: item.id, kind: "permission", permission: { ...item.permission, selectedOptionId: "cancelled" } });
        }
      }
      delete app.replying;
      if (app.latestBuild?.status === "running") {
        app.latestBuild = { ...app.latestBuild, status: "failed", finishedAt: nowIso(), error: "The PC companion restarted during this build." };
      }
      if (app.status === "creating" && !(record as ReadyRecord).ready) {
        app.status = "error";
        app.error = "The PC companion restarted while this app was being created.";
      } else if (app.status !== "idle" && app.status !== "error") {
        app.status = "idle";
      }
    }
    this.store.save();
  }

  async shutdown(): Promise<void> {
    await Promise.all([...this.runtimes.values()].map((rt) => rt.session?.stop()));
    await this.workers?.shutdown();
    this.store.flush();
  }

  // ---------- reads

  list(): App[] {
    return this.store.apps().map((record) => record.app);
  }

  get(id: string): App {
    return this.record(id).app;
  }

  messages(id: string, afterSeq: number) {
    this.record(id);
    return this.store.chat(id).list(afterSeq);
  }

  apkFile(id: string): { path: string; app: App } | null {
    const record = this.record(id);
    const apk = record.app.latestApk;
    if (!apk) return null;
    const path = join(this.store.apkDir(id), `build-${apk.number}.apk`);
    return existsSync(path) ? { path, app: record.app } : null;
  }

  icon(id: string): { path: string } | { png: Buffer } {
    const record = this.record(id);
    const path = this.safeIconPath(record);
    return path ? { path } : { png: placeholderIconPng(record.app.name) };
  }

  /** The session id of an app (not part of the protocol; for logs and the e2e script). */
  sessionId(id: string): string | undefined {
    return this.record(id).sessionId;
  }

  private record(id: string): ReadyRecord {
    const record = this.store.find(id);
    if (!record) throw new HttpError(404, "There is no app with that id.");
    return record;
  }

  private runtime(id: string): Runtime {
    let rt = this.runtimes.get(id);
    if (!rt) {
      const record = this.record(id);
      rt = {
        translator: new ChatTranslator({ cwd: record.dir, newId: () => randomUUID() }),
        queue: [],
        running: false,
        held: false,
        cancelRequested: false,
        permissions: new Map(),
        hiddenTools: new Set(),
        turnActive: false,
      };
      this.runtimes.set(id, rt);
    }
    return rt;
  }

  // ---------- events

  private emitItem(record: AppRecord, draft: ChatDraft & { build?: BuildInfo; worker?: WorkerInfo }): void {
    const item = this.store.chat(record.app.id).upsert(draft);
    this.broadcast({ type: "chat.item", item });
  }

  private errorItem(record: AppRecord, text: string): void {
    this.emitItem(record, { id: randomUUID(), kind: "error", text });
  }

  private touch(record: AppRecord): void {
    // Set (0 or more) only when the app's chat hands work to helpers: clients read it as "helpers mode".
    if (this.workers && record.app.activeHelpers === undefined) record.app.activeHelpers = this.workers.activeCount(record.app.id);
    record.app.updatedAt = nowIso();
    this.store.save();
    this.broadcast({ type: "app.updated", app: record.app });
  }

  private setStatus(record: AppRecord, status: AppStatus, error?: string): void {
    // With workers, the app is idle only when the main chat and every worker are.
    if (status === "idle" && this.busy(record)) status = "working";
    record.app.status = status;
    if (error === undefined) delete record.app.error;
    else record.app.error = error;
    this.touch(record);
  }

  private busy(record: AppRecord): boolean {
    return this.runtime(record.app.id).turnActive || (this.workers?.busy(record.app.id) ?? false);
  }

  /** A worker started or settled: "working" while anything runs, "idle" after (an error stays shown). */
  private activityChanged(record: AppRecord): void {
    const status = record.app.status;
    if (record.deleted) return;
    const helpers = this.workers?.activeCount(record.app.id);
    if (helpers !== undefined && helpers !== record.app.activeHelpers) {
      record.app.activeHelpers = helpers;
      this.touch(record);
    }
    if (status === "creating" || status === "building") return;
    const busy = this.busy(record);
    if (busy && status !== "working") this.setStatus(record, "working");
    else if (!busy && status === "working") this.setStatus(record, "idle");
  }

  // ---------- commands

  create(name: string, prompt: string, preset: unknown = "react-native"): App {
    const cleanName = name.trim().replace(/\s+/g, " ");
    if (!PRESETS.includes(preset as AppPreset)) throw new HttpError(400, "Choose React Native, Kotlin or Expo Exact.");
    if (cleanName === "" || cleanName.length > 50) throw new HttpError(400, "Give the app a name of up to 50 characters.");
    if (prompt.trim() === "") throw new HttpError(400, "Say what the app should do.");
    const base = slugify(cleanName);
    const taken = (slug: string) =>
      this.store.allRecords().some((r) => r.app.slug === slug) || existsSync(join(this.config.appsDir, slug));
    let slug = base;
    for (let n = 2; taken(slug); n++) slug = `${base}${n}`;
    const now = nowIso();
    const app: App = {
      id: randomUUID(),
      name: cleanName,
      slug,
      packageName: `com.anyapp.${slug}`,
      preset: preset as AppPreset,
      status: "creating",
      iconVersion: 1,
      lastMessagePreview: shorten(prompt, 140),
      createdAt: now,
      updatedAt: now,
    };
    const record: ReadyRecord = { app, dir: join(this.config.appsDir, slug) };
    this.store.add(record);
    this.runtime(app.id).held = true;
    this.broadcast({ type: "app.updated", app });
    this.emitItem(record, { id: randomUUID(), kind: "user", text: prompt.trim() });
    this.finishCreate(record, prompt.trim()).catch((error: unknown) => {
      if (!record.deleted) this.log(`[${app.slug}] creation stopped:`, (error as Error).message);
    });
    return app;
  }

  private async finishCreate(record: ReadyRecord, prompt: string): Promise<void> {
    const { app, dir } = record;
    try {
      mkdirSync(this.config.appsDir, { recursive: true });
      this.log(`[${app.slug}] creating ${dir} with the ${this.builder.kind} builder`);
      await this.builder.createApp({ dir, name: app.name, slug: app.slug, packageName: app.packageName, preset: app.preset ?? "react-native", onLog: () => {} });
      await git.initRepo(dir, `Create ${app.name}`);
      record.iconStamp = this.iconStamp(record);
      record.ready = true;
      this.store.save();
    } catch (error) {
      this.log(`[${app.slug}] creation failed:`, (error as Error).message);
      this.errorItem(record, `The app could not be created: ${firstLine((error as Error).message)}`);
      this.setStatus(record, "error", "The app could not be created on the PC.");
      this.dropQueue(record);
      this.runtime(app.id).held = false;
      return;
    }
    if (record.deleted) return;
    if (this.config.github) {
      try {
        app.repoUrl = await git.createGithubRepo(dir, `anyapp-${app.slug}`);
        this.log(`[${app.slug}] GitHub repository ${app.repoUrl}`);
        this.touch(record);
      } catch (error) {
        this.log(`[${app.slug}] GitHub failed:`, (error as Error).message);
        this.errorItem(record, `GitHub is not available (${firstLine((error as Error).message, 160)}); the app is kept on the PC only.`);
      }
    } else {
      this.log(`[${app.slug}] GitHub is turned off (ANYAPP_GITHUB=off)`);
    }
    // The first prompt goes in front of anything the user sent while the app was being set up.
    const rt = this.runtime(app.id);
    rt.queue.unshift({ kind: "prompt", text: prompt });
    rt.held = false;
    if (!rt.running) void this.drain(record);
  }

  sendMessage(id: string, text: string, uploads: ImageUpload[] = []): void {
    const record = this.record(id);
    if (text.trim() === "" && uploads.length === 0) throw new HttpError(400, "The message is empty.");
    const problem = checkImages(uploads.map((u) => ({ mimeType: String(u?.mimeType ?? ""), data: String(u?.data ?? "") })));
    if (problem) throw new HttpError(400, problem);
    if (!record.ready && record.app.status !== "creating") throw new HttpError(409, "This app could not be created. Make a new one.");
    const rt = this.runtime(record.app.id);
    // Sent while the agent (or the build after it) is busy: it waits its turn, and says so.
    const queued = rt.running || rt.held || rt.queue.length > 0;
    const itemId = randomUUID();
    // Pictures are saved on the PC (as bb saves attachments) and go to the agent as ACP image blocks.
    const saved = uploads.map((u) => this.saveImage(record.app.id, u));
    const images: ChatImage[] = saved.map(({ chat }) => chat);
    this.emitItem(record, { id: itemId, kind: "user", text: text.trim(), ...(images.length ? { images } : {}), ...(queued ? { queued: true } : {}) });
    record.app.lastMessagePreview = text.trim() ? shorten(text, 140) : picturesLabel(images.length);
    this.touch(record);
    this.enqueue(record, { kind: "prompt", text: text.trim(), itemId, images: saved.map(({ prompt }) => prompt) });
  }

  private imagesDir(appId: string): string {
    return join(this.store.stateDir, "images", appId);
  }

  private saveImage(appId: string, upload: ImageUpload): { chat: ChatImage; prompt: PromptImage } {
    const id = randomUUID();
    const dir = this.imagesDir(appId);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `${id}.${imageExtension(upload.mimeType)}`);
    writeFileSync(path, Buffer.from(upload.data, "base64"));
    const size = typeof upload.width === "number" && typeof upload.height === "number" ? { width: Math.round(upload.width), height: Math.round(upload.height) } : {};
    return { chat: { id, mimeType: upload.mimeType, ...size }, prompt: { path, mimeType: upload.mimeType } };
  }

  /** A picture sent in this app's chat, for GET /api/apps/:id/images/:imageId. */
  imageFile(appId: string, imageId: string): { path: string; mimeType: string } | null {
    this.record(appId);
    if (!/^[a-zA-Z0-9-]+$/.test(imageId)) return null;
    for (const mimeType of IMAGE_TYPES) {
      const path = join(this.imagesDir(appId), `${imageId}.${imageExtension(mimeType)}`);
      if (existsSync(path)) return { path, mimeType };
    }
    return null;
  }

  rebuild(id: string): void {
    const record = this.record(id);
    if (!record.ready) throw new HttpError(409, "This app is not ready yet.");
    if (this.workers) {
      this.workers.rebuild(id, record.app.latestBuild?.error);
      return;
    }
    this.enqueue(record, { kind: "build" });
  }

  /** Stop (ACP session/cancel, as bb does): ends the current turn and drops what waits behind it. */
  cancel(id: string): void {
    const record = this.record(id);
    const rt = this.runtime(record.app.id);
    // Only the main chat's own turn stops, and the person's queued messages are dropped; helpers keep
    // working (each has its own Stop) and their reports still reach the main chat.
    this.dropQueue(record);
    if (!rt.running) return;
    rt.cancelRequested = true;
    for (const [requestId, pending] of rt.permissions) {
      pending.responder.result({ outcome: { outcome: "cancelled" } });
      rt.permissions.delete(requestId);
    }
    rt.session?.cancel();
  }

  answerPermission(id: string, requestId: string, optionId: string): void {
    const record = this.record(id);
    const rt = this.runtime(record.app.id);
    const pending = rt.permissions.get(requestId);
    if (!pending) throw new HttpError(404, "That question was already answered.");
    rt.permissions.delete(requestId);
    pending.responder.result({ outcome: { outcome: "selected", optionId } });
    const item = this.store.chat(id).get(pending.itemId);
    if (item?.permission) {
      this.emitItem(record, { id: item.id, kind: "permission", permission: { ...item.permission, selectedOptionId: optionId } });
    }
  }

  async delete(id: string): Promise<void> {
    const record = this.record(id);
    const rt = this.runtimes.get(id);
    if (rt) {
      rt.queue.length = 0;
      await rt.session?.stop();
      this.runtimes.delete(id);
    }
    await this.workers?.forget(id);
    record.deleted = true;
    this.store.save();
    this.broadcast({ type: "app.deleted", appId: id });
  }

  // ---------- the per-app work queue

  private enqueue(record: AppRecord, job: Job): void {
    if (record.deleted) return;
    const rt = this.runtime(record.app.id);
    rt.queue.push(job);
    if (!rt.running && !rt.held) void this.drain(record);
  }

  /** Empties the queue; the user's waiting messages are marked as not sent. */
  private dropQueue(record: AppRecord): void {
    const rt = this.runtime(record.app.id);
    // Helpers' reports stay queued: Stop is about the person's own messages.
    const dropped = rt.queue.filter((job) => job.kind !== "report");
    rt.queue = rt.queue.filter((job) => job.kind === "report");
    for (const job of dropped) {
      if (job.kind === "prompt" && job.itemId) this.emitItem(record, { id: job.itemId, kind: "user", queued: false, dropped: true });
    }
  }

  private async drain(record: AppRecord): Promise<void> {
    const rt = this.runtime(record.app.id);
    rt.running = true;
    this.setReplying(record, true);
    try {
      while (rt.queue.length > 0 && !record.deleted) {
        const job = rt.queue.shift()!;
        rt.cancelRequested = false;
        if (job.kind === "prompt" && job.itemId && this.store.chat(record.app.id).get(job.itemId)?.queued) {
          this.emitItem(record, { id: job.itemId, kind: "user", queued: false });
        }
        try {
          if (job.kind === "prompt") await this.userTurn(record, job.text, job.images ?? []);
          else if (job.kind === "report") await this.reportTurn(record, job);
          else await this.buildCycle(record);
        } catch (error) {
          if (record.deleted) break;
          this.log(`[${record.app.slug}] job failed:`, (error as Error).message);
          this.errorItem(record, firstLine((error as Error).message));
          this.setStatus(record, "error", firstLine((error as Error).message, 160));
        }
      }
    } finally {
      rt.running = false;
      this.setReplying(record, false);
    }
  }

  /** The main chat itself is answering (its Stop applies), as opposed to helpers working. */
  private setReplying(record: AppRecord, replying: boolean): void {
    if (record.deleted || (record.app.replying ?? false) === replying) return;
    record.app.replying = replying;
    this.touch(record);
  }

  /** Worker reports go to the coordinator as one message (every report waiting in the queue). */
  private async reportTurn(record: AppRecord, first: Job & { kind: "report" }): Promise<void> {
    const rt = this.runtime(record.app.id);
    const jobs = [first, ...rt.queue.filter((job): job is Job & { kind: "report" } => job.kind === "report")];
    rt.queue = rt.queue.filter((job) => job.kind !== "report");
    const stop = await this.agentTurn(record, reportPrompt(jobs.map((job) => job.text)));
    this.workers?.reported(record.app.id, jobs.map((job) => job.workerId));
    if (stop !== "cancelled") this.setStatus(record, "idle");
  }

  private async userTurn(record: AppRecord, text: string, images: PromptImage[] = []): Promise<void> {
    if (this.workers) {
      // The coordinator only talks and starts workers; builds follow workers' changes. Pictures go to
      // it as image blocks, and their paths on this PC too, so it can hand them to a helper's brief.
      const paths = images.length > 0 ? `\n\n(The pictures are saved on this PC at: ${images.map((i) => i.path).join(", ")}. A helper can open them by path.)` : "";
      await this.agentTurn(record, `${text}${paths}`, images);
      this.setStatus(record, "idle");
      return;
    }
    const before = await git.treeSnapshot(record.dir, (m) => this.log(`[${record.app.slug}] ${m}`));
    const stopReason = await this.agentTurn(record, text, images);
    if (stopReason === "cancelled" || this.runtime(record.app.id).cancelRequested) {
      this.setStatus(record, "idle");
      return;
    }
    const after = await git.treeSnapshot(record.dir, (m) => this.log(`[${record.app.slug}] ${m}`));
    if (before === after) {
      this.log(`[${record.app.slug}] the turn changed no files; no build`);
      this.setStatus(record, "idle");
      return;
    }
    await this.buildCycle(record);
  }

  private async ensureSession(record: AppRecord): Promise<ClaudeSession> {
    const rt = this.runtime(record.app.id);
    if (rt.session?.alive) return rt.session;
    if (rt.starting) return rt.starting;
    const slug = record.app.slug;
    const ready = record as ReadyRecord;
    const appInfo = { name: record.app.name, packageName: record.app.packageName, dir: record.dir, preset: record.app.preset };
    const coordinated = this.workers
      ? {
          instructions: coordinatorPlaybook(appInfo),
          // An app made before workers resumes its session and gets the new playbook once.
          instructionsOnResume: (ready.coordinatorPlaybook ?? 0) < COORDINATOR_PLAYBOOK_VERSION,
          mcpServers: [workerToolsMcpServer(this.config.port, record.app.id, this.workers.toolsToken)],
        }
      : undefined;
    const session = new ClaudeSession({
      cwd: record.dir,
      ...(record.sessionId ? { resumeSessionId: record.sessionId } : {}),
      instructions: appPlaybook(appInfo),
      ...coordinated,
      launch: claudeLaunchSpec(this.config.acpLaunch),
      askPermissions: this.config.askPermissions,
      onUpdate: (update) => {
        if (coordinated && isJsonObject(update) && (update["sessionUpdate"] === "tool_call" || update["sessionUpdate"] === "tool_call_update")) {
          const toolCallId = String(update["toolCallId"] ?? "");
          if (rt.hiddenTools.has(toolCallId)) return;
          if (isWorkerToolCall(update)) {
            // Not shown (the worker row stands for it), but it ends the text before it, like any tool call.
            rt.hiddenTools.add(toolCallId);
            for (const draft of rt.translator.closeStreams()) this.emitItem(record, draft);
            return;
          }
        }
        for (const draft of rt.translator.translate(update)) this.emitItem(record, draft);
      },
      onPermission: (ask) => this.handlePermission(record, ask),
      onExit: (info) => {
        this.log(`[${slug}] Claude Code exited (code ${info.code ?? "none"})`);
        if (rt.session === session) rt.session = undefined;
      },
      log: (message) => this.log(`[${slug}] ${message}`),
    });
    rt.starting = session.start().then(
      () => {
        rt.session = session;
        rt.starting = undefined;
        record.sessionId = session.sessionId;
        if (coordinated) ready.coordinatorPlaybook = COORDINATOR_PLAYBOOK_VERSION;
        this.store.save();
        this.log(`[${slug}] Claude Code session ${session.sessionId} ${session.resumed ? "resumed" : "started"} (mode ${session.modeId ?? "?"})`);
        return session;
      },
      (error: unknown) => {
        rt.starting = undefined;
        throw new Error(`Claude Code could not start: ${(error as Error).message}`);
      },
    );
    return rt.starting;
  }

  private handlePermission(record: AppRecord, ask: PermissionAsk): void {
    const rt = this.runtime(record.app.id);
    const { request, responder } = ask;
    const requestId = randomUUID();
    const itemId = randomUUID();
    const toolTitle = typeof request.toolCall["title"] === "string" ? request.toolCall["title"] : undefined;
    const permission = {
      requestId,
      title: request.title ?? toolTitle ?? "The agent asks for permission",
      options: request.options.map((o) => ({ optionId: o.optionId, label: o.name, kind: o.kind })),
    };
    const allow = this.config.askPermissions ? undefined : pickAllowOption(request.options);
    if (allow) {
      responder.result({ outcome: { outcome: "selected", optionId: allow } });
      this.emitItem(record, { id: itemId, kind: "permission", permission: { ...permission, selectedOptionId: allow } });
      return;
    }
    rt.permissions.set(requestId, { responder, itemId });
    this.emitItem(record, { id: itemId, kind: "permission", permission });
  }

  /** One prompt to the agent; resolves with the ACP stop reason ("error" when it broke). */
  private async agentTurn(record: AppRecord, text: string, images: PromptImage[] = []): Promise<string> {
    this.setStatus(record, "working");
    const rt = this.runtime(record.app.id);
    const session = await this.ensureSession(record);
    rt.translator.startTurn();
    let stopReason = "error";
    try {
      rt.turnActive = true;
      stopReason = await session.prompt(text, images);
    } catch (error) {
      this.log(`[${record.app.slug}] prompt failed:`, (error as Error).message);
      this.errorItem(record, `The agent stopped unexpectedly: ${firstLine((error as Error).message, 200)}`);
    } finally {
      rt.turnActive = false;
      for (const draft of rt.translator.finishTurn(stopReason)) this.emitItem(record, draft);
    }
    if (stopReason === "cancelled") this.emitItem(record, { id: randomUUID(), kind: "stopped", text: "Stopped" });
    if (rt.translator.lastTurnText.trim() !== "") record.app.lastMessagePreview = shorten(rt.translator.lastTurnText, 140);
    this.checkIcon(record);
    this.touch(record);
    if (stopReason === "error") throw new Error("The agent stopped unexpectedly.");
    return stopReason;
  }

  // ---------- builds

  /**
   * Builds after a turn. The person sees ONE build row for the whole cycle: it keeps saying what is
   * happening in plain words, says "Found a small problem, fixing it" while the agent repairs a
   * failed build, and only turns into "The app didn't build" when every try failed.
   */
  private async buildCycle(record: AppRecord, opts: BuildCycleOptions = {}): Promise<BuildChangeOutcome> {
    const rt = this.runtime(record.app.id);
    const isCancelled = opts.cancelled ?? (() => rt.cancelRequested);
    const fixTurn = opts.fix ?? ((prompt: string) => this.agentTurn(record, prompt));
    const max = this.config.maxBuildFixes;
    const rowId = randomUUID();
    const toolchainProblem = this.checkToolchain();
    if (toolchainProblem) {
      const build: BuildInfo = { number: (record.app.latestBuild?.number ?? 0) + 1, status: "failed", startedAt: nowIso(), finishedAt: nowIso(), error: toolchainProblem };
      this.emitItem(record, { id: rowId, kind: "build", build, text: "" });
      this.setStatus(record, "error", toolchainProblem);
      return { ok: false, error: toolchainProblem };
    }
    let environmentProblem: string | undefined;
    const outcome = await runBuildCycle<{ build: BuildInfo }>({
      maxFixes: max,
      build: () => this.buildOnce(record, rowId),
      cancelled: () => isCancelled() || environmentProblem !== undefined,
      fix: async (error, attempt) => {
        if (isEnvironmentFailure(error)) {
          environmentProblem = error;
          return false;
        }
        const failed = record.app.latestBuild!;
        this.emitItem(record, {
          id: rowId,
          kind: "build",
          build: { number: failed.number, status: "running", startedAt: failed.startedAt },
          text: `Found a small problem. Fixing it, then building again (${attempt} of ${max})`,
        });
        this.log(`[${record.app.slug}] build ${failed.number} failed; fix attempt ${attempt} of ${max}`);
        const stop = await fixTurn(buildFixPrompt({ buildNumber: failed.number, attempt, maxAttempts: max, error, preset: record.app.preset }));
        return stop !== "cancelled";
      },
    });
    if (outcome.outcome === "succeeded") {
      const { build } = outcome.result;
      try {
        const summary = opts.summary ?? (record.app.lastMessagePreview ?? "update").split(/(?<=[.!?])\s/)[0];
        await git.commitAll(record.dir, `Build ${build.number}: ${shorten(summary, 72)}`);
      } catch (error) {
        this.log(`[${record.app.slug}] commit failed:`, (error as Error).message);
      }
      const pushError = await git.push(record.dir);
      if (pushError) {
        this.log(`[${record.app.slug}] push failed: ${pushError}`);
        this.errorItem(record, "Could not save this version to GitHub right now; it is kept on the PC.");
      }
      record.app.latestApk = build;
      this.checkIcon(record);
      this.setStatus(record, "idle");
      this.broadcast({ type: "apk.ready", app: record.app });
      this.log(`[${record.app.slug}] APK ${build.number} ready (${build.sizeBytes} bytes)`);
      return { ok: true, number: build.number };
    }
    const failed = record.app.latestBuild!;
    let plain: string;
    if (environmentProblem !== undefined) {
      this.log(`[${record.app.slug}] build environment problem: ${firstLine(environmentProblem.replace(/^Build #\d+ failed\.\s*/, ""))}`);
      plain = "The PC could not build the app just now. Tap Try again in a moment.";
    } else if (outcome.outcome === "cancelled") {
      plain = "You stopped the fix. Tap Try again to build again.";
    } else {
      plain = `${plainBuildError(outcome.error)} ${max} tries to fix it did not work. Tap Try again, or tell me more about what you want.`;
    }
    record.app.latestBuild = { ...failed, status: "failed", error: plain };
    this.emitItem(record, { id: rowId, kind: "build", build: record.app.latestBuild, text: "" });
    this.setStatus(record, "error", plain);
    return { ok: false, error: plain, ...(outcome.outcome === "cancelled" ? { cancelled: true } : {}) };
  }

  private async buildOnce(record: AppRecord, rowId: string): Promise<BuildAttempt<{ build: BuildInfo }>> {
    const app = record.app;
    const number = (app.latestBuild?.number ?? 0) + 1;
    let build: BuildInfo = { number, status: "running", startedAt: nowIso() };
    app.latestBuild = build;
    this.setStatus(record, "building");
    const progress = new BuildProgress(!existsSync(join(record.dir, "android", "app", "build")));
    let shown = "";
    const show = () => {
      const text = progress.text;
      if (text === shown) return;
      shown = text;
      this.emitItem(record, { id: rowId, kind: "build", build, text });
    };
    show();
    const heartbeat = setInterval(show, 15_000);
    const onLog = (line: string) => {
      if (progress.line(line)) show();
    };
    this.log(`[${app.slug}] build ${number} started`);
    const started = Date.now();
    try {
      const result: BuildResult = await this.builder.buildApk({ dir: record.dir, buildNumber: number, onLog });
      const apkDir = this.store.apkDir(app.id);
      mkdirSync(apkDir, { recursive: true });
      const target = join(apkDir, `build-${number}.apk`);
      copyFileSync(result.apkPath, target);
      this.pruneApks(apkDir, number);
      build = {
        ...build,
        status: "succeeded",
        finishedAt: nowIso(),
        sizeBytes: statSync(target).size,
        sha256: result.sha256,
      };
      app.latestBuild = build;
      this.log(`[${app.slug}] build ${number} took ${Math.round((Date.now() - started) / 1000)} s`);
      this.emitItem(record, { id: rowId, kind: "build", build, text: "The new version is ready" });
      return { ok: true, result: { build } };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      build = { ...build, status: "failed", finishedAt: nowIso(), error: plainBuildError(message) };
      app.latestBuild = build;
      const detail = message.replace(/^Build #\d+ failed\.\s*/, "");
      this.log(`[${app.slug}] build ${number} failed after ${Math.round((Date.now() - started) / 1000)} s: ${firstLine(detail)}`);
      this.touch(record);
      return { ok: false, error: message };
    } finally {
      clearInterval(heartbeat);
    }
  }

  private pruneApks(apkDir: string, keepFrom: number): void {
    for (const file of readdirSync(apkDir)) {
      const match = file.match(/^build-(\d+)\.apk$/);
      if (match && Number(match[1]) < keepFrom - 2) rmSync(join(apkDir, file), { force: true });
    }
  }

  // ---------- icon

  private safeIconPath(record: AppRecord): string | null {
    try {
      const path = this.builder.getIconPath({ dir: record.dir });
      return path && existsSync(path) ? path : null;
    } catch {
      return null;
    }
  }

  private iconStamp(record: AppRecord): string {
    const path = this.safeIconPath(record);
    if (!path) return "none";
    const stat = statSync(path);
    return `${stat.size}:${stat.mtimeMs}`;
  }

  private checkIcon(record: AppRecord): void {
    const stamp = this.iconStamp(record);
    if (stamp === record.iconStamp) return;
    record.iconStamp = stamp;
    record.app.iconVersion += 1;
    this.store.save();
  }
}
