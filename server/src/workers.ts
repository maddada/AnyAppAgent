// Workers: the Claude Code sessions an app's coordinator (its main chat) starts for real work. Each
// worker has its own ACP session in the app's folder, its own chat, and one row in the main chat.
// Workers that change the app take turns (one "change slot" per app, shared with Try again
// builds); workers that only look run at once. When a changing worker's turn changed files, the
// companion builds the app (build errors go back to that worker), then the worker's report goes to
// the coordinator as a message. Everything is saved under <state>/workers/ so a restart resumes.
// See docs/APP-COORDINATOR.md.
import { randomBytes, randomUUID } from "node:crypto";
import { join } from "node:path";
import type { ChatItem, PlanLimit, ServerEvent, TokenUsage, WorkerInfo, WorkerState } from "../../shared/protocol.ts";
import { ClaudeSession, claudeLaunchSpec, pickAllowOption } from "./acp/claude-session.ts";
import { ChatTranslator, type ChatDraft } from "./acp/translate.ts";
import type { Config } from "./config.ts";
import { workerPlaybook } from "./coordinator-playbook.ts";
import { appsCliEnv } from "./apps-cli.ts";
import { commitAll } from "./git.ts";
import { checkCommand } from "./playbook.ts";
import { nowIso, readJson, writeJsonAtomic } from "./fs-util.ts";
import { existsSync } from "node:fs";
import { isJsonObject } from "./acp/acp-client.ts";
import {
  appBranch,
  ensureHelperCopy,
  helperCopyDir,
  landFix,
  landHelperWork,
  leftoverConflictMarkers,
  removeHelperCopy,
  saveHelperWork,
  undoLanding,
  type LandResult,
} from "./helper-copies.ts";
import { ChatLog, type AppRecord } from "./store.ts";

// delivery (docs/FAST-LANE.md): "quick" when the build went to the phone as a quick update.
export type BuildChangeOutcome = { ok: true; number: number; delivery?: "quick" | "full" } | { ok: false; error: string; cancelled?: boolean };

/** What the worker manager needs from the app manager. */
export interface WorkerHost {
  config: Config;
  stateDir: string;
  log(...parts: unknown[]): void;
  broadcast(event: ServerEvent): void;
  /** The app's record, or undefined once it was deleted. */
  record(appId: string): AppRecord | undefined;
  /** Upserts an item into the app's main chat and broadcasts it. */
  emitMain(record: AppRecord, draft: ChatDraft & { worker?: WorkerInfo }): void;
  /** Builds the app after a change (one build row in the main chat), fixing failures through `fix`. */
  buildChange(record: AppRecord, opts: { fix(prompt: string): Promise<string>; cancelled(): boolean; summary: string; notesKey?: string }): Promise<BuildChangeOutcome>;
  /** Hands finished workers' reports to the coordinator as its next message. */
  report(record: AppRecord, workerId: string, text: string): void;
  /** A worker started or settled: the app's status may change. */
  activityChanged(record: AppRecord): void;
  /** The page tools (show_page) for a worker's session: its pages show in the main chat. */
  pageTools?(appId: string, from: { workerId: string; title: string }): unknown;
  /** The app tools (describe_change, read_diary; history.ts) for a helper's session. */
  appTools?(appId: string, workerId: string): unknown;
  /** Tool calls that are plumbing and never shown (the page tools: a page card stands for them). */
  hiddenTool?(update: Record<string, unknown>): boolean;
  /** The usage meter: the person's message the main chat works for now (a new helper's work counts toward it). */
  usageItem?(appId: string): string | undefined;
  /** The usage meter: one of a helper's turns used this (itemId: the message it works for). */
  countUsage?(appId: string, itemId: string | undefined, usage: TokenUsage): void;
  /** The usage meter: a plan limit Claude reported. */
  notePlan?(limit: PlanLimit): void;
}

interface WorkerRecord {
  info: WorkerInfo;
  brief: string;
  rowId: string; // its row in the main chat
  sessionId?: string;
  inbox: string[]; // prompts for its next turn
  forceBuild?: boolean; // build after its first turn even when no file changed (Try again)
  buildAgain?: boolean; // the PC restarted while it was building: land and build again, no turn first
  reportPending?: string; // a report the coordinator has not received yet
  lastText?: string; // the worker's last message (its report)
  conflictsResolved?: number; // times it combined its change with one that landed first
  usageItem?: string; // the person's message whose work it does (the usage meter)
}

type Ended = { state: WorkerState; build?: string };

/** How often a helper may try to combine its change with ones that landed first. */
const MAX_CONFLICT_TRIES = 3;

function conflictPrompt(base: string, files: string[], check: string): string {
  return `Your change could not be added to the app yet: while you worked, another helper's change landed and touches the same parts of ${files.join(", ")}.
In your folder (your own copy of the app), run \`git merge ${base}\` to bring in the app's latest version, then resolve every conflict so that both changes work together: keep the other change and add yours on top. Remove every conflict marker, then run \`${check}\`. Do not commit: the PC saves your work and tries to add it again when you end your turn.
End with one plain sentence on how you combined the two changes.`;
}

interface WorkerRuntime {
  translator: ChatTranslator;
  session?: ClaudeSession;
  running: boolean;
  stopRequested: boolean;
  latestTimer?: NodeJS.Timeout;
  latestShownAt: number;
  /** ACP tool call ids that are never shown (hiddenTool). */
  hiddenTools: Set<string>;
}

interface AppWorkers {
  records: WorkerRecord[];
  chats: Map<string, ChatLog>;
  saveTimer?: NodeJS.Timeout;
}

const ACTIVE: ReadonlySet<WorkerState> = new Set(["waiting", "working", "building"]);
const LATEST_EVERY_MS = 1500;

function oneLine(text: string, max = 140): string {
  const line = text.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? "";
  const flat = line.replace(/\s*\u{2014}\s*/gu, ", ").replace(/[*_`#>]+/g, "").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** A FIFO lock: one holder at a time. */
class Slot {
  private tail: Promise<void> = Promise.resolve();
  holder: string | undefined;
  acquire(who: string): Promise<() => void> {
    let release!: () => void;
    const next = new Promise<void>((r) => (release = r));
    const before = this.tail;
    this.tail = before.then(() => next);
    return before.then(() => {
      this.holder = who;
      return () => {
        if (this.holder === who) this.holder = undefined;
        release();
      };
    });
  }
}

export class WorkerManager {
  /** The bearer secret of the coordinator tool endpoint (a new one each run; only Claude Code gets it). */
  readonly toolsToken = randomBytes(24).toString("hex");
  private readonly host: WorkerHost;
  private readonly apps = new Map<string, AppWorkers>();
  private readonly runtimes = new Map<string, WorkerRuntime>();
  private readonly slots = new Map<string, Slot>();
  /** Set on shutdown: what is running stays "working" on disk so the next start resumes it. */
  private closing = false;

  constructor(host: WorkerHost) {
    this.host = host;
  }

  // ---------- storage

  private dir(appId: string): string {
    return join(this.host.stateDir, "workers", appId);
  }

  private workers(appId: string): AppWorkers {
    let entry = this.apps.get(appId);
    if (!entry) {
      entry = { records: readJson<WorkerRecord[]>(join(this.dir(appId), "workers.json"), []), chats: new Map() };
      this.apps.set(appId, entry);
    }
    return entry;
  }

  private save(appId: string): void {
    if (this.closing) return;
    const entry = this.workers(appId);
    entry.saveTimer ??= setTimeout(() => this.flushApp(appId), 250);
  }

  private flushApp(appId: string): void {
    const entry = this.apps.get(appId);
    if (!entry) return;
    if (entry.saveTimer) clearTimeout(entry.saveTimer);
    entry.saveTimer = undefined;
    writeJsonAtomic(join(this.dir(appId), "workers.json"), entry.records);
    for (const chat of entry.chats.values()) chat.flush();
  }

  private chat(appId: string, workerId: string): ChatLog {
    const entry = this.workers(appId);
    let log = entry.chats.get(workerId);
    if (!log) {
      log = new ChatLog(appId, join(this.dir(appId), `${workerId}.chat.json`));
      entry.chats.set(workerId, log);
    }
    return log;
  }

  private find(appId: string, workerId: string): WorkerRecord {
    const found = this.workers(appId).records.find((w) => w.info.id === workerId);
    if (!found) throw Object.assign(new Error("There is no worker with that id."), { status: 404 });
    return found;
  }

  /** Runs `fn` holding the app's landing slot, so it never overlaps a landing or its build (Versions). */
  async withLandingSlot<T>(appId: string, holder: string, fn: () => Promise<T>): Promise<T> {
    const release = await this.slot(appId).acquire(holder);
    try {
      return await fn();
    } finally {
      release();
    }
  }

  private slot(appId: string): Slot {
    let slot = this.slots.get(appId);
    if (!slot) this.slots.set(appId, (slot = new Slot()));
    return slot;
  }

  private runtime(appId: string, workerId: string, cwd: string): WorkerRuntime {
    const key = `${appId}/${workerId}`;
    let rt = this.runtimes.get(key);
    if (!rt) {
      rt = { translator: new ChatTranslator({ cwd, newId: () => randomUUID() }), running: false, stopRequested: false, latestShownAt: 0, hiddenTools: new Set() };
      this.runtimes.set(key, rt);
    }
    return rt;
  }

  /**
   * Saves what the main chat wrote in the app folder (overview.md, APP_MEMORY.md) in the app's
   * history after its turn, so they are committed even when no helper lands next. It takes the
   * landing slot, so it never runs in the middle of a landing.
   */
  saveMainNotes(appId: string, dir: string): void {
    void this.slot(appId)
      .acquire("main-notes")
      .then(async (release) => {
        try {
          if (this.host.record(appId) && (await commitAll(dir, "Notes from the main chat"))) this.host.log(`[${appId}] saved the main chat's notes`);
        } catch (error) {
          this.host.log(`[${appId}] could not save the main chat's notes: ${(error as Error).message}`);
        } finally {
          release();
        }
      });
  }

  // ---------- reads

  list(appId: string): WorkerInfo[] {
    return this.workers(appId).records.map((w) => w.info);
  }

  messages(appId: string, workerId: string, afterSeq: number): ChatItem[] {
    this.find(appId, workerId);
    return this.chat(appId, workerId).list(afterSeq);
  }

  /** How many workers of the app wait, work or build now. */
  activeCount(appId: string): number {
    return this.workers(appId).records.filter((w) => ACTIVE.has(w.info.state)).length;
  }

  /** True while any worker of the app waits, works or builds. */
  busy(appId: string): boolean {
    return this.workers(appId).records.some((w) => ACTIVE.has(w.info.state));
  }

  // ---------- events

  private emitWorkerItem(appId: string, workerId: string, draft: ChatDraft): void {
    const item = this.chat(appId, workerId).upsert({ ...draft, workerId } as ChatDraft);
    this.host.broadcast({ type: "worker.item", item });
  }

  private changed(record: AppRecord, w: WorkerRecord): void {
    if (this.closing) return;
    w.info.updatedAt = nowIso();
    this.save(record.app.id);
    this.host.emitMain(record, { id: w.rowId, kind: "worker", worker: { ...w.info } });
    this.host.broadcast({ type: "worker.updated", worker: { ...w.info } });
  }

  private setState(record: AppRecord, w: WorkerRecord, state: WorkerState, latest?: string): void {
    const was = w.info.state;
    w.info.state = state;
    if (latest !== undefined) w.info.latest = latest;
    if (!ACTIVE.has(state)) w.info.finishedAt = nowIso();
    this.changed(record, w);
    if (ACTIVE.has(was) !== ACTIVE.has(state) || was === "building" || state === "building") this.host.activityChanged(record);
  }

  /** The row's latest line follows the worker's tool calls and words, at most every 1.5 s. */
  private noteLatest(record: AppRecord, w: WorkerRecord, rt: WorkerRuntime, line: string): void {
    if (!line || line === w.info.latest || w.info.state !== "working") return;
    w.info.latest = line;
    const wait = rt.latestShownAt + LATEST_EVERY_MS - Date.now();
    if (wait <= 0) {
      rt.latestShownAt = Date.now();
      this.changed(record, w);
      return;
    }
    rt.latestTimer ??= setTimeout(() => {
      rt.latestTimer = undefined;
      rt.latestShownAt = Date.now();
      if (w.info.state === "working") this.changed(record, w);
    }, wait);
  }

  // ---------- commands (the coordinator's tools and the HTTP routes)

  start(appId: string, args: { title: string; brief: string; changesApp: boolean; forceBuild?: boolean }): WorkerInfo {
    const record = this.host.record(appId);
    if (!record) throw new Error("The app is gone.");
    const entry = this.workers(appId);
    let id = randomBytes(3).toString("hex");
    while (entry.records.some((w) => w.info.id === id)) id = randomBytes(3).toString("hex");
    const now = nowIso();
    const w: WorkerRecord = {
      info: { id, appId, title: oneLine(args.title, 60) || "Work on the app", state: "working", latest: "Starting", changesApp: args.changesApp, createdAt: now, updatedAt: now },
      brief: args.brief.trim(),
      rowId: randomUUID(),
      inbox: [args.brief.trim()],
      ...(args.forceBuild ? { forceBuild: true } : {}),
    };
    const usageItem = this.host.usageItem?.(appId);
    if (usageItem) w.usageItem = usageItem;
    entry.records.push(w);
    this.changed(record, w);
    this.host.activityChanged(record);
    this.host.log(`[${record.app.slug}] worker ${id} "${w.info.title}" (${args.changesApp ? "changes the app, in its own copy" : "looks only"})`);
    void this.run(appId, id);
    return { ...w.info };
  }

  /** The person's message a worker's work counts toward (the usage meter), if known. */
  usageItemOf(appId: string, workerId: string): string | undefined {
    return this.workers(appId).records.find((w) => w.info.id === workerId)?.usageItem;
  }

  /** A follow-up for a worker, from the coordinator (a worker's own chat is read only). */
  send(appId: string, workerId: string, text: string): "now" | "next" {
    const record = this.host.record(appId);
    if (!record) throw new Error("The app is gone.");
    const w = this.find(appId, workerId);
    const body = text.trim();
    if (body === "") throw Object.assign(new Error("The message is empty."), { status: 400 });
    w.inbox.push(body);
    this.save(appId);
    const rt = this.runtimes.get(`${appId}/${workerId}`);
    if (rt?.running) return "next";
    void this.run(appId, workerId);
    return "now";
  }

  stop(appId: string, workerId: string): WorkerInfo {
    const record = this.host.record(appId);
    const w = this.find(appId, workerId);
    w.inbox.length = 0;
    const rt = this.runtimes.get(`${appId}/${workerId}`);
    if (rt?.running) {
      rt.stopRequested = true;
      rt.session?.cancel();
      // One waiting for its turn to land shows as stopped now; it settles when the slot comes round.
      if (record && w.info.state === "waiting") this.setState(record, w, "stopped", "Stopped");
    } else if (record && ACTIVE.has(w.info.state)) {
      this.setState(record, w, "stopped", "Stopped");
    }
    this.save(appId);
    return { ...w.info };
  }

  /** A short readout of one worker for the coordinator: its state and its newest chat lines. */
  readout(appId: string, workerId: string, last = 10): string {
    const w = this.find(appId, workerId);
    const lines: string[] = [];
    for (const item of this.chat(appId, workerId).all().slice(-60)) {
      if (item.kind === "assistant" && item.text) lines.push(`Worker said: ${item.text.trim().slice(0, 1200)}`);
      else if (item.kind === "user" && item.text) lines.push(`It was told: ${oneLine(item.text, 300)}`);
      else if (item.kind === "tool" && item.tool) lines.push(`Step: ${item.tool.title} (${item.tool.status})`);
      else if (item.kind === "error" && item.text) lines.push(`Problem: ${item.text}`);
    }
    return [`Worker ${w.info.id} "${w.info.title}": ${w.info.state}${w.info.latest ? `, latest: ${w.info.latest}` : ""}`, ...lines.slice(-last)].join("\n");
  }

  // ---------- running a worker

  /** Where a worker works: its own copy of the app when it changes the app, else the app folder. */
  private workDir(record: AppRecord, w: WorkerRecord): string {
    return w.info.changesApp ? helperCopyDir(this.host.config.appsDir, record.app.slug, w.info.id) : record.dir;
  }

  private async ensureSession(record: AppRecord, w: WorkerRecord, rt: WorkerRuntime): Promise<ClaudeSession> {
    if (rt.session?.alive) return rt.session;
    const appId = record.app.id;
    const slug = record.app.slug;
    const cwd = this.workDir(record, w);
    const session = new ClaudeSession({
      cwd,
      env: appsCliEnv(this.host.stateDir, appId),
      ...(w.sessionId ? { resumeSessionId: w.sessionId } : {}),
      instructions: workerPlaybook({ name: record.app.name, packageName: record.app.packageName, dir: cwd, preset: record.app.preset }, w.info),
      mcpServers: [
        ...(this.host.pageTools ? [this.host.pageTools(appId, { workerId: w.info.id, title: w.info.title })] : []),
        ...(this.host.appTools ? [this.host.appTools(appId, w.info.id)] : []),
      ],
      launch: claudeLaunchSpec(this.host.config.acpLaunch),
      onUsage: (usage) => this.host.countUsage?.(appId, w.usageItem, usage),
      onPlanLimit: (limit) => this.host.notePlan?.(limit),
      onUpdate: (update) => {
        if (this.host.hiddenTool && isJsonObject(update) && (update["sessionUpdate"] === "tool_call" || update["sessionUpdate"] === "tool_call_update")) {
          const toolCallId = String(update["toolCallId"] ?? "");
          if (rt.hiddenTools.has(toolCallId)) return;
          if (this.host.hiddenTool(update)) {
            rt.hiddenTools.add(toolCallId);
            for (const draft of rt.translator.closeStreams()) this.emitWorkerItem(appId, w.info.id, draft);
            return;
          }
        }
        for (const draft of rt.translator.translate(update)) {
          this.emitWorkerItem(appId, w.info.id, draft);
          if (draft.kind === "tool" && draft.tool && draft.tool.status !== "failed") this.noteLatest(record, w, rt, draft.tool.title);
          else if (draft.kind === "assistant" && draft.text && !draft.streaming) this.noteLatest(record, w, rt, oneLine(draft.text));
        }
      },
      onPermission: ({ request, responder }) => {
        // Workers run in full access mode; nobody can answer a question mid-task, so anything that
        // still asks is allowed when it can be, and refused otherwise.
        const allow = pickAllowOption(request.options);
        responder.result({ outcome: allow ? { outcome: "selected", optionId: allow } : { outcome: "cancelled" } });
      },
      onExit: (info) => {
        if (rt.session === session) rt.session = undefined;
        if (rt.running) this.host.log(`[${slug}] worker ${w.info.id}: Claude Code exited (code ${info.code ?? "none"})`);
      },
      log: (message) => this.host.log(`[${slug}] worker ${w.info.id}: ${message}`),
    });
    await session.start();
    rt.session = session;
    w.sessionId = session.sessionId;
    this.save(appId);
    return session;
  }

  /** One prompt to the worker; resolves with the ACP stop reason ("error" when it broke). */
  private async turn(record: AppRecord, w: WorkerRecord, rt: WorkerRuntime, text: string, shown: string = text): Promise<string> {
    const appId = record.app.id;
    this.emitWorkerItem(appId, w.info.id, { id: randomUUID(), kind: "user", text: shown });
    let stopReason = "error";
    rt.translator.startTurn();
    try {
      const session = await this.ensureSession(record, w, rt);
      stopReason = await session.prompt(text);
    } catch (error) {
      this.host.log(`[${record.app.slug}] worker ${w.info.id} turn failed:`, (error as Error).message);
      this.emitWorkerItem(appId, w.info.id, { id: randomUUID(), kind: "error", text: `The helper stopped unexpectedly: ${oneLine((error as Error).message, 200)}` });
    } finally {
      for (const draft of rt.translator.finishTurn(stopReason)) this.emitWorkerItem(appId, w.info.id, draft);
    }
    if (rt.translator.lastTurnText.trim() !== "") w.lastText = rt.translator.lastTurnText.trim();
    return stopReason;
  }

  private async run(appId: string, workerId: string): Promise<void> {
    const record = this.host.record(appId);
    if (!record) return;
    const w = this.find(appId, workerId);
    const rt = this.runtime(appId, workerId, this.workDir(record, w));
    if (rt.running) return;
    rt.running = true;
    rt.stopRequested = false;
    let ended: Ended = { state: "done" };
    let keepCopy = false;
    const copyDir = this.workDir(record, w);
    try {
      if (w.info.changesApp && !existsSync(join(copyDir, ".git"))) {
        this.setState(record, w, "working", "Getting its own copy of the app");
        await ensureHelperCopy(record.dir, copyDir, workerId, (m) => this.host.log(`[${record.app.slug}] worker ${workerId}: ${m}`));
      }
      if (w.buildAgain) {
        delete w.buildAgain;
        this.save(appId);
        this.host.log(`[${record.app.slug}] worker ${workerId}: the PC restarted during its build; building again`);
        await saveHelperWork(record.dir, copyDir, w.info.title);
        ended = await this.landAndBuild(record, w, rt, copyDir);
      }
      while (ended.state === "done" && w.inbox.length > 0 && !rt.stopRequested && this.host.record(appId)) {
        const text = w.inbox.splice(0).join("\n\n");
        this.save(appId);
        this.setState(record, w, "working", "Working on it");
        const stop = await this.turn(record, w, rt, text);
        if (rt.stopRequested || stop === "cancelled") {
          ended = { state: "stopped" };
          break;
        }
        if (stop === "error") {
          ended = { state: "failed" };
          break;
        }
        ended = { state: "done" };
        if (!w.info.changesApp) continue;
        const hasWork = await saveHelperWork(record.dir, copyDir, w.info.title);
        if (!hasWork && !w.forceBuild) {
          ended.build = "It changed no files, so there was nothing new to add or build.";
          continue;
        }
        ended = await this.landAndBuild(record, w, rt, copyDir);
        if (ended.state !== "done") break;
      }
    } catch (error) {
      this.host.log(`[${record.app.slug}] worker ${workerId} failed:`, (error as Error).message);
      ended = { state: "failed", build: `It broke: ${oneLine((error as Error).message, 200)}` };
    } finally {
      if (rt.latestTimer) clearTimeout(rt.latestTimer);
      rt.latestTimer = undefined;
      rt.running = false;
      // A finished worker's Claude Code process is closed to save memory; a follow-up resumes it.
      const session = rt.session;
      rt.session = undefined;
      await session?.stop();
    }
    if (this.closing || !this.host.record(appId)) return;
    if (rt.stopRequested && ended.state !== "failed") ended = { ...ended, state: "stopped" };
    if (w.inbox.length > 0 && !rt.stopRequested) {
      void this.run(appId, workerId); // a follow-up arrived while it was finishing
      return;
    }
    // Its work landed (or there was none): the copy and its branch go. A failed or stopped
    // helper keeps its copy, so a follow-up carries on with what it had.
    keepCopy = ended.state !== "done";
    if (w.info.changesApp && !keepCopy) {
      await removeHelperCopy(record.dir, copyDir, workerId).catch((error: unknown) =>
        this.host.log(`[${record.app.slug}] worker ${workerId}: could not remove its copy: ${(error as Error).message}`),
      );
    }
    const latest =
      ended.state === "stopped" ? "Stopped" : ended.state === "failed" ? (oneLine(ended.build ?? "", 120) || "It ran into a problem") : oneLine(w.lastText ?? "", 160) || "Done";
    this.setState(record, w, ended.state, latest);
    if (ended.state === "stopped") this.emitWorkerItem(appId, workerId, { id: randomUUID(), kind: "stopped", text: "Stopped" });
    const verb = ended.state === "done" ? "finished" : ended.state === "stopped" ? "was stopped" : "ran into a problem";
    const report = [
      `Worker ${w.info.id} "${w.info.title}" ${verb}.`,
      `Its last message: ${w.lastText ? w.lastText.slice(0, 3000) : "(none)"}`,
      ...(ended.build ? [`Build: ${ended.build}`] : []),
    ].join("\n");
    w.reportPending = report;
    this.save(appId);
    this.host.report(record, workerId, report);
  }

  /**
   * Lands the helper's work in the app and builds it, one landing at a time per app (the landing
   * slot covers the merge and the build, so the phone gets one build per landing). A conflict
   * goes back to the helper to resolve in its own copy, without holding the slot, and the
   * landing is tried again. A change that never builds is taken out of the app again.
   */
  private async landAndBuild(record: AppRecord, w: WorkerRecord, rt: WorkerRuntime, copyDir: string): Promise<Ended> {
    const appId = record.app.id;
    const id = w.info.id;
    for (let attempt = 1; ; attempt++) {
      if (this.slot(appId).holder) this.setState(record, w, "waiting", "Waiting for another change to land");
      const release = await this.slot(appId).acquire(id);
      let held = true;
      try {
        if (rt.stopRequested) return { state: "stopped" };
        this.setState(record, w, "building", "Adding its change to the app");
        const markers = await leftoverConflictMarkers(copyDir);
        const land: LandResult = markers.length > 0 ? { ok: false, conflict: markers } : await landHelperWork(record.dir, copyDir, id, w.info.title);
        if (!land.ok && "conflict" in land) {
          release();
          held = false;
          this.host.log(`[${record.app.slug}] worker ${id}: its change conflicts with what landed (${land.conflict.join(", ")}), attempt ${attempt}`);
          if (attempt > MAX_CONFLICT_TRIES) {
            return { state: "failed", build: `Its change clashes with another change in ${land.conflict.join(", ")} and could not be combined after ${MAX_CONFLICT_TRIES} tries. It is kept in the helper's copy.` };
          }
          this.setState(record, w, "working", "Fitting its change together with another one");
          const base = await appBranch(record.dir);
          const stop = await this.turn(record, w, rt, conflictPrompt(base, land.conflict, checkCommand(record.app.preset)), "Another change landed first and touches the same files. Combine both.");
          if (rt.stopRequested || stop === "cancelled") return { state: "stopped" };
          if (stop === "error") return { state: "failed" };
          w.conflictsResolved = (w.conflictsResolved ?? 0) + 1;
          this.save(appId);
          continue;
        }
        if (!land.ok) return { state: "failed", build: `Its change could not be added to the app: ${land.error}` };
        this.host.log(`[${record.app.slug}] worker ${id}: landed ${land.before.slice(0, 7)} -> ${land.after.slice(0, 7)}`);
        delete w.forceBuild;
        this.setState(record, w, "building", "Building the new version");
        const outcome = await this.host.buildChange(record, {
          summary: w.info.title,
          notesKey: w.info.id,
          cancelled: () => rt.stopRequested,
          fix: async (prompt) => {
            this.setState(record, w, "working", "Fixing a small problem in the build");
            const fixStop = await this.turn(record, w, rt, prompt, "The build failed. Fix it (the build output follows).");
            if (!(await landFix(record.dir, copyDir, id, w.info.title))) this.host.log(`[${record.app.slug}] worker ${id}: its build fix did not reach the app`);
            if (!rt.stopRequested) this.setState(record, w, "building", "Building the new version");
            return rt.stopRequested ? "cancelled" : fixStop;
          },
        });
        if (outcome.ok) {
          w.info.buildNumber = outcome.number;
          const combined = w.conflictsResolved ? ` It was combined with a change that landed first (${w.conflictsResolved} time${w.conflictsResolved > 1 ? "s" : ""}).` : "";
          delete w.conflictsResolved;
          const how = outcome.delivery === "quick" ? " as a quick update (no install needed: the app shows a Reload button)" : " as a new version to install";
          return { state: "done", build: `Its change was added to the app and the new version (build ${outcome.number}) was built and sent to the person's phone${how}.${combined}` };
        }
        const undone = await undoLanding(record.dir, land.before);
        const back = undone ? " The app was put back as it was before this change; the change is kept in the helper's copy." : "";
        if (outcome.cancelled || rt.stopRequested) return { state: "stopped", build: `It was stopped before its change was built.${back}` };
        return { state: "failed", build: `Its change did not build: ${outcome.error}${back}` };
      } finally {
        if (held) release();
      }
    }
  }

  /** The coordinator received these reports (they were in a prompt it got). */
  reported(appId: string, workerIds: string[]): void {
    for (const id of workerIds) {
      const w = this.workers(appId).records.find((r) => r.info.id === id);
      if (w) delete w.reportPending;
    }
    this.save(appId);
  }

  /** "Try again" on a failed build: a worker that builds the app as it is and fixes what fails. */
  rebuild(appId: string, lastError: string | undefined): WorkerInfo {
    return this.start(appId, {
      title: "Build the app again",
      changesApp: true,
      forceBuild: true,
      brief: `The person tapped Try again because the app did not build${lastError ? ` (${lastError})` : ""}. Look at the app, make sure \`${checkCommand(this.host.record(appId)?.app.preset)}\` passes, and fix anything you find. The PC builds the app when you end your turn; if that build fails, its output comes back to you.`,
    });
  }

  // ---------- startup, shutdown, delete

  /**
   * After a restart nothing runs: close what was streaming, then carry on. A worker that was in a
   * turn gets a "carry on" prompt (same Claude Code session, resumed); a waiting one starts in turn;
   * a report the coordinator never got is handed over again.
   */
  resume(appIds: string[]): Set<string> {
    const building = new Set<string>();
    for (const appId of appIds) {
      const record = this.host.record(appId);
      if (!record) continue;
      const entry = this.workers(appId);
      for (const w of entry.records) {
        const chat = this.chat(appId, w.info.id);
        for (const item of chat.all()) {
          if (item.streaming) chat.upsert({ id: item.id, kind: item.kind, streaming: false });
          if (item.tool && (item.tool.status === "pending" || item.tool.status === "in_progress")) {
            chat.upsert({ id: item.id, kind: "tool", tool: { ...item.tool, status: "failed" } });
          }
        }
        if ((w.info.state === "building" || w.info.state === "waiting") && w.info.changesApp) {
          // Its turn had ended and its change was waiting to land, being added or built: land and
          // build again straight away, without another turn of the agent.
          w.buildAgain = true;
          building.add(appId);
        } else if (w.info.state === "working" || w.info.state === "building") {
          w.inbox.unshift(
            "The PC restarted while you were working, so your last step was cut off. Check where you stopped, carry on with your task, and end with your report.",
          );
          if (w.info.state === "building") w.forceBuild = true;
        }
        if (ACTIVE.has(w.info.state)) {
          this.host.log(`[${record.app.slug}] resuming worker ${w.info.id} "${w.info.title}"`);
          void this.run(appId, w.info.id);
        } else if (w.reportPending) {
          this.host.report(record, w.info.id, w.reportPending);
        }
      }
    }
    return building;
  }

  async forget(appId: string): Promise<void> {
    const stops: Promise<void>[] = [];
    for (const [key, rt] of this.runtimes) {
      if (!key.startsWith(`${appId}/`)) continue;
      rt.stopRequested = true;
      if (rt.session) stops.push(rt.session.stop());
      this.runtimes.delete(key);
    }
    await Promise.all(stops);
    this.flushApp(appId);
  }

  async shutdown(): Promise<void> {
    for (const appId of this.apps.keys()) this.flushApp(appId);
    this.closing = true;
    await Promise.all([...this.runtimes.values()].map((rt) => rt.session?.stop()));
  }
}
