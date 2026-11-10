// Mirrors bb's packages/provider-bridge-acp/src/client/acp-client.ts and
// client/message-stream.ts (MIT, see THIRD_PARTY_NOTICES.md): a JSON-RPC line
// stream over the agent's stdio, handed to @agentclientprotocol/sdk's client app.
import { client, RequestError, type AnyMessage, type ClientConnection, type Stream } from "@agentclientprotocol/sdk";
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";

export const ACP_AUTH_REQUIRED_CODE = -32000;
export const ACP_RESOURCE_NOT_FOUND_CODE = -32002;

export type JsonObject = Record<string, unknown>;

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readString(source: JsonObject, key: string): string | undefined {
  const value = source[key];
  return typeof value === "string" ? value : undefined;
}

export interface AcpSessionUpdateNotification {
  sessionId: string;
  update: unknown;
}

export interface AcpPermissionOption {
  optionId: string;
  name: string;
  kind: string;
}

export interface AcpPermissionRequest {
  sessionId: string;
  toolCall: JsonObject;
  options: AcpPermissionOption[];
  title?: string;
}

export type AcpInboundRequestHandler = (params: unknown, context: { signal: AbortSignal }) => unknown;

export interface AcpClientHandlers {
  sessionUpdate(notification: AcpSessionUpdateNotification): void;
  requests?: Readonly<Record<string, AcpInboundRequestHandler>>;
  anyNotification?(method: string, params: unknown): void;
  discarded?(reason: string, line: string): void;
}

export interface AcpClient {
  request(method: string, params: unknown, options?: { timeoutMs?: number | null }): Promise<unknown>;
  notify(method: string, params: unknown): Promise<void>;
  close(reason?: Error): void;
  readonly closed: Promise<void>;
}

export class AcpRequestTimeoutError extends Error {
  constructor(method: string, timeoutMs: number) {
    super(`ACP agent did not answer ${method} within ${timeoutMs} ms`);
    this.name = "AcpRequestTimeoutError";
  }
}

export function decodeAcpPermissionRequest(params: unknown): AcpPermissionRequest {
  if (!isJsonObject(params)) {
    throw RequestError.invalidParams();
  }
  const sessionId = readString(params, "sessionId");
  const rawOptions = params["options"];
  if (sessionId === undefined || !Array.isArray(rawOptions)) {
    throw RequestError.invalidParams();
  }
  const options: AcpPermissionOption[] = [];
  for (const entry of rawOptions) {
    if (!isJsonObject(entry)) continue;
    const optionId = readString(entry, "optionId");
    if (optionId === undefined) continue;
    options.push({
      optionId,
      name: readString(entry, "name") ?? optionId,
      kind: readString(entry, "kind") ?? "",
    });
  }
  const toolCall = isJsonObject(params["toolCall"]) ? params["toolCall"] : {};
  const title = readString(params, "title");
  return { sessionId, toolCall, options, ...(title !== undefined ? { title } : {}) };
}

const SESSION_UPDATE_METHOD = "session/update";
type JsonRpcId = string | number;

function createAcpMessageStream(options: {
  input: Readable;
  output: Writable;
  onSessionUpdate(params: unknown): void;
  onNotification?(method: string, params: unknown): void;
  onDiscard(reason: string, line: string): void;
}): Stream {
  const outstandingRequestIds = new Set<JsonRpcId>();
  let closed = false;
  let detach = () => {};

  function issuedRequestId(id: JsonRpcId): JsonRpcId | undefined {
    if (outstandingRequestIds.has(id)) return id;
    if (typeof id === "string" && id.trim() !== "") {
      const numericId = Number(id);
      if (outstandingRequestIds.has(numericId)) return numericId;
    }
    return undefined;
  }

  const readable = new ReadableStream<AnyMessage>({
    start(controller) {
      const lines = createInterface({ input: options.input, terminal: false });
      detach = () => lines.close();
      lines.on("line", (line) => {
        if (closed || line.trim() === "") return;
        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch {
          options.onDiscard("not-json", line);
          return;
        }
        if (!isJsonObject(parsed)) {
          options.onDiscard("not-a-message", line);
          return;
        }
        const method = parsed["method"];
        const rawId = parsed["id"];
        const id = typeof rawId === "string" || typeof rawId === "number" ? rawId : undefined;
        if (typeof method !== "string") {
          const issuedId = id === undefined ? undefined : issuedRequestId(id);
          if (issuedId === undefined) {
            options.onDiscard("unexpected-response", line);
            return;
          }
          outstandingRequestIds.delete(issuedId);
          parsed["id"] = issuedId;
        } else if (id === undefined) {
          options.onNotification?.(method, parsed["params"]);
          if (method === SESSION_UPDATE_METHOD) {
            options.onSessionUpdate(parsed["params"]);
            return;
          }
        }
        controller.enqueue(parsed as AnyMessage);
      });
    },
    cancel() {
      closed = true;
      detach();
    },
  });

  const writable = new WritableStream<AnyMessage>({
    write(message) {
      if (options.output.destroyed || !options.output.writable) {
        throw new Error("ACP agent stdin is not writable");
      }
      if ("method" in message && "id" in message) {
        const id = message.id;
        if (typeof id === "string" || typeof id === "number") outstandingRequestIds.add(id);
      }
      options.output.write(`${JSON.stringify(message)}\n`);
    },
  });

  return { readable, writable };
}

export function connectAcpClient(options: {
  input: Readable;
  output: Writable;
  handlers: AcpClientHandlers;
}): AcpClient {
  const { handlers } = options;
  const discarded = handlers.discarded ?? (() => {});
  const stream = createAcpMessageStream({
    input: options.input,
    output: options.output,
    onDiscard: discarded,
    ...(handlers.anyNotification ? { onNotification: handlers.anyNotification } : {}),
    onSessionUpdate(params) {
      if (!isJsonObject(params)) {
        discarded("malformed-update", JSON.stringify(params ?? null));
        return;
      }
      const sessionId = readString(params, "sessionId");
      if (sessionId === undefined) {
        discarded("malformed-update", JSON.stringify(params));
        return;
      }
      handlers.sessionUpdate({ sessionId, update: params["update"] });
    },
  });

  const app = client({ name: "anyappagent" });
  for (const [method, handler] of Object.entries(handlers.requests ?? {})) {
    app.onRequest(
      method,
      (params: unknown) => params,
      async ({ params, signal }: { params: unknown; signal: AbortSignal }) => (await handler(params, { signal })) ?? null,
    );
  }
  const connection: ClientConnection = app.connect(stream);

  async function withDeadline<Result>(
    method: string,
    timeoutMs: number | null | undefined,
    send: (signal: AbortSignal | undefined) => Promise<Result>,
  ): Promise<Result> {
    if (timeoutMs === null || timeoutMs === undefined) return send(undefined);
    const controller = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new AcpRequestTimeoutError(method, timeoutMs));
      }, timeoutMs);
    });
    try {
      return await Promise.race([send(controller.signal), deadline]);
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    request(method, params, requestOptions) {
      return withDeadline(method, requestOptions?.timeoutMs, (cancellationSignal) =>
        connection.agent.request<unknown, unknown>(
          method,
          params,
          cancellationSignal ? { cancellationSignal } : undefined,
        ),
      );
    },
    notify(method, params) {
      return connection.agent.notify(method, params);
    },
    close(reason) {
      connection.close(reason);
    },
    closed: connection.closed,
  };
}
