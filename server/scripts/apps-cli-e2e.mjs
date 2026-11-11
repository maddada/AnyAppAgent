#!/usr/bin/env node
// End-to-end check of "apps that know each other" (overview.md and the `anyapp` command) against
// REAL Claude Code ACP sessions, the fake builder, no GitHub, on a companion of its own:
//   1. app A is made; its agent writes overview.md (not the PC's draft) and it is committed
//   2. the companion's own `anyapp` launcher lists app A
//   3. app B is made with a prompt that points at A; B's agents run `anyapp`, read A's overview and
//      code, and copy a piece of A into B; the CLI lists both apps
//   4. a prompt that changes what B should do: B's overview.md is updated and committed
//   5. A's folder is untouched by B's agents
// Usage: node scripts/apps-cli-e2e.mjs   (E2E_PORT, default 8811; E2E_DIR)
import { spawn, spawnSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SERVER_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.E2E_PORT ?? 8811);
if (PORT === 8787) throw new Error("Never run this on the desktop app's port 8787.");
const BASE = `http://127.0.0.1:${PORT}`;
const ROOT = process.env.E2E_DIR ?? join(tmpdir(), `anyapp-cli-e2e-${Date.now().toString(36)}`);
if (/\.anyappagent/i.test(ROOT)) throw new Error("Never use the user's .anyappagent folder.");
const STATE = join(ROOT, "state");
const APPS = join(ROOT, "apps");
const TURN_TIMEOUT_MS = 25 * 60_000;
mkdirSync(ROOT, { recursive: true });
const transcript = createWriteStream(join(ROOT, "transcript.txt"));

const t0 = Date.now();
const stamp = () => `${((Date.now() - t0) / 1000).toFixed(1).padStart(7)}s`;
const say = (...parts) => {
  const line = [stamp(), ...parts].join(" ");
  console.log(line);
  transcript.write(`${line}\n`);
};
const short = (text, max = 160) => {
  const flat = String(text ?? "").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};
const block = (title, text) => {
  say(`---- ${title}`);
  for (const line of String(text).trimEnd().split(/\r?\n/)) transcript.write(`         | ${line}\n`);
  console.log(String(text).trimEnd().replace(/^/gm, "         | "));
};

let server;
function startServer() {
  const out = createWriteStream(join(ROOT, "server.log"));
  server = spawn(process.execPath, [join(SERVER_DIR, "bin", "anyappagent.mjs")], {
    cwd: SERVER_DIR,
    env: {
      ...process.env,
      ANYAPP_PORT: String(PORT),
      ANYAPP_HOST: "127.0.0.1",
      ANYAPP_STATE_DIR: STATE,
      ANYAPP_APPS_DIR: APPS,
      ANYAPP_BUILDER: "fake",
      ANYAPP_GITHUB: "off",
      ANYAPP_COORDINATOR: "on",
      ANYAPP_FAKE_BUILD_MS: "2000",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (const stream of [server.stdout, server.stderr]) stream.on("data", (d) => out.write(d));
}
function stopServer() {
  if (!server || server.exitCode !== null) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" });
  else server.kill("SIGINT");
}
process.on("exit", stopServer);

async function waitForHealth() {
  for (let i = 0; i < 150; i++) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return res.json();
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("server did not start");
}

let token = "";
async function json(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = res.status === 204 ? null : await res.json();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(data)}`);
  return data;
}

// ---- events
const waiters = [];
const printed = new Map();
/** Every tool call of every agent, by app: [{ who, title, rawInput }] */
const tools = new Map();
const names = new Map();
function noteTool(appId, who, tool) {
  if (!tool) return;
  const list = tools.get(appId) ?? [];
  const key = `${who}:${tool.id ?? tool.title}`;
  const existing = list.find((t) => t.key === key);
  const title = tool.detail ? `${tool.title}: ${tool.detail}` : tool.title;
  if (existing) Object.assign(existing, { title, status: tool.status });
  else list.push({ key, who, title, status: tool.status });
  tools.set(appId, list);
}
function onEvent(event) {
  if (event.type === "chat.item") {
    const item = event.item;
    const app = names.get(item.appId) ?? "?";
    if (item.kind === "tool") noteTool(item.appId, "main", { id: item.id, ...item.tool });
    let line;
    if (item.kind === "worker") line = `helper "${item.worker.title}" [${item.worker.state}]`;
    else if (item.kind === "tool") line = `tool [${item.tool.status}] ${short(item.tool.title, 80)}${item.tool.detail ? ` | ${short(item.tool.detail, 160)}` : ""}`;
    else if (item.kind === "build") line = `build #${item.build.number} ${item.build.status}`;
    else if (item.streaming || item.kind === "thought") line = null;
    else line = `${item.kind}: ${short(item.text, 400)}`;
    if (line && printed.get(item.id) !== line) say(`[${app} main] ${line}`);
    if (line) printed.set(item.id, line);
  } else if (event.type === "worker.item") {
    const item = event.item;
    const app = names.get(item.appId) ?? "?";
    if (item.kind === "tool") noteTool(item.appId, `helper ${item.workerId}`, { id: item.id, ...item.tool });
    let line;
    if (item.kind === "tool") line = item.tool.status === "pending" ? null : `tool [${item.tool.status}] ${short(item.tool.title, 80)}${item.tool.detail ? ` | ${short(item.tool.detail, 160)}` : ""}`;
    else if (item.streaming || item.kind === "thought") line = null;
    else line = `${item.kind}: ${short(item.text, 400)}`;
    if (line && printed.get(item.id) !== line) say(`[${app} helper ${item.workerId}] ${line}`);
    if (line) printed.set(item.id, line);
  } else if (event.type === "apk.ready") {
    say(`[${names.get(event.app.id) ?? "?"}] apk.ready build #${event.app.latestApk.number}`);
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

function check(condition, message) {
  if (!condition) {
    say(`FAILED  ${message}`);
    throw new Error(`CHECK FAILED: ${message}`);
  }
  say(`OK  ${message}`);
}
const git = (dir, args) => (spawnSync("git", args, { cwd: dir, encoding: "utf8" }).stdout ?? "").trim();
const anyapp = (...args) => {
  const cmd = join(STATE, "bin", "anyapp.cmd");
  const r =
    process.platform === "win32"
      ? spawnSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/c", cmd, ...args], { encoding: "utf8", env: { ...process.env, ANYAPP_CLI_STATE_DIR: "" } })
      : spawnSync(join(STATE, "bin", "anyapp"), args, { encoding: "utf8" });
  return `${r.stdout}${r.stderr}`.trim();
};

/** Waits until the app is idle with no helper running, after at least one build since `afterBuild`. */
async function settled(appId, what, afterBuild = 0) {
  const deadline = Date.now() + TURN_TIMEOUT_MS;
  let calm = 0;
  while (Date.now() < deadline) {
    const app = (await json("GET", "/api/apps")).find((a) => a.id === appId);
    const workers = await json("GET", `/api/apps/${appId}/workers`);
    const busy = workers.some((w) => ["waiting", "working", "building"].includes(w.state));
    const done = app && app.status === "idle" && !app.replying && !busy && (app.latestApk?.number ?? 0) > afterBuild;
    // Twice in a row, 5 s apart: the coordinator's report turn starts a moment after a landing.
    if (done && calm++ >= 1) return app;
    if (!done) calm = 0;
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error(`timed out waiting for ${what}`);
}

function files(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === ".git" || e.name === "node_modules" || e.name === ".anyapp") continue;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.push(p);
    }
  };
  walk(dir);
  return out;
}

async function main() {
  say(`apps-cli e2e: dir ${ROOT}, port ${PORT}`);
  startServer();
  await waitForHealth();
  const code = readFileSync(join(STATE, "pairing-code.txt"), "utf8").trim();
  const pair = await fetch(`${BASE}/api/pair`, { method: "POST", body: JSON.stringify({ code, deviceName: "apps-cli e2e" }) });
  token = (await pair.json()).token;
  await openSocket();
  check(existsSync(join(STATE, "bin", "anyapp.cmd")) && existsSync(join(STATE, "bin", "anyapp")), "the companion installed its anyapp launchers in its own state folder");

  // ---------- 1. app A
  const a = await json("POST", "/api/apps", {
    name: "Ajman Prayers",
    prompt:
      "A prayer times app for Ajman, UAE. It works out the five prayer times on the phone itself (no internet), using the UAE method: Fajr at 18.2 degrees, Isha at 18.2 degrees, Asr Shafii. Show today's times in a list and a countdown to the next prayer. Put the calculation in its own file so it is easy to reuse.",
  });
  names.set(a.id, "A");
  say(`made app A ${a.slug} (${a.id})`);
  const aDir = join(APPS, a.slug);
  check(readFileSync(join(aDir, "overview.md"), "utf8").includes("anyapp: draft"), "app A starts with the PC's draft overview.md (the first message)");
  const aDone = await settled(a.id, "app A's first version");
  const aOverview = readFileSync(join(aDir, "overview.md"), "utf8");
  block("app A overview.md, written by its agent", aOverview);
  check(!aOverview.includes("anyapp: draft"), "app A's agent replaced the draft with its own overview.md");
  check(git(aDir, ["status", "--porcelain", "--", "overview.md"]) === "", "app A's overview.md is committed");
  block("app A git log", git(aDir, ["log", "--oneline", "--", "overview.md"]));
  const aFilesBefore = new Map(files(aDir).map((f) => [f, statSync(f).mtimeMs]));
  const aHead = git(aDir, ["rev-parse", "HEAD"]);
  block("anyapp apps (the companion's own launcher, after app A)", anyapp("apps"));

  // ---------- 2. app B points at A
  const b = await json("POST", "/api/apps", {
    name: "Fasting Times",
    prompt:
      "A fasting app for Ajman: it shows when suhoor ends (Fajr) and when iftar is (Maghrib) today, with a big countdown to the next one. Use exactly the same prayer time calculation as my Ajman Prayers app so the times match.",
  });
  names.set(b.id, "B");
  say(`made app B ${b.slug} (${b.id})`);
  const bDir = join(APPS, b.slug);
  await settled(b.id, "app B's first version");
  const listing = anyapp("apps");
  block("anyapp apps (both apps)", listing);
  check(listing.includes(a.slug) && listing.includes(b.slug), "the CLI lists both apps");
  block("anyapp overview " + a.slug, anyapp("overview", a.slug));
  block("anyapp path " + a.slug, anyapp("path", a.slug));

  const bTools = tools.get(b.id) ?? [];
  const cliCalls = bTools.filter((t) => /anyapp/i.test(t.title) || t.title.includes(aDir) || t.title.includes(a.slug));
  block("app B's tool calls that touch the anyapp command or app A", cliCalls.map((t) => `${t.who}: [${t.status}] ${t.title}`).join("\n") || "(none)");
  check(cliCalls.some((t) => /anyapp (apps|overview|path)/.test(t.title)), "an agent of app B ran the anyapp command");
  check(cliCalls.some((t) => /overview/.test(t.title)), "an agent of app B read app A's overview");

  // The piece of A that B reuses: a function or constant name from A's calculation file found in B.
  const aCode = files(aDir).filter((f) => /\.(ts|tsx|js|kt)$/.test(f));
  const calc = aCode.find((f) => /pray|time|calc|salah|adhan/i.test(relative(aDir, f)) && !/App\.tsx$/.test(f)) ?? aCode[0];
  const aText = calc ? readFileSync(calc, "utf8") : "";
  const idents = [...new Set([...aText.matchAll(/(?:function|const|export const|export function)\s+([A-Za-z_][A-Za-z0-9_]{5,})/g)].map((m) => m[1]))];
  const bText = files(bDir).filter((f) => /\.(ts|tsx|js|kt)$/.test(f)).map((f) => readFileSync(f, "utf8")).join("\n");
  const shared = idents.filter((id) => bText.includes(id));
  say(`app A's calculation file: ${calc ? relative(aDir, calc) : "none"}; its names found in app B: ${shared.join(", ") || "none"}`);
  check(shared.length >= 2, "app B contains code copied from app A");
  const bOverview1 = readFileSync(join(bDir, "overview.md"), "utf8");
  block("app B overview.md after its first version", bOverview1);
  check(!bOverview1.includes("anyapp: draft"), "app B's agent wrote its own overview.md");

  // ---------- 3. a prompt that changes what B should do
  const buildBefore = (await json("GET", "/api/apps")).find((x) => x.id === b.id).latestApk.number;
  await json("POST", `/api/apps/${b.id}/messages`, {
    text: "Also show a short dua for breaking the fast under the iftar time, and let me switch between 12 and 24 hour time.",
  });
  await settled(b.id, "app B's change", buildBefore);
  const bOverview2 = readFileSync(join(bDir, "overview.md"), "utf8");
  block("app B overview.md after the second prompt", bOverview2);
  check(bOverview2 !== bOverview1 && /dua/i.test(bOverview2) && /24/.test(bOverview2), "app B's overview.md now has the new requirements");
  check(git(bDir, ["status", "--porcelain", "--", "overview.md"]) === "", "app B's updated overview.md is committed");
  block("app B git log of overview.md", git(bDir, ["log", "--oneline", "--", "overview.md"]));

  // ---------- 4. A untouched
  const changed = files(aDir).filter((f) => aFilesBefore.get(f) !== statSync(f).mtimeMs);
  check(changed.length === 0 && git(aDir, ["rev-parse", "HEAD"]) === aHead && git(aDir, ["status", "--porcelain"]) === "", "app A's folder was not changed by app B's agents");

  writeFileSync(join(ROOT, "result.json"), JSON.stringify({ ok: true, a: a.slug, b: b.slug, aDone: aDone.latestApk, shared, cliCalls }, null, 2));
  say("ALL CHECKS PASSED");
}

main()
  .then(() => {
    transcript.end();
    stopServer();
    setTimeout(() => process.exit(0), 500);
  })
  .catch((error) => {
    say(`E2E FAILED: ${error.message}`);
    transcript.end();
    stopServer();
    setTimeout(() => process.exit(1), 500);
  });
