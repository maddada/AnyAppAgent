// Codex app-server over private stdio. Mirrors the lifecycle in Ghostex's vendored
// VS Code codexAppServerClient/codexClientCustomizations: initialize, thread start/resume,
// per-thread MCP config, turn/start, streamed items and turn/completed. No shared daemon.
import spawn from "cross-spawn";
import { spawnSync, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { CODEX_EFFORT, CODEX_MODEL } from "../../../shared/engines.mts";
import type { PlanLimit } from "../../../shared/protocol.ts";
import { agentEnv, type ClaudeSessionOptions, type PromptImage } from "./claude-session.ts";

type Obj = Record<string, any>;
const obj = (value: unknown): Obj => value && typeof value === "object" && !Array.isArray(value) ? value as Obj : {};

/** ACP HTTP/stdio MCP entries become Codex's per-thread configuration. No global config writes. */
export function codexMcpConfig(servers: unknown[] = []): Record<string, unknown> {
  return Object.fromEntries(servers.map((value) => {
    const s = obj(value);
    if (!s.name) throw new Error("MCP server is missing its name");
    if (s.url) return [s.name, { url: s.url, http_headers: Object.fromEntries((s.headers ?? []).map((h: Obj) => [h.name, h.value])) }];
    return [s.name, { command: s.command, args: s.args ?? [], env: Object.fromEntries((s.env ?? []).map((e: Obj) => [e.name, e.value])) }];
  }));
}

export function codexPlanLimits(params: unknown, now = new Date().toISOString()): PlanLimit[] {
  const p = obj(params);
  const rates = obj(p.rateLimits);
  return ["primary", "secondary"].flatMap((key) => {
    const w = obj(rates[key]);
    if (typeof w.usedPercent !== "number" || !Number.isFinite(w.usedPercent)) return [];
    return [{ engine: "codex" as const, kind: `codex_${key}`, status: w.usedPercent >= 100 ? "rejected" as const : w.usedPercent >= 90 ? "allowed_warning" as const : "allowed" as const,
      usedPercent: Math.max(0, Math.min(100, w.usedPercent)), seenAt: now,
      ...(typeof w.resetsAt === "number" && w.resetsAt > 0 ? { resetsAt: new Date(w.resetsAt * 1000).toISOString() } : {}),
    }];
  });
}

export class CodexSession {
  sessionId = "";
  resumed = false;
  modeId = "danger-full-access";
  supportsImageInput = true;
  private child: ChildProcess | undefined;
  private sequence = 0;
  private requests = new Map<number, { resolve(value: Obj): void; reject(error: Error): void; timer: NodeJS.Timeout }>();
  private turn: { resolve(value: string): void; reject(error: Error): void } | undefined;
  private turnId: string | undefined;
  private cancelPending = false;
  private stopping = false;
  private streamed = new Set<string>();
  private lastUsage: Obj | undefined;
  private readonly options: ClaudeSessionOptions;

  constructor(options: ClaudeSessionOptions) { this.options = options; }
  get alive(): boolean { return !!this.child && !this.stopping && this.child.exitCode === null && this.child.signalCode === null; }

  private send(value: unknown): void { this.child?.stdin?.write(`${JSON.stringify(value)}\n`); }
  private request(method: string, params: unknown, timeoutMs = 120_000): Promise<Obj> {
    if (!this.alive) return Promise.reject(new Error("Codex is not running"));
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => { this.requests.delete(id); reject(new Error(`Codex ${method} timed out`)); }, timeoutMs);
      this.requests.set(id, { resolve, reject, timer });
      this.send({ id, method, params });
    });
  }

  async start(): Promise<void> {
    this.stopping = false;
    const child = spawn(this.options.launch.command, this.options.launch.args, {
      cwd: this.options.cwd, env: agentEnv(process.env, this.options.env) as NodeJS.ProcessEnv,
      stdio: ["pipe", "pipe", "pipe"], windowsHide: true, detached: process.platform !== "win32",
    });
    this.child = child;
    child.stdin?.on("error", () => this.fail(new Error("Codex input closed")));
    // stderr may contain paths or authentication diagnostics. Never echo it into user chat/logs.
    child.stderr?.resume();
    const lines = createInterface({ input: child.stdout! });
    lines.on("line", (line) => {
      try { this.receive(JSON.parse(line)); } catch { this.fail(new Error("Codex sent an invalid protocol message")); }
    });
    child.on("error", () => this.fail(new Error("Could not start Codex. Check the installation in Setup.")));
    child.on("exit", (code, signal) => {
      this.fail(new Error("The Codex session exited"));
      this.child = undefined;
      this.options.onExit({ code, signal, stderrTail: "" });
    });
    try {
      await this.request("initialize", { clientInfo: { name: "kiwimake", title: "Kiwimake", version: "0.3.1" }, capabilities: { experimentalApi: true } });
      this.send({ method: "initialized", params: {} });
      const params = {
        cwd: this.options.cwd, model: CODEX_MODEL, modelProvider: "openai", serviceTier: null,
        approvalPolicy: this.options.askPermissions ? "on-request" : "never", sandbox: "danger-full-access",
        developerInstructions: this.options.instructions,
        config: { model_reasoning_effort: CODEX_EFFORT, mcp_servers: codexMcpConfig(this.options.mcpServers) },
      };
      let result: Obj | undefined;
      if (this.options.resumeSessionId) {
        // Never feed a Claude session id to Codex. Selection is engine-scoped in session.ts.
        try {
          result = await this.request("thread/resume", { ...params, threadId: this.options.resumeSessionId });
          this.resumed = true;
        } catch (error) {
          // An unavailable old thread can start fresh. Authentication/model errors must stay visible.
          if (!/not found|does not exist|no rollout|failed to (find|load)/i.test((error as Error).message)) throw error;
          this.options.log("The saved Codex thread is unavailable. Starting a new thread with the app's playbook.");
        }
      }
      result ??= await this.request("thread/start", params);
      this.sessionId = obj(result.thread).id;
      if (!this.sessionId) throw new Error("Codex did not return a thread id");
      if (result.model && result.model !== CODEX_MODEL) throw new Error(`Codex did not accept ${CODEX_MODEL}. Check account access in Setup.`);
      this.options.log(`Codex ${this.resumed ? "resumed" : "started"}: ${CODEX_MODEL}, ${CODEX_EFFORT}`);
    } catch (error) { await this.stop(); throw error; }
  }

  async prompt(text: string, images: PromptImage[] = []): Promise<string> {
    if (this.turn) throw new Error("Codex already has an active turn");
    this.streamed.clear(); this.lastUsage = undefined; this.cancelPending = false;
    const done = new Promise<string>((resolve, reject) => { this.turn = { resolve, reject }; });
    // Attach before turn/start so a fast completion or exit cannot become an unhandled rejection.
    void done.catch(() => {});
    try {
      const response = await this.request("turn/start", {
        threadId: this.sessionId, model: CODEX_MODEL, effort: CODEX_EFFORT,
        approvalPolicy: this.options.askPermissions ? "on-request" : "never",
        sandboxPolicy: { type: "dangerFullAccess" },
        input: [{ type: "text", text, text_elements: [] }, ...images.map((i) => ({ type: "localImage", path: i.path }))],
      });
      if (this.turn) this.turnId = obj(response.turn).id;
      if (this.cancelPending) this.cancel();
    } catch (error) { this.fail(error as Error); }
    return done;
  }

  cancel(): void {
    this.cancelPending = true;
    if (this.turnId) void this.request("turn/interrupt", { threadId: this.sessionId, turnId: this.turnId }, 10_000).catch(() => this.stop());
  }

  async stop(): Promise<void> {
    this.stopping = true;
    this.fail(new Error("Codex session stopped"));
    const child = this.child;
    if (!child?.pid || child.exitCode !== null) return;
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    else { try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill(); } }
    await Promise.race([exited, new Promise<void>((resolve) => { const t = setTimeout(resolve, 3000); t.unref(); })]);
  }

  private fail(error: Error): void {
    for (const p of this.requests.values()) { clearTimeout(p.timer); p.reject(error); }
    this.requests.clear(); this.turn?.reject(error); this.turn = undefined; this.turnId = undefined;
  }

  private receive(message: Obj): void {
    if (message.id !== undefined && !message.method) {
      const pending = this.requests.get(message.id);
      if (!pending) return;
      this.requests.delete(message.id); clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(String(obj(message.error).message ?? "Codex request failed")));
      else pending.resolve(obj(message.result));
      return;
    }
    if (message.id !== undefined) { this.permission(message); return; }
    const p = obj(message.params);
    if (p.threadId && this.sessionId && p.threadId !== this.sessionId) return;
    if (message.method === "account/rateLimits/updated") { for (const limit of codexPlanLimits(p)) this.options.onPlanLimit?.(limit); return; }
    if (!this.turn) return; // Resume notifications are history, not a new chat turn.
    switch (message.method) {
      case "turn/started": this.turnId = obj(p.turn).id; if (this.cancelPending) this.cancel(); break;
      case "item/agentMessage/delta":
      case "item/reasoning/summaryTextDelta":
      case "item/reasoning/textDelta": {
        this.streamed.add(p.itemId);
        this.options.onUpdate({ sessionUpdate: message.method === "item/agentMessage/delta" ? "agent_message_chunk" : "agent_thought_chunk", content: { type: "text", text: p.delta ?? "" } });
        break;
      }
      case "item/started": case "item/completed": this.item(obj(p.item), message.method === "item/completed"); break;
      case "thread/tokenUsage/updated": this.lastUsage = obj(obj(p.tokenUsage).last); break;
      case "turn/plan/updated": this.options.onUpdate({ sessionUpdate: "plan", entries: (p.plan ?? []).map((v: Obj) => ({ content: v.step, status: v.status === "inProgress" ? "in_progress" : v.status, priority: "medium" })) }); break;
      case "turn/completed": {
        const turn = obj(p.turn);
        const pending = this.turn; this.turn = undefined; this.turnId = undefined;
        if (this.lastUsage) {
          const u = this.lastUsage;
          this.options.onUsage?.({ inputTokens: Math.max(0, (u.inputTokens ?? 0) - (u.cachedInputTokens ?? 0)), outputTokens: u.outputTokens ?? 0, cacheReadTokens: u.cachedInputTokens ?? 0, cacheWriteTokens: 0 });
        }
        if (turn.status === "failed") pending?.reject(new Error(String(obj(turn.error).message ?? "Codex turn failed")));
        else pending?.resolve(turn.status === "interrupted" ? "cancelled" : "end_turn");
        break;
      }
    }
  }

  private item(item: Obj, done: boolean): void {
    if (item.type === "agentMessage" || item.type === "reasoning") {
      if (done && !this.streamed.has(item.id)) {
        const text = item.text ?? (item.summary ?? []).join("\n");
        if (text) this.options.onUpdate({ sessionUpdate: item.type === "agentMessage" ? "agent_message_chunk" : "agent_thought_chunk", content: { type: "text", text } });
      }
      return;
    }
    if (!["commandExecution", "fileChange", "mcpToolCall", "webSearch", "dynamicToolCall"].includes(item.type)) return;
    const name = item.type === "mcpToolCall" ? `mcp__${item.server}__${item.tool}` : item.type;
    this.options.onUpdate({ sessionUpdate: done ? "tool_call_update" : "tool_call", toolCallId: item.id, name,
      title: item.type === "commandExecution" ? "Running a command" : name,
      kind: item.type === "commandExecution" ? "execute" : item.type === "fileChange" ? "edit" : "other",
      status: done ? item.status === "failed" || item.status === "declined" ? "failed" : "completed" : "in_progress",
      rawInput: item.arguments ?? (item.command ? { command: item.command } : {}),
      ...(done ? { rawOutput: item.aggregatedOutput ?? item.result ?? item.error } : {}),
    });
  }

  private permission(message: Obj): void {
    const p = obj(message.params);
    const approval = /\/requestApproval$/.test(message.method);
    if (!approval) { this.send({ id: message.id, error: { code: -32601, message: "Unsupported request. Ask the person in chat instead." } }); return; }
    const answer = (decision: string) => this.send({ id: message.id, result: { decision } });
    // Respect requests the engine actually makes, even if approvalPolicy was never.
    this.options.onPermission({ request: { sessionId: this.sessionId, toolCall: { title: p.command ?? p.reason ?? "Codex asks for permission" }, options: [
      { optionId: "accept", name: "Allow once", kind: "allow_once" }, { optionId: "decline", name: "Decline", kind: "reject_once" },
    ] }, responder: {
      result: (value) => { const outcome = obj(obj(value).outcome); answer(outcome.outcome === "selected" && outcome.optionId === "accept" ? "accept" : "decline"); },
      error: () => answer("decline"),
    } });
  }
}
