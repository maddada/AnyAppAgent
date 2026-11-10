#!/usr/bin/env node
// The companion with the REAL builder and a REAL Claude Code session, end to end on the emulator:
//   1. create a small app through the API, wait for apk.ready, install the APK on the emulator
//      with adb, launch it and take a screenshot;
//   2. send a second prompt, see build 2 install over build 1 (versionCode 2), screenshot;
//   3. plant a real type error and ask for a rebuild: the build fails in seconds, the error goes
//      back to the agent, the next build succeeds, and the person sees one calm build row.
// GitHub off; its own port and state folder. Usage:
//   node scripts/real-build-check.mjs [--serial emulator-5560] [--shots C:\aa\e2e\shots\taskA]
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync, appendFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SERVER_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = resolve(SERVER_DIR, "..");
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const SERIAL = arg("--serial", "emulator-5560");
const SHOTS = arg("--shots", "C:\\aa\\e2e\\shots\\taskA");
const PORT = Number(arg("--port", "8790"));
const ROOT = arg("--root", `C:\\aa\\taskA-${Date.now().toString(36)}`);
const ADB = "D:\\tools\\android\\sdk\\platform-tools\\adb.exe";
const BASE = `http://127.0.0.1:${PORT}`;
mkdirSync(SHOTS, { recursive: true });
mkdirSync(ROOT, { recursive: true });
const t0 = Date.now();
const say = (...p) => {
  const line = `${((Date.now() - t0) / 1000).toFixed(0).padStart(5)}s ${p.join(" ")}`;
  console.log(line);
  appendFileSync(join(ROOT, "run.log"), `${line}\n`);
};
const adb = (...args) => spawnSync(ADB, ["-s", SERIAL, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
function shot(name) {
  const r = spawnSync(ADB, ["-s", SERIAL, "exec-out", "screencap", "-p"], { maxBuffer: 64 * 1024 * 1024 });
  const file = join(SHOTS, `${name}.png`);
  writeFileSync(file, r.stdout);
  say(`screenshot ${file}`);
}

// ---------- the emulator (shared: start-emulator.ps1 is idempotent)
const AVD = arg("--avd", SERIAL === "emulator-5562" ? "anyapp2" : "anyapp");
spawnSync("pwsh", ["-NoProfile", "-File", join(REPO, "scripts", "start-emulator.ps1"), "-Name", AVD], { stdio: "inherit" });
say(`emulator ${SERIAL}: ${adb("shell", "getprop", "sys.boot_completed").stdout.trim() === "1" ? "booted" : "NOT READY"}`);

// ---------- the companion: real builder, GitHub off
const server = spawn(process.execPath, [join(SERVER_DIR, "bin", "anyappagent.mjs")], {
  env: { ...process.env, ANYAPP_PORT: String(PORT), ANYAPP_STATE_DIR: join(ROOT, "state"), ANYAPP_BUILDER: "real", ANYAPP_GITHUB: "off" },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
for (const s of [server.stdout, server.stderr]) {
  s.on("data", (d) => {
    serverLog += d;
    appendFileSync(join(ROOT, "server.log"), d);
    for (const line of d.toString().split(/\r?\n/)) if (/^\[\d\d:|Android tools|build tools were not/.test(line.trim())) say(`  [server] ${line.trim()}`);
  });
}
const stop = () => {
  if (server.exitCode === null) spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" });
};
process.on("exit", stop);
for (let i = 0; i < 100; i++) {
  try {
    if ((await fetch(`${BASE}/api/health`)).ok) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 200));
}
const code = readFileSync(join(ROOT, "state", "pairing-code.txt"), "utf8").trim();
const { token } = await (await fetch(`${BASE}/api/pair`, { method: "POST", body: JSON.stringify({ code, deviceName: "taskA" }) })).json();
const H = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
const api = async (method, path, body) => {
  const res = await fetch(`${BASE}${path}`, { method, headers: H, body: body && JSON.stringify(body) });
  return res.status === 204 ? null : res.json();
};

// ---------- the socket: every build row text the person would see
const events = [];
const waiters = [];
const rowTexts = new Map();
const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws?token=${encodeURIComponent(token)}`);
ws.addEventListener("message", (m) => {
  const e = JSON.parse(m.data);
  events.push(e);
  if (e.type === "chat.item" && e.item.kind === "build") {
    const b = e.item.build;
    const line = `${b.status} #${b.number}: ${e.item.text || b.error || ""}`;
    if (rowTexts.get(e.item.id) !== line) say(`  build row ${e.item.id.slice(0, 6)} ${line}`);
    rowTexts.set(e.item.id, line);
  } else if (e.type === "chat.item" && e.item.kind === "assistant" && !e.item.streaming) {
    say(`  agent: ${e.item.text.replace(/\s+/g, " ").slice(0, 220)}`);
  } else if (e.type === "chat.item" && e.item.kind === "error") {
    say(`  error row: ${e.item.text}`);
  } else if (e.type === "apk.ready") {
    say(`  apk.ready #${e.app.latestApk.number} (${(e.app.latestApk.sizeBytes / 1048576).toFixed(1)} MB)`);
  }
  for (const w of [...waiters]) if (w.match(e)) waiters.splice(waiters.indexOf(w), 1), w.resolve(e);
});
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
const waitFor = (match, what, ms = 40 * 60_000) =>
  new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error(`timed out waiting for ${what}`)), ms);
    waiters.push({ match, resolve: (e) => (clearTimeout(timer), res(e)) });
  });
/** The next APK of this app, or a clear failure when its turn ends without one (idle or error after working). */
function nextApk(id, afterNumber, what, ms = 40 * 60_000) {
  let worked = false;
  return waitFor((e) => {
    if (e.type === "apk.ready" && e.app.id === id && e.app.latestApk.number > afterNumber) return true;
    if (e.type !== "app.updated" || e.app.id !== id) return false;
    if (e.app.status === "working" || e.app.status === "building") worked = true;
    else if (worked && (e.app.status === "idle" || e.app.status === "error")) return true;
    return false;
  }, what, ms).then(async (e) => {
    if (e.type !== "apk.ready") {
      // The companion announces "idle" a moment before apk.ready: give it a few seconds.
      await new Promise((r) => setTimeout(r, 3000));
      const ready = events.find((x) => x.type === "apk.ready" && x.app.id === id && x.app.latestApk.number > afterNumber);
      if (ready) return ready;
    }
    if (e.type !== "apk.ready") throw new Error(`${what}: the turn ended (${e.app.status}${e.app.error ? `: ${e.app.error}` : ""}) without a new APK`);
    return e;
  });
}

async function installAndLaunch(app, label) {
  const res = await fetch(`${BASE}/api/apps/${app.id}/apk`, { headers: H });
  const bytes = Buffer.from(await res.arrayBuffer());
  const sha = createHash("sha256").update(bytes).digest("hex");
  const file = join(ROOT, `${app.slug}-${app.latestApk.number}.apk`);
  writeFileSync(file, bytes);
  say(`downloaded ${file} (${bytes.length} bytes, sha256 ${sha === app.latestApk.sha256 ? "matches" : "MISMATCH"})`);
  const t = Date.now();
  const install = adb("install", "-r", file);
  say(`adb install -r: ${install.stdout.trim().split(/\r?\n/).at(-1)} (${Math.round((Date.now() - t) / 1000)} s)`);
  const version = adb("shell", "dumpsys", "package", app.packageName).stdout.match(/versionCode=(\d+)/)?.[1];
  say(`installed ${app.packageName} versionCode=${version}`);
  adb("shell", "am", "force-stop", app.packageName);
  const start = adb("shell", "monkey", "-p", app.packageName, "-c", "android.intent.category.LAUNCHER", "1");
  say(`launched: ${start.stdout.includes("Events injected: 1") ? "ok" : start.stdout.trim()}`);
  await new Promise((r) => setTimeout(r, 6000));
  const top = adb("shell", "dumpsys", "activity", "activities").stdout.match(/topResumedActivity=.*?\{[^}]*\s(\S+\/\S+)/)?.[1];
  say(`foreground: ${top}`);
  shot(label);
  return Number(version);
}

async function main() {
// ---------- 1. create (or, with --resume, continue the app made by an earlier run in --root)
let app;
let first;
let v1;
const existing = process.argv.includes("--resume") ? (await api("GET", "/api/apps")).find((a) => a.latestApk) : undefined;
if (existing) {
  app = existing;
  first = { app: existing };
  v1 = Number(adb("shell", "dumpsys", "package", app.packageName).stdout.match(/versionCode=(\d+)/)?.[1] ?? 0);
  say(`resuming ${app.slug}: latest APK #${app.latestApk.number}, installed versionCode ${v1}`);
} else {
  const createdAt = Date.now();
  app = await api("POST", "/api/apps", {
    name: "Tip Split",
    prompt: "A tip calculator. I type the bill amount and pick a tip of 10, 15 or 20 percent, and it shows the tip and the total. Keep it simple and quick.",
  });
  say(`created ${app.slug} (${app.packageName}); status ${app.status}`);
  first = await nextApk(app.id, 0, "build 1");
  say(`build 1 ready ${Math.round((Date.now() - createdAt) / 1000)} s after create`);
  v1 = await installAndLaunch(first.app, "1-first-version");
}

// ---------- 2. second prompt
let second = first;
if (!process.argv.includes("--fix-only")) {
const secondAt = Date.now();
await api("POST", `/api/apps/${app.id}/messages`, {
  text: existing
    ? "Make the Each pays amount a little bigger so it is easy to read."
    : "Add a way to split the total between a number of people, with plus and minus buttons, and show what each person pays.",
});
second = await nextApk(app.id, first.app.latestApk.number, "build 2");
say(`build ${second.app.latestApk.number} ready ${Math.round((Date.now() - secondAt) / 1000)} s after the second prompt`);
const v2 = await installAndLaunch(second.app, "2-second-version");
say(v2 > v1 ? `OK the update installed over the first version (versionCode ${v1} -> ${v2})` : `FAIL versionCode ${v1} -> ${v2}`);
}

// ---------- 3. a real type error: fails fast, goes back to the agent, one calm row
const appDir = join("C:\\aa\\apps", app.slug);
const screen = ["src/screens/HomeScreen.tsx", "src/App.tsx"].map((f) => join(appDir, f)).find(existsSync);
writeFileSync(screen, `${readFileSync(screen, "utf8")}\nexport const brokenOnPurpose: number = "this is not a number";\n`);
say(`planted a type error in ${screen}`);
const rowsBefore = new Set(rowTexts.keys());
const thirdAt = Date.now();
await api("POST", `/api/apps/${app.id}/build`);
const third = await nextApk(app.id, second.app.latestApk.number, "build after the fix", 20 * 60_000).catch((e) => ({ error: e.message }));
const newRows = [...rowTexts.keys()].filter((k) => !rowsBefore.has(k));
const errorRows = events.filter((e) => e.type === "chat.item" && e.item.kind === "error" && Date.parse(e.item.createdAt) >= thirdAt);
if (third.error) say(`FAIL ${third.error}`);
else {
  say(`fixed and rebuilt in ${Math.round((Date.now() - thirdAt) / 1000)} s; build rows shown for this cycle: ${newRows.length}; error rows: ${errorRows.length}`);
  const v3 = await installAndLaunch(third.app, "3-after-fix");
  say(`versionCode now ${v3}; ${readFileSync(screen, "utf8").includes("brokenOnPurpose: number = \"") ? "FAIL the error is still there" : "the agent fixed the planted error"}`);
}
ws.close();
stop();
say("done");
process.exit(0);
}
main().catch((error) => {
  say(`FAIL ${error.message}`);
  stop();
  process.exit(1);
});
