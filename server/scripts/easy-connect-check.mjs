#!/usr/bin/env node
// Proves Easy Connect without a phone. A real companion turns Easy Connect on (the Tailcat helper
// from %USERPROFILE%\.anyappagent\tools, installed there the Ghostex way when missing); a test
// client built from Ghostex's phone bridge (server/easy-connect/tailcat-bridge, cmd/ecclient) dials
// the address from the one-time code through the relay (TS_DEBUG_ALWAYS_USE_DERP forces every
// packet through Tailscale's public DERP relay, so nothing goes straight over localhost), pairs
// with the code, then fetches GET /api/apps and opens the WebSocket through the tunnel. It also
// checks that an unpaired client and an unpaired-again client are kept out.
// Usage: node scripts/easy-connect-check.mjs        (temp state dir, port 8795)
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SERVER_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { decodeEasyConnectCode } = await import(pathToFileURL(join(SERVER_DIR, "src", "easy-connect", "code.ts")).href);
const { ensureTailcat, ensureGoToolchain, goEnv } = await import(pathToFileURL(join(SERVER_DIR, "src", "easy-connect", "tailcat.ts")).href);

const PORT = Number(process.env.EC_CHECK_PORT ?? 8795);
const BASE = `http://127.0.0.1:${PORT}`;
const ROOT = join(tmpdir(), `anyapp-ec-${Date.now().toString(36)}`);
const ADMIN = randomBytes(32).toString("base64url");
const TOOLS = join(homedir(), ".anyappagent", "tools");
const EXE = process.platform === "win32" ? ".exe" : "";
mkdirSync(ROOT, { recursive: true });
const t0 = Date.now();
const say = (...p) => console.log(`${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s`, ...p);
let failures = 0;
const check = (ok, message) => {
  say(`${ok ? "OK  " : "FAIL"} ${message}`);
  if (!ok) failures++;
};
const children = [];
function killAll() {
  for (const child of children) {
    if (child.exitCode !== null || child.pid === undefined) continue;
    if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    else child.kill();
  }
}
process.on("exit", killAll);

// ---------- tools: the helper (Ghostex install method) and the bridge-based client
const paths = { toolsDir: TOOLS, dataDir: join(ROOT, "unused") };
const tailcat = await ensureTailcat(paths, (m) => say(`[install] ${m}`));
say(`helper: ${tailcat}`);
const bridgeDir = join(SERVER_DIR, "easy-connect", "tailcat-bridge");
const ecclient = join(TOOLS, "ecclient", `ecclient${EXE}`);
const newest = Math.max(...["bridge.go", "interfaces.go", join("cmd", "ecclient", "main.go")].map((f) => statSync(join(bridgeDir, f)).mtimeMs));
if (!existsSync(ecclient) || statSync(ecclient).mtimeMs < newest) {
  say("building the test client from the bridge (Ghostex tailcat-bridge) …");
  const go = await ensureGoToolchain(paths, (m) => say(`[go] ${m}`));
  const built = spawnSync(go, ["build", "-o", ecclient, "./cmd/ecclient"], { cwd: bridgeDir, env: goEnv(paths), encoding: "utf8" });
  if (built.status !== 0) throw new Error(`building ecclient failed: ${built.stderr}`);
}

// ---------- the companion
let serverLog = "";
function startServer() {
const server = spawn(process.execPath, [join(SERVER_DIR, "bin", "anyappagent.mjs")], {
  env: {
    ...process.env,
    ANYAPP_PORT: String(PORT),
    ANYAPP_STATE_DIR: join(ROOT, "state"),
    ANYAPP_APPS_DIR: join(ROOT, "apps"),
    ANYAPP_BUILDER: "fake",
    ANYAPP_GITHUB: "off",
    ANYAPP_ADMIN_TOKEN: ADMIN,
    ANYAPP_TAILCAT_BIN: tailcat,
  },
  stdio: ["ignore", "pipe", "pipe"],
});
children.push(server);
for (const s of [server.stdout, server.stderr]) {
  s.on("data", (d) => {
    serverLog += d;
    for (const line of d.toString().split(/\r?\n/)) if (/^\[\d\d:/.test(line)) say(`  [server] ${line.slice(11)}`);
  });
}
return server;
}
async function waitHealthy() {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
}
let server = startServer();
await waitHealthy();
const admin = (method, path, body) =>
  fetch(`${BASE}${path}`, { method, headers: { Authorization: `Bearer ${ADMIN}`, "Content-Type": "application/json" }, body: body && JSON.stringify(body) }).then((r) => r.json());

let state = await admin("POST", "/api/admin/easy-connect", { enabled: true });
say(`POST /api/admin/easy-connect {enabled:true} -> ${state.easyConnect.state}${state.easyConnect.detail ? ` (${state.easyConnect.detail})` : ""}`);
for (let i = 0; i < 600 && !(state.easyConnect.state === "ready" && state.easyConnect.code); i++) {
  await new Promise((r) => setTimeout(r, 200));
  state = await admin("GET", "/api/admin/state");
  if (state.easyConnect.state === "error") break;
}
check(state.easyConnect.state === "ready" && !!state.easyConnect.code, `Easy Connect ready: ${state.easyConnect.error ?? "code issued"}`);
const codeText = state.easyConnect.code;
const code = decodeEasyConnectCode(codeText);
check(!!code && code.port === PORT, `code ${codeText.slice(0, 11)}… (${codeText.length} chars, expires ${state.easyConnect.expiresAt}) decodes: port ${code?.port}, name "${code?.name}", address ${code?.address.length} chars, secret ${code?.secret.length} chars`);
check(!serverLog.includes(code.address) && !serverLog.includes(code.secret) && !serverLog.includes(ADMIN), "neither the address, the secret nor the admin token is in the companion's log");

// ---------- the phone stand-in, through the relay only
function startClient(label, keyFile) {
  const child = spawn(ecclient, ["--key", keyFile, "--port", String(code.port)], {
    env: { ...process.env, TS_DEBUG_ALWAYS_USE_DERP: "true" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  children.push(child);
  const waiters = [];
  const seen = [];
  let stderr = "";
  child.stderr.on("data", (d) => (stderr = (stderr + d).slice(-20000)));
  child.stdout.on("data", (d) => {
    for (const line of d.toString().split(/\r?\n/).filter(Boolean)) {
      seen.push(line);
      for (const w of [...waiters]) if (w.re.test(line)) waiters.splice(waiters.indexOf(w), 1), w.resolve(line);
    }
  });
  child.stdin.write(`${code.address}\n`);
  const next = (re, ms = 60_000) =>
    new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => reject(new Error(`${label}: no ${re} within ${ms} ms; stderr tail: ${stderr.slice(-600)}`)), ms);
      waiters.push({ re, resolve: (l) => (clearTimeout(timer), resolvePromise(l)) });
    });
  return { child, next, seen, send: (line) => child.stdin.write(`${line}\n`), stderr: () => stderr };
}

const phone = startClient("phone", join(ROOT, "phone.key"));
const clientKey = (await phone.next(/^CLIENTKEY /)).split(" ")[1];
let first = await phone.next(/^(LOCALPORT|ERROR) /);
check(first.startsWith("LOCALPORT"), `phone stand-in dialed the Easy Connect address (TS_DEBUG_ALWAYS_USE_DERP=true): ${first}`);
let tunnel = `http://127.0.0.1:${first.split(" ")[1]}`;
const path = await phone.next(/^PATH /, 30_000).catch(() => "PATH (not measured)");
say(`link: ${path}`);
check(/"path":"relay"/.test(path), "the link runs through the DERP relay, not a direct path");

let res = await fetch(`${tunnel}/api/health`);
check(res.ok, `through the tunnel: GET /api/health -> ${res.status} ${JSON.stringify(await res.json())}`);
res = await fetch(`${tunnel}/api/apps`);
check(res.status === 401, `through the tunnel without a token: GET /api/apps -> ${res.status}`);
res = await fetch(`${tunnel}/api/pair/easy-connect`, { method: "POST", body: JSON.stringify({ secret: "wrong", deviceName: "x", clientKey }) });
check(res.status === 401, `pairing with a wrong secret -> ${res.status}`);
res = await fetch(`${tunnel}/api/pair/easy-connect`, { method: "POST", body: JSON.stringify({ secret: code.secret, deviceName: "Tunnel test phone", clientKey }) });
const paired = await res.json();
check(res.status === 200 && typeof paired.token === "string", `POST /api/pair/easy-connect with the code's secret -> ${res.status}, token received, serverName "${paired.serverName}"`);
res = await fetch(`${tunnel}/api/pair/easy-connect`, { method: "POST", body: JSON.stringify({ secret: code.secret, deviceName: "again", clientKey }) });
check(res.status === 401, `the same code a second time -> ${res.status} (single use)`);

// The helper restarts with the phone's key on the allow-list; the phone reconnects (StartForward again).
for (let i = 0; i < 100 && !/allowListRestored/.test(serverLog); i++) await new Promise((r) => setTimeout(r, 100));
check(/allowListRestored; 1 device\(s\) allowed/.test(serverLog), "helper restarted with the allow-list holding exactly the new phone");
await new Promise((r) => setTimeout(r, 1500));
phone.send("reconnect");
const again = await phone.next(/^(LOCALPORT|ERROR) /, 60_000);
check(again.startsWith("LOCALPORT"), `paired phone reconnects through the relay: ${again}`);
tunnel = `http://127.0.0.1:${again.split(" ")[1]}`;
const auth = { Authorization: `Bearer ${paired.token}` };
res = await fetch(`${tunnel}/api/apps`, { headers: auth });
check(res.status === 200, `through the tunnel with the token: GET /api/apps -> ${res.status} ${JSON.stringify(await res.json())}`);
const ws = new WebSocket(`${tunnel.replace("http", "ws")}/ws?token=${encodeURIComponent(paired.token)}`);
const hello = await new Promise((r, j) => {
  ws.addEventListener("message", (m) => r(JSON.parse(m.data)), { once: true });
  ws.addEventListener("error", () => j(new Error("ws failed")), { once: true });
});
check(hello.type === "hello", `through the tunnel: WebSocket /ws -> ${JSON.stringify(hello)}`);
const socketEvents = [];
ws.addEventListener("message", (m) => socketEvents.push(JSON.parse(m.data)));
const created = await (await fetch(`${tunnel}/api/apps`, { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ name: "Tunnel App", prompt: "x" }) })).json();
for (let i = 0; i < 50 && !socketEvents.some((e) => e.type === "chat.item"); i++) await new Promise((r) => setTimeout(r, 100));
const event = socketEvents.find((e) => e.type === "app.updated" && e.app.id === created.id);
check(!!event && socketEvents.some((e) => e.type === "chat.item" && e.item.appId === created.id),
  `through the tunnel: POST /api/apps, then app.updated (${event?.app.status}) and the user's chat.item arrive on the socket`);
await fetch(`${tunnel}/api/apps/${created.id}`, { method: "DELETE", headers: auth });
state = await admin("GET", "/api/admin/state");
const device = state.devices.find((d) => d.name === "Tunnel test phone");
check(device?.connected === true && device?.via === "easy-connect", `admin state lists "Tunnel test phone" as connected, via "${device?.via}"`);

// ---------- a companion restart: Easy Connect comes back for paired phones, with no code
ws.close();
if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" });
else server.kill();
await new Promise((r) => setTimeout(r, 1500));
serverLog = "";
server = startServer();
await waitHealthy();
for (let i = 0; i < 150; i++) {
  state = await admin("GET", "/api/admin/state");
  if (state.easyConnect.state === "ready") break;
  await new Promise((r) => setTimeout(r, 200));
}
check(
  state.easyConnect.state === "ready" && !state.easyConnect.code && /1 device\(s\) allowed/.test(serverLog) && !/pairing window open/.test(serverLog),
  `after a restart Easy Connect is back on (${state.easyConnect.state}) with no code, serving only the paired phone`,
);
await new Promise((r) => setTimeout(r, 1000));
phone.send("reconnect");
const afterRestart = await phone.next(/^(LOCALPORT|ERROR) /, 90_000);
check(afterRestart.startsWith("LOCALPORT"), `the paired phone reconnects after the restart: ${afterRestart}`);
if (afterRestart.startsWith("LOCALPORT")) {
  res = await fetch(`http://127.0.0.1:${afterRestart.split(" ")[1]}/api/apps`, { headers: auth });
  check(res.status === 200, `through the tunnel after the restart: GET /api/apps -> ${res.status}`);
}

// ---------- only paired devices get in
const stranger = startClient("stranger", join(ROOT, "stranger.key"));
await stranger.next(/^CLIENTKEY /);
const strangerResult = await stranger.next(/^(LOCALPORT|ERROR) /, 90_000);
let strangerIn = false;
if (strangerResult.startsWith("LOCALPORT")) {
  strangerIn = await fetch(`http://127.0.0.1:${strangerResult.split(" ")[1]}/api/health`, { signal: AbortSignal.timeout(15_000) }).then(() => true, () => false);
}
check(!strangerIn, `a client whose key is not on the allow-list cannot reach the companion (${strangerResult.slice(0, 120)})`);

// The phone disconnects itself, through the tunnel, as the app's Disconnect button does.
const tunnelNow = afterRestart.startsWith("LOCALPORT") ? `http://127.0.0.1:${afterRestart.split(" ")[1]}` : tunnel;
res = await fetch(`${tunnelNow}/api/unpair`, { method: "POST", headers: auth });
check(res.status === 204, `the phone disconnects itself: POST /api/unpair through the tunnel -> ${res.status}`);
state = await admin("GET", "/api/admin/state");
check(!state.devices.some((d) => d.id === device.id), "the PC no longer lists it");
for (let i = 0; i < 100 && !/allowListChanged; no devices allowed yet/.test(serverLog); i++) await new Promise((r) => setTimeout(r, 100));
await new Promise((r) => setTimeout(r, 1500));
phone.send("reconnect");
const after = await phone.next(/^(LOCALPORT|ERROR) /, 90_000);
let stillIn = false;
if (after.startsWith("LOCALPORT")) {
  stillIn = await fetch(`http://127.0.0.1:${after.split(" ")[1]}/api/health`, { signal: AbortSignal.timeout(15_000) }).then(() => true, () => false);
}
check(!stillIn, `after unpairing, the same phone cannot reach the companion any more (${after.slice(0, 120)})`);

state = await admin("POST", "/api/admin/pairing/new");
check(
  !!state.easyConnect.code && state.easyConnect.code !== codeText && /allowListLiftedForPairing; pairing window open/.test(serverLog),
  "POST /api/admin/pairing/new makes a fresh Easy Connect code and opens the pairing window",
);

// ---------- the same-network path is untouched; turning Easy Connect off stops the helper
const lanCode = state.pairing.code;
res = await fetch(`${BASE}/api/pair`, { method: "POST", body: JSON.stringify({ code: lanCode, deviceName: "LAN phone" }) });
check(res.status === 200, `same-network pairing with the 6-digit code still works -> ${res.status}`);
state = await admin("POST", "/api/admin/easy-connect", { enabled: false });
await new Promise((r) => setTimeout(r, 1000));
check(
  state.easyConnect.state === "off" && !existsSync(join(ROOT, "state", "easy-connect", "helper.pid")),
  `POST /api/admin/easy-connect {enabled:false} -> ${state.easyConnect.state}, helper stopped`,
);
phone.child.stdin.end();
stranger.child.stdin.end();
killAll();
say(failures === 0 ? "EASY CONNECT CHECK PASSED" : `EASY CONNECT CHECK FAILED (${failures})`);
process.exit(failures === 0 ? 0 : 1);
