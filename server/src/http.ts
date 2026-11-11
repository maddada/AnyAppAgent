// HTTP routes and the WebSockets of shared/protocol.ts, including the desktop app's admin surface.
import { createReadStream, existsSync, statSync } from "node:fs";
import { pipeline } from "node:stream";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { hostname } from "node:os";
import { WebSocketServer, type WebSocket } from "ws";
import type {
  AddTodoRequest,
  AdminEvent,
  AdminState,
  BackupRestoreRequest,
  BackupSetupRequest,
  CreateAppRequest,
  EasyConnectPairRequest,
  EasyConnectToggleRequest,
  ErrorBody,
  HealthResponse,
  KeysBackupRequest,
  PairedDevice,
  PairRequest,
  PairResponse,
  PermissionAnswerRequest,
  SendMessageRequest,
  PublishRequest,
  PullBackRequest,
  ShareRequest,
  ServerEvent,
  UpdateTodoRequest,
} from "../../shared/protocol.ts";
import { HttpError, type AppManager } from "./apps.ts";
import type { SigningKeys } from "./signing-keys.ts";
import { ADMIN_DEVICE_ID, cleanDeviceName, type Auth } from "./auth.ts";
import { PairingRefused, type EasyConnect } from "./easy-connect/controller.ts";
import { log } from "./fs-util.ts";
import { lanAddresses, pairingUri } from "./net.ts";
import { workerApiRoute, workerToolsRoute } from "./worker-http.ts";

const MAX_BODY = 1024 * 1024;
/** A message can carry pictures (up to 6, each at most about 5 MB as base64) and long pasted text. */
const MAX_MESSAGE_BODY = 40 * 1024 * 1024;

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

async function readBody<T>(req: IncomingMessage, limit = MAX_BODY): Promise<T> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new HttpError(413, limit === MAX_BODY ? "The request is too large." : "That message is too big to send. Send fewer or smaller pictures.");
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

/**
 * Streams a file into a response and always closes the file: stream.pipeline destroys the read
 * stream when the phone drops the connection (a plain .pipe() kept the file open for good).
 */
function streamFile(res: ServerResponse, path: string, range?: { start: number; end: number }, done?: (sent: number, error?: Error) => void): void {
  const file = createReadStream(path, range);
  let sent = 0;
  file.on("data", (chunk: string | Buffer) => {
    sent += chunk.length;
  });
  pipeline(file, res, (error) => done?.(sent, error ?? undefined));
}

/**
 * Serves a file with Range support. If-Range (an ETag) is honoured: when it does not match the
 * file's ETag, the whole file is sent with 200, so a resumed download never mixes two builds.
 */
function sendFileWithRange(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  headers: Record<string, string>,
  done?: (info: { start: number; length: number; size: number; sent: number; error?: Error }) => void,
): void {
  const size = statSync(path).size;
  const ifRange = req.headers["if-range"];
  const range = ifRange !== undefined && ifRange !== headers.ETag ? undefined : req.headers.range;
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
    streamFile(res, path, { start, end }, (sent, error) => done?.({ start, length: end - start + 1, size, sent, ...(error ? { error } : {}) }));
    return;
  }
  res.writeHead(200, { ...base, "Content-Length": size });
  if (req.method === "HEAD") return void res.end();
  streamFile(res, path, undefined, (sent, error) => done?.({ start: 0, length: size, size, sent, ...(error ? { error } : {}) }));
}

const mb = (bytes: number) => (bytes / 1048576).toFixed(1);

export function startHttpServer(deps: {
  host: string;
  port: number;
  version: string;
  auth: Auth;
  apps: AppManager;
  easyConnect: EasyConnect;
  signing?: SigningKeys;
  hostApkPath?: string;
}): {
  server: Server;
  broadcast(event: ServerEvent): void;
  adminChanged(): void;
  adminState(): AdminState;
  phonesConnected(): number;
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
      ...(deps.signing?.state() ? { signing: deps.signing.state() } : {}),
      backup: apps.backups.state(),
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
    if (method === "POST" && (path === "/api/admin/keys/backup" || path === "/api/admin/keys/restore")) {
      if (!deps.signing) throw new HttpError(409, "Signing keys are not available in this companion.");
      const body = await readBody<Partial<KeysBackupRequest>>(req);
      if (path === "/api/admin/keys/backup") return sendJson(res, 200, await deps.signing.backup(body.file, body.password));
      return sendJson(res, 200, await deps.signing.restore(body.file, body.password));
    }
    // "Never lose your apps" (backup.ts): the password passes straight through and is never logged.
    if (method === "POST" && path === "/api/admin/backup") {
      const body = await readBody<Partial<BackupSetupRequest>>(req);
      const state = await apps.backups.setup(body);
      adminChanged();
      return sendJson(res, 200, state);
    }
    if (method === "POST" && path === "/api/admin/backup/run") {
      const state = await apps.backups.run();
      adminChanged();
      return sendJson(res, 200, state);
    }
    if (method === "POST" && path === "/api/admin/backup/restore") {
      const body = await readBody<Partial<BackupRestoreRequest>>(req);
      const result = await apps.backups.restore(body);
      deps.signing?.refreshSoon();
      adminChanged();
      return sendJson(res, 200, result);
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
    if (path.startsWith("/page/") || path.startsWith("/page-kit/")) {
      if (await apps.pages.route(req, res, path, url)) return;
    }
    if (path.startsWith("/mcp/app/")) {
      if (await apps.history.mcpRoute(req, res, path, url)) return;
    }
    if (path.startsWith("/mcp/pages/")) {
      if (await apps.pages.mcpRoute(req, res, path, url)) return;
    }
    if (path.startsWith("/mcp/")) {
      const exists = (appId: string) => apps.list().some((app) => app.id === appId);
      if (await workerToolsRoute(req, res, path, { workers: apps.workers, appExists: exists, log })) return;
    }
    if (path.startsWith("/api/admin/")) return adminRoute(req, res, path, method);
    if (!path.startsWith("/api/")) return sendError(res, 404, "Not found.");
    if (!auth.check(bearer(req))) return sendError(res, 401, "This phone is not paired with this PC. Pair it again.");

    // The usage meter, the health reminder and the backup, for the phone (docs/TRUST.md).
    if (path === "/api/care") {
      if (method === "GET") return sendJson(res, 200, apps.care());
      return sendError(res, 405, "Method not allowed.");
    }
    if (path === "/api/care/reminder") {
      if (method === "POST") return sendJson(res, 200, apps.dismissReminder());
      return sendError(res, 405, "Method not allowed.");
    }
    if (path === "/api/apps") {
      if (method === "GET") return sendJson(res, 200, apps.list());
      if (method === "POST") {
        const body = await readBody<CreateAppRequest>(req);
        return sendJson(res, 201, apps.create(str(body.name, "name"), str(body.prompt, "prompt"), body.preset, body.askMore === true));
      }
      return sendError(res, 405, "Method not allowed.");
    }
    // A picture sent in the chat: GET /api/apps/:id/images/:imageId
    const image = /^\/api\/apps\/([^/]+)\/images\/([a-zA-Z0-9-]+)$/.exec(path);
    if (image && (method === "GET" || method === "HEAD")) {
      const found = apps.imageFile(decodeURIComponent(image[1]), image[2]);
      if (!found) return sendError(res, 404, "That picture is not on this PC any more.");
      res.writeHead(200, { "content-type": found.mimeType, "content-length": statSync(found.path).size, "cache-control": "private, max-age=31536000, immutable" });
      if (method === "HEAD") return void res.end();
      streamFile(res, found.path);
      return;
    }
    // Pages: GET /api/apps/:id/pages, POST /api/apps/:id/pages/:pageId/open
    const pages = /^\/api\/apps\/([^/]+)\/pages(?:\/([0-9a-f]{32})\/open)?$/.exec(path);
    if (pages) {
      const appId = decodeURIComponent(pages[1]);
      apps.get(appId);
      if (!pages[2] && method === "GET") return sendJson(res, 200, apps.pages.list(appId));
      if (pages[2] && method === "POST") {
        try {
          return sendJson(res, 200, apps.pages.open(appId, pages[2]));
        } catch (error) {
          return sendError(res, (error as { status?: number }).status ?? 500, (error as Error).message);
        }
      }
      return sendError(res, 405, "Method not allowed.");
    }
    // The person's to-do list: /api/apps/:id/todos[/:todoId[/send]]
    const todo = /^\/api\/apps\/([^/]+)\/todos(?:\/([a-zA-Z0-9-]+)(\/send)?)?$/.exec(path);
    if (todo) {
      const appId = decodeURIComponent(todo[1]);
      const todoId = todo[2];
      if (!todoId) {
        if (method === "GET") return sendJson(res, 200, apps.todos(appId));
        if (method === "POST") return sendJson(res, 201, apps.addTodo(appId, str((await readBody<AddTodoRequest>(req)).text, "text")));
      } else if (todo[3]) {
        if (method === "POST") return sendJson(res, 200, apps.sendTodo(appId, todoId));
      } else {
        if (method === "PATCH") return sendJson(res, 200, apps.updateTodo(appId, todoId, await readBody<UpdateTodoRequest>(req)));
        if (method === "DELETE") {
          apps.removeTodo(appId, todoId);
          res.writeHead(204);
          return void res.end();
        }
      }
      return sendError(res, 405, "Method not allowed.");
    }
    // Versions and undo, crashes, the diary (docs/VERSIONS.md)
    const restore = /^\/api\/apps\/([^/]+)\/versions\/(\d{1,9})\/restore$/.exec(path);
    if (restore && method === "POST") return sendJson(res, 202, await apps.restore(decodeURIComponent(restore[1]), Number(restore[2])));
    const crashFix = /^\/api\/apps\/([^/]+)\/crashes\/([0-9a-f-]{36})\/fix$/.exec(path);
    if (crashFix && method === "POST") {
      apps.fixCrash(decodeURIComponent(crashFix[1]), crashFix[2]);
      return sendJson(res, 202, {});
    }
    if (await workerApiRoute(req, res, path, url, { workers: apps.workers, checkApp: (appId) => void apps.get(appId) })) return;
    // "Update it" on an app that is behind (health.ts): POST /api/apps/:id/keep-healthy
    const healthy = /^\/api\/apps\/([^/]+)\/keep-healthy$/.exec(path);
    if (healthy) {
      if (method !== "POST") return sendError(res, 405, "Method not allowed.");
      apps.keepHealthy(decodeURIComponent(healthy[1]));
      return sendJson(res, 202, {});
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
      const abi = url.searchParams.get("abi") ?? undefined;
      const apk = apps.apkFile(id, abi);
      if (!apk) return sendError(res, 404, "This app has no APK yet.");
      if ("missing" in apk) return sendError(res, 404, "This version for your phone is not on the PC any more. Ask for a change to make a new one.");
      const name = `${apk.app.slug}-${apk.build.number}${apk.abi ? `-${apk.abi}` : ""}`;
      const who = auth.list().find((device) => device.id === auth.identify(bearer(req)))?.deviceName ?? "a phone";
      return sendFileWithRange(
        req,
        res,
        apk.path,
        {
          "Content-Type": "application/vnd.android.package-archive",
          "Content-Disposition": `attachment; filename="${name}.apk"`,
          ETag: `"${apk.sha256 ?? apk.build.number}"`,
        },
        ({ start, length, size, sent, error }) => {
          if (method === "HEAD") return;
          const from = start > 0 ? ` from ${mb(start)} MB` : "";
          const what = `[${apk.app.slug}] ${who.slice(0, 60)} downloading ${name}.apk${from}`;
          if (error || sent < length) log(`${what}: stopped at ${mb(start + sent)} of ${mb(size)} MB (the connection closed)`);
          else log(`${what}: done, ${mb(sent)} MB sent`);
        },
      );
    } else if (action === "ota" && (method === "GET" || method === "HEAD")) {
      // The latest build's quick update (docs/FAST-LANE.md); the app checks its signature itself.
      const ota = apps.otaFile(id);
      if (!ota) return sendError(res, 404, "This version has no quick update. Install the APK instead.");
      const name = `${ota.app.slug}-${ota.build.number}-ota.zip`;
      return sendFileWithRange(req, res, ota.path, {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${name}"`,
        ETag: `"${ota.sha256}"`,
      }, ({ sent, size, error }) => {
        if (method === "HEAD") return;
        log(`[${ota.app.slug}] quick update ${ota.build.number}: ${error || sent < size ? `stopped at ${mb(sent)} MB` : `sent, ${mb(sent)} MB`}`);
      });
    } else if (action === "messages") {
      if (method === "GET") {
        const afterSeq = Number(url.searchParams.get("afterSeq") ?? 0);
        return sendJson(res, 200, apps.messages(id, Number.isFinite(afterSeq) ? afterSeq : 0));
      }
      if (method === "POST") {
        const body = await readBody<SendMessageRequest>(req, MAX_MESSAGE_BODY);
        apps.sendMessage(id, body.text === undefined && body.images?.length ? "" : str(body.text, "text"), Array.isArray(body.images) ? body.images : []);
        return sendJson(res, 202, {});
      }
    } else if (method === "POST" && action === "cancel") {
      apps.cancel(id);
      return sendJson(res, 202, {});
    } else if (method === "POST" && action === "share") {
      const body = await readBody<Partial<ShareRequest>>(req);
      if (typeof body.shared !== "boolean") throw new HttpError(400, '"shared" must be true or false.');
      return sendJson(res, 200, await apps.setShared(id, body.shared));
    } else if (method === "POST" && action === "publish") {
      const body = await readBody<Partial<PublishRequest>>(req);
      if (body.notes !== undefined && typeof body.notes !== "string") throw new HttpError(400, '"notes" must be text.');
      if (body.channel !== undefined && body.channel !== "stable" && body.channel !== "testing") throw new HttpError(400, '"channel" must be "stable" or "testing".');
      return sendJson(res, 200, await apps.publish(id, { ...(body.notes ? { notes: body.notes } : {}), ...(body.channel ? { channel: body.channel } : {}) }));
    } else if (method === "POST" && action === "pullback") {
      const body = await readBody<Partial<PullBackRequest>>(req);
      if (typeof body.build !== "number" || !Number.isInteger(body.build)) throw new HttpError(400, '"build" must be a build number.');
      return sendJson(res, 200, await apps.pullBack(id, body.build));
    } else if (method === "GET" && action === "releases") {
      return sendJson(res, 200, await apps.releaseStats(id));
    } else if (method === "POST" && action === "build") {
      apps.rebuild(id);
      return sendJson(res, 202, {});
    } else if (method === "GET" && action === "versions") {
      return sendJson(res, 200, await apps.versions(id));
    } else if (method === "POST" && action === "undo") {
      return sendJson(res, 202, await apps.undo(id));
    } else if (method === "POST" && action === "crashes") {
      return sendJson(res, 201, apps.reportCrash(id, await readBody<unknown>(req, 256 * 1024)));
    } else if (method === "POST" && action === "diary") {
      apps.diaryAnswer(id, await readBody<unknown>(req, 512 * 1024));
      res.writeHead(204);
      return void res.end();
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
    phonesConnected: () => [...phoneSockets.keys()].filter((ws) => ws.readyState === ws.OPEN).length,
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
