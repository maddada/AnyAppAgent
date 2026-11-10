// The app manager: creating apps, one Claude Code session per app, a build after every turn,
// Git/GitHub, and the chat timeline. Every change goes out as a ServerEvent.
import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import type { App, AppStatus, BuildInfo, ServerEvent } from "../../shared/protocol.ts";
import { ClaudeSession, claudeLaunchSpec, pickAllowOption, type PermissionAsk } from "./acp/claude-session.ts";
import { ChatTranslator, type ChatDraft } from "./acp/translate.ts";
import type { AcpAgentRequestResponder } from "./acp/agent-connection.ts";
import type { Builder, BuildResult } from "./builder.ts";
import { runBuildCycle, type BuildAttempt } from "./build-cycle.ts";
import type { Config } from "./config.ts";
import { nowIso } from "./fs-util.ts";
import * as git from "./git.ts";
import { placeholderIconPng } from "./icon.ts";
import { appPlaybook, buildFixPrompt } from "./playbook.ts";
import type { AppRecord, Store } from "./store.ts";

export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type Job = { kind: "prompt"; text: string } | { kind: "build" };

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
  cancelRequested: boolean;
  permissions: Map<string, PendingPermission>;
}

interface ReadyRecord extends AppRecord {
  ready?: boolean;
}

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

  constructor(deps: {
    store: Store;
    builder: Builder;
    config: Config;
    broadcast: (event: ServerEvent) => void;
    log: (...parts: unknown[]) => void;
  }) {
    this.store = deps.store;
    this.builder = deps.builder;
    this.config = deps.config;
    this.broadcast = deps.broadcast;
    this.log = deps.log;
  }

  // ---------- startup / shutdown

  /** After a restart nothing is running: settle whatever was in flight when the server stopped. */
  recover(): void {
    for (const record of this.store.apps()) {
      const app = record.app;
      const chat = this.store.chat(app.id);
      for (const item of chat.all()) {
        if (item.streaming) chat.upsert({ id: item.id, kind: item.kind, streaming: false });
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
        cancelRequested: false,
        permissions: new Map(),
      };
      this.runtimes.set(id, rt);
    }
    return rt;
  }

  // ---------- events

  private emitItem(record: AppRecord, draft: ChatDraft & { build?: BuildInfo }): void {
    const item = this.store.chat(record.app.id).upsert(draft);
    this.broadcast({ type: "chat.item", item });
  }

  private errorItem(record: AppRecord, text: string): void {
    this.emitItem(record, { id: randomUUID(), kind: "error", text });
  }

  private touch(record: AppRecord): void {
    record.app.updatedAt = nowIso();
    this.store.save();
    this.broadcast({ type: "app.updated", app: record.app });
  }

  private setStatus(record: AppRecord, status: AppStatus, error?: string): void {
    record.app.status = status;
    if (error === undefined) delete record.app.error;
    else record.app.error = error;
    this.touch(record);
  }

  // ---------- commands

  create(name: string, prompt: string): App {
    const cleanName = name.trim().replace(/\s+/g, " ");
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
      status: "creating",
      iconVersion: 1,
      lastMessagePreview: shorten(prompt, 140),
      createdAt: now,
      updatedAt: now,
    };
    const record: ReadyRecord = { app, dir: join(this.config.appsDir, slug) };
    this.store.add(record);
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
      await this.builder.createApp({ dir, name: app.name, slug: app.slug, packageName: app.packageName, onLog: () => {} });
      await git.initRepo(dir, `Create ${app.name}`);
      record.iconStamp = this.iconStamp(record);
      record.ready = true;
      this.store.save();
    } catch (error) {
      this.log(`[${app.slug}] creation failed:`, (error as Error).message);
      this.errorItem(record, `The app could not be created: ${firstLine((error as Error).message)}`);
      this.setStatus(record, "error", "The app could not be created on the PC.");
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
    this.enqueue(record, { kind: "prompt", text: prompt });
  }

  sendMessage(id: string, text: string): void {
    const record = this.record(id);
    if (text.trim() === "") throw new HttpError(400, "The message is empty.");
    if (!record.ready && record.app.status !== "creating") throw new HttpError(409, "This app could not be created. Make a new one.");
    this.emitItem(record, { id: randomUUID(), kind: "user", text: text.trim() });
    record.app.lastMessagePreview = shorten(text, 140);
    this.touch(record);
    this.enqueue(record, { kind: "prompt", text: text.trim() });
  }

  rebuild(id: string): void {
    const record = this.record(id);
    if (!record.ready) throw new HttpError(409, "This app is not ready yet.");
    this.enqueue(record, { kind: "build" });
  }

  cancel(id: string): void {
    const record = this.record(id);
    const rt = this.runtime(record.app.id);
    rt.queue.length = 0;
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
    record.deleted = true;
    this.store.save();
    this.broadcast({ type: "app.deleted", appId: id });
  }

  // ---------- the per-app work queue

  private enqueue(record: AppRecord, job: Job): void {
    if (record.deleted) return;
    const rt = this.runtime(record.app.id);
    rt.queue.push(job);
    if (!rt.running) void this.drain(record);
  }

  private async drain(record: AppRecord): Promise<void> {
    const rt = this.runtime(record.app.id);
    rt.running = true;
    try {
      while (rt.queue.length > 0 && !record.deleted) {
        const job = rt.queue.shift()!;
        rt.cancelRequested = false;
        try {
          if (job.kind === "prompt") await this.userTurn(record, job.text);
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
    }
  }

  private async userTurn(record: AppRecord, text: string): Promise<void> {
    const before = await git.treeSnapshot(record.dir);
    const stopReason = await this.agentTurn(record, text);
    if (stopReason === "cancelled" || this.runtime(record.app.id).cancelRequested) {
      this.setStatus(record, "idle");
      return;
    }
    const after = await git.treeSnapshot(record.dir);
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
    const session = new ClaudeSession({
      cwd: record.dir,
      ...(record.sessionId ? { resumeSessionId: record.sessionId } : {}),
      instructions: appPlaybook({ name: record.app.name, packageName: record.app.packageName, dir: record.dir }),
      launch: claudeLaunchSpec(this.config.acpLaunch),
      onUpdate: (update) => {
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
    const allow = pickAllowOption(request.options);
    if (allow) {
      responder.result({ outcome: { outcome: "selected", optionId: allow } });
      this.emitItem(record, { id: itemId, kind: "permission", permission: { ...permission, selectedOptionId: allow } });
      return;
    }
    rt.permissions.set(requestId, { responder, itemId });
    this.emitItem(record, { id: itemId, kind: "permission", permission });
  }

  /** One prompt to the agent; resolves with the ACP stop reason ("error" when it broke). */
  private async agentTurn(record: AppRecord, text: string): Promise<string> {
    this.setStatus(record, "working");
    const rt = this.runtime(record.app.id);
    const session = await this.ensureSession(record);
    rt.translator.startTurn();
    let stopReason = "error";
    try {
      stopReason = await session.prompt(text);
    } catch (error) {
      this.log(`[${record.app.slug}] prompt failed:`, (error as Error).message);
      this.errorItem(record, `The agent stopped unexpectedly: ${firstLine((error as Error).message, 200)}`);
    } finally {
      for (const draft of rt.translator.finishTurn(stopReason)) this.emitItem(record, draft);
    }
    if (rt.translator.lastTurnText.trim() !== "") record.app.lastMessagePreview = shorten(rt.translator.lastTurnText, 140);
    this.checkIcon(record);
    this.touch(record);
    if (stopReason === "error") throw new Error("The agent stopped unexpectedly.");
    return stopReason;
  }

  // ---------- builds

  private async buildCycle(record: AppRecord): Promise<void> {
    const rt = this.runtime(record.app.id);
    const max = this.config.maxBuildFixes;
    const outcome = await runBuildCycle<{ build: BuildInfo }>({
      maxFixes: max,
      build: () => this.buildOnce(record),
      cancelled: () => rt.cancelRequested,
      fix: async (error, attempt) => {
        const number = record.app.latestBuild?.number ?? 0;
        this.errorItem(record, `Build ${number} failed. Asking the agent to fix it (try ${attempt} of ${max}).`);
        const stop = await this.agentTurn(record, buildFixPrompt({ buildNumber: number, attempt, maxAttempts: max, error }));
        return stop !== "cancelled";
      },
    });
    if (outcome.outcome === "succeeded") {
      const { build } = outcome.result;
      try {
        const summary = (record.app.lastMessagePreview ?? "update").split(/(?<=[.!?])\s/)[0];
        await git.commitAll(record.dir, `Build ${build.number}: ${shorten(summary, 72)}`);
      } catch (error) {
        this.log(`[${record.app.slug}] commit failed:`, (error as Error).message);
      }
      const pushError = await git.push(record.dir);
      if (pushError) this.errorItem(record, `Could not push to GitHub (${shorten(pushError, 160)}); the change is saved on the PC.`);
      record.app.latestApk = build;
      this.checkIcon(record);
      this.setStatus(record, "idle");
      this.broadcast({ type: "apk.ready", app: record.app });
      this.log(`[${record.app.slug}] APK ${build.number} ready (${build.sizeBytes} bytes)`);
      return;
    }
    if (outcome.outcome === "cancelled") {
      this.setStatus(record, "error", "The last build failed and fixing it was stopped.");
      return;
    }
    const lines = outcome.error.trim().split(/\r?\n/).slice(-12).join("\n");
    this.errorItem(record, `The build still fails after ${outcome.fixes} fixes:\n${lines}`);
    this.setStatus(record, "error", "The build failed.");
  }

  private async buildOnce(record: AppRecord): Promise<BuildAttempt<{ build: BuildInfo }>> {
    const app = record.app;
    const number = (app.latestBuild?.number ?? 0) + 1;
    const itemId = randomUUID();
    let build: BuildInfo = { number, status: "running", startedAt: nowIso() };
    app.latestBuild = build;
    this.setStatus(record, "building");
    this.emitItem(record, { id: itemId, kind: "build", build, text: "Starting the build" });
    let lastLogAt = 0;
    const onLog = (line: string) => {
      const text = line.trim();
      if (text === "" || Date.now() - lastLogAt < 1000) return;
      lastLogAt = Date.now();
      this.emitItem(record, { id: itemId, kind: "build", text: shorten(text, 200) });
    };
    this.log(`[${app.slug}] build ${number} started`);
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
      this.emitItem(record, { id: itemId, kind: "build", build, text: "The new version is ready" });
      return { ok: true, result: { build } };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      build = { ...build, status: "failed", finishedAt: nowIso(), error: firstLine(message) };
      app.latestBuild = build;
      this.emitItem(record, { id: itemId, kind: "build", build, text: "The build failed" });
      this.log(`[${app.slug}] build ${number} failed: ${firstLine(message)}`);
      this.touch(record);
      return { ok: false, error: message };
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
