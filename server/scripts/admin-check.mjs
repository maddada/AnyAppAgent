#!/usr/bin/env node
// Checks the desktop app's admin contract (shared/protocol.ts "Desktop app to companion") against
// a real companion process: ANYAPP_ADMIN_TOKEN, /api/admin/*, the admin events socket, devices with
// lastSeenAt and connected, unpairing, and GET /download/anyappagent.apk.
// Usage: node scripts/admin-check.mjs   (temp state dir, port 8796, no Claude session needed)
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SERVER_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.ADMIN_CHECK_PORT ?? 8796);
const BASE = `http://127.0.0.1:${PORT}`;
const ROOT = join(tmpdir(), `anyapp-admin-${Date.now().toString(36)}`);
const ADMIN = randomBytes(32).toString("base64url");
mkdirSync(ROOT, { recursive: true });
const hostApk = join(ROOT, "anyappagent.apk");
writeFileSync(hostApk, Buffer.concat([Buffer.from("PK\u0003\u0004"), randomBytes(1000)]));

let server;
function start(withApk) {
  server = spawn(process.execPath, [join(SERVER_DIR, "bin", "anyappagent.mjs")], {
    env: {
      ...process.env,
      ANYAPP_PORT: String(PORT),
      ANYAPP_STATE_DIR: join(ROOT, "state"),
      ANYAPP_APPS_DIR: join(ROOT, "apps"),
      ANYAPP_BUILDER: "fake",
      ANYAPP_GITHUB: "off",
      ANYAPP_ADMIN_TOKEN: ADMIN,
      ...(withApk ? { ANYAPP_HOST_APK: hostApk } : { ANYAPP_HOST_APK: "" }),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  server.stdout.on("data", (d) => (out += d));
  server.stderr.on("data", (d) => (out += d));
  return () => out;
}
function stop() {
  if (!server || server.exitCode !== null) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" });
  else server.kill();
}
process.on("exit", stop);
async function up() {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error("server did not start");
}
const call = (method, path, token, body) =>
  fetch(`${BASE}${path}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
let failures = 0;
function check(ok, message) {
  console.log(`${ok ? "OK  " : "FAIL"} ${message}`);
  if (!ok) failures++;
}

const output = start(true);
await up();
let res = await call("GET", "/api/admin/state");
check(res.status === 401, `GET /api/admin/state without a token -> ${res.status}`);
let state = await (await call("GET", "/api/admin/state", ADMIN)).json();
check(/^\d{6}$/.test(state.pairing.code) && state.port === PORT && state.easyConnect.state === "off" && Array.isArray(state.devices),
  `admin state: code ${state.pairing.code}, ${state.pairing.lanUrls.length} LAN urls, qrPayload ${state.pairing.qrPayload.slice(0, 40)}…, easyConnect ${state.easyConnect.state}`);
check(!output().includes(ADMIN), "the admin token never appears in the companion's output");
res = await call("GET", "/api/apps", ADMIN);
check(res.status === 200, `the admin token works on phone routes too (GET /api/apps -> ${res.status})`);

const events = [];
const adminWs = new WebSocket(`ws://127.0.0.1:${PORT}/api/admin/events?token=${encodeURIComponent(ADMIN)}`);
adminWs.addEventListener("message", (m) => events.push(JSON.parse(m.data)));
await new Promise((r) => adminWs.addEventListener("open", r, { once: true }));
const badWs = new WebSocket(`ws://127.0.0.1:${PORT}/api/admin/events?token=nope`);
const badClosed = await new Promise((r) => {
  badWs.addEventListener("error", () => r(true), { once: true });
  badWs.addEventListener("open", () => r(false), { once: true });
});
check(badClosed, "admin events socket refuses a wrong token");

const code = readFileSync(join(ROOT, "state", "pairing-code.txt"), "utf8").trim();
check(code === state.pairing.code, "pairing-code.txt matches the admin state's code");
const pair = await (await call("POST", "/api/pair", undefined, { code, deviceName: "Test phone" })).json();
res = await call("GET", "/api/admin/state", pair.token);
check(res.status === 401, `a phone token is refused on /api/admin/* (${res.status})`);
const phoneWs = new WebSocket(`ws://127.0.0.1:${PORT}/ws?token=${encodeURIComponent(pair.token)}`);
await new Promise((r) => phoneWs.addEventListener("open", r, { once: true }));
await new Promise((r) => setTimeout(r, 300));
state = await (await call("GET", "/api/admin/state", ADMIN)).json();
const device = state.devices.find((d) => d.name === "Test phone");
check(device && device.connected === true && typeof device.lastSeenAt === "string" && typeof device.id === "string",
  `paired device listed: ${JSON.stringify(device)}`);
const pushed = events.filter((e) => e.type === "admin.state").at(-1);
check(events[0]?.type === "hello" && pushed?.state.devices.some((d) => d.name === "Test phone" && d.connected),
  `admin events: hello, then admin.state pushed when the phone connected (${events.length} events)`);

const before = state.pairing.code;
state = await (await call("POST", "/api/admin/pairing/new", ADMIN)).json();
check(state.pairing.code !== before && readFileSync(join(ROOT, "state", "pairing-code.txt"), "utf8").trim() === state.pairing.code,
  `POST /api/admin/pairing/new rotates the code (${before} -> ${state.pairing.code})`);
res = await call("POST", "/api/pair", undefined, { code: before, deviceName: "late" });
check(res.status === 401, `the old code no longer pairs (${res.status})`);

res = await call("POST", "/api/admin/easy-connect", ADMIN, { enabled: "yes" });
check(res.status === 400, `POST /api/admin/easy-connect with a non-boolean -> ${res.status}`);

const phoneClosed = new Promise((r) => phoneWs.addEventListener("close", (e) => r(e.code), { once: true }));
res = await call("DELETE", `/api/admin/devices/${device.id}`, ADMIN);
check(res.status === 204, `DELETE /api/admin/devices/:id -> ${res.status}`);
check((await phoneClosed) === 4001, "the unpaired phone's socket is closed");
res = await call("GET", "/api/apps", pair.token);
check(res.status === 401, `the unpaired phone's token stops working at once (${res.status})`);
res = await call("DELETE", `/api/admin/devices/${device.id}`, ADMIN);
check(res.status === 404, `unpairing it again -> ${res.status}`);
check(device.via === "same-network", `a phone paired with the 6-digit code is listed with via "${device.via}"`);

// ---------- the phone disconnects itself: POST /api/unpair
const pairWith = async (deviceName) => {
  const code = (await (await call("GET", "/api/admin/state", ADMIN)).json()).pairing.code;
  return (await (await call("POST", "/api/pair", undefined, { code, deviceName })).json()).token;
};
const listed = async () => (await (await call("GET", "/api/admin/state", ADMIN)).json()).devices;
const leaver = await pairWith("Leaving phone");
const leaverWs = new WebSocket(`ws://127.0.0.1:${PORT}/ws?token=${encodeURIComponent(leaver)}`);
await new Promise((r) => leaverWs.addEventListener("open", r, { once: true }));
const leaverClosed = new Promise((r) => leaverWs.addEventListener("close", (e) => r(e.code), { once: true }));
const eventsBefore = events.length;
res = await call("POST", "/api/unpair", leaver);
check(res.status === 204, `POST /api/unpair with the phone's own token -> ${res.status}`);
check((await leaverClosed) === 4001, "its socket is closed at once");
res = await call("GET", "/api/apps", leaver);
check(res.status === 401, `its token stops working at once (${res.status})`);
await new Promise((r) => setTimeout(r, 300));
check(!(await listed()).some((d) => d.name === "Leaving phone"), "the PC no longer lists it");
check(events.slice(eventsBefore).some((e) => e.type === "admin.state" && !e.state.devices.some((d) => d.name === "Leaving phone")), "the desktop got an admin.state without it");
res = await call("POST", "/api/unpair", leaver);
check(res.status === 401, `POST /api/unpair again -> ${res.status}`);
res = await call("POST", "/api/unpair", ADMIN);
check(res.status === 400, `POST /api/unpair with the admin token -> ${res.status}`);

// ---------- pairing again under the same name replaces the old entry, unless it is connected
await pairWith("Pixel 7");
const second = await pairWith("Pixel 7");
let twins = (await listed()).filter((d) => d.name === "Pixel 7");
check(twins.length === 1, `pairing again as "Pixel 7" while the old one is not connected leaves ${twins.length} entry`);
const secondWs = new WebSocket(`ws://127.0.0.1:${PORT}/ws?token=${encodeURIComponent(second)}`);
await new Promise((r) => secondWs.addEventListener("open", r, { once: true }));
await pairWith("pixel 7 ");
twins = (await listed()).filter((d) => d.name.toLowerCase() === "pixel 7");
check(twins.length === 2, `a third pairing while the second is connected keeps both (${twins.length}), so a live phone is never cut off`);
secondWs.close();

// ---------- names are cleaned
await pairWith(`  Sam\u0000sung\t\u200bGalaxy   ${"X".repeat(200)}  `);
const cleaned = (await listed()).find((d) => d.name.startsWith("Sam"));
check(cleaned && cleaned.name.length <= 60 && !/[\u0000-\u001f\u200b]/.test(cleaned.name) && cleaned.name.startsWith("Sam sung Galaxy X"), `a messy name is cleaned: "${cleaned?.name}" (${cleaned?.name.length} chars)`);
await pairWith("   ");
check((await listed()).some((d) => d.name === "Phone"), 'an empty name becomes "Phone"');

res = await fetch(`${BASE}/download/anyappagent.apk`);
const apk = Buffer.from(await res.arrayBuffer());
check(res.status === 200 && res.headers.get("content-type") === "application/vnd.android.package-archive" && apk.length === 1004,
  `GET /download/anyappagent.apk without a token -> ${res.status} ${apk.length} bytes`);
adminWs.close();
stop();
await new Promise((r) => setTimeout(r, 800));
start(false);
await up();
res = await fetch(`${BASE}/download/anyappagent.apk`);
const body = await res.json();
check(res.status === 404 && typeof body.error === "string", `without ANYAPP_HOST_APK -> ${res.status} "${body.error}"`);
stop();
console.log(failures === 0 ? "ADMIN CHECK PASSED" : `ADMIN CHECK FAILED (${failures})`);
process.exit(failures === 0 ? 0 : 1);
