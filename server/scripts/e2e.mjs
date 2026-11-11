#!/usr/bin/env node
// End-to-end check of the PC companion against a REAL Claude Code ACP session and the fake
// builder (no Android toolchain, no GitHub). Usage: node scripts/e2e.mjs
//   1. start the server, pair, create an app, watch the socket until apk.ready, download the APK
//   2. send a second prompt, see a second build with a higher number
//   3. restart the server: same Claude session resumes, the history is still there
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, createWriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SERVER_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.E2E_PORT ?? 8797);
const BASE = `http://127.0.0.1:${PORT}`;
const ROOT = process.env.E2E_DIR ?? join(tmpdir(), `anyapp-e2e-${Date.now().toString(36)}`);
const STATE = join(ROOT, "state");
const APPS = join(ROOT, "apps");
const TURN_TIMEOUT_MS = 15 * 60_000;
mkdirSync(ROOT, { recursive: true });

const t0 = Date.now();
const stamp = () => `${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s`;
const say = (...parts) => console.log(stamp(), ...parts);
const short = (text, max = 110) => {
  const flat = String(text ?? "").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

let server;
let serverLog = "";

function startServer(label) {
  const out = createWriteStream(join(ROOT, `server-${label}.log`));
  server = spawn(process.execPath, [join(SERVER_DIR, "bin", "anyappagent.mjs")], {
    cwd: SERVER_DIR,
    env: {
      ...process.env,
      ANYAPP_PORT: String(PORT),
      ANYAPP_STATE_DIR: STATE,
      ANYAPP_APPS_DIR: APPS,
      ANYAPP_BUILDER: "fake",
      ANYAPP_GITHUB: "off",
      ANYAPP_FAKE_BUILD_MS: "1500",
      ANYAPP_COORDINATOR: "off", // this script checks the one-session flow; scripts/coordinator-e2e.mjs checks workers
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (const stream of [server.stdout, server.stderr]) {
    stream.on("data", (d) => {
      const text = d.toString();
      serverLog += text;
      out.write(text);
      for (const line of text.split(/\r?\n/)) {
        if (/^\[\d\d:\d\d:\d\d\]/.test(line)) say(`  [server] ${line.slice(11)}`);
      }
    });
  }
}

function stopServer() {
  if (!server || server.exitCode !== null) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" });
  else server.kill("SIGINT");
}

process.on("exit", stopServer);

async function waitForHealth() {
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return res.json();
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("server did not start");
}

let token = "";
async function api(method, path, body, headers = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return res;
}
async function json(method, path, body) {
  const res = await api(method, path, body);
  const data = res.status === 204 ? null : await res.json();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(data)}`);
  return data;
}

// ---- socket watcher
const events = [];
const waiters = [];
const printed = new Map();
function onEvent(event) {
  events.push(event);
  if (event.type === "app.updated") {
    const key = `app:${event.app.id}`;
    const line = `${event.app.status}${event.app.latestBuild ? ` build#${event.app.latestBuild.number}:${event.app.latestBuild.status}` : ""}`;
    if (printed.get(key) !== line) say(`app.updated  status=${line}`);
    printed.set(key, line);
  } else if (event.type === "chat.item") {
    const item = event.item;
    let line;
    if (item.kind === "tool") line = `tool  [${item.tool.status}] ${short(item.tool.title, 60)}${item.tool.detail ? ` (${short(item.tool.detail, 50)})` : ""}`;
    else if (item.kind === "build") line = `build #${item.build.number} ${item.build.status}${item.build.error ? `: ${item.build.error}` : ""}`;
    else if (item.kind === "plan") line = `plan  ${item.plan.map((p) => `[${p.status[0]}] ${short(p.content, 30)}`).join(" ")}`;
    else if (item.kind === "permission") line = `permission ${short(item.permission.title, 60)} -> ${item.permission.selectedOptionId ?? "waiting"}`;
    else if (item.streaming) line = null;
    else line = `${item.kind.padEnd(9)} ${short(item.text, 160)}`;
    if (line && printed.get(item.id) !== line) say(`chat.item #${item.seq} ${line}`);
    if (line) printed.set(item.id, line);
  } else if (event.type === "apk.ready") {
    say(`apk.ready    build #${event.app.latestApk.number} ${event.app.latestApk.sizeBytes} bytes sha256=${event.app.latestApk.sha256.slice(0, 12)}…`);
  } else if (event.type === "hello") {
    say(`hello from ${event.serverName} (protocol ${event.protocol})`);
  }
  for (const w of [...waiters]) {
    if (w.match(event)) {
      waiters.splice(waiters.indexOf(w), 1);
      w.resolve(event);
    }
  }
}
function waitFor(match, what, timeoutMs = TURN_TIMEOUT_MS) {
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${what}`)), timeoutMs);
    waiters.push({ match, resolve: (e) => (clearTimeout(timer), resolvePromise(e)) });
  });
}
async function openSocket() {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws?token=${encodeURIComponent(token)}`);
  ws.addEventListener("message", (m) => onEvent(JSON.parse(m.data)));
  await new Promise((r, j) => {
    ws.addEventListener("open", r, { once: true });
    ws.addEventListener("error", j, { once: true });
  });
  return ws;
}

async function downloadApk(app) {
  const res = await api("GET", `/api/apps/${app.id}/apk`);
  const bytes = Buffer.from(await res.arrayBuffer());
  const sha = createHash("sha256").update(bytes).digest("hex");
  const ok = res.status === 200 && bytes.length === app.latestApk.sizeBytes && sha === app.latestApk.sha256;
  const range = await api("GET", `/api/apps/${app.id}/apk`, undefined, { Range: "bytes=0-3" });
  const head = Buffer.from(await range.arrayBuffer());
  say(
    `GET /apk -> ${res.status} ${res.headers.get("content-type")} ${bytes.length} bytes, sha256 ${ok ? "matches" : "MISMATCH"}; ` +
      `Range bytes=0-3 -> ${range.status} ${range.headers.get("content-range")} ${JSON.stringify(head.toString("latin1"))}`,
  );
  if (!ok || range.status !== 206 || head.length !== 4) throw new Error("APK download check failed");
}

function check(condition, message) {
  if (!condition) throw new Error(`CHECK FAILED: ${message}`);
  say(`OK  ${message}`);
}

async function main() {
  say(`e2e dir ${ROOT}`);
  // ---------- 1. start, pair, create
  startServer("1");
  const health = await waitForHealth();
  say(`GET /api/health -> ${JSON.stringify(health)}`);
  const code = readFileSync(join(STATE, "pairing-code.txt"), "utf8").trim();
  const unauth = await fetch(`${BASE}/api/apps`);
  check(unauth.status === 401, `GET /api/apps without a token -> ${unauth.status}`);
  const pair = await fetch(`${BASE}/api/pair`, { method: "POST", body: JSON.stringify({ code, deviceName: "e2e phone" }) });
  token = (await pair.json()).token;
  check(pair.status === 200 && token.length > 20, `POST /api/pair with code from pairing-code.txt -> ${pair.status}, got a token`);
  let ws = await openSocket();

  const created = await json("POST", "/api/apps", {
    name: "Tap Counter",
    prompt:
      "A tiny counter app: one big button in the middle that adds 1, and the count shown above it. Keep it minimal and quick.",
  });
  say(`POST /api/apps -> status=${created.status} slug=${created.slug} package=${created.packageName}`);
  check(created.status === "creating", "create returns at once with status creating");
  const first = await waitFor((e) => e.type === "apk.ready" && e.app.id === created.id, "first apk.ready");
  await downloadApk(first.app);
  const icon = await api("GET", `/api/apps/${created.id}/icon`);
  const iconBytes = Buffer.from(await icon.arrayBuffer());
  say(`GET /icon -> ${icon.status} ${icon.headers.get("content-type")} ${iconBytes.length} bytes (iconVersion ${first.app.iconVersion})`);
  check(icon.status === 200 && iconBytes.subarray(1, 4).toString() === "PNG", "icon is a PNG");

  // ---------- 2. second prompt -> second build
  await json("POST", `/api/apps/${created.id}/messages`, { text: "Make the button green and add a small Reset button under it." });
  const second = await waitFor(
    (e) => e.type === "apk.ready" && e.app.id === created.id && e.app.latestApk.number > first.app.latestApk.number,
    "second apk.ready",
  );
  check(second.app.latestApk.number > first.app.latestApk.number, `second build #${second.app.latestApk.number} > first #${first.app.latestApk.number}`);
  await downloadApk(second.app);
  const historyBefore = await json("GET", `/api/apps/${created.id}/messages`);
  const sessionBefore = JSON.parse(readFileSync(join(STATE, "apps.json"), "utf8")).find((r) => r.app.id === created.id).sessionId;
  say(`history: ${historyBefore.length} chat items; Claude session ${sessionBefore}`);
  await new Promise((r) => setTimeout(r, 1000));
  ws.close();

  // ---------- 3. restart: same session resumes, history kept
  say("---- restarting the server ----");
  stopServer();
  await new Promise((r) => setTimeout(r, 1500));
  serverLog = "";
  startServer("2");
  await waitForHealth();
  ws = await openSocket();
  const apps = await json("GET", "/api/apps");
  const after = apps.find((a) => a.id === created.id);
  check(after && after.latestApk.number === second.app.latestApk.number, `app still listed after restart with latestApk #${after?.latestApk?.number}`);
  const historyAfter = await json("GET", `/api/apps/${created.id}/messages`);
  check(historyAfter.length === historyBefore.length, `history after restart has the same ${historyAfter.length} items`);
  const tail = await json("GET", `/api/apps/${created.id}/messages?afterSeq=${historyAfter.at(-3).seq}`);
  check(tail.length === 2, `GET messages?afterSeq returns only the newer items (${tail.length})`);

  const mark = events.length;
  const idleAgain = waitFor(
    (e) =>
      e.type === "app.updated" &&
      e.app.id === created.id &&
      e.app.status === "idle" &&
      events.slice(mark).some((x) => x.type === "app.updated" && x.app.id === created.id && x.app.status === "working"),
    "idle after the memory question",
  );
  await json("POST", `/api/apps/${created.id}/messages`, {
    text: "Do not change any files. In one sentence: what colour is the main button now, and what did I ask you to add last time?",
  });
  await idleAgain;
  const lastItems = await json("GET", `/api/apps/${created.id}/messages?afterSeq=${historyAfter.at(-1).seq}`);
  const answer = lastItems.filter((i) => i.kind === "assistant").map((i) => i.text).join(" ");
  say(`answer after restart: ${short(answer, 300)}`);
  const sessionAfter = JSON.parse(readFileSync(join(STATE, "apps.json"), "utf8")).find((r) => r.app.id === created.id).sessionId;
  check(sessionAfter === sessionBefore, `same Claude session id after restart (${sessionAfter})`);
  check(/session\/(resume|load) restored Claude Code session/.test(serverLog), "server log shows the session was restored, not recreated");
  check(/green/i.test(answer) && /reset/i.test(answer), "the agent remembers the earlier turns (green, Reset)");
  check(!lastItems.some((i) => i.kind === "build"), "no build after a turn that changed no files");
  ws.close();
  say("E2E PASSED");
}

main()
  .then(() => {
    stopServer();
    process.exit(0);
  })
  .catch((error) => {
    say(`E2E FAILED: ${error.message}`);
    stopServer();
    process.exit(1);
  });
