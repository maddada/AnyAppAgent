// HTTP routes and the WebSockets of shared/protocol.ts, including the desktop app's admin surface.
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { hostname } from "node:os";
import { WebSocketServer, type WebSocket } from "ws";
import type {
  AdminEvent,
  AdminState,
  CreateAppRequest,
  EasyConnectPairRequest,
  EasyConnectToggleRequest,
  ErrorBody,
  HealthResponse,
  PairedDevice,
  PairRequest,
  PairResponse,
  PermissionAnswerRequest,
  SendMessageRequest,
  ServerEvent,
} from "../../shared/protocol.ts";
import { HttpError, type AppManager } from "./apps.ts";
import { ADMIN_DEVICE_ID, cleanDeviceName, type Auth } from "./auth.ts";
import { PairingRefused, type EasyConnect } from "./easy-connect/controller.ts";
import { log } from "./fs-util.ts";
import { lanAddresses, pairingUri } from "./net.ts";
import { workerApiRoute, workerToolsRoute } from "./worker-http.ts";

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
  easyConnect: EasyConnect;
  hostApkPath?: string;
}): {
  server: Server;
  broadcast(event: ServerEvent): void;
  adminChanged(): void;
  adminState(): AdminState;
  ready: Promise<void>;
  close(): void;
} {
  const { auth, apps, easyConnect } = deps;
  const phoneSockets = new Map<WebSocket, string>();
  const adminSockets = new Set<WebSocket>();

  function connectedDeviceIds(): Set<string> {
    return new Set(phoneSockets.values());
  }

  /**
   * Forgets a paired phone at once: its token stops working, its Easy Connect key leaves the
   * allow-list, its sockets close, and the desktop gets a new admin.state (through auth.onChange).
   */
  function forgetDevice(id: string, why: string, allowListLater?: ServerResponse): boolean {
    const name = auth.list().find((device) => device.id === id)?.deviceName;
    if (!auth.remove(id)) return false;
    for (const [ws, deviceId] of phoneSockets) if (deviceId === id) ws.close(4001, "unpaired");
    // A phone that unpairs itself over Easy Connect is answered through the tunnel the new
    // allow-list closes, so its key leaves the list only once that answer is on its way.
    if (allowListLater) allowListLater.once("finish", () => setTimeout(() => easyConnect.devicesChanged(), 1500));
    else easyConnect.devicesChanged();
    log(`forgot device ${name ?? id} (${why})`);
    return true;
  }

  /**
   * A phone that pairs again under the same name replaces its older entries that are not
   * connected now, so the PC never lists two phones the user cannot tell apart.
   */
  function replaceOlderTwins(token: string): void {
    const id = auth.identify(token);
    const fresh = auth.list().find((device) => device.id === id);
    if (!fresh) return;
    const connected = connectedDeviceIds();
    const same = (name: string) => name.trim().toLowerCase() === fresh.deviceName.trim().toLowerCase();
    for (const older of [...auth.list()]) {
      if (older.id !== fresh.id && same(older.deviceName) && !connected.has(older.id)) forgetDevice(older.id, "paired again");
    }
  }

  function adminState(): AdminState {
    const lanUrls = lanAddresses().map((address) => `http://${address}:${deps.port}`);
    const connected = connectedDeviceIds();
    const devices: PairedDevice[] = auth.list().map((device) => ({
      id: device.id,
      name: device.deviceName,
      pairedAt: device.createdAt,
      ...(device.lastSeenAt ? { lastSeenAt: device.lastSeenAt } : {}),
      connected: connected.has(device.id),
      via: device.via === "easy-connect" ? "easy-connect" : "same-network",
    }));
    return {
      serverName: serverName(),
      version: deps.version,
      port: deps.port,
      pairing: {
        code: auth.code,
        lanUrls,
        qrPayload: pairingUri(lanAddresses()[0] ?? "10.0.2.2", deps.port, auth.code),
      },
      easyConnect: easyConnect.state(),
      devices,
    };
  }

  function sendAdmin(event: AdminEvent): void {
    const data = JSON.stringify(event);
    for (const ws of adminSockets) if (ws.readyState === ws.OPEN) ws.send(data);
  }

  let adminTimer: NodeJS.Timeout | undefined;
  function adminChanged(): void {
    adminTimer ??= setTimeout(() => {
      adminTimer = undefined;
      sendAdmin({ type: "admin.state", state: adminState() });
    }, 50);
  }

  async function adminRoute(req: IncomingMessage, res: ServerResponse, path: string, method: string): Promise<void> {
    if (!auth.isAdmin(bearer(req))) return sendError(res, 401, "Only the AnyAppAgent desktop app may do this.");
    if (method === "GET" && path === "/api/admin/state") return sendJson(res, 200, adminState());
    if (method === "POST" && path === "/api/admin/pairing/new") {
      auth.newCode();
      easyConnect.newCode();
      adminChanged();
      return sendJson(res, 200, adminState());
    }
    if (method === "POST" && path === "/api/admin/easy-connect") {
      const body = await readBody<EasyConnectToggleRequest>(req);
      if (typeof body.enabled !== "boolean") throw new HttpError(400, '"enabled" must be true or false.');
      await easyConnect.setEnabled(body.enabled);
      adminChanged();
      return sendJson(res, 200, adminState());
    }
    const device = /^\/api\/admin\/devices\/([^/]+)$/.exec(path);
    if (method === "DELETE" && device) {
      const id = decodeURIComponent(device[1]);
      if (!forgetDevice(id, "removed on the PC")) return sendError(res, 404, "There is no paired device with that id.");
      res.writeHead(204);
      return void res.end();
    }
    return sendError(res, 404, "Not found.");
  }

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const method = req.method ?? "GET";

    if (method === "GET" && path === "/api/health") {
      return sendJson(res, 200, { ok: true, name: serverName(), version: deps.version, protocol: 1 } satisfies HealthResponse);
    }
    if ((method === "GET" || method === "HEAD") && path === "/download/anyappagent.apk") {
      const apk = deps.hostApkPath;
      if (!apk || !existsSync(apk)) return sendError(res, 404, "The AnyAppAgent phone app is not available from this PC yet.");
      return sendFileWithRange(req, res, apk, {
        "Content-Type": "application/vnd.android.package-archive",
        "Content-Disposition": 'attachment; filename="anyappagent.apk"',
      });
    }
    if (method === "POST" && path === "/api/pair") {
      const body = await readBody<PairRequest>(req);
      const deviceName = cleanDeviceName(body.deviceName);
      const token = auth.pair(str(body.code, "code"), deviceName);
      if (token === "locked") return sendError(res, 429, "Too many wrong codes. Wait a minute and try again.");
      if (token === null) return sendError(res, 401, "That pairing code is not right. Check the code on your PC.");
      log(`paired a new device: ${deviceName}`);
      replaceOlderTwins(token);
      return sendJson(res, 200, { token, serverName: serverName() } satisfies PairResponse);
    }
    if (method === "POST" && path === "/api/pair/easy-connect") {
      const body = await readBody<Partial<EasyConnectPairRequest>>(req);
      const { token } = easyConnect.pair({ ...body, deviceName: cleanDeviceName(body.deviceName) });
      replaceOlderTwins(token);
      return sendJson(res, 200, { token, serverName: serverName() } satisfies PairResponse);
    }
    if (method === "POST" && path === "/api/unpair") {
      const id = auth.identify(bearer(req));
      if (id === null) return sendError(res, 401, "This phone is not paired with this PC.");
      if (id === ADMIN_DEVICE_ID) return sendError(res, 400, "Only a paired phone can disconnect itself.");
      forgetDevice(id, "the phone disconnected", res);
      res.writeHead(204);
      return void res.end();
    }
    if (path.startsWith("/mcp/")) {
      const exists = (appId: string) => apps.list().some((app) => app.id === appId);
      if (await workerToolsRoute(req, res, path, { workers: apps.workers, appExists: exists, log })) return;
    }
    if (path.startsWith("/api/admin/")) return adminRoute(req, res, path, method);
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
    if (await workerApiRoute(req, res, path, url, { workers: apps.workers, checkApp: (appId) => void apps.get(appId) })) return;
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
      if (error instanceof HttpError || error instanceof PairingRefused) return sendError(res, error.status, error.message);
      log(`${req.method} ${(req.url ?? "").split("?")[0]} failed:`, error instanceof Error ? error.message : error);
      if (!res.headersSent) sendError(res, 500, "Something went wrong on the PC.");
      else res.end();
    });
  });

  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const token = url.searchParams.get("token");
    const isAdminEvents = url.pathname === "/api/admin/events";
    const deviceId = url.pathname === "/ws" ? auth.identify(token) : isAdminEvents && auth.isAdmin(token) ? ADMIN_DEVICE_ID : null;
    if (deviceId === null) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const hello = JSON.stringify({ type: "hello", serverName: serverName(), protocol: 1 } satisfies ServerEvent);
      if (isAdminEvents) {
        adminSockets.add(ws);
        const drop = () => adminSockets.delete(ws);
        ws.on("close", drop);
        ws.on("error", drop);
        ws.send(hello);
        ws.send(JSON.stringify({ type: "admin.state", state: adminState() } satisfies AdminEvent));
        return;
      }
      phoneSockets.set(ws, deviceId);
      const drop = () => {
        if (phoneSockets.delete(ws)) adminChanged();
      };
      ws.on("close", drop);
      ws.on("error", drop);
      ws.send(hello);
      adminChanged();
    });
  });
  const ping = setInterval(() => {
    for (const ws of [...phoneSockets.keys(), ...adminSockets]) ws.ping();
  }, 25_000);
  server.on("close", () => clearInterval(ping));

  const ready = new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(deps.port, deps.host, () => resolve());
  });

  return {
    server,
    ready,
    adminChanged,
    adminState,
    broadcast(event) {
      const data = JSON.stringify(event);
      for (const ws of phoneSockets.keys()) if (ws.readyState === ws.OPEN) ws.send(data);
      for (const ws of adminSockets) if (ws.readyState === ws.OPEN) ws.send(data);
    },
    close() {
      for (const ws of [...phoneSockets.keys(), ...adminSockets]) ws.terminate();
      server.close();
    },
  };
}
