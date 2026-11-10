// Mirrors bb's packages/provider-bridge-acp/src/bridge/agent-connection.ts (MIT, see
// THIRD_PARTY_NOTICES.md): spawn the ACP agent, wire its stdio to the ACP client, keep a
// stderr tail, answer inbound client requests, and send `initialize`.
import { RequestError } from "@agentclientprotocol/sdk";
import spawn from "cross-spawn";
import { spawnSync, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { connectAcpClient, type AcpClient } from "./acp-client.ts";

const STDERR_TAIL_MAX_CHUNKS = 40;
export const ACP_CLIENT_PROTOCOL_VERSION = 1;
export const ACP_INITIALIZE_TIMEOUT_MS = 60_000;

export const ACP_CORE_CLIENT_REQUEST_METHODS = [
  "session/request_permission",
  "fs/read_text_file",
  "fs/write_text_file",
] as const;

export interface AcpAgentRequestResponder {
  result(value: unknown): void;
  error(code: number, message: string): void;
}

export interface AcpAgentExitInfo {
  code: number | null;
  signal: NodeJS.Signals | null;
  stderrTail: string;
}

export interface AcpAgentConnection {
  request(method: string, params: unknown, timeoutMs?: number | null): Promise<unknown>;
  notify(method: string, params: unknown): void;
  kill(): Promise<void>;
  readonly exited: boolean;
  readonly pid: number | undefined;
}

export class AcpAgentExitedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AcpAgentExitedError";
  }
}

export class AcpAgentResponseError extends Error {
  readonly code: number | undefined;
  readonly data: unknown;
  constructor(message: string, code: number | undefined, data?: unknown) {
    super(message);
    this.name = "AcpAgentResponseError";
    this.code = code;
    this.data = data;
  }
}

export function formatAgentError(error: { code?: number; message?: string; data?: unknown }): string {
  const message = error.message ?? `ACP agent returned error code ${error.code ?? "unknown"}`;
  const data = error.data;
  if (data === undefined || data === null) return message;
  if (typeof data === "string") return data.trim() === "" ? message : `${message}: ${data}`;
  if (typeof data === "object" && "details" in data && typeof data.details === "string") {
    return `${message}: ${data.details}`;
  }
  try {
    return `${message}: ${JSON.stringify(data)}`;
  } catch {
    return message;
  }
}

function killTree(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
  } else {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
  }
}

export function createAcpAgentConnection(options: {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string | undefined>;
  onNotification(method: string, params: unknown): void;
  onSessionUpdate(sessionId: string, update: unknown): void;
  onRequest(method: string, params: unknown, responder: AcpAgentRequestResponder): void;
  onExit(info: AcpAgentExitInfo): void;
}): AcpAgentConnection {
  const child = spawn(options.command, options.args, {
    cwd: options.cwd,
    env: options.env as NodeJS.ProcessEnv,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    detached: process.platform !== "win32",
  });

  const stderrChunks: string[] = [];
  let acp: AcpClient | undefined;
  let exited = false;
  let stopping = false;

  function notRunningError(): AcpAgentExitedError {
    return new AcpAgentExitedError(`ACP agent "${options.command}" is not running`);
  }

  child.stdin?.on("error", () => {
    if (stopping || exited) return;
    exited = true;
    acp?.close(new AcpAgentExitedError(`ACP agent "${options.command}" stdin closed`));
    options.onExit({ code: null, signal: null, stderrTail: stderrChunks.join("\n") });
  });

  if (child.stdout && child.stdin) {
    const requests: Record<string, (params: unknown) => Promise<unknown>> = {};
    for (const method of ACP_CORE_CLIENT_REQUEST_METHODS) {
      requests[method] = (params) =>
        new Promise((resolveResult, rejectResult) => {
          if (stopping) return;
          let settled = false;
          options.onRequest(method, params, {
            result(value) {
              if (settled) return;
              settled = true;
              resolveResult(value ?? null);
            },
            error(code, errorMessage) {
              if (settled) return;
              settled = true;
              rejectResult(new RequestError(code, errorMessage));
            },
          });
        });
    }
    acp = connectAcpClient({
      input: child.stdout,
      output: child.stdin,
      handlers: {
        sessionUpdate: ({ sessionId, update }) => {
          if (!stopping) options.onSessionUpdate(sessionId, update);
        },
        anyNotification: (method, params) => {
          if (!stopping && method !== "session/update") options.onNotification(method, params);
        },
        requests,
      },
    });
  }

  if (child.stderr) {
    const stderrLines = createInterface({ input: child.stderr, terminal: false });
    stderrLines.on("line", (line) => {
      stderrChunks.push(line);
      if (stderrChunks.length > STDERR_TAIL_MAX_CHUNKS) stderrChunks.shift();
    });
  }

  child.on("error", (error) => {
    if (exited) return;
    exited = true;
    acp?.close(new AcpAgentExitedError(`Failed to launch ACP agent "${options.command}": ${error.message}`));
    options.onExit({ code: null, signal: null, stderrTail: error.message });
  });

  child.on("exit", (code, signal) => {
    if (exited) return;
    exited = true;
    const stderrTail = stderrChunks.join("\n");
    acp?.close(
      new AcpAgentExitedError(
        `ACP agent "${options.command}" exited (code ${code ?? "null"}, signal ${signal ?? "null"})${stderrTail ? `: ${stderrTail}` : ""}`,
      ),
    );
    options.onExit({ code, signal, stderrTail });
  });

  return {
    get exited() {
      return stopping || exited;
    },
    get pid() {
      return child.pid;
    },
    request(method, params, timeoutMs) {
      if (stopping || exited || !acp) return Promise.reject(notRunningError());
      return acp.request(method, params, { timeoutMs: timeoutMs ?? null }).catch((error: unknown) => {
        if (error instanceof RequestError) {
          throw new AcpAgentResponseError(formatAgentError(error), error.code, error.data);
        }
        throw error;
      });
    },
    notify(method, params) {
      if (stopping || exited || !acp) return;
      void acp.notify(method, params).catch(() => {});
    },
    async kill() {
      if (stopping) return;
      stopping = true;
      acp?.close(notRunningError());
      killTree(child);
    },
  };
}

// bb's acpClientCapabilities + requestAcpInitialize, with fs access on as bb's bridge sets it.
export async function requestAcpInitialize(connection: AcpAgentConnection): Promise<unknown> {
  return connection.request(
    "initialize",
    {
      protocolVersion: ACP_CLIENT_PROTOCOL_VERSION,
      clientInfo: { name: "anyappagent", version: "0.1.0" },
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },
        terminal: false,
        auth: { terminal: true },
      },
    },
    ACP_INITIALIZE_TIMEOUT_MS,
  );
}
