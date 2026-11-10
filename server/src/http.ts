// HTTP routes and the WebSocket of shared/protocol.ts.
import { createReadStream, statSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { hostname } from "node:os";
import { WebSocketServer, type WebSocket } from "ws";
import type {
  CreateAppRequest,
  ErrorBody,
  HealthResponse,
  PairRequest,
  PairResponse,
  PermissionAnswerRequest,
  SendMessageRequest,
  ServerEvent,
} from "../../shared/protocol.ts";
import { HttpError, type AppManager } from "./apps.ts";
import type { Auth } from "./auth.ts";
import { log } from "./fs-util.ts";

const MAX_BODY = 1024 * 1024;

export function serverName(): string {
  return hostname();
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": data.length });
  res.end(data);
}

function sendError(res: ServerResponse, status: number, error: string): void {
  sendJson(res, status, { error } satisfies ErrorBody);
}

async function readBody<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new HttpError(413, "The request is too large.");
    chunks.push(chunk as Buffer);
  }
  if (size === 0) return {} as T;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
  } catch {
    throw new HttpError(400, "The request body is not valid JSON.");
  }
}

function str(value: unknown, field: string): string {
  if (typeof value !== "string") throw new HttpError(400, `"${field}" must be a string.`);
  return value;
}

function bearer(req: IncomingMessage): string | undefined {
  const header = req.headers.authorization;
  return header?.startsWith("Bearer ") ? header.slice(7).trim() : undefined;
}

function sendFileWithRange(req: IncomingMessage, res: ServerResponse, path: string, headers: Record<string, string>): void {
  const size = statSync(path).size;
  const range = req.headers.range;
  const base = { ...headers, "Accept-Ranges": "bytes" };
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    let start = match && match[1] !== "" ? Number(match[1]) : NaN;
    let end = match && match[2] !== "" ? Number(match[2]) : size - 1;
    if (match && match[1] === "" && match[2] !== "") {
      start = Math.max(0, size - Number(match[2]));
      end = size - 1;
    }
    end = Math.min(end, size - 1);
    if (!match || Number.isNaN(start) || start > end || start >= size) {
      res.writeHead(416, { ...base, "Content-Range": `bytes */${size}` });
      res.end();
      return;
    }
    res.writeHead(206, { ...base, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": end - start + 1 });
    if (req.method === "HEAD") return void res.end();
    createReadStream(path, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { ...base, "Content-Length": size });
  if (req.method === "HEAD") return void res.end();
  createReadStream(path).pipe(res);
}

export function startHttpServer(deps: {
  host: string;
  port: number;
  version: string;
  auth: Auth;
  apps: AppManager;
}): { server: Server; broadcast(event: ServerEvent): void; ready: Promise<void> } {
  const { auth, apps } = deps;
  const sockets = new Set<WebSocket>();

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const method = req.method ?? "GET";

    if (method === "GET" && path === "/api/health") {
      return sendJson(res, 200, { ok: true, name: serverName(), version: deps.version, protocol: 1 } satisfies HealthResponse);
    }
    if (method === "POST" && path === "/api/pair") {
      const body = await readBody<PairRequest>(req);
      const token = auth.pair(str(body.code, "code"), typeof body.deviceName === "string" ? body.deviceName : "Phone");
      if (token === "locked") return sendError(res, 429, "Too many wrong codes. Wait a minute and try again.");
      if (token === null) return sendError(res, 401, "That pairing code is not right. Check the code on your PC.");
      log(`paired a new device: ${typeof body.deviceName === "string" ? body.deviceName.slice(0, 80) : "Phone"}`);
      return sendJson(res, 200, { token, serverName: serverName() } satisfies PairResponse);
    }
    if (!path.startsWith("/api/")) return sendError(res, 404, "Not found.");
    if (!auth.check(bearer(req))) return sendError(res, 401, "This phone is not paired with this PC. Pair it again.");

    if (path === "/api/apps") {
      if (method === "GET") return sendJson(res, 200, apps.list());
      if (method === "POST") {
        const body = await readBody<CreateAppRequest>(req);
        return sendJson(res, 201, apps.create(str(body.name, "name"), str(body.prompt, "prompt")));
      }
      return sendError(res, 405, "Method not allowed.");
    }
    const match = /^\/api\/apps\/([^/]+)(?:\/([a-z]+))?$/.exec(path);
    if (!match) return sendError(res, 404, "Not found.");
    const id = decodeURIComponent(match[1]);
    const action = match[2];

    if (action === undefined) {
      if (method === "GET") return sendJson(res, 200, apps.get(id));
      if (method === "DELETE") {
        await apps.delete(id);
        res.writeHead(204);
        return void res.end();
      }
    } else if (action === "icon" && (method === "GET" || method === "HEAD")) {
      const app = apps.get(id);
      const icon = apps.icon(id);
      const headers = { "Content-Type": "image/png", "Cache-Control": "no-cache", ETag: `"${app.iconVersion}"` };
      if (req.headers["if-none-match"] === headers.ETag) {
        res.writeHead(304, headers);
        return void res.end();
      }
      if ("png" in icon) {
        res.writeHead(200, { ...headers, "Content-Length": icon.png.length });
        return void res.end(method === "HEAD" ? undefined : icon.png);
      }
      return sendFileWithRange(req, res, icon.path, headers);
    } else if (action === "apk" && (method === "GET" || method === "HEAD")) {
      const apk = apps.apkFile(id);
      if (!apk) return sendError(res, 404, "This app has no APK yet.");
      return sendFileWithRange(req, res, apk.path, {
        "Content-Type": "application/vnd.android.package-archive",
        "Content-Disposition": `attachment; filename="${apk.app.slug}-${apk.app.latestApk!.number}.apk"`,
        ETag: `"${apk.app.latestApk!.sha256 ?? apk.app.latestApk!.number}"`,
      });
    } else if (action === "messages") {
      if (method === "GET") {
        const afterSeq = Number(url.searchParams.get("afterSeq") ?? 0);
        return sendJson(res, 200, apps.messages(id, Number.isFinite(afterSeq) ? afterSeq : 0));
      }
      if (method === "POST") {
        const body = await readBody<SendMessageRequest>(req);
        apps.sendMessage(id, str(body.text, "text"));
        return sendJson(res, 202, {});
      }
    } else if (method === "POST" && action === "cancel") {
      apps.cancel(id);
      return sendJson(res, 202, {});
    } else if (method === "POST" && action === "build") {
      apps.rebuild(id);
      return sendJson(res, 202, {});
    } else if (method === "POST" && action === "permission") {
      const body = await readBody<PermissionAnswerRequest>(req);
      apps.answerPermission(id, str(body.requestId, "requestId"), str(body.optionId, "optionId"));
      return sendJson(res, 202, {});
    }
    return sendError(res, 404, "Not found.");
  }

  const server = createServer((req, res) => {
    route(req, res).catch((error: unknown) => {
      if (error instanceof HttpError) return sendError(res, error.status, error.message);
      log(`${req.method} ${(req.url ?? "").split("?")[0]} failed:`, error instanceof Error ? error.message : error);
      if (!res.headersSent) sendError(res, 500, "Something went wrong on the PC.");
      else res.end();
    });
  });

  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== "/ws" || !auth.check(url.searchParams.get("token"))) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      sockets.add(ws);
      ws.on("close", () => sockets.delete(ws));
      ws.on("error", () => sockets.delete(ws));
      ws.send(JSON.stringify({ type: "hello", serverName: serverName(), protocol: 1 } satisfies ServerEvent));
    });
  });
  const ping = setInterval(() => {
    for (const ws of sockets) ws.ping();
  }, 25_000);
  server.on("close", () => clearInterval(ping));

  const ready = new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(deps.port, deps.host, () => resolve());
  });

  return {
    server,
    ready,
    broadcast(event) {
      const data = JSON.stringify(event);
      for (const ws of sockets) if (ws.readyState === ws.OPEN) ws.send(data);
    },
  };
}
