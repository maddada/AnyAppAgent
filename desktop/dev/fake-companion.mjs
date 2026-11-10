// A small fake of the companion for developing the desktop app before the real admin routes exist.
// Implements the "Desktop app to companion" part of shared/protocol.ts plus the app and chat routes
// the main window uses, with a simulated agent turn and build. Plain Node, no build step.
//
//   ANYAPP_PORT=8931 ANYAPP_ADMIN_TOKEN=... node dev/fake-companion.mjs
//
// Extra env: ANYAPP_STATE_DIR (writes pairing-code.txt there), FAKE_EASY_CONNECT=off|ready|error,
// FAKE_SEED=1 (a few example apps). Dev-only hooks: POST /__fake/pair-phone {name},
// POST /__fake/disconnect-all.
import { createServer } from "node:http";
import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { WebSocketServer } from "ws";

const port = Number(process.env.ANYAPP_PORT ?? 8931);
const adminToken = process.env.ANYAPP_ADMIN_TOKEN ?? "";
const stateDir = process.env.ANYAPP_STATE_DIR;
const now = () => new Date().toISOString();

let code = "";
function newCode() {
  code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  if (stateDir) {
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(join(stateDir, "pairing-code.txt"), `${code}\n`);
  }
}
newCode();

const easyMode = process.env.FAKE_EASY_CONNECT ?? "off";
let easyConnect = easyMode === "off" ? { state: "off" } : easyMode === "error" ? { state: "error", error: "Easy Connect could not reach its relay. The same-network way still works." } : { state: "starting" };
function freshEasyCode() {
  easyConnect = { state: "ready", code: `AAE1:${randomBytes(220).toString("hex").toUpperCase().slice(0, 349)}`, expiresAt: new Date(Date.now() + 10 * 60_000).toISOString() };
}
if (easyMode === "ready") setTimeout(() => {
  freshEasyCode();
  pushState();
}, 1200);

const devices = []; // { id, name, pairedAt, lastSeenAt, connected, token }
const apps = new Map(); // id -> App
const chats = new Map(); // id -> ChatItem[]
const seqs = new Map();
const sockets = new Set(); // { ws, admin }

function lan() {
  return ["192.168.1.157"].map((a) => `http://${a}:${port}`);
}

function adminState() {
  const lanUrls = lan();
  return {
    serverName: hostname(),
    version: "0.1.0-fake",
    port,
    pairing: { code, lanUrls, qrPayload: `anyappagent://pair?url=${encodeURIComponent(lanUrls[0])}&code=${code}` },
    easyConnect,
    devices: devices.map(({ token, ...d }) => d),
  };
}

function send(event, adminOnly = false) {
  const text = JSON.stringify(event);
  for (const s of sockets) if (!adminOnly || s.admin) s.ws.send(text);
}
function pushState() {
  send({ type: "admin.state", state: adminState() }, true);
}

// ---- icons: a soft coloured square PNG with a lighter inner tile, generated per app.
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function iconPng(hue) {
  const size = 96;
  const rgb = (h, s, l) => {
    const a = s * Math.min(l, 1 - l);
    const f = (n) => {
      const k = (n + h / 30) % 12;
      return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
    };
    return [f(0), f(8), f(4)];
  };
  const bg = rgb(hue, 0.55, 0.55);
  const fg = rgb(hue, 0.7, 0.9);
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const inner = Math.hypot(x - 48, y - 48) < 22;
      const [r, g, b] = inner ? fg : bg;
      const o = y * (size * 3 + 1) + 1 + x * 3;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

// Sample launcher icons for the seeded apps, like the theme's renders (dev only).
const ART = {
  prayer: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#1D3646"/><circle cx="30" cy="33" r="15" fill="#EFE0BC"/><circle cx="37" cy="27.5" r="12.5" fill="#1D3646"/><circle cx="45" cy="19" r="2" fill="#EFE0BC"/></svg>`,
  habits: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#E4B04A"/>${[0, 1, 2].map((r) => [0, 1, 2].map((c) => `<rect x="${14 + c * 13}" y="${14 + r * 13}" width="10" height="10" rx="3" fill="#2A2116" opacity="${[1, 1, 0, 1, 1, 1, 0, 1, 0][r * 3 + c] ? 1 : 0.22}"/>`).join("")).join("")}</svg>`,
  groceries: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#F2EADC"/><path d="M24 26c0-6 3.6-10 8-10s8 4 8 10" fill="none" stroke="#B9482B" stroke-width="3" stroke-linecap="round"/><path d="M17 26h30l-3 22a3 3 0 0 1-3 2.6H23a3 3 0 0 1-3-2.6z" fill="#B9482B"/></svg>`,
  water: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#D5E4E8"/><path d="M32 13c7 9 12 15.5 12 22a12 12 0 0 1-24 0c0-6.5 5-13 12-22z" fill="#2B6075"/></svg>`,
  tasbih: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#57412F"/>${Array.from({ length: 14 }).map((_, i) => { const a = (i / 14) * Math.PI * 2 - Math.PI / 2; return `<circle cx="${(32 + Math.cos(a) * 15).toFixed(1)}" cy="${(30 + Math.sin(a) * 15).toFixed(1)}" r="3" fill="#F0E2C8"/>`; }).join("")}</svg>`,
};
const ART_FOR = { "Prayer Times Ajman": "prayer", "Kids Chores": "habits", "Grocery List": "groceries", "Water Reminder": "water", "Recipe Box": "tasbih" };

// ---- apps and a simulated agent
function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 30) || "app";
}
function makeApp(name, status = "creating") {
  const id = randomUUID();
  const slug = slugify(name);
  const app = { id, name, slug, packageName: `com.anyapp.${slug}`, status, iconVersion: 1, createdAt: now(), updatedAt: now(), hue: randomInt(0, 360) };
  apps.set(id, app);
  chats.set(id, []);
  seqs.set(id, 0);
  return app;
}
function publicApp(app) {
  const { hue, ...rest } = app;
  return rest;
}
function updateApp(app, patch) {
  Object.assign(app, patch, { updatedAt: now() });
  send({ type: "app.updated", app: publicApp(app) });
}
function upsert(appId, item) {
  const list = chats.get(appId);
  const existing = list.find((i) => i.id === item.id);
  if (existing) Object.assign(existing, item, { updatedAt: now() });
  else {
    const seq = seqs.get(appId) + 1;
    seqs.set(appId, seq);
    list.push({ ...item, appId, seq, createdAt: now(), updatedAt: now() });
  }
  send({ type: "chat.item", item: list.find((i) => i.id === item.id) });
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function simulateTurn(app, prompt) {
  upsert(app.id, { id: randomUUID(), kind: "user", text: prompt });
  updateApp(app, { status: "working", lastMessagePreview: prompt.slice(0, 80) });
  const plan = randomUUID();
  upsert(app.id, { id: plan, kind: "plan", plan: [{ content: "Plan the screens", status: "in_progress" }, { content: "Write the app", status: "pending" }, { content: "Check it builds", status: "pending" }] });
  await wait(700);
  const t1 = randomUUID();
  upsert(app.id, { id: t1, kind: "tool", tool: { title: "Read App.tsx", kind: "read", status: "completed" } });
  await wait(500);
  const t2 = randomUUID();
  upsert(app.id, { id: t2, kind: "tool", tool: { title: "Edit App.tsx", kind: "edit", status: "in_progress" } });
  upsert(app.id, { id: plan, kind: "plan", plan: [{ content: "Plan the screens", status: "completed" }, { content: "Write the app", status: "in_progress" }, { content: "Check it builds", status: "pending" }] });
  await wait(900);
  upsert(app.id, { id: t2, kind: "tool", tool: { title: "Edit App.tsx", kind: "edit", status: "completed" } });
  upsert(app.id, { id: plan, kind: "plan", plan: [{ content: "Plan the screens", status: "completed" }, { content: "Write the app", status: "completed" }, { content: "Check it builds", status: "completed" }] });
  const reply = randomUUID();
  const text = `Done! I made **${app.name}**. It opens on a simple home screen with what you asked for. Building it for your phone now.`;
  for (let n = 10; n <= text.length; n += 14) {
    upsert(app.id, { id: reply, kind: "assistant", text: text.slice(0, n), streaming: true });
    await wait(60);
  }
  upsert(app.id, { id: reply, kind: "assistant", text, streaming: false });
  const number = (app.latestBuild?.number ?? 0) + 1;
  const build = { number, status: "running", startedAt: now() };
  const buildItem = randomUUID();
  updateApp(app, { status: "building", latestBuild: build });
  upsert(app.id, { id: buildItem, kind: "build", build, text: "Building the app…" });
  await wait(Number(process.env.ANYAPP_FAKE_BUILD_MS ?? 1500));
  const done = { ...build, status: "succeeded", finishedAt: now(), sizeBytes: 31_457_280, sha256: randomBytes(32).toString("hex") };
  upsert(app.id, { id: buildItem, kind: "build", build: done, text: "Ready to install" });
  updateApp(app, { status: "idle", latestBuild: done, latestApk: done, lastMessagePreview: text.slice(0, 80) });
  send({ type: "apk.ready", app: publicApp(app) });
}

if (process.env.FAKE_SEED === "1") {
  const seeds = [
    ["Prayer Times Ajman", "idle"],
    ["Grocery List", "working"],
    ["Kids Chores", "idle"],
    ["Water Reminder", "error"],
    ["Recipe Box", "building"],
  ];
  for (const [name, status] of seeds) {
    const app = makeApp(name, status);
    const ok = { number: 3, status: "succeeded", startedAt: now(), finishedAt: now(), sizeBytes: 30_000_000 };
    if (status === "idle") Object.assign(app, { latestBuild: ok, latestApk: ok, lastMessagePreview: "Done! The alarm now plays 10 minutes before each prayer." });
    if (status === "working") Object.assign(app, { lastMessagePreview: "Add a share button to send the list to my wife" });
    if (status === "building") Object.assign(app, { latestBuild: { number: 2, status: "running", startedAt: now() } });
    if (status === "error") Object.assign(app, { error: "The last build failed after 3 tries.", latestBuild: { number: 4, status: "failed", startedAt: now(), finishedAt: now(), error: "Metro could not find module './Timer'" } });
    const list = chats.get(app.id);
    let seq = 0;
    const push = (item) => list.push({ id: randomUUID(), appId: app.id, seq: ++seq, createdAt: now(), updatedAt: now(), ...item });
    push({ kind: "user", text: name === "Prayer Times Ajman" ? "An app that shows the five prayer times for Ajman and plays an alarm before each one." : `Make me a ${name.toLowerCase()} app.` });
    push({ kind: "plan", plan: [{ content: "Plan the screens", status: "completed" }, { content: "Write the app", status: status === "working" ? "in_progress" : "completed" }] });
    push({ kind: "tool", tool: { title: "Edit App.tsx", kind: "edit", status: "completed" } });
    push({ kind: "tool", tool: { title: "Run npx tsc --noEmit", kind: "execute", status: status === "working" ? "in_progress" : "completed" } });
    if (status !== "working") push({ kind: "assistant", text: app.lastMessagePreview ?? "Working on it." });
    if (status === "error") push({ kind: "error", text: "The app could not be built after 3 tries. Tell me what to change, or ask me to try again." });
    if (status === "idle") push({ kind: "build", build: ok, text: "Ready to install" });
    seqs.set(app.id, seq);
  }
}

// ---- HTTP
function bearer(req) {
  const h = req.headers.authorization ?? "";
  if (h.startsWith("Bearer ")) return h.slice(7);
  return new URL(req.url, "http://x").searchParams.get("token");
}
function isAdmin(token) {
  return !!adminToken && token === adminToken;
}
function isPhone(token) {
  return devices.some((d) => d.token === token);
}
function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(body === undefined ? "" : JSON.stringify(body));
}
async function readBody(req) {
  let raw = "";
  for await (const c of req) raw += c;
  return raw ? JSON.parse(raw) : {};
}

function pairPhone(name) {
  const token = randomBytes(24).toString("base64url");
  const device = { id: randomUUID(), name, pairedAt: now(), lastSeenAt: now(), connected: true, token };
  devices.push(device);
  pushState();
  return device;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const path = url.pathname;
  try {
    if (path === "/api/health") return json(res, 200, { ok: true, name: hostname(), version: "0.1.0-fake", protocol: 1 });
    if (path === "/api/pair" && req.method === "POST") {
      const body = await readBody(req);
      if (String(body.code) !== code) return json(res, 401, { error: "That code is not right." });
      const d = pairPhone(body.deviceName || "Phone");
      return json(res, 200, { token: d.token, serverName: hostname() });
    }
    if (path === "/download/anyappagent.apk") {
      const apk = process.env.ANYAPP_HOST_APK;
      if (!apk || !existsSync(apk)) return json(res, 404, { error: "The phone app is not on this PC yet." });
      res.writeHead(200, { "content-type": "application/vnd.android.package-archive", "content-length": statSync(apk).size });
      if (req.method === "HEAD") return res.end();
      return createReadStream(apk).pipe(res);
    }
    if (path === "/__fake/pair-phone" && req.method === "POST") {
      const body = await readBody(req);
      pairPhone(body.name || "Pixel 7");
      return json(res, 204);
    }
    if (path === "/__fake/disconnect-all" && req.method === "POST") {
      for (const d of devices) d.connected = false;
      pushState();
      return json(res, 204);
    }
    const token = bearer(req);
    if (path.startsWith("/api/admin/")) {
      if (!isAdmin(token)) return json(res, 401, { error: "Not allowed." });
      if (path === "/api/admin/state") return json(res, 200, adminState());
      if (path === "/api/admin/pairing/new" && req.method === "POST") {
        newCode();
        if (easyConnect.state === "ready") freshEasyCode();
        pushState();
        return json(res, 200, adminState());
      }
      if (path === "/api/admin/easy-connect" && req.method === "POST") {
        const body = await readBody(req);
        if (body.enabled) {
          // Like the real one: "starting" with a detail sentence for a while, then ready.
          const steps = ["Preparing the connection helper", "Building the connection helper (first time only)", "Reaching the relay"];
          steps.forEach((detail, i) => setTimeout(() => {
            if (easyConnect.state !== "starting") return;
            easyConnect = { state: "starting", detail };
            pushState();
          }, i * 1000));
          setTimeout(() => {
            freshEasyCode();
            pushState();
          }, Number(process.env.FAKE_EASY_CONNECT_MS ?? 6500));
          easyConnect = { state: "starting", detail: steps[0] };
        } else easyConnect = { state: "off" };
        pushState();
        return json(res, 200, adminState());
      }
      const dm = path.match(/^\/api\/admin\/devices\/([^/]+)$/);
      if (dm && req.method === "DELETE") {
        const i = devices.findIndex((d) => d.id === decodeURIComponent(dm[1]));
        if (i < 0) return json(res, 404, { error: "No such phone." });
        devices.splice(i, 1);
        pushState();
        return json(res, 204);
      }
      return json(res, 404, { error: "Not found." });
    }
    if (!isAdmin(token) && !isPhone(token)) return json(res, 401, { error: "Please pair again." });
    if (path === "/api/apps" && req.method === "GET") return json(res, 200, [...apps.values()].map(publicApp));
    if (path === "/api/apps" && req.method === "POST") {
      const body = await readBody(req);
      const app = makeApp(String(body.name || "My app"));
      send({ type: "app.updated", app: publicApp(app) });
      json(res, 200, publicApp(app));
      setTimeout(() => void simulateTurn(app, String(body.prompt || "Make it.")), 800);
      return;
    }
    const m = path.match(/^\/api\/apps\/([^/]+)(?:\/(icon|messages|apk|cancel|build))?$/);
    const app = m && apps.get(decodeURIComponent(m[1]));
    if (m && !app) return json(res, 404, { error: "No such app." });
    if (m && !m[2] && req.method === "GET") return json(res, 200, publicApp(app));
    if (m && m[2] === "icon") {
      const art = ART[ART_FOR[app.name]];
      if (art) {
        res.writeHead(200, { "content-type": "image/svg+xml" });
        return res.end(art);
      }
      res.writeHead(200, { "content-type": "image/png" });
      return res.end(iconPng(app.hue));
    }
    if (m && m[2] === "messages" && req.method === "GET") {
      const after = Number(url.searchParams.get("afterSeq") ?? 0);
      return json(res, 200, chats.get(app.id).filter((i) => i.seq > after));
    }
    if (m && m[2] === "messages" && req.method === "POST") {
      const body = await readBody(req);
      json(res, 202);
      void simulateTurn(app, String(body.text ?? ""));
      return;
    }
    return json(res, 404, { error: "Not found." });
  } catch (error) {
    return json(res, 500, { error: String(error?.message ?? error) });
  }
});

const wss = new WebSocketServer({ noServer: true });
server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url, "http://x");
  const token = bearer(req);
  const admin = isAdmin(token);
  if (!(url.pathname === "/ws" && (admin || isPhone(token))) && !(url.pathname === "/api/admin/events" && admin)) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    const entry = { ws, admin: url.pathname === "/api/admin/events" };
    sockets.add(entry);
    ws.send(JSON.stringify({ type: "hello", serverName: hostname(), protocol: 1 }));
    if (entry.admin) ws.send(JSON.stringify({ type: "admin.state", state: adminState() }));
    ws.on("close", () => sockets.delete(entry));
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`fake companion on http://127.0.0.1:${port} (pairing code ${code})`);
});
const stop = () => process.exit(0);
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
if (process.env.ANYAPP_STOP_ON_STDIN_END === "1") {
  process.stdin.on("end", () => {
    console.log("stdin closed: stopping");
    stop();
  });
  process.stdin.resume();
}
