#!/usr/bin/env node
// Proves the APK delivery fixes against a real companion (own port, own state folder, fake builder
// serving real APKs made with app/dev/make-test-apk.mjs), without a phone:
//   1. a build cut off by a hard stop of the companion is built again by itself after the restart;
//   2. GET /apk?abi= serves the smaller per-ABI APK; Range + If-Range resumes it, a stale If-Range
//      gets the whole file (200);
//   3. a download dropped halfway closes its file on the PC (it used to stay open for good);
//   4. with --easy-connect: while a download runs through the Easy Connect tunnel, codes expire and
//      a new one is asked for at once (New code in the popup) without the helper restarting or the download
//      dropping. Uses an existing tailcat (ANYAPP_TAILCAT_BIN, else %USERPROFILE%\.anyappagent\tools).
//   5. with --helper: a helper (coordinator mode) that was building when the companion stopped
//      lands and builds again by itself after the restart, with no agent turn first.
// Usage: node scripts/download-check.mjs [--easy-connect] [--helper]   (port 8797, state in C:\aa\fsd\dl)
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SERVER_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = resolve(SERVER_DIR, "..");
const PORT = Number(process.env.DL_CHECK_PORT ?? 8807);
const BASE = `http://127.0.0.1:${PORT}`;
const ROOT = process.env.DL_CHECK_DIR ?? (process.platform === "win32" ? "C:\\aa\\fsd\\dl" : join(homedir(), "aa", "fsd", "dl"));
const ADMIN = randomBytes(24).toString("base64url");
const PKG = "com.anyappagent.mock.bigdl";
const APP_ID = "bigdl-app";
const withEasyConnect = process.argv.includes("--easy-connect");
const withHelper = process.argv.includes("--helper");
let coordinator = "off";
const t0 = Date.now();
const say = (...p) => console.log(`${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s`, ...p);
let failures = 0;
const check = (ok, message) => {
  say(`${ok ? "OK  " : "FAIL"} ${message}`);
  if (!ok) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (buf) => createHash("sha256").update(buf).digest("hex");

// ---------- real APKs for the fake builder: build N = full (24 MB) + x86_64 and arm64-v8a (12 MB)
rmSync(ROOT, { recursive: true, force: true });
const apkDir = join(ROOT, "apks-ready");
mkdirSync(apkDir, { recursive: true });
say("making real test APKs (app/dev/make-test-apk.mjs)…");
for (const n of [1, 2]) {
  for (const [suffix, pad] of [["", 24], ["-x86_64", 12], ["-arm64-v8a", 11]]) {
    const out = join(apkDir, `${PKG}-${n}${suffix}.apk`);
    const r = spawnSync(process.execPath, [join(REPO, "app", "dev", "make-test-apk.mjs"), "--package", PKG, "--label", "Big Download", "--version", String(n), "--pad-mb", String(pad), "--out", out], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(`make-test-apk failed: ${r.stderr}`);
  }
}

// ---------- a ready app in the companion's own state folder (no agent needed to build it)
const state = join(ROOT, "state");
const appDir = join(ROOT, "apps", "bigdl");
mkdirSync(appDir, { recursive: true });
mkdirSync(state, { recursive: true });
writeFileSync(join(appDir, "app.json"), JSON.stringify({ expo: { name: "Big Download", slug: "bigdl", android: { package: PKG } } }, null, 2));
writeFileSync(join(appDir, "package.json"), JSON.stringify({ name: "bigdl", version: "1.0.0", private: true }));
spawnSync("git", ["init", "-q"], { cwd: appDir });
spawnSync("git", ["-c", "user.name=check", "-c", "user.email=check@example.invalid", "commit", "-q", "--allow-empty", "-m", "start"], { cwd: appDir });
const now = new Date().toISOString();
writeFileSync(
  join(state, "apps.json"),
  JSON.stringify([{ app: { id: APP_ID, name: "Big Download", slug: "bigdl", packageName: PKG, status: "idle", iconVersion: 1, createdAt: now, updatedAt: now }, dir: appDir, ready: true }], null, 1),
);

// ---------- the companion
let log = "";
let server;
const tailcat = process.env.ANYAPP_TAILCAT_BIN ?? join(homedir(), ".anyappagent", "tools", "tailcat", `tailcat${process.platform === "win32" ? ".exe" : ""}`);
function startServer() {
  server = spawn(process.execPath, [join(SERVER_DIR, "bin", "anyappagent.mjs")], {
    env: {
      ...process.env,
      ANYAPP_PORT: String(PORT),
      ANYAPP_STATE_DIR: state,
      ANYAPP_APPS_DIR: join(ROOT, "apps"),
      ANYAPP_BUILDER: "fake",
      ANYAPP_FAKE_BUILD_MS: "12000",
      ANYAPP_FAKE_APK_DIR: apkDir,
      ANYAPP_GITHUB: "off",

      ANYAPP_PLAN_FIRST: "off", // the script expects a build right after the first prompt (docs/PAGES.md)
      ANYAPP_COORDINATOR: coordinator,
      ANYAPP_ADMIN_TOKEN: ADMIN,
      ANYAPP_TAILCAT_BIN: tailcat,
      ANYAPP_EC_CODE_TTL_MS: "20000",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (const s of [server.stdout, server.stderr]) s.on("data", (d) => (log += d));
}
function killServer() {
  if (server?.exitCode === null) spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" });
}
process.on("exit", () => {
  killServer();
  ecclient?.kill();
});
async function waitHealthy() {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return;
    } catch {}
    await sleep(200);
  }
  throw new Error(`companion did not start:\n${log}`);
}
const admin = (path, method = "GET", body) =>
  fetch(`${BASE}${path}`, { method, headers: { Authorization: `Bearer ${ADMIN}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }).then((r) => r.json());

startServer();
await waitHealthy();
say(`companion on ${PORT}, state ${state}`);
const code = (await admin("/api/admin/state")).pairing.code;
const paired = await (await fetch(`${BASE}/api/pair`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, deviceName: "Proof client" }) })).json();
const auth = { Authorization: `Bearer ${paired.token}` };
const getApp = () => fetch(`${BASE}/api/apps/${APP_ID}`, { headers: auth }).then((r) => r.json());

// ---------- 1. a build cut off by a restart is built again by itself
await fetch(`${BASE}/api/apps/${APP_ID}/build`, { method: "POST", headers: auth });
for (let i = 0; i < 50 && (await getApp()).latestBuild?.status !== "running"; i++) await sleep(100);
check((await getApp()).latestBuild?.status === "running", "build 1 is running");
await sleep(4000);
killServer();
say("companion killed halfway through build 1 (like the desktop app quitting); starting it again");
await sleep(1000);
startServer();
await waitHealthy();
let app = await getApp();
check(app.latestBuild?.number === 2 && app.latestBuild?.status === "running", `after the restart build ${app.latestBuild?.number} is ${app.latestBuild?.status} without anyone asking`);
check(/the PC restarted during build 1; building again/.test(log), 'log: "the PC restarted during build 1; building again"');
for (let i = 0; i < 300 && (app = await getApp()).latestApk?.number !== 2; i++) await sleep(200);
check(app.latestApk?.number === 2 && app.latestApk.variants?.length === 2, `build 2 succeeded: full ${app.latestApk?.sizeBytes} bytes, variants ${app.latestApk?.variants?.map((v) => `${v.abi} ${v.sizeBytes}`).join(", ")}`);
const chat = await fetch(`${BASE}/api/apps/${APP_ID}/messages`, { headers: auth }).then((r) => r.json());
const cut = chat.find((i) => i.build?.number === 1);
check(cut?.build?.status === "failed" && /building again/.test(cut.build.error), `build 1's card says: "${cut?.build?.error}"`);

// ---------- 2. per-ABI APK, Range and If-Range
const x86 = app.latestApk.variants.find((v) => v.abi === "x86_64");
const whole = Buffer.from(await (await fetch(`${BASE}/api/apps/${APP_ID}/apk?abi=x86_64`, { headers: auth })).arrayBuffer());
check(whole.length === x86.sizeBytes && sha(whole) === x86.sha256, `?abi=x86_64 serves the x86_64 APK (${whole.length} bytes, checksum matches) instead of the full ${app.latestApk.sizeBytes}`);
const full = Buffer.from(await (await fetch(`${BASE}/api/apps/${APP_ID}/apk?abi=mips`, { headers: auth })).arrayBuffer());
check(full.length === app.latestApk.sizeBytes, `an ABI without a variant gets the full APK (${full.length} bytes)`);
const from = 5_000_000;
const part = await fetch(`${BASE}/api/apps/${APP_ID}/apk?abi=x86_64`, { headers: { ...auth, Range: `bytes=${from}-`, "If-Range": `"${x86.sha256}"` } });
const tail = Buffer.from(await part.arrayBuffer());
check(part.status === 206 && tail.equals(whole.subarray(from)), `Range from ${from} with the right If-Range -> ${part.status}, ${part.headers.get("content-range")}, bytes match`);
const stale = await fetch(`${BASE}/api/apps/${APP_ID}/apk?abi=x86_64`, { headers: { ...auth, Range: `bytes=${from}-`, "If-Range": '"an-older-build"' } });
check(stale.status === 200 && Buffer.from(await stale.arrayBuffer()).length === x86.sizeBytes, `Range with a stale If-Range -> ${stale.status}, the whole file (never two builds mixed)`);

// ---------- 3. a download dropped halfway closes its file
const fullPath = join(state, "apks", APP_ID, "build-2.apk");
await new Promise((done) => {
  const req = request(`${BASE}/api/apps/${APP_ID}/apk`, { headers: auth }, (res) => {
    let got = 0;
    res.on("data", (chunk) => {
      got += chunk.length;
      if (got > 3_000_000) {
        req.destroy();
        done();
      }
    });
  });
  req.end();
});
await sleep(1500);
check(/downloading bigdl-2\.apk: stopped at/.test(log), `log: "${log.match(/Proof client downloading bigdl-2\.apk: stopped at[^\n]*/)?.[0]}"`);
check(!fileIsOpen(fullPath), "after the drop the companion no longer holds build-2.apk open");

/** True when another process holds the file open (Windows: an exclusive open fails). */
function fileIsOpen(path) {
  if (process.platform !== "win32") return false;
  const ps = `try { $s=[System.IO.File]::Open('${path}','Open','Read','None'); $s.Close(); 'free' } catch { 'open' }`;
  return spawnSync("powershell", ["-NoProfile", "-Command", ps], { encoding: "utf8" }).stdout.trim() === "open";
}

// ---------- 4. code renewals do not restart the helper or drop a download in the tunnel
let ecclient;
if (withEasyConnect) {
  if (!existsSync(tailcat)) throw new Error(`no tailcat at ${tailcat}`);
  const { decodeEasyConnectCode } = await import(new URL("../src/easy-connect/code.ts", import.meta.url).href);
  let st = await admin("/api/admin/easy-connect", "POST", { enabled: true });
  for (let i = 0; i < 100 && st.easyConnect.state !== "ready"; i++) {
    await sleep(300);
    st = await admin("/api/admin/state");
  }
  await sleep(1500);
  st = await admin("/api/admin/state");
  check(st.easyConnect.state === "ready" && !st.easyConnect.code, "turning Easy Connect on makes no code by itself");
  st = await admin("/api/admin/pairing/new", "POST", {}); // the pairing popup opens
  const ec = decodeEasyConnectCode(st.easyConnect.code ?? "");
  check(!!ec, "the popup's POST /api/admin/pairing/new issues the code");
  const bin = join(homedir(), ".anyappagent", "tools", "ecclient", `ecclient${process.platform === "win32" ? ".exe" : ""}`);
  ecclient = spawn(bin, ["--key", join(ROOT, "client.key"), "--port", String(ec.port)], { stdio: ["pipe", "pipe", "pipe"] });
  const lines = [];
  ecclient.stdout.on("data", (d) => lines.push(...d.toString().split(/\r?\n/).filter(Boolean)));
  ecclient.stdin.write(`${ec.address}\n`);
  const localPort = async (n) => {
    for (let i = 0; i < 300; i++) {
      const found = lines.filter((l) => l.startsWith("LOCALPORT"));
      if (found.length >= n) return Number(found[n - 1].split(" ")[1]);
      await sleep(100);
    }
    throw new Error(`no tunnel: ${lines.join(" | ")}`);
  };
  let tunnel = await localPort(1);
  const clientKey = lines.find((l) => l.startsWith("CLIENTKEY")).split(" ")[1];
  const ecPair = await fetch(`http://127.0.0.1:${tunnel}/api/pair/easy-connect`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ secret: ec.secret, deviceName: "Tunnel proof", clientKey }) }).then((r) => r.json());
  check(!!ecPair.token, "paired through the tunnel");
  // The pairing popup left open, its New code tapped as soon as a code runs out.
  let renewals = 0;
  let renewing = true;
  void (async () => {
    while (renewing) {
      const s = await admin("/api/admin/state").catch(() => null);
      if (s?.easyConnect.state === "ready" && !s.easyConnect.code) {
        await admin("/api/admin/pairing/new", "POST", {});
        renewals++;
        say(`  (New code tapped in the popup, ${renewals})`);
      }
      await sleep(500);
    }
  })();
  await sleep(9000); // the restore after pairing and the first renewal settle
  ecclient.stdin.write("reconnect\n");
  tunnel = await localPort(2);
  const startsBefore = (log.match(/Easy Connect helper starting/g) ?? []).length;
  const renewalsBefore = renewals;
  say(`downloading the 24 MB APK through the tunnel at about 300 KB/s while codes expire every 20 s…`);
  const t = Date.now();
  const got = await new Promise((done, fail) => {
    const req = request(`http://127.0.0.1:${tunnel}/api/apps/${APP_ID}/apk`, { headers: { Authorization: `Bearer ${ecPair.token}` } }, (res) => {
      const chunks = [];
      let n = 0;
      res.on("data", (chunk) => {
        chunks.push(chunk);
        n += chunk.length;
        // Read slowly: about 300 KB/s, so the download spans several code expiries.
        if (n > ((Date.now() - t) / 1000) * 300_000) {
          res.pause();
          setTimeout(() => res.resume(), 200);
        }
      });
      res.on("end", () => done(Buffer.concat(chunks)));
      res.on("error", fail);
    });
    req.on("error", fail);
    req.end();
  }).catch((e) => e);
  renewing = false;
  const secs = (Date.now() - t) / 1000;
  const startsDuring = (log.match(/Easy Connect helper starting/g) ?? []).length - startsBefore;
  check(Buffer.isBuffer(got) && got.length === app.latestApk.sizeBytes && sha(got) === app.latestApk.sha256, `the download finished whole through the tunnel in ${secs.toFixed(0)} s (${Buffer.isBuffer(got) ? got.length : got.message})`);
  check(renewals - renewalsBefore >= 2, `${renewals - renewalsBefore} codes expired and were renewed during it`);
  check(startsDuring === 0, `the helper restarted ${startsDuring} times during it`);
}

// ---------- 5. a helper that was building builds again by itself after a restart
if (withHelper) {
  killServer();
  await sleep(1000);
  const records = JSON.parse(readFileSync(join(state, "apps.json"), "utf8"));
  const before = records[0].app.latestApk.number;
  records[0].app.status = "building";
  records[0].app.latestBuild = { number: before + 1, status: "running", startedAt: new Date().toISOString() };
  writeFileSync(join(state, "apps.json"), JSON.stringify(records, null, 1));
  const at = new Date().toISOString();
  mkdirSync(join(state, "workers", APP_ID), { recursive: true });
  writeFileSync(
    join(state, "workers", APP_ID, "workers.json"),
    JSON.stringify([{ info: { id: "abc123", appId: APP_ID, title: "Make the button green", state: "building", latest: "Building the new version", changesApp: true, createdAt: at, updatedAt: at }, brief: "Make the button green.", rowId: "row-abc123", inbox: [] }]),
  );
  say(`helper "Make the button green" left building when the companion stopped (latest APK ${before}); starting it in coordinator mode`);
  coordinator = "on";
  log = "";
  startServer();
  await waitHealthy();
  for (let i = 0; i < 300 && (app = await getApp()).latestApk?.number === before; i++) await sleep(200);
  check(/worker abc123: the PC restarted during its build; building again/.test(log), 'log: "worker abc123: the PC restarted during its build; building again"');
  check(app.latestApk?.number === before + 2, `the helper's change was built again by itself: latest APK is now ${app.latestApk?.number} (build ${before + 1} was the cut one)`);
  const untilReady = log.slice(0, log.indexOf(`APK ${before + 2} ready`));
  check(!/session\/(new|resume)/.test(untilReady), "no Claude Code session started before that build (no agent turn first)");
}

killServer();
say(failures === 0 ? "DOWNLOAD CHECK PASSED" : `DOWNLOAD CHECK FAILED (${failures})`);
if (failures) console.log(log.split(/\r?\n/).slice(-40).join("\n"));
process.exit(failures === 0 ? 0 : 1);
