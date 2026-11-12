// The HTTP side of workers:
// 1. The coordinator's worker tools, an MCP server (Streamable HTTP, JSON responses only) at
//    /mcp/workers/<appId>. Claude Code reaches it on loopback with the run's secret as a Bearer
//    token; the companion hands it to the coordinator's ACP session in session/new and
//    session/resume (bb hands its sessions a stdio MCP relay to a loopback bridge; the Claude ACP
//    adapter takes an HTTP MCP server directly, so no relay process is needed).
// 2. The worker routes of shared/protocol.ts (/api/apps/:id/workers...).
import type { IncomingMessage, ServerResponse } from "node:http";
import type { WorkerInfo } from "../../shared/protocol.ts";
import { WORKER_TOOLS_SERVER } from "./coordinator-playbook.ts";
import type { WorkerManager } from "./workers.ts";

const MAX_BODY = 1024 * 1024;

export function workerToolsMcpServer(port: number, appId: string, token: string): unknown {
  return {
    type: "http",
    name: WORKER_TOOLS_SERVER,
    url: `http://127.0.0.1:${port}/mcp/workers/${encodeURIComponent(appId)}`,
    headers: [{ name: "Authorization", value: `Bearer ${token}` }],
  };
}

const TOOL_NAMES = ["start_worker", "message_worker", "stop_worker", "list_workers", "read_worker"];

/**
 * True for an ACP tool call of the coordinator's own worker tools (its worker rows stand for them),
 * and for Claude Code's ToolSearch, which only fetches those tools: plumbing the person never sees.
 */
export function isWorkerToolCall(update: Record<string, unknown>): boolean {
  if (/^ToolSearch\b/.test(String(update["title"] ?? ""))) return true;
  const text = JSON.stringify([update["title"], update["name"], update["_meta"], update["rawInput"] === undefined ? null : Object.keys(update["rawInput"] as object)]);
  return text.includes(`mcp__${WORKER_TOOLS_SERVER}__`) || TOOL_NAMES.some((name) => new RegExp(`\\b${name}\\b`).test(String(update["title"] ?? "")));
}

const WORKER_ID = { type: "string", description: "The worker's id, as start_worker or list_workers gave it." };
const TOOLS = [
  {
    name: "start_worker",
    description:
      "Start a worker (the person calls it a helper): another agent that does one piece of real work on this app (a change, a fix, a new feature, looking into a problem) while you stay free to talk. Workers that change the app work in parallel, each in its own copy; their changes are added to the app one at a time, each followed by a build. It starts with none of your conversation, so the brief must stand on its own. Returns at once; its report arrives later as a message starting with [Worker report].",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Its task in 3 to 6 plain words, shown to the person, e.g. \"Make the button green\"." },
        brief: { type: "string", description: "Everything it needs: what the person wants (their words when they matter), what you know, what done looks like." },
        changes_app: { type: "boolean", description: "false when it should only look into something and change no files. Default true." },
        level: {
          type: "string",
          enum: ["deep", "focused", "simple"],
          description:
            "How hard the work is (it picks the worker's model): deep for complex work across several areas (a new feature touching screens, storage and alarms; a new app), focused for complex work in a few files (a tricky calculation, one screen's logic), simple for simple work in one area (styling, text, colours, an icon). Default focused.",
        },
      },
      required: ["title", "brief"],
    },
  },
  {
    name: "message_worker",
    description: "Send a follow-up to a worker (a correction, more detail, a next step). A busy worker gets it after its current step; a finished one starts again with everything it knew.",
    inputSchema: { type: "object", properties: { worker_id: WORKER_ID, message: { type: "string" } }, required: ["worker_id", "message"] },
  },
  {
    name: "stop_worker",
    description: "Stop a worker now (the person changed their mind, or it is going the wrong way).",
    inputSchema: { type: "object", properties: { worker_id: WORKER_ID }, required: ["worker_id"] },
  },
  {
    name: "list_workers",
    description: "Every worker of this app with its id, task, state (waiting, working, building, done, failed, stopped) and latest line.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "read_worker",
    description: "One worker's recent messages and steps, to answer questions about its progress.",
    inputSchema: { type: "object", properties: { worker_id: WORKER_ID }, required: ["worker_id"] },
  },
];

function describe(w: WorkerInfo): string {
  return `${w.id} "${w.title}": ${w.state}${w.changesApp ? "" : " (looks only)"}${w.latest ? `, latest: ${w.latest}` : ""}${w.buildNumber ? `, build ${w.buildNumber}` : ""}`;
}

function arg(args: Record<string, unknown>, name: string): string {
  const value = args[name];
  if (typeof value !== "string" || value.trim() === "") throw new Error(`"${name}" is required.`);
  return value;
}

function callTool(workers: WorkerManager, appId: string, name: string, args: Record<string, unknown>): string {
  switch (name) {
    case "start_worker": {
      const changesApp = args["changes_app"] !== false;
      const level = args["level"] === "deep" || args["level"] === "simple" || args["level"] === "focused" ? args["level"] : undefined;
      const w = workers.start(appId, { title: arg(args, "title"), brief: arg(args, "brief"), changesApp, ...(level ? { level } : {}) });
      return changesApp
        ? `Worker ${w.id} "${w.title}" started in its own copy of the app. Its change is added to the app when it is done (one change at a time, then a build), and its report arrives as a message.`
        : `Worker ${w.id} "${w.title}" started (looks only). Its report arrives as a message when it is done.`;
    }
    case "message_worker": {
      const when = workers.send(appId, arg(args, "worker_id"), arg(args, "message"));
      return when === "now" ? "Sent. The worker is working on it now." : "Sent. The worker reads it as soon as its current step ends.";
    }
    case "stop_worker":
      return `Stopping: ${describe(workers.stop(appId, arg(args, "worker_id")))}`;
    case "list_workers": {
      const list = workers.list(appId);
      return list.length === 0 ? "There are no workers yet." : list.map(describe).join("\n");
    }
    case "read_worker":
      return workers.readout(appId, arg(args, "worker_id"));
    default:
      throw new Error(`Unknown tool ${name}`);
  }
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw Object.assign(new Error("The request is too large."), { status: 413 });
    chunks.push(chunk as Buffer);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("The request body is not valid JSON."), { status: 400 });
  }
}

function json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": data.length, ...headers });
  res.end(data);
}

function isLoopback(req: IncomingMessage): boolean {
  const address = req.socket.remoteAddress ?? "";
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

type JsonRpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };

function answer(workers: WorkerManager, appId: string, message: JsonRpc, log: (...parts: unknown[]) => void): object | null {
  const { id, method } = message;
  if (id === undefined || id === null) return null; // a notification: nothing to answer
  const ok = (result: unknown) => ({ jsonrpc: "2.0", id, result });
  switch (method) {
    case "initialize": {
      const requested = typeof message.params?.["protocolVersion"] === "string" ? message.params["protocolVersion"] : "2025-06-18";
      return ok({ protocolVersion: requested, capabilities: { tools: { listChanged: false } }, serverInfo: { name: `anyappagent-${WORKER_TOOLS_SERVER}`, version: "1" } });
    }
    case "ping":
      return ok({});
    case "tools/list":
      return ok({ tools: TOOLS });
    case "tools/call": {
      const name = String(message.params?.["name"] ?? "");
      const args = (message.params?.["arguments"] ?? {}) as Record<string, unknown>;
      try {
        const text = callTool(workers, appId, name, args);
        log(`coordinator tool ${name}: ${text.split("\n")[0]}`);
        return ok({ content: [{ type: "text", text }] });
      } catch (error) {
        return ok({ content: [{ type: "text", text: (error as Error).message }], isError: true });
      }
    }
    default:
      return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } };
  }
}

/** Handles /mcp/workers/<appId>. Returns false when the path is not ours. */
export async function workerToolsRoute(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  deps: { workers: WorkerManager | undefined; appExists(appId: string): boolean; log(...parts: unknown[]): void },
): Promise<boolean> {
  const match = /^\/mcp\/workers\/([^/]+)$/.exec(path);
  if (!match) return false;
  const appId = decodeURIComponent(match[1]);
  const header = req.headers.authorization ?? "";
  if (!deps.workers || !isLoopback(req) || header !== `Bearer ${deps.workers.toolsToken}` || !deps.appExists(appId)) {
    json(res, 401, { error: "Not allowed." });
    return true;
  }
  if (req.method === "GET") {
    json(res, 405, { error: "This server sends no events." }, { Allow: "POST" });
    return true;
  }
  if (req.method === "DELETE") {
    res.writeHead(204).end();
    return true;
  }
  if (req.method !== "POST") {
    json(res, 405, { error: "Method not allowed." });
    return true;
  }
  const body = (await readJsonBody(req)) as JsonRpc | JsonRpc[];
  const messages = Array.isArray(body) ? body : [body];
  const replies = messages.map((m) => answer(deps.workers!, appId, m, deps.log)).filter((r): r is object => r !== null);
  if (replies.length === 0) {
    res.writeHead(202).end();
    return true;
  }
  json(res, 200, Array.isArray(body) ? replies : replies[0]);
  return true;
}

/** Handles /api/apps/:id/workers[/:workerId[/messages|/cancel]] (after the token check). False when not ours.
 * A worker's own chat is read only: it is told things through the main chat (message_worker). */
export async function workerApiRoute(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  url: URL,
  deps: { workers: WorkerManager | undefined; checkApp(appId: string): void },
): Promise<boolean> {
  const match = /^\/api\/apps\/([^/]+)\/workers(?:\/([^/]+)(?:\/(messages|cancel))?)?$/.exec(path);
  if (!match) return false;
  const appId = decodeURIComponent(match[1]);
  const workerId = match[2] ? decodeURIComponent(match[2]) : undefined;
  const action = match[3];
  const method = req.method ?? "GET";
  try {
    deps.checkApp(appId);
    const workers = deps.workers;
    if (!workers) {
      if (method === "GET" && !workerId) json(res, 200, []);
      else json(res, 404, { error: "This PC runs apps without workers." });
      return true;
    }
    if (!workerId && method === "GET") json(res, 200, workers.list(appId));
    else if (workerId && action === "messages" && method === "GET") {
      const afterSeq = Number(url.searchParams.get("afterSeq") ?? 0);
      json(res, 200, workers.messages(appId, workerId, Number.isFinite(afterSeq) ? afterSeq : 0));
    } else if (workerId && action === "cancel" && method === "POST") {
      workers.stop(appId, workerId);
      json(res, 202, {});
    } else json(res, 404, { error: "Not found." });
  } catch (error) {
    const status = typeof (error as { status?: unknown }).status === "number" ? (error as { status: number }).status : 500;
    json(res, status, { error: status === 500 ? "Something went wrong on the PC." : (error as Error).message });
  }
  return true;
}
