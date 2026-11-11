// An app's history and health (docs/VERSIONS.md): the versions the PC built (with their commits), the
// "What changed" notes the agent writes with describe_change, crash reports from the phone, and reading the
// app's diary from the phone for the agent (read_diary). The two agent tools are an MCP server at
// /mcp/app/<appId>[?worker=<id>], loopback only, with a random Bearer secret per run (like pages.ts).
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import type { ChangeNotes, CrashInfo, CrashReport, DiaryAnswer, DiaryEntry } from "../../shared/protocol.ts";
import { nowIso, readJson, writeJsonAtomic } from "./fs-util.ts";
import * as git from "./git.ts";

export const APP_TOOLS_SERVER = "app";

/** One version as the PC remembers it. */
export interface VersionRecord {
  build: number;
  commit?: string;
  title: string;
  changes?: ChangeNotes;
  createdAt: string;
  restoredFrom?: number;
}

export interface HistoryHost {
  stateDir: string;
  log(...parts: unknown[]): void;
  appExists(appId: string): boolean;
  /** Sends diary.request to the connected phones; false when none is connected. */
  askPhoneForDiary(appId: string, requestId: string): boolean;
  /** The quiet "read the diary" line in the app's main chat. */
  diaryRead(appId: string, info: { ok: boolean; entries: number; problem?: string }): void;
}

const MAX_TEXT = 300;
// The phone first waits for an install of that app that is running (up to 60 s), then asks the app.
const DIARY_WAIT_MS = 80_000;

function clean(text: unknown, max = MAX_TEXT): string | undefined {
  if (typeof text !== "string") return undefined;
  const flat = text.replace(/\s*\u{2014}\s*/gu, ", ").replace(/\s+/g, " ").trim();
  if (!flat) return undefined;
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** ChangeNotes from the agent's tool arguments (or null when "changed" is missing). */
export function notesFrom(args: Record<string, unknown>): ChangeNotes | null {
  const changed = clean(args["changed"]);
  if (!changed) return null;
  const tryIt = clean(args["try_it"] ?? args["tryIt"]);
  const goodToKnow = clean(args["good_to_know"] ?? args["goodToKnow"]);
  return { changed, ...(tryIt ? { tryIt } : {}), ...(goodToKnow ? { goodToKnow } : {}) };
}

/** Diary entries as they come from a phone: well formed, short, oldest first, at most `max`. */
export function cleanDiary(raw: unknown, max = 300): DiaryEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: DiaryEntry[] = [];
  for (const e of raw.slice(-max)) {
    if (!e || typeof e !== "object") continue;
    const text = clean((e as DiaryEntry).text, 200);
    const at = typeof (e as DiaryEntry).at === "string" ? (e as DiaryEntry).at.slice(0, 40) : "";
    if (text) out.push({ at, text });
  }
  return out;
}

/** The diary as the agent reads it: one line per note. */
export function diaryText(entries: readonly DiaryEntry[]): string {
  return entries.map((e) => `${e.at}  ${e.text}`).join("\n");
}

/** The crash report as the agent gets it with "Fix the crash". */
export function crashPrompt(appName: string, report: CrashReport): string {
  const lines = [
    `<crash-report app="${appName.replace(/"/g, "'")}">`,
    `What: ${report.kind === "crash" ? "the app crashed and closed" : "the app caught an error and showed its error screen"}`,
    `When: ${report.at}`,
    ...(report.versionCode ? [`Version on the phone: ${report.versionCode}`] : []),
    ...(report.screen ? [`Screen: ${report.screen}`] : []),
    `Error: ${report.message}`,
    ...(report.stack ? ["Stack:", report.stack] : []),
    ...(report.diary?.length ? ["The app's latest diary notes (oldest first):", diaryText(report.diary)] : []),
    "</crash-report>",
  ];
  return lines.join("\n");
}

const FIX_NOTE =
  "Find the cause from the report above (the stack can be from a minified bundle: match it to the code by the message and the screen), fix it so it cannot happen again, and check your work. Tell the person in one or two plain sentences what went wrong and that it is fixed, without code words.";

export function crashFixPrompt(appName: string, report: CrashReport): string {
  return `${crashPrompt(appName, report)}\n\n${FIX_NOTE}`;
}

function crashKey(kind: string, message: string): string {
  return `${kind}:${message.replace(/\d+/g, "#").slice(0, 200)}`;
}

export class History {
  readonly toolsToken = randomBytes(24).toString("hex");
  private readonly host: HistoryHost;
  /** describe_change notes waiting for the next successful build, per app and per helper ("" = the main chat). */
  private readonly pendingNotes = new Map<string, ChangeNotes>();
  private readonly diaryWaits = new Map<string, { appId: string; resolve(answer: DiaryAnswer | null): void }>();

  constructor(host: HistoryHost) {
    this.host = host;
  }

  // ---------- versions

  private versionsPath(appId: string): string {
    return join(this.host.stateDir, "versions", `${appId}.json`);
  }

  recorded(appId: string): VersionRecord[] {
    return readJson<VersionRecord[]>(this.versionsPath(appId), []);
  }

  record(appId: string, version: VersionRecord): void {
    const list = this.recorded(appId).filter((v) => v.build !== version.build);
    list.push(version);
    list.sort((a, b) => a.build - b.build);
    writeJsonAtomic(this.versionsPath(appId), list);
  }

  /**
   * Every version, oldest first: the recorded ones, plus builds from before this feature read from the
   * app's Git history ("Build N: summary" commits).
   */
  async versions(appId: string, dir: string): Promise<VersionRecord[]> {
    const recorded = this.recorded(appId);
    const known = new Set(recorded.map((v) => v.build));
    const older: VersionRecord[] = [];
    if (existsSync(join(dir, ".git"))) {
      const log = await git.run("git", ["log", "--format=%H%x09%cI%x09%s", "-n", "500"], dir);
      if (log.code === 0) {
        for (const line of log.stdout.split(/\r?\n/)) {
          const [commit, date, subject] = line.split("\t");
          const m = /^Build (\d+): (.+)$/.exec(subject?.trim() ?? "");
          if (!m || known.has(Number(m[1]))) continue;
          known.add(Number(m[1]));
          older.push({ build: Number(m[1]), commit, title: clean(m[2], 120) ?? `Version ${m[1]}`, createdAt: date ?? nowIso() });
        }
      }
    }
    return [...older, ...recorded].sort((a, b) => a.build - b.build);
  }

  // ---------- What changed

  private notesKey(appId: string, workerId?: string): string {
    return `${appId}/${workerId ?? ""}`;
  }

  setNotes(appId: string, notes: ChangeNotes, workerId?: string): void {
    this.pendingNotes.set(this.notesKey(appId, workerId), notes);
  }

  /** The notes for the build that just succeeded (and forgets them). */
  takeNotes(appId: string, workerId?: string): ChangeNotes | undefined {
    const key = this.notesKey(appId, workerId);
    const notes = this.pendingNotes.get(key);
    this.pendingNotes.delete(key);
    return notes;
  }

  // ---------- crashes

  private crashDir(appId: string): string {
    return join(this.host.stateDir, "crashes", appId);
  }

  /** Keeps the whole report; returns the id and the dedupe key of the crash. */
  saveReport(appId: string, report: CrashReport): { id: string; key: string } {
    const id = randomUUID();
    const dir = this.crashDir(appId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${id}.json`), JSON.stringify(report, null, 1));
    return { id, key: crashKey(report.kind, report.message) };
  }

  /** The newest report saved for a crash card (a repeat adds a newer one under the same card). */
  report(appId: string, reportId: string): CrashReport | null {
    if (!/^[0-9a-f-]{36}$/.test(reportId)) return null;
    const path = join(this.crashDir(appId), `${reportId}.json`);
    if (!existsSync(path)) return null;
    try {
      return JSON.parse(readFileSync(path, "utf8")) as CrashReport;
    } catch {
      return null;
    }
  }

  static sameCrash(info: CrashInfo, report: CrashReport, now = Date.now()): boolean {
    return crashKey(info.kind, info.message) === crashKey(report.kind, report.message) && now - Date.parse(info.lastAt) < 24 * 3600_000 && !info.fixAskedAt;
  }

  // ---------- diary

  /** The phone's answer to a diary.request (POST /api/apps/:id/diary). */
  diaryAnswer(appId: string, answer: DiaryAnswer): boolean {
    const wait = this.diaryWaits.get(String(answer?.requestId ?? ""));
    if (!wait || wait.appId !== appId) return false;
    this.diaryWaits.delete(String(answer.requestId));
    wait.resolve(answer);
    return true;
  }

  async readDiary(appId: string): Promise<string> {
    const requestId = randomUUID();
    const answered = new Promise<DiaryAnswer | null>((resolve) => {
      this.diaryWaits.set(requestId, { appId, resolve });
      setTimeout(() => {
        if (this.diaryWaits.delete(requestId)) resolve(null);
      }, DIARY_WAIT_MS).unref?.();
    });
    if (!this.host.askPhoneForDiary(appId, requestId)) {
      this.diaryWaits.delete(requestId);
      const problem = "your phone is not connected to the PC";
      this.host.diaryRead(appId, { ok: false, entries: 0, problem });
      return "The person's phone is not connected to the PC right now, so the diary could not be read. Do not ask them to do anything technical; if you need it, say in one line that you will read it once AnyAppAgent is open on their phone.";
    }
    const answer = await answered;
    if (!answer || answer.problem) {
      const problem =
        answer?.problem === "not_installed"
          ? "the app is not on your phone"
          : answer?.problem === "not_supported"
            ? "this version of the app does not keep a diary yet"
            : "the app on your phone did not answer";
      this.host.diaryRead(appId, { ok: false, entries: 0, problem });
      const hint = answer?.problem === "not_supported" ? " Apps get the diary from the template; the next version you build has it if the app uses src/lib/diary.ts (or Diary.note in Kotlin)." : "";
      return `The diary could not be read: ${problem}.${hint}`;
    }
    const entries = cleanDiary(answer.entries);
    this.host.diaryRead(appId, { ok: true, entries: entries.length });
    if (entries.length === 0) return "The app's diary is empty: the app has not written any notes yet (it writes them with src/lib/diary.ts, or Diary.note in Kotlin).";
    return `The app's diary from the person's phone, oldest first (${entries.length} notes, times in UTC unless they say otherwise):\n${diaryText(entries)}`;
  }

  // ---------- the agent's tools

  mcpServer(port: number, appId: string, workerId?: string): unknown {
    const query = workerId ? `?worker=${encodeURIComponent(workerId)}` : "";
    return {
      type: "http",
      name: APP_TOOLS_SERVER,
      url: `http://127.0.0.1:${port}/mcp/app/${encodeURIComponent(appId)}${query}`,
      headers: [{ name: "Authorization", value: `Bearer ${this.toolsToken}` }],
    };
  }

  private tools(): object[] {
    return [
      {
        name: "describe_change",
        description:
          "Before you end a turn that changed the app, say what changed for the person, in their words, never code words (no file, function or library names). It shows on the new version's card on their phone and PC as \"What changed\". Short, one sentence each. Call it again to replace it.",
        inputSchema: {
          type: "object",
          properties: {
            changed: { type: "string", description: 'What is different now, e.g. "The timer now rings three times instead of once."' },
            try_it: { type: "string", description: 'Optional: what to try, e.g. "Start a 1 minute timer and wait for it."' },
            good_to_know: { type: "string", description: 'Optional: anything to know, e.g. "Your saved timers are kept."' },
          },
          required: ["changed"],
        },
      },
      {
        name: "read_diary",
        description:
          "Reads the app's diary from the person's phone: the notes the app wrote about what it did (alarms set and rung, reminders, errors, crashes), oldest first, newest 300. Use it when something did not work as expected (\"why didn't it ring?\") before you guess. It stays on the phone and this PC: never copy it into the app, a page or GitHub. Takes up to 25 seconds.",
        inputSchema: { type: "object", properties: {} },
      },
    ];
  }

  private async callTool(appId: string, name: string, args: Record<string, unknown>, workerId?: string): Promise<string> {
    if (name === "describe_change") {
      const notes = notesFrom(args);
      if (!notes) throw new Error('Say what changed in "changed".');
      this.setNotes(appId, notes, workerId);
      return "Saved. It shows on the new version's card when the build is ready. Now end your turn as usual.";
    }
    if (name === "read_diary") return this.readDiary(appId);
    throw new Error(`Unknown tool ${name}`);
  }

  async mcpRoute(req: IncomingMessage, res: ServerResponse, path: string, url: URL): Promise<boolean> {
    const m = /^\/mcp\/app\/([^/]+)$/.exec(path);
    if (!m) return false;
    const appId = decodeURIComponent(m[1]);
    const address = req.socket.remoteAddress ?? "";
    const loopback = address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
    if (!loopback || req.headers.authorization !== `Bearer ${this.toolsToken}` || !this.host.appExists(appId)) return send(res, 401, { error: "Not allowed." }), true;
    if (req.method === "DELETE") return res.writeHead(204).end(), true;
    if (req.method !== "POST") return send(res, 405, { error: "This server sends no events." }), true;
    const workerId = url.searchParams.get("worker") ?? undefined;
    let body: Rpc | Rpc[];
    try {
      body = JSON.parse((await readRaw(req, 256 * 1024)).toString("utf8")) as Rpc | Rpc[];
    } catch {
      return send(res, 400, { error: "Bad JSON." }), true;
    }
    const replies = (await Promise.all((Array.isArray(body) ? body : [body]).map((message) => this.answerRpc(appId, message, workerId)))).filter((r): r is object => r !== null);
    if (replies.length === 0) return res.writeHead(202).end(), true;
    send(res, 200, Array.isArray(body) ? replies : replies[0]);
    return true;
  }

  private async answerRpc(appId: string, message: Rpc, workerId?: string): Promise<object | null> {
    const { id, method } = message;
    if (id === undefined || id === null) return null;
    const ok = (result: unknown) => ({ jsonrpc: "2.0", id, result });
    switch (method) {
      case "initialize": {
        const requested = typeof message.params?.["protocolVersion"] === "string" ? message.params["protocolVersion"] : "2025-06-18";
        return ok({ protocolVersion: requested, capabilities: { tools: { listChanged: false } }, serverInfo: { name: `anyappagent-${APP_TOOLS_SERVER}`, version: "1" } });
      }
      case "ping":
        return ok({});
      case "tools/list":
        return ok({ tools: this.tools() });
      case "tools/call": {
        const name = String(message.params?.["name"] ?? "");
        const args = (message.params?.["arguments"] ?? {}) as Record<string, unknown>;
        try {
          return ok({ content: [{ type: "text", text: await this.callTool(appId, name, args, workerId) }] });
        } catch (error) {
          return ok({ content: [{ type: "text", text: (error as Error).message }], isError: true });
        }
      }
      default:
        return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } };
    }
  }
}

type Rpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };

/** An ACP tool call of describe_change (hidden: the version's card stands for it). */
export function isDescribeChangeCall(update: Record<string, unknown>): boolean {
  return JSON.stringify([update["title"], update["name"], update["_meta"]]).includes(`mcp__${APP_TOOLS_SERVER}__describe_change`);
}

/** An ACP tool call of read_diary (hidden: the "Read the app's diary" line stands for it). */
export function isReadDiaryCall(update: Record<string, unknown>): boolean {
  return JSON.stringify([update["title"], update["name"], update["_meta"]]).includes(`mcp__${APP_TOOLS_SERVER}__read_diary`);
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": data.length });
  res.end(data);
}

function readRaw(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("too large"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
