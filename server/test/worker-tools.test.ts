import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isWorkerToolCall, workerToolsMcpServer, workerToolsRoute } from "../src/worker-http.ts";
import type { WorkerManager } from "../src/workers.ts";

const started: { title: string; brief: string; changesApp: boolean }[] = [];
const fakeWorkers = {
  toolsToken: "secret",
  start: (_appId: string, args: { title: string; brief: string; changesApp: boolean }) => {
    started.push(args);
    return { id: `w${started.length}`, appId: "app1", title: args.title, state: "working", changesApp: args.changesApp, createdAt: "", updatedAt: "" };
  },
  list: () => [],
} as unknown as WorkerManager;

let server: Server;
let base: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://x").pathname;
    void workerToolsRoute(req, res, path, { workers: fakeWorkers, appExists: (id) => id === "app1", log: () => {} }).then((handled) => {
      if (!handled) res.writeHead(404).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());

async function rpc(body: unknown, token = "secret", app = "app1") {
  const res = await fetch(`${base}/mcp/workers/${app}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify(body),
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { status: res.status, body: (res.status === 200 ? await res.json() : null) as any };
}

describe("coordinator worker tools (MCP over HTTP)", () => {
  it("refuses a wrong token or an unknown app", async () => {
    expect((await rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }, "nope")).status).toBe(401);
    expect((await rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }, "secret", "other")).status).toBe(401);
  });

  it("does the MCP handshake and lists the five tools", async () => {
    const init = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {} } });
    expect(init.body.result.protocolVersion).toBe("2025-06-18");
    expect(init.body.result.capabilities.tools).toBeDefined();
    expect((await rpc({ jsonrpc: "2.0", method: "notifications/initialized" })).status).toBe(202);
    const list = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    expect(list.body.result.tools.map((t: { name: string }) => t.name)).toEqual(["start_worker", "message_worker", "stop_worker", "list_workers", "read_worker"]);
  });

  it("starts workers in their own copies, look-only ones without, and reports bad arguments as tool errors", async () => {
    const first = await rpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "start_worker", arguments: { title: "First change", brief: "Do it" } } });
    expect(first.body.result.content[0].text).toMatch(/Worker w1 "First change" started/);
    const second = await rpc({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "start_worker", arguments: { title: "Second", brief: "Then this" } } });
    expect(second.body.result.content[0].text).toMatch(/own copy/);
    const look = await rpc({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "start_worker", arguments: { title: "Look", brief: "Why", changes_app: false } } });
    expect(look.body.result.content[0].text).toMatch(/looks only/);
    expect(started.map((s) => s.changesApp)).toEqual([true, true, false]);
    const bad = await rpc({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "start_worker", arguments: { title: "" } } });
    expect(bad.body.result.isError).toBe(true);
  });

  it("recognises the coordinator's own tool calls in ACP updates", () => {
    expect(isWorkerToolCall({ toolCallId: "1", title: "mcp__workers__start_worker", rawInput: { title: "x" } })).toBe(true);
    expect(isWorkerToolCall({ toolCallId: "1", title: "start_worker" })).toBe(true);
    expect(isWorkerToolCall({ toolCallId: "1", title: "ToolSearch" })).toBe(true);
    expect(isWorkerToolCall({ toolCallId: "1", title: "Edit App.tsx", kind: "edit" })).toBe(false);
  });

  it("describes itself to ACP as an http MCP server with the secret header", () => {
    expect(workerToolsMcpServer(8798, "app1", "secret")).toEqual({
      type: "http",
      name: "workers",
      url: "http://127.0.0.1:8798/mcp/workers/app1",
      headers: [{ name: "Authorization", value: "Bearer secret" }],
    });
  });
});
