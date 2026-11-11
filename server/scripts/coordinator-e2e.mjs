#!/usr/bin/env node
// End-to-end check of the coordinator and its workers (docs/APP-COORDINATOR.md) against REAL
// Claude Code ACP sessions, the fake builder by default, and no GitHub. Usage:
//   node scripts/coordinator-e2e.mjs        (E2E_PORT, E2E_DIR, E2E_BUILDER=real to use the real builder)
//   1. create an app: the coordinator answers and starts a worker for the first version
//   2. while the worker runs, ask the main chat a question: a real answer comes back at once
//   3. the worker finishes, the app is built ONCE, and the coordinator reports it to the person
//   4. restart the companion: workers and history are kept, the coordinator resumes its session
//      and still has its worker tools
//   5. two changes at once on different files, then two on the same file: the helpers work in
//      parallel in their own copies, land one at a time with one build each, and the clash on the
//      same file is combined by the helper that landed second
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, createWriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SERVER_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.E2E_PORT ?? 8798);
if (PORT === 8787) throw new Error("Never run this on the desktop app's port 8787.");
if (/\.anyappagent/i.test(process.env.E2E_HOME ?? "")) throw new Error("Never use the user's .anyappagent folder.");
const BASE = `http://127.0.0.1:${PORT}`;
const ROOT = process.env.E2E_DIR ?? join(tmpdir(), `anyapp-coord-e2e-${Date.now().toString(36)}`);
const STATE = join(ROOT, "state");
// A real build needs a short apps folder (React Native on Windows) and its own builder home (deps
// cache, keystore), never the user's %USERPROFILE%\.anyappagent: E2E_APPS and E2E_HOME.
const REAL = process.env.E2E_BUILDER === "real";
const APPS = process.env.E2E_APPS ?? join(ROOT, "apps");
const HOME = process.env.E2E_HOME ?? (REAL ? join(ROOT, "home") : undefined);
const TURN_TIMEOUT_MS = (REAL ? 60 : 20) * 60_000;
mkdirSync(ROOT, { recursive: true });

const t0 = Date.now();
const secs = () => (Date.now() - t0) / 1000;
const stamp = () => `${secs().toFixed(1).padStart(6)}s`;
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
      ANYAPP_HOST: "127.0.0.1",
      ANYAPP_STATE_DIR: STATE,
      ANYAPP_APPS_DIR: APPS,
      ANYAPP_BUILDER: REAL ? "real" : "fake",
      ...(HOME ? { ANYAPP_HOME: HOME } : {}),
      // Spare app folders of its own (the builder's default C:a\.spare is the user's).
      ...(REAL ? { ANYAPP_SPARE_DIR: join(dirname(APPS), "spare") } : {}),
      ANYAPP_GITHUB: "off",

      ANYAPP_PLAN_FIRST: "off", // the script expects a build right after the first prompt (docs/PAGES.md)
      ANYAPP_COORDINATOR: "on",
      ANYAPP_FAKE_BUILD_MS: "3000",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (const stream of [server.stdout, server.stderr]) {
    stream.on("data", (d) => {
      const text = d.toString();
      serverLog += text;
      out.write(text);
      for (const line of text.split(/\r?\n/)) {
        if (/^\[\d\d:\d\d:\d\d\]/.test(line)) say(`  [server] ${short(line.slice(11), 200)}`);
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

// ---- socket watcher
const events = [];
const waiters = [];
const printed = new Map();
function onEvent(event) {
  events.push({ at: secs(), event });
  if (event.type === "app.updated") {
    const line = `${event.app.status}${event.app.latestBuild ? ` build#${event.app.latestBuild.number}:${event.app.latestBuild.status}` : ""}`;
    if (printed.get("app") !== line) say(`app.updated   ${line}`);
    printed.set("app", line);
  } else if (event.type === "chat.item") {
    const item = event.item;
    let line;
    if (item.kind === "worker") line = `WORKER ROW ${item.worker.id} "${item.worker.title}" [${item.worker.state}] ${short(item.worker.latest, 80)}`;
    else if (item.kind === "tool") line = `tool [${item.tool.status}] ${short(item.tool.title, 60)}`;
    else if (item.kind === "build") line = `build #${item.build.number} ${item.build.status}${item.text ? ` (${item.text})` : ""}${item.build.error ? `: ${item.build.error}` : ""}`;
    else if (item.streaming) line = null;
    else line = `${item.kind.padEnd(9)} ${short(item.text, 220)}`;
    if (line && printed.get(item.id) !== line) say(`main #${item.seq} ${line}`);
    if (line) printed.set(item.id, line);
  } else if (event.type === "worker.item") {
    const item = event.item;
    let line;
    if (item.kind === "tool") line = `tool [${item.tool.status}] ${short(item.tool.title, 60)}`;
    else if (item.streaming || item.kind === "thought") line = null;
    else line = `${item.kind.padEnd(9)} ${short(item.text, 140)}`;
    if (line && item.kind !== "tool" && printed.get(item.id) !== line) say(`  worker ${item.workerId} #${item.seq} ${line}`);
    if (line) printed.set(item.id, line);
  } else if (event.type === "apk.ready") {
    say(`apk.ready     build #${event.app.latestApk.number} ${event.app.latestApk.sizeBytes} bytes`);
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
async function gitOut(args) {
  const dir = join(APPS, "tipsplitter");
  const result = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
  return (result.stdout ?? "").trim();
}

function check(condition, message) {
  if (!condition) throw new Error(`CHECK FAILED: ${message}`);
  say(`OK  ${message}`);
}
const finishedAssistant = (appId, afterSeq) => (e) =>
  e.type === "chat.item" && e.item.appId === appId && !e.item.workerId && e.item.kind === "assistant" && !e.item.streaming && e.item.seq > afterSeq;
const maxSeq = () => events.reduce((m, { event }) => (event.type === "chat.item" ? Math.max(m, event.item.seq) : m), 0);

async function main() {
  say(`coordinator e2e dir ${ROOT} port ${PORT}`);
  startServer("1");
  await waitForHealth();
  const code = readFileSync(join(STATE, "pairing-code.txt"), "utf8").trim();
  const pair = await fetch(`${BASE}/api/pair`, { method: "POST", body: JSON.stringify({ code, deviceName: "coordinator e2e" }) });
  token = (await pair.json()).token;
  let ws = await openSocket();

  // ---------- 1. the first message: the coordinator starts a worker
  const tCreate = secs();
  const app = await json("POST", "/api/apps", {
    name: "Tip Splitter",
    prompt:
      "A tip splitter: I type the bill amount, pick a tip of 10, 15 or 20 percent, and the number of people, and it shows what each person pays. Keep it simple.",
  });
  say(`POST /api/apps -> ${app.status} ${app.slug}`);
  const firstWorker = await waitFor((e) => e.type === "worker.updated" && e.worker.appId === app.id, "the first worker");
  const workerId = firstWorker.worker.id;
  say(`first worker ${workerId} "${firstWorker.worker.title}" ${(secs() - tCreate).toFixed(1)} s after create`);
  await waitFor(finishedAssistant(app.id, 0), "the coordinator's first reply");
  const workerNow = (await json("GET", `/api/apps/${app.id}/workers`)).find((w) => w.id === workerId);
  check(workerNow && ["waiting", "working"].includes(workerNow.state), `coordinator replied while worker ${workerId} is ${workerNow?.state}`);

  // ---------- 2. a second message while the worker runs gets a real reply at once
  await waitFor((e) => e.type === "app.updated" && e.app.id === app.id && e.app.status === "working", "working", 60_000).catch(() => {});
  const seqBefore = maxSeq();
  const tAsk = secs();
  await json("POST", `/api/apps/${app.id}/messages`, {
    text: "While that is being made: will the tip options be buttons or a slider? One sentence is enough.",
  });
  const reply = await waitFor(finishedAssistant(app.id, seqBefore), "the reply to the second message", 5 * 60_000);
  const tReply = secs();
  const stateAtReply = (await json("GET", `/api/apps/${app.id}/workers`)).find((w) => w.id === workerId).state;
  say(`second message answered in ${(tReply - tAsk).toFixed(1)} s: ${short(reply.item.text, 200)}`);
  check(stateAtReply === "working" || stateAtReply === "waiting", `the worker was still ${stateAtReply} when the reply arrived`);

  // ---------- 3. the worker finishes, one build, the coordinator reports
  const done = await waitFor(
    (e) => e.type === "worker.updated" && e.worker.id === workerId && ["done", "failed", "stopped"].includes(e.worker.state),
    "the worker to finish",
  );
  say(`worker ${workerId} ${done.worker.state} at ${secs().toFixed(1)} s: ${short(done.worker.latest, 200)}`);
  check(done.worker.state === "done", "the worker finished");
  const seqAtDone = maxSeq();
  const report = await waitFor(finishedAssistant(app.id, seqAtDone), "the coordinator's report to the person");
  say(`coordinator report at ${secs().toFixed(1)} s: ${short(report.item.text, 300)}`);
  await waitFor((e) => e.type === "app.updated" && e.app.id === app.id && e.app.status === "idle", "idle", 5 * 60_000);
  await new Promise((r) => setTimeout(r, 1500));
  const apkReady = events.filter(({ event }) => event.type === "apk.ready" && event.app.id === app.id);
  const buildRows = new Set(events.filter(({ event }) => event.type === "chat.item" && event.item.kind === "build").map(({ event }) => event.item.id));
  check(apkReady.length === 1, `exactly one apk.ready (${apkReady.length})`);
  check(buildRows.size === 1, `exactly one build row in the main chat (${buildRows.size})`);
  const appAfter = await json("GET", `/api/apps/${app.id}`);
  check(appAfter.latestApk?.number === 1 && done.worker.buildNumber === 1, `latestApk is build 1 and the worker row says build ${done.worker.buildNumber}`);
  const apkTime = apkReady[0].at;
  check(report.item.seq > [...events].reverse().find(({ event }) => event.type === "chat.item" && event.item.kind === "build").event.item.seq, `the report comes after the build (apk.ready at ${apkTime.toFixed(1)} s)`);

  const main1 = await json("GET", `/api/apps/${app.id}/messages`);
  const workerChat = await json("GET", `/api/apps/${app.id}/workers/${workerId}/messages`);
  check(main1.filter((i) => i.kind === "worker").length === 1, "one worker row in the main chat history");
  check(!main1.some((i) => i.kind === "tool" && /worker|ToolSearch/i.test(i.tool.title)), "no raw worker-tool or ToolSearch rows in the main chat");
  check(workerChat.length > 2 && workerChat.every((i) => i.workerId === workerId), `the worker's own chat has ${workerChat.length} items, all tagged with its id`);
  check(!main1.some((i) => i.workerId), "no worker chat items leak into the main chat");
  say("main chat timeline:");
  for (const i of main1) say(`   #${i.seq} ${i.kind.padEnd(9)} ${i.kind === "worker" ? `${i.worker.title} [${i.worker.state}] ${short(i.worker.latest, 80)}` : i.kind === "build" ? `build #${i.build.number} ${i.build.status}` : i.kind === "tool" ? i.tool.title : short(i.text, 150)}`);
  ws.close();

  // ---------- 4. restart: kept, resumed, tools still work
  say("---- restarting the companion ----");
  const sessionBefore = JSON.parse(readFileSync(join(STATE, "apps.json"), "utf8")).find((r) => r.app.id === app.id).sessionId;
  stopServer();
  await new Promise((r) => setTimeout(r, 1500));
  serverLog = "";
  startServer("2");
  await waitForHealth();
  ws = await openSocket();
  const workersAfter = await json("GET", `/api/apps/${app.id}/workers`);
  check(workersAfter.length === 1 && workersAfter[0].state === "done", "the worker is still listed as done after the restart");
  const seq2 = (await json("GET", `/api/apps/${app.id}/messages`)).at(-1).seq;
  await json("POST", `/api/apps/${app.id}/messages`, { text: "Check right now what state each helper is in, and tell me in one sentence. Do not start anything." });
  const answer = await waitFor(finishedAssistant(app.id, seq2), "the answer after the restart", 5 * 60_000);
  say(`answer after restart: ${short(answer.item.text, 250)}`);
  const sessionAfter = JSON.parse(readFileSync(join(STATE, "apps.json"), "utf8")).find((r) => r.app.id === app.id).sessionId;
  check(sessionAfter === sessionBefore, "the coordinator resumed the same Claude Code session");
  check(/coordinator tool (list_workers|read_worker)/.test(serverLog), "the resumed coordinator used its worker tools (new run, new token)");
  check((await json("GET", `/api/apps/${app.id}/workers`)).length === 1, "no new worker was started");

  // ---------- 5. parallel helpers: a pair that touches different files, then a pair on the same file
  const runPair = async (label, text) => {
    const mark = events.length;
    const logMark = serverLog.length;
    const t = secs();
    const seq = (await json("GET", `/api/apps/${app.id}/messages`)).at(-1).seq;
    say(`---- ${label} ----`);
    await json("POST", `/api/apps/${app.id}/messages`, { text });
    await waitFor(finishedAssistant(app.id, seq), `the reply to ${label}`, 5 * 60_000);
    const updates = () => events.slice(mark).filter(({ event }) => event.type === "worker.updated" && event.worker.id !== workerId);
    const ids = [...new Set(updates().map(({ event }) => event.worker.id))];
    check(ids.length === 2, `${label}: two helpers started (${ids.join(", ")})`);
    for (const id of ids) {
      const seen = updates().filter(({ event }) => event.worker.id === id).at(-1).event.worker;
      if (!["done", "failed", "stopped"].includes(seen.state)) {
        await waitFor((e) => e.type === "worker.updated" && e.worker.id === id && ["done", "failed", "stopped"].includes(e.worker.state), `helper ${id} to finish`);
      }
    }
    await waitFor((e) => e.type === "app.updated" && e.app.id === app.id && e.app.status === "idle", `idle after ${label}`, 15 * 60_000).catch(() => {});
    await new Promise((r) => setTimeout(r, 3000));
    const finals = (await json("GET", `/api/apps/${app.id}/workers`)).filter((w) => ids.includes(w.id));
    // Both worked at the same time at some point (not one after the other).
    const state = {};
    let together = false;
    for (const { event } of updates()) {
      state[event.worker.id] = event.worker.state;
      if (ids.every((id) => state[id] === "working")) together = true;
    }
    const lastSeen = {};
    const timeline = [];
    for (const { at, event } of updates()) {
      const w = event.worker;
      const key = `${w.state}|${w.state === "working" ? "" : w.latest}`;
      if (lastSeen[w.id] === key) continue;
      lastSeen[w.id] = key;
      timeline.push(`+${(at - t).toFixed(0)}s ${w.id} ${w.state}${w.state === "working" && !/^(Working on it|Starting)$/.test(w.latest ?? "") ? "" : ` (${short(w.latest, 70)})`}`);
    }
    say(`${label} timeline (seconds after the message):`);
    for (const line of timeline) say(`   ${line}`);
    const builds = events.slice(mark).filter(({ event }) => event.type === "apk.ready").map(({ at, event }) => `build ${event.app.latestApk.number} at +${(at - t).toFixed(0)}s`);
    const log = serverLog.slice(logMark);
    const conflicts = [...log.matchAll(/worker (\w+): its change conflicts with what landed \(([^)]*)\)/g)].map((m) => `${m[1]} on ${m[2]}`);
    const landed = [...log.matchAll(/worker (\w+): landed (\w+) -> (\w+)/g)].map((m) => `${m[1]} ${m[2]}..${m[3]}`);
    const copies = [...log.matchAll(/worker (\w+): helper copy .* ready in ([\d.]+) s/g)].map((m) => `${m[1]} ${m[2]} s`);
    say(`${label}: helper copies made: ${copies.join("; ") || "none"}`);
    say(`${label}: landed ${landed.join("; ")}; builds ${builds.join(", ")}; clashes: ${conflicts.join("; ") || "none"}`);
    say(`${label}: ${finals.map((w) => `${w.id} "${w.title}" ${w.state} build ${w.buildNumber ?? "-"}: ${short(w.latest, 120)}`).join(" | ")}`);
    check(finals.every((w) => w.state === "done"), `${label}: both helpers finished`);
    check(together, `${label}: both helpers worked at the same time`);
    check(builds.length === 2, `${label}: one build per landing (${builds.length})`);
    return { conflicts, ids };
  };
  if (process.env.E2E_SKIP_PAIRS !== "1") {
    const apart = await runPair(
      "pair 1 (different files)",
      "Two separate changes, one helper each, both at once please: 1) change the app's name that shows under its icon on the phone to \"Tip Split\" (only the app's name setting, nothing on the screen). 2) add a short grey line under the screen's title that says \"Split the bill fairly\".",
    );
    say(`pair 1 clashes: ${apart.conflicts.length}`);
    const same = await runPair(
      "pair 2 (same file)",
      "Two separate changes, one helper each, both at once please: 1) change the tip choices to 10, 18 and 25 percent. 2) add a 5 percent tip choice as the first option.",
    );
    check(same.conflicts.length >= 1, `pair 2: the second landing clashed and was combined by its helper (${same.conflicts.join("; ")})`);
    const files = await gitOut(["log", "--format=%h %s", "-12"]);
    say(`app history:\n${files}`);
    const leftover = existsSync(join(APPS, ".helpers")) ? readdirSync(join(APPS, ".helpers")) : [];
    check(leftover.length === 0, `every helper copy was removed after its work landed (${leftover.length} left)`);
    const branches = await gitOut(["branch", "--list", "helper/*"]);
    check(branches.trim() === "", "no helper branches left");
  }
  ws.close();
  say("COORDINATOR E2E PASSED");
}

main()
  .then(() => {
    stopServer();
    process.exit(0);
  })
  .catch((error) => {
    say(`COORDINATOR E2E FAILED: ${error.message}`);
    stopServer();
    process.exit(1);
  });
