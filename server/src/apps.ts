// The app manager: creating apps, one Claude Code session per app, a build after every turn,
// Git/GitHub, and the chat timeline. Every change goes out as a ServerEvent.
import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ApkVariant, App, AppPreset, AppStatus, AppVersion, BuildInfo, ChangeNotes, ChatImage, CrashInfo, CrashReport, DiaryAnswer, DiaryReadInfo, ImageUpload, PageInfo, PublishRequest, ReleaseStats, ServerEvent, TodoItem, WorkerInfo } from "../../shared/protocol.ts";
import { crashFixPrompt, History, isDescribeChangeCall, isReadDiaryCall, type VersionRecord } from "./history.ts";
import { MEMORY_FILE } from "./playbook.ts";
import { checkImages, imageExtension, IMAGE_TYPES, picturesLabel } from "../../shared/chat/images.ts";
import { answersPreview, parsePageAnswers } from "../../shared/chat/pages.ts";
import { isPageToolCall, Pages } from "./pages.ts";
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
import { realGithub, shareApp, testingFeedUrl, unshareApp, type GithubApi } from "./sharing.ts";
import * as githubCli from "./github.ts";
import { publishVersion, pullBack, StaleSignerError, parseUpdateJson, repoOf, type ApkFile, type ReleaseApi } from "./publish.ts";
import { appPlaybook, buildFixPrompt, firstPrompt, sharedInNote } from "./playbook.ts";
import type { AppRecord, Store } from "./store.ts";
import { COORDINATOR_PLAYBOOK_VERSION, coordinatorPlaybook, reportPrompt } from "./coordinator-playbook.ts";
import { isWorkerToolCall, workerToolsMcpServer } from "./worker-http.ts";
import { WorkerManager, type BuildChangeOutcome } from "./workers.ts";
import { cleanTodoText, TodoLists } from "./todos.ts";
import { isJsonObject } from "./acp/acp-client.ts";
import { appsCliEnv, firstOverview, OVERVIEW_FILE, overviewNeedsAgent } from "./apps-cli.ts";
import { overviewNudge } from "./playbook.ts";

export { HttpError } from "./http-error.ts";
import { HttpError } from "./http-error.ts";

// itemId: the user's chat item for a prompt the user sent, marked `queued` while it waits.
// A report carries finished helpers' reports to the coordinator (never dropped by Stop).
type Job =
  | { kind: "prompt"; text: string; itemId?: string; images?: PromptImage[] }
  | { kind: "build" }
  | { kind: "restore"; to: VersionRecord }
  | { kind: "report"; workerId: string; text: string };

interface BuildCycleOptions {
  /** Sends a build failure to an agent; resolves with the stop reason. Default: the app's main session. */
  fix?(prompt: string): Promise<string>;
  cancelled?(): boolean;
  /** The commit message summary. Default: the main chat's last message. */
  summary?: string;
  /** Whose describe_change notes this build carries: a helper's id, else the main chat's. */
  notesKey?: string;
  /** A go-back (Versions): its own notes, no fix turns, and the version it went back to. */
  restore?: { from: number; notes: ChangeNotes; before: string };
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
  /** Told to the agent with the person's next message, not shown to them (after a go-back). */
  agentNote?: string;
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

/** What a build cut off by a restart of the companion says (it is built again by itself). */
const INTERRUPTED_BUILD = "The PC restarted during this build, so it is building again.";

/** An ABI name as Android spells it (arm64-v8a, x86_64): safe inside a file name. */
const SAFE_ABI = /^[a-z0-9_-]{1,20}$/;

/** What the build row says when a build went out as a quick update (docs/FAST-LANE.md). */
export const QUICK_UPDATE_TEXT = "Sent as a quick update, no install needed";

/** build-6-ota.zip: the quick update of build 6 (docs/FAST-LANE.md). */
export function otaFileName(number: number): string {
  return `build-${number}-ota.zip`;
}

/** build-6.apk (every ABI) or build-6-arm64-v8a.apk (one ABI). */
export function apkFileName(number: number, abi?: string): string {
  return abi ? `build-${number}-${abi}.apk` : `build-${number}.apk`;
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
  /** Apps whose build was cut off by the last stop of the companion (recover -> startWork). */
  private readonly interruptedBuilds = new Set<string>();
  /** A plain sentence when the builder cannot run on this PC (no Android toolchain), else null. */
  private readonly checkToolchain: () => string | null;
  private readonly github: GithubApi;
  /** Apps whose sharing is being turned on or off right now (one change at a time). */
  private readonly sharingBusy = new Set<string>();
  /** Each app's workers, when its main chat is a coordinator (config.coordinator). */
  readonly workers: WorkerManager | undefined;
  /** The pages agents publish into the apps' chats (pages.ts). */
  readonly pages: Pages;
  /** The person's own to-do list per app; never given to the agent. */
  private readonly todoLists: TodoLists;
  /** Versions, What changed notes, crash reports and the diary (docs/VERSIONS.md). */
  readonly history: History;
  private readonly phonesConnected: () => number;

  constructor(deps: {
    store: Store;
    builder: Builder;
    config: Config;
    broadcast: (event: ServerEvent) => void;
    log: (...parts: unknown[]) => void;
    checkToolchain?: () => string | null;
    github?: GithubApi;
    /** How many phones have a live socket now (diary requests need one). */
    phonesConnected?: () => number;
  }) {
    this.phonesConnected = deps.phonesConnected ?? (() => 0);
    this.github = deps.github ?? realGithub;
    this.store = deps.store;
    this.builder = deps.builder;
    this.config = deps.config;
    this.broadcast = deps.broadcast;
    this.log = deps.log;
    this.checkToolchain = deps.checkToolchain ?? (() => null);
    this.pages = new Pages({
      stateDir: this.store.stateDir,
      log: this.log,
      appExists: (appId) => Boolean(this.store.find(appId)),
      showCard: (appId, itemId, page) => {
        const record = this.store.find(appId);
        if (!record) return;
        this.emitItem(record, { id: itemId, kind: "page", text: page.title, page });
        // A page with questions (a plan, "Ask me more") waits for the person; its answers clear it.
        if (page.answeredAt) this.setWaitingForAnswer(record, false);
        else if ((page.questions?.length ?? 0) > 0) this.setWaitingForAnswer(record, true);
      },
      deliver: (appId, text) => this.sendMessage(appId, text),
    });
    this.todoLists = new TodoLists(this.store.stateDir);
    this.history = new History({
      stateDir: this.store.stateDir,
      log: this.log,
      appExists: (appId) => Boolean(this.store.find(appId)),
      askPhoneForDiary: (appId, requestId) => {
        const record = this.store.find(appId);
        if (!record || this.phonesConnected() === 0) return false;
        this.broadcast({ type: "diary.request", appId, packageName: record.app.packageName, requestId });
        return true;
      },
      diaryRead: (appId, info) => {
        const record = this.store.find(appId);
        if (record) this.emitItem(record, { id: randomUUID(), kind: "diary", diary: info });
      },
    });
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
          pageTools: (appId, from) => this.pages.mcpServer(this.config.port, appId, from),
          appTools: (appId, workerId) => this.history.mcpServer(this.config.port, appId, workerId),
          hiddenTool: (update) => isPageToolCall(update) || isDescribeChangeCall(update) || isReadDiaryCall(update),
        })
      : undefined;
  }

  /** After the server listens: workers that were running when it stopped carry on. */
  startWork(): void {
    const ready = this.store.apps().filter((r) => (r as ReadyRecord).ready);
    // A helper that was building builds again by itself (workers.resume); a build of the main
    // chat (or one no helper owns any more) is queued here.
    const helperBuilds = this.workers?.resume(ready.map((r) => r.app.id)) ?? new Set<string>();
    for (const record of ready) {
      this.activityChanged(record);
      if (!this.interruptedBuilds.delete(record.app.id) || helperBuilds.has(record.app.id)) continue;
      this.log(`[${record.app.slug}] the PC restarted during build ${record.app.latestBuild?.number}; building again`);
      this.enqueue(record, { kind: "build" });
    }
    this.interruptedBuilds.clear();
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
            build: { ...item.build, status: "failed", finishedAt: nowIso(), error: INTERRUPTED_BUILD },
          });
        }
        if (item.permission && item.permission.selectedOptionId === undefined) {
          chat.upsert({ id: item.id, kind: "permission", permission: { ...item.permission, selectedOptionId: "cancelled" } });
        }
      }
      delete app.replying;
      // A question page still waiting, with no message from the person after it (also for pages
      // published before App.waitingForAnswer existed).
      const all = chat.all();
      const lastPage = [...all].reverse().find((i) => i.kind === "page" && i.page && (i.page.questions?.length ?? 0) > 0);
      const waiting = Boolean(lastPage && !lastPage.page!.answeredAt && !all.some((i) => i.kind === "user" && !i.dropped && i.seq > lastPage.seq));
      if (waiting) app.waitingForAnswer = true;
      else delete app.waitingForAnswer;
      this.refreshSigning(record);
      if (app.latestBuild?.status === "running") {
        app.latestBuild = { ...app.latestBuild, status: "failed", finishedAt: nowIso(), error: INTERRUPTED_BUILD };
        // Built again by itself once the server listens (startWork), not left for the person to notice.
        if ((record as ReadyRecord).ready) this.interruptedBuilds.add(app.id);
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

  /** The quick update GET /ota serves: the latest build's, when it is a quick build. */
  otaFile(id: string): { path: string; app: App; build: BuildInfo; sha256: string } | null {
    const record = this.record(id);
    const build = record.app.latestApk;
    if (!build?.ota) return null;
    const path = join(this.store.apkDir(id), otaFileName(build.number));
    return existsSync(path) ? { path, app: record.app, build, sha256: build.ota.sha256 } : null;
  }

  /**
   * The APK GET /apk serves: the variant for `abi` when the build has one (smaller), else the full
   * APK. `missing` when the variant is listed but its file is gone, so the phone never gets a file
   * whose checksum differs from the one it was told.
   */
  apkFile(id: string, abi?: string): { path: string; app: App; build: BuildInfo; abi?: string; sha256?: string } | { missing: true } | null {
    const record = this.record(id);
    const apk = record.app.latestApk;
    if (!apk) return null;
    const variant = abi ? apk.variants?.find((v) => v.abi === abi) : undefined;
    if (variant) {
      const path = join(this.store.apkDir(id), apkFileName(apk.number, variant.abi));
      return existsSync(path) ? { path, app: record.app, build: apk, abi: variant.abi, sha256: variant.sha256 } : { missing: true };
    }
    const path = join(this.store.apkDir(id), apkFileName(apk.number));
    return existsSync(path) ? { path, app: record.app, build: apk, ...(apk.sha256 ? { sha256: apk.sha256 } : {}) } : null;
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

  private emitItem(record: AppRecord, draft: ChatDraft & { build?: BuildInfo; worker?: WorkerInfo; page?: PageInfo; crash?: CrashInfo; diary?: DiaryReadInfo }): void {
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

  /** uploads: pictures for the first message; sharedIn: "Like this, but mine" (the agent gets sharedInNote). */
  create(name: string, prompt: string, preset: unknown = "react-native", askMore = false, uploads: ImageUpload[] = [], sharedIn = false): App {
    const cleanName = name.trim().replace(/\s+/g, " ");
    if (!PRESETS.includes(preset as AppPreset)) throw new HttpError(400, "Choose React Native, Kotlin or Expo Exact.");
    if (cleanName === "" || cleanName.length > 50) throw new HttpError(400, "Give the app a name of up to 50 characters.");
    if (prompt.trim() === "") throw new HttpError(400, "Say what the app should do.");
    const problem = checkImages(uploads.map((u) => ({ mimeType: String(u?.mimeType ?? ""), data: String(u?.data ?? "") })));
    if (problem) throw new HttpError(400, problem);
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
    const saved = uploads.map((u) => this.saveImage(app.id, u));
    this.emitItem(record, { id: randomUUID(), kind: "user", text: prompt.trim(), ...(saved.length ? { images: saved.map(({ chat }) => chat) } : {}) });
    const agentPrompt = firstPrompt(prompt.trim(), { askMore: askMore === true, planFirst: this.config.planFirst });
    const shared = sharedIn ? `\n\n${sharedInNote(/https?:\/\//i.test(prompt))}` : "";
    this.finishCreate(record, prompt.trim(), `${agentPrompt}${shared}`, saved.map(({ prompt: image }) => image)).catch((error: unknown) => {
      if (!record.deleted) this.log(`[${app.slug}] creation stopped:`, (error as Error).message);
    });
    return app;
  }

  /** prompt: the person's words (the overview draft); agentPrompt: what the agent gets (with the PC's plan-first line). */
  private async finishCreate(record: ReadyRecord, prompt: string, agentPrompt = prompt, images: PromptImage[] = []): Promise<void> {
    const { app, dir } = record;
    try {
      mkdirSync(this.config.appsDir, { recursive: true });
      this.log(`[${app.slug}] creating ${dir} with the ${this.builder.kind} builder`);
      await this.builder.createApp({ dir, name: app.name, slug: app.slug, packageName: app.packageName, preset: app.preset ?? "react-native", onLog: () => {} });
      // A first overview.md (what the person asked for), so other apps' agents see it at once; this
      // app's agent rewrites it on its first turn and keeps it up to date.
      if (!existsSync(join(dir, OVERVIEW_FILE))) writeFileSync(join(dir, OVERVIEW_FILE), firstOverview(app.name, prompt));
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
    rt.queue.unshift({ kind: "prompt", text: agentPrompt, ...(images.length ? { images } : {}) });
    rt.held = false;
    if (!rt.running) void this.drain(record);
  }

  // ---------- the person's to-do list (never shown to the agent)

  todos(id: string): TodoItem[] {
    this.record(id);
    return this.todoLists.list(id);
  }

  addTodo(id: string, text: string): TodoItem {
    const record = this.record(id);
    const clean = cleanTodoText(text);
    if (!clean) throw new HttpError(400, "Write something first.");
    const item = this.todoLists.add(id, clean);
    if (!item) throw new HttpError(409, "This list is full. Remove a few done items first.");
    this.todosChanged(record);
    return item;
  }

  updateTodo(id: string, todoId: string, change: { done?: unknown; text?: unknown }): TodoItem {
    const record = this.record(id);
    if (change.done !== undefined && typeof change.done !== "boolean") throw new HttpError(400, '"done" must be true or false.');
    if (change.text !== undefined && typeof change.text !== "string") throw new HttpError(400, '"text" must be a string.');
    const text = typeof change.text === "string" ? cleanTodoText(change.text) : undefined;
    if (text === "") throw new HttpError(400, "Write something first.");
    const item = this.todoLists.update(id, todoId, { ...(typeof change.done === "boolean" ? { done: change.done } : {}), ...(text ? { text } : {}) });
    if (!item) throw new HttpError(404, "That to-do is not on the list any more.");
    this.todosChanged(record);
    return item;
  }

  removeTodo(id: string, todoId: string): void {
    const record = this.record(id);
    if (!this.todoLists.remove(id, todoId)) throw new HttpError(404, "That to-do is not on the list any more.");
    this.todosChanged(record);
  }

  /** Sends the item's text to the app's chat as the person's message, then ticks it off. */
  sendTodo(id: string, todoId: string): TodoItem {
    const record = this.record(id);
    const item = this.todoLists.find(id, todoId);
    if (!item) throw new HttpError(404, "That to-do is not on the list any more.");
    this.sendMessage(id, item.text);
    const sent = this.todoLists.update(id, todoId, { done: true, sentAt: nowIso() })!;
    this.todosChanged(record);
    return sent;
  }

  private todosChanged(record: AppRecord): void {
    const open = this.todoLists.openCount(record.app.id);
    if (open > 0) record.app.openTodos = open;
    else delete record.app.openTodos;
    this.broadcast({ type: "todos.updated", appId: record.app.id, todos: this.todoLists.list(record.app.id) });
    this.store.save();
    this.broadcast({ type: "app.updated", app: record.app });
  }

  sendMessage(id: string, text: string, uploads: ImageUpload[] = [], agentExtra = ""): void {
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
    // Any message from the person (a page's answers, or "yes" typed in the chat) is their answer.
    if (record.app.waitingForAnswer) record.app.waitingForAnswer = false;
    const answers = parsePageAnswers(text);
    record.app.lastMessagePreview = answers ? shorten(answersPreview(answers), 140) : text.trim() ? shorten(text, 140) : picturesLabel(images.length);
    this.touch(record);
    const agentText = agentExtra ? `${text.trim()}\n\n${agentExtra}` : text.trim();
    this.enqueue(record, { kind: "prompt", text: agentText, itemId, images: saved.map(({ prompt }) => prompt) });
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

  /** Which key signs this app's builds (docs/DISTRIBUTION.md); unknown with the fake builder. */
  private refreshSigning(record: AppRecord): void {
    if (!this.builder.keys) return;
    try {
      record.app.signing = this.builder.keys.kind(record.app.packageName);
    } catch {
      // a broken key record is reported by the next build
    }
  }

  /**
   * "Share with others" on or off (docs/DISTRIBUTION.md, "GitHub"). On: the code stays in the
   * private repo, a public anyapp-<slug>-releases repo gets a README and the icon, and an app still
   * on the shared key moves to its own key first (then builds again, so the phone gets that build).
   */
  async setShared(id: string, shared: boolean): Promise<App> {
    const record = this.record(id);
    if (!record.ready) throw new HttpError(409, "This app is not ready yet.");
    if (!this.config.github) throw new HttpError(409, "GitHub is turned off on this PC, so apps cannot be shared.");
    if (this.sharingBusy.has(id)) throw new HttpError(409, "Sharing is already being changed for this app.");
    if (shared === Boolean(record.app.sharing?.shared)) return record.app;
    this.sharingBusy.add(id);
    try {
      if (shared) {
        const { sharing, movedKey } = await shareApp(record.app, {
          github: this.github,
          ensureCodeRepo: () => this.ensureCodeRepo(record),
          ...(this.builder.keys
            ? { keys: { kind: (p: string) => this.builder.keys!.kind(p), move: async (p: string) => void (await this.builder.keys!.move(p)) } }
            : {}),
          iconPng: () => this.iconPng(record),
          log: this.log,
        });
        record.app.sharing = sharing;
        this.refreshSigning(record);
        this.touch(record);
        // A plain build (no agent turn unless it fails), so the phone gets the build with the new key.
        if (movedKey && record.app.latestApk) this.enqueue(record, { kind: "build" });
      } else {
        record.app.sharing = await unshareApp(record.app, { github: this.github, log: this.log });
        this.touch(record);
      }
      return record.app;
    } finally {
      this.sharingBusy.delete(id);
    }
  }

  /**
   * Publishes the newest build of a shared app as a GitHub release (docs/DISTRIBUTION.md, stage 3).
   * A build signed before the app got its own key is built again instead (409).
   */
  async publish(id: string, req: PublishRequest): Promise<App> {
    const record = this.record(id);
    if (!record.ready) throw new HttpError(409, "This app is not ready yet.");
    if (this.sharingBusy.has(id)) throw new HttpError(409, "This app is already being published or shared.");
    this.sharingBusy.add(id);
    try {
      const build = record.app.latestApk;
      const apks: ApkFile[] = [];
      if (build?.sha256) {
        const dir = this.store.apkDir(id);
        const full = join(dir, apkFileName(build.number));
        if (existsSync(full)) apks.push({ abi: "universal", path: full, size: statSync(full).size, sha256: build.sha256 });
        for (const v of build.variants ?? []) {
          const path = join(dir, apkFileName(build.number, v.abi));
          if (existsSync(path)) apks.push({ abi: v.abi, path, size: v.sizeBytes, sha256: v.sha256 });
        }
      }
      try {
        const releases = await publishVersion(record.app, build, req, {
          github: this.releaseApi,
          apks,
          currentSigner: () => this.currentSigner(record),
          notesBetween: (after, upTo) => this.buildSummaries(record, after, upTo),
          log: this.log,
        });
        record.app.sharing = { ...record.app.sharing!, releases };
        this.touch(record);
        return record.app;
      } catch (error) {
        if (error instanceof StaleSignerError) this.enqueue(record, { kind: "build" });
        throw error;
      }
    } finally {
      this.sharingBusy.delete(id);
    }
  }

  /** Certificate SHA-256 of the key that signs this app's builds now (null with the fake builder). */
  private async currentSigner(record: AppRecord): Promise<string | null> {
    if (!this.builder.keys) return null;
    const listed = await this.builder.keys.list();
    const kind = this.builder.keys.kind(record.app.packageName);
    return listed.keys.find((k) => k.id === (kind === "shared" ? "shared" : record.app.packageName))?.certSha256 ?? null;
  }

  /** Stops offering a published stable version (docs/DISTRIBUTION.md, "Pull back"). */
  async pullBack(id: string, buildNumber: number): Promise<App> {
    const record = this.record(id);
    if (this.sharingBusy.has(id)) throw new HttpError(409, "This app is already being published or shared.");
    this.sharingBusy.add(id);
    try {
      const releases = await pullBack(record.app, buildNumber, {
        github: this.releaseApi,
        readUpdateJson: async (full, tag) => parseUpdateJson(await githubCli.downloadAsset(full, tag, "update.json")),
        writeAsset: (full, tag, name, content) => githubCli.writeAsset(full, tag, name, content),
        log: this.log,
      });
      record.app.sharing = { ...record.app.sharing!, releases };
      this.touch(record);
      return record.app;
    } finally {
      this.sharingBusy.delete(id);
    }
  }

  /** Downloads per published version, from GitHub. */
  async releaseStats(id: string): Promise<ReleaseStats[]> {
    const record = this.record(id);
    if (!record.app.sharing) return [];
    try {
      const list = await githubCli.listReleases(repoOf(record.app));
      return list.map((r) => ({ tag: r.tag, downloads: r.assets.filter((a) => a.name.endsWith(".apk")).reduce((n, a) => n + a.downloads, 0) }));
    } catch (error) {
      throw new HttpError(502, `GitHub is not reachable: ${(error as Error).message.split(/\r?\n/)[0].slice(0, 160)}`);
    }
  }

  private get releaseApi(): ReleaseApi {
    return {
      createRelease: githubCli.createRelease,
      uploadAssets: githubCli.uploadAssets,
      editRelease: githubCli.editRelease,
      releaseExists: githubCli.releaseExists,
      putFile: (full, path, content, message) => this.github.putFile(full, path, content, message),
    };
  }

  /** "Build 5: add a dark mode" commit summaries for the builds after `after` up to `upTo`. */
  private async buildSummaries(record: AppRecord, after: number, upTo: number): Promise<string> {
    const log = await git.run("git", ["log", "--format=%s", "-n", "200"], record.dir);
    if (log.code !== 0) return "";
    const lines: string[] = [];
    for (const subject of log.stdout.split(/\r?\n/)) {
      const m = /^Build (\d+): (.+)$/.exec(subject.trim());
      if (!m) continue;
      const n = Number(m[1]);
      if (n > after && n <= upTo && !lines.includes(m[2])) lines.push(m[2]);
    }
    return lines.reverse().map((l) => `- ${l}`).join("\n");
  }

  /** The app's private code repo: made now if GitHub failed when the app was created. */
  private async ensureCodeRepo(record: AppRecord): Promise<void> {
    if (record.app.repoUrl) return;
    if (!existsSync(join(record.dir, ".git"))) await git.initRepo(record.dir, `Create ${record.app.name}`);
    record.app.repoUrl = await git.createGithubRepo(record.dir, `anyapp-${record.app.slug}`);
    this.store.save();
  }

  private iconPng(record: AppRecord): Buffer {
    const path = this.safeIconPath(record);
    return path ? readFileSync(path) : placeholderIconPng(record.app.name);
  }

  // ---------- versions, undo, crashes and the diary (docs/VERSIONS.md)

  /** Every version, newest first. */
  async versions(id: string): Promise<AppVersion[]> {
    const record = this.record(id);
    const list = await this.history.versions(id, record.dir);
    const current = record.app.latestApk?.number;
    return list
      .map((v) => ({
        build: v.build,
        title: v.title,
        ...(v.changes ? { changes: v.changes } : {}),
        createdAt: v.createdAt,
        ...(v.restoredFrom ? { restoredFrom: v.restoredFrom } : {}),
        current: v.build === current,
        canRestore: Boolean(v.commit) && v.build !== current,
      }))
      .reverse();
  }

  /** Why the app cannot go back right now, or null. */
  private goBackBlocked(record: ReadyRecord): string | null {
    const rt = this.runtime(record.app.id);
    if (!record.ready) return "Wait until the app is made.";
    if (record.app.status === "building" || record.app.status === "creating") return "Wait until the new version is built.";
    if (rt.running || rt.queue.length > 0 || this.busy(record)) return "Wait until the agent has finished.";
    return null;
  }

  /** Goes back to an earlier version: its code is built again as a new version (202). */
  async restore(id: string, build: number): Promise<App> {
    const record = this.record(id);
    const blocked = this.goBackBlocked(record);
    if (blocked) throw new HttpError(409, blocked);
    const to = (await this.history.versions(id, record.dir)).find((v) => v.build === build);
    if (!to) throw new HttpError(404, `There is no version ${build}.`);
    if (!to.commit) throw new HttpError(409, "The PC does not have the code of that version any more.");
    if (record.app.latestApk?.number === build) throw new HttpError(409, `Version ${build} is already the newest.`);
    this.startGoBack(record, to);
    return record.app;
  }

  /** Undo: back to the version before the newest one. */
  async undo(id: string): Promise<App> {
    const record = this.record(id);
    const list = await this.versions(id);
    const at = list.findIndex((v) => v.current);
    const target = at >= 0 ? list[at + 1] : undefined;
    if (!target || !target.canRestore) throw new HttpError(409, "There is no earlier version to go back to.");
    return this.restore(id, target.build);
  }

  private startGoBack(record: ReadyRecord, to: VersionRecord): void {
    if (!this.workers) {
      this.enqueue(record, { kind: "restore", to });
      return;
    }
    // With helpers, builds follow landings: a go-back takes the landing slot so it never overlaps one.
    this.setStatus(record, "building");
    void this.workers
      .withLandingSlot(record.app.id, "go-back", () => this.goBack(record, to))
      .catch((error: unknown) => {
        this.log(`[${record.app.slug}] going back failed:`, (error as Error).message);
        this.errorItem(record, `Could not go back to version ${to.build}: ${firstLine((error as Error).message, 160)}`);
        this.setStatus(record, "idle");
      });
  }

  /** Puts the files of version `to` back (one new commit) and builds them as a new version. */
  private async goBack(record: ReadyRecord, to: VersionRecord): Promise<void> {
    if (record.deleted) return;
    const from = record.app.latestApk?.number;
    let before: string;
    try {
      const restored = await git.restoreTree(record.dir, to.commit!, `Back to version ${to.build}`, [MEMORY_FILE, OVERVIEW_FILE]);
      before = restored.before;
    } catch (error) {
      this.errorItem(record, `Could not go back to version ${to.build}: ${firstLine((error as Error).message, 160)}`);
      this.setStatus(record, "idle");
      return;
    }
    this.log(`[${record.app.slug}] going back to version ${to.build} (${to.commit?.slice(0, 7)})`);
    const notes: ChangeNotes = {
      // Its own first sentence, so the line never ends cut off mid-word.
      changed: `Back to version ${to.build}, as it was on ${this.dayLabel(to.createdAt)}: ${shorten(to.title.split(/(?<=[.!?])\s/)[0], 160)}`,
      goodToKnow: "Nothing is lost: the newer versions stay in Versions, so you can go back to them.",
    };
    const outcome = await this.buildCycle(record, { summary: `Back to version ${to.build}`, restore: { from: to.build, notes, before } });
    if (outcome.ok) {
      (record as ReadyRecord).agentNote = `(A note from the PC, not from the person: they went back to version ${to.build} with the Versions screen, so the app's files are now as they were in version ${to.build} (commit ${to.commit?.slice(0, 12)}), built as version ${outcome.number}.${from ? ` What versions after ${to.build} up to ${from} added is undone in the files but still in Git history: \`git log\` shows every "Build N" and "Back to version N" commit, and \`git show <commit>:<file>\` shows an old file, if they want something from those versions back.` : ""} ${MEMORY_FILE} and ${OVERVIEW_FILE} were kept as they were.)`;
      this.store.save();
    }
  }

  private dayLabel(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "an earlier day";
    return d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }).replace(",", "");
  }

  /** A crash report from the phone (Crash catcher): a "crash" card in the main chat, deduplicated. */
  reportCrash(id: string, body: unknown): CrashInfo {
    const record = this.record(id);
    const report = cleanCrashReport(body);
    if (!report) throw new HttpError(400, "That crash report is not complete.");
    const saved = this.history.saveReport(id, report);
    const chat = this.store.chat(id);
    const existing = [...chat.all()].reverse().find((i) => i.kind === "crash" && i.crash && History.sameCrash(i.crash, report));
    const crash: CrashInfo = existing?.crash
      ? { ...existing.crash, count: existing.crash.count + 1, lastAt: report.at, ...(report.versionCode ? { versionCode: report.versionCode } : {}) }
      : {
          id: saved.id,
          appId: id,
          kind: report.kind,
          message: firstLine(report.message, 300),
          ...(report.screen ? { screen: report.screen } : {}),
          ...(report.versionCode ? { versionCode: report.versionCode } : {}),
          count: 1,
          firstAt: report.at,
          lastAt: report.at,
        };
    const ready = record as ReadyRecord & { lastCrashReport?: Record<string, string> };
    ready.lastCrashReport = { ...(ready.lastCrashReport ?? {}), [crash.id]: saved.id };
    this.emitItem(record, { id: existing?.id ?? `crash-${crash.id}`, kind: "crash", text: `${record.app.name} ${report.kind === "crash" ? "crashed" : "ran into an error"}`, crash });
    this.log(`[${record.app.slug}] ${report.kind} on the phone: ${firstLine(report.message, 160)}`);
    this.store.save();
    return crash;
  }

  /** "Fix it" on a crash card: the person's message "Fix the crash", with the whole report for the agent. */
  fixCrash(id: string, crashId: string): void {
    const record = this.record(id) as ReadyRecord & { lastCrashReport?: Record<string, string> };
    const item = this.store.chat(id).all().find((i) => i.kind === "crash" && i.crash?.id === crashId);
    if (!item?.crash) throw new HttpError(404, "That crash is not in this chat.");
    if (item.crash.fixAskedAt) throw new HttpError(409, "The agent already has this crash.");
    const report = this.history.report(id, record.lastCrashReport?.[crashId] ?? crashId);
    if (!report) throw new HttpError(404, "The PC does not have this crash's report any more.");
    const text = `Fix the crash: ${shorten(item.crash.message, 120)}`;
    this.sendMessage(id, text, [], crashFixPrompt(record.app.name, report));
    this.emitItem(record, { id: item.id, kind: "crash", crash: { ...item.crash, fixAskedAt: nowIso() } });
  }

  /** The phone's answer to diary.request. */
  diaryAnswer(id: string, body: unknown): void {
    this.record(id);
    if (!this.history.diaryAnswer(id, body as DiaryAnswer)) throw new HttpError(404, "Nobody is waiting for that diary any more.");
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
          else if (job.kind === "restore") await this.goBack(record, job.to);
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

  /** App.waitingForAnswer: a plan or question page waits for the person (shared/chat/state.ts words it). */
  private setWaitingForAnswer(record: AppRecord, waiting: boolean): void {
    if (record.deleted || (record.app.waitingForAnswer ?? false) === waiting) return;
    record.app.waitingForAnswer = waiting;
    this.touch(record);
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
    this.workers?.saveMainNotes(record.app.id, record.dir);
    this.workers?.reported(record.app.id, jobs.map((job) => job.workerId));
    if (stop !== "cancelled") this.setStatus(record, "idle");
  }

  private async userTurn(record: AppRecord, text: string, images: PromptImage[] = []): Promise<void> {
    if (this.workers) {
      // The coordinator only talks and starts workers; builds follow workers' changes. Pictures go to
      // it as image blocks, and their paths on this PC too, so it can hand them to a helper's brief.
      const paths = images.length > 0 ? `\n\n(The pictures are saved on this PC at: ${images.map((i) => i.path).join(", ")}. A helper can open them by path.)` : "";
      await this.agentTurn(record, `${text}${paths}${this.overviewNote(record)}`, images);
      this.workers.saveMainNotes(record.app.id, record.dir);
      this.setStatus(record, "idle");
      return;
    }
    const before = await git.treeSnapshot(record.dir, (m) => this.log(`[${record.app.slug}] ${m}`));
    const stopReason = await this.agentTurn(record, `${text}${this.overviewNote(record)}`, images);
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

  /** Added to the person's prompt (not shown to them) while the app has no overview.md of the agent's own. */
  private overviewNote(record: AppRecord): string {
    const ready = record as ReadyRecord;
    let note = "";
    if (ready.agentNote) {
      note = `\n\n${ready.agentNote}`;
      delete ready.agentNote;
      this.store.save();
    }
    return overviewNeedsAgent(record.dir) ? `${note}

${overviewNudge()}` : note;
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
          mcpServers: [workerToolsMcpServer(this.config.port, record.app.id, this.workers.toolsToken), this.pages.mcpServer(this.config.port, record.app.id), this.history.mcpServer(this.config.port, record.app.id)],
        }
      : undefined;
    const session = new ClaudeSession({
      cwd: record.dir,
      env: appsCliEnv(this.store.stateDir, record.app.id),
      ...(record.sessionId ? { resumeSessionId: record.sessionId } : {}),
      instructions: appPlaybook(appInfo),
      mcpServers: [this.pages.mcpServer(this.config.port, record.app.id), this.history.mcpServer(this.config.port, record.app.id)],
      ...coordinated,
      launch: claudeLaunchSpec(this.config.acpLaunch),
      askPermissions: this.config.askPermissions,
      onUpdate: (update) => {
        if (isJsonObject(update) && (update["sessionUpdate"] === "tool_call" || update["sessionUpdate"] === "tool_call_update")) {
          const toolCallId = String(update["toolCallId"] ?? "");
          if (rt.hiddenTools.has(toolCallId)) return;
          // The page tools are never shown (the page's card stands for them); with helpers, neither are the worker tools.
          if (isPageToolCall(update) || isDescribeChangeCall(update) || isReadDiaryCall(update) || (coordinated && isWorkerToolCall(update))) {
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
      build: () => this.buildOnce(record, rowId, opts.restore?.from),
      cancelled: () => isCancelled() || environmentProblem !== undefined,
      fix: async (error, attempt) => {
        if (opts.restore) return false;
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
    const agentNotes = this.history.takeNotes(record.app.id, opts.notesKey);
    if (outcome.outcome === "succeeded") {
      const { build } = outcome.result;
      const summary = opts.summary ?? (record.app.lastMessagePreview ?? "update").split(/(?<=[.!?])\s/)[0];
      try {
        await git.commitAll(record.dir, `Build ${build.number}: ${shorten(summary, 72)}`);
      } catch (error) {
        this.log(`[${record.app.slug}] commit failed:`, (error as Error).message);
      }
      // What changed (docs/VERSIONS.md): the agent's describe_change notes, else the PC's one line.
      // The same code as the version before (built again after a restart, or Try again): say so.
      const commit = await git.headCommit(record.dir);
      const previous = this.history.recorded(record.app.id).at(-1);
      const unchanged = !opts.restore && !agentNotes && Boolean(commit) && previous?.commit === commit;
      build.changes = opts.restore?.notes ?? agentNotes ?? (unchanged ? { changed: "Built again, nothing changed in the app." } : { changed: shorten(summary, 160) });
      if (opts.restore) build.restoredFrom = opts.restore.from;
      record.app.latestBuild = build;
      this.emitItem(record, { id: rowId, kind: "build", build, text: "The new version is ready" });
      this.history.record(record.app.id, {
        build: build.number,
        ...(commit ? { commit } : {}),
        title: build.changes.changed,
        changes: build.changes,
        createdAt: build.finishedAt ?? nowIso(),
        ...(opts.restore ? { restoredFrom: opts.restore.from } : {}),
      });
      const pushError = await git.push(record.dir);
      if (pushError) {
        this.log(`[${record.app.slug}] push failed: ${pushError}`);
        this.errorItem(record, "Could not save this version to GitHub right now; it is kept on the PC.");
      }
      record.app.latestApk = build;
      this.refreshSigning(record);
      this.checkIcon(record);
      this.setStatus(record, "idle");
      this.broadcast({ type: "apk.ready", app: record.app });
      this.log(`[${record.app.slug}] APK ${build.number} ready (${build.sizeBytes} bytes)`);
      return { ok: true, number: build.number, ...(build.delivery ? { delivery: build.delivery } : {}) };
    }
    const failed = record.app.latestBuild!;
    let plain: string;
    if (environmentProblem !== undefined) {
      this.log(`[${record.app.slug}] build environment problem: ${firstLine(environmentProblem.replace(/^Build #\d+ failed\.\s*/, ""))}`);
      plain = "The PC could not build the app just now. Tap Try again in a moment.";
    } else if (opts.restore) {
      plain = `Version ${opts.restore.from} did not build again on this PC, so your app stays as it was.`;
      if (!(await git.resetKeep(record.dir, opts.restore.before))) this.log(`[${record.app.slug}] could not take the go-back out again`);
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

  private async buildOnce(record: AppRecord, rowId: string, restoredFrom?: number): Promise<BuildAttempt<{ build: BuildInfo }>> {
    const app = record.app;
    const number = (app.latestBuild?.number ?? 0) + 1;
    let build: BuildInfo = { number, status: "running", startedAt: nowIso(), ...(restoredFrom ? { restoredFrom } : {}) };
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
      // A shared app's builds carry its update feeds, so its own updater can find new versions.
      const feeds = app.sharing ? { updateFeed: app.sharing.feedUrl, updateTestingFeed: testingFeedUrl(app.sharing.releasesRepoUrl) } : {};
      const result: BuildResult = await this.builder.buildApk({ dir: record.dir, buildNumber: number, onLog, ...feeds });
      const apkDir = this.store.apkDir(app.id);
      mkdirSync(apkDir, { recursive: true });
      const target = join(apkDir, apkFileName(number));
      copyFileSync(result.apkPath, target);
      const variants: ApkVariant[] = [];
      for (const v of result.variants ?? []) {
        if (!SAFE_ABI.test(v.abi)) continue;
        copyFileSync(v.apkPath, join(apkDir, apkFileName(number, v.abi)));
        variants.push({ abi: v.abi, sizeBytes: v.sizeBytes, sha256: v.sha256 });
      }
      const ota = result.ota && result.delivery === "quick" ? result.ota : undefined;
      if (ota) copyFileSync(ota.path, join(apkDir, otaFileName(number)));
      this.pruneApks(apkDir, number);
      build = {
        ...build,
        status: "succeeded",
        finishedAt: nowIso(),
        sizeBytes: statSync(target).size,
        sha256: result.sha256,
        ...(result.signing?.certSha256 ? { signerSha256: result.signing.certSha256 } : {}),
        ...(variants.length > 0 ? { variants } : {}),
        ...(result.delivery ? { delivery: result.delivery } : {}),
        ...(result.runtime ? { runtime: result.runtime } : {}),
        ...(ota ? { ota: { sizeBytes: ota.sizeBytes, sha256: ota.sha256, runtime: ota.runtime } } : {}),
      };
      app.latestBuild = build;
      this.log(`[${app.slug}] build ${number} (${build.delivery ?? "full"}) took ${Math.round((Date.now() - started) / 1000)} s`);
      this.emitItem(record, { id: rowId, kind: "build", build, text: ota ? QUICK_UPDATE_TEXT : "The new version is ready" });
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
      const match = file.match(/^build-(\d+)(?:-[a-z0-9_-]+)?\.(?:apk|zip)$/);
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

/** A crash report from a phone, checked and trimmed (null when it lacks the message). */
export function cleanCrashReport(body: unknown): CrashReport | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const message = typeof b["message"] === "string" ? withoutEmDashes(b["message"]).trim().slice(0, 2000) : "";
  if (!message) return null;
  const kind = b["kind"] === "error" ? "error" : "crash";
  const at = typeof b["at"] === "string" && !Number.isNaN(Date.parse(b["at"])) ? new Date(b["at"]).toISOString() : nowIso();
  const stack = typeof b["stack"] === "string" ? b["stack"].slice(0, 16 * 1024) : undefined;
  const screen = typeof b["screen"] === "string" ? b["screen"].trim().slice(0, 80) : undefined;
  const versionCode = typeof b["versionCode"] === "number" && Number.isInteger(b["versionCode"]) ? b["versionCode"] : undefined;
  const diary = Array.isArray(b["diary"])
    ? (b["diary"] as unknown[])
        .slice(-50)
        .filter((e): e is { at: string; text: string } => !!e && typeof (e as { text?: unknown }).text === "string")
        .map((e) => ({ at: String(e.at ?? "").slice(0, 40), text: e.text.slice(0, 200) }))
    : undefined;
  return { kind, message, at, ...(stack ? { stack } : {}), ...(screen ? { screen } : {}), ...(versionCode ? { versionCode } : {}), ...(diary?.length ? { diary } : {}) };
}
