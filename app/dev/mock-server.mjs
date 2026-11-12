// A stand-in for the PC companion (server/), implementing shared/protocol.ts with canned data,
// so the app can be developed and proven without it.
//
//   node dev/mock-server.mjs [--port 8787] [--code 123456] [--speed 1] [--empty]
//
// - Pairing code is 123456 unless --code is given. Any token it hands out stays valid until restart.
// - Seeded with a few apps in every state (ready, working, building, problem, being made).
// - Sending a message runs a scripted turn: thinking, a plan, tool calls, streamed markdown,
//   then a build that produces a real APK (dev/make-test-apk.mjs) and announces apk.ready.
//   A message containing "permission" makes the agent ask for permission first.
//   A message containing "fail" makes the build fail.
// - Real APKs need the Android SDK build-tools (ANDROID_HOME). Without them builds still
//   "succeed" if an APK for that app was built before (dev/tmp/apks), otherwise they fail.
import { Buffer } from "node:buffer";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { networkInterfaces } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { appIconPng } from "./png.mjs";
import { makeApk, toolchain } from "./make-test-apk.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const APK_DIR = join(here, "tmp", "apks");
const args = process.argv.slice(2);
const arg = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : d;
};
const PORT = Number(arg("port", process.env.PORT ?? 8787));
const CODE = String(arg("code", "123456"));
const SPEED = Number(arg("speed", "1"));
const SERVER_NAME = arg("name", "Home PC");
const EMPTY = args.includes("--empty");

const tokens = new Set();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms / SPEED));
const now = () => new Date().toISOString();
const ago = (min) => new Date(Date.now() - min * 60000).toISOString();

// ---------- state

/** @type {Map<string, any>} */
const apps = new Map();
/** @type {Map<string, any[]>} */
const chats = new Map();
const seqs = new Map();
const looks = new Map(); // appId -> { color, glyph }
const turns = new Map(); // appId -> { cancelled }
const pendingPermissions = new Map(); // requestId -> resolve

let mockPage = null; // the seeded page item (GET /page/<id>/mock serves it)

const MOCK_PAGE_HTML = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Prayer Alarm: the plan</title>
<style>:root{color-scheme:light dark}body{font:16px/1.5 system-ui;margin:0;padding:24px;background:#F3EFE7;color:#1F1B16}@media (prefers-color-scheme:dark){body{background:#181613;color:#EEE8DD}}
h1{font-size:26px;margin:0 0 8px}ul{padding-left:20px}button{font:600 16px system-ui;padding:12px 18px;border-radius:10px;border:0;background:#1D6A4A;color:#F7F4EC}</style></head>
<body><p style="font:500 11px monospace;letter-spacing:.9px;text-transform:uppercase;opacity:.7">Prayer Alarm, the plan</p><h1>What I will build</h1>
<ul><li>Five prayer times for Ajman<ul><li>Worked out on the phone, offline</li></ul></li><li>Two reminders before each prayer</li></ul>
<button id="b">Build it</button><p id="s"></p>
<script>document.getElementById("b").onclick=function(){fetch(location.pathname+"/answers",{method:"POST",body:JSON.stringify({answers:{"Build it?":"Build it"}})}).then(function(r){document.getElementById("s").textContent=r.ok?"Answered. The agent has your answers.":"Not sent";});};</script>
<p><a href="https://example.com/">A link that opens in the browser</a></p></body></html>`;

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 24) || "app";
}

function addApp({ name, status = "idle", color, glyph, minutesAgo = 0, error, builds = [] }) {
  const slug = slugify(name);
  const id = `app_${slug}`;
  const app = {
    id,
    name,
    slug,
    // Its own namespace, so mock apps never collide with real ones (com.anyapp.<slug>) on a shared emulator.
    packageName: `com.anyappagent.mock.${slug}`,
    status,
    error,
    iconVersion: 1,
    createdAt: ago(minutesAgo),
    updatedAt: ago(minutesAgo),
  };
  apps.set(id, app);
  chats.set(id, []);
  seqs.set(id, 0);
  looks.set(id, { color, glyph });
  for (const b of builds) recordBuild(app, b);
  return app;
}

function recordBuild(app, build) {
  app.latestBuild = build;
  if (build.status === "succeeded") app.latestApk = build;
}

function item(appId, kind, fields, at = now()) {
  const seq = (seqs.get(appId) ?? 0) + 1;
  seqs.set(appId, seq);
  const it = { id: `${appId}-${seq}-${randomBytes(3).toString("hex")}`, appId, seq, kind, createdAt: at, updatedAt: at, ...fields };
  chats.get(appId).push(it);
  broadcast({ type: "chat.item", item: it });
  return it;
}

function update(it, fields) {
  Object.assign(it, fields, { updatedAt: now() });
  broadcast({ type: "chat.item", item: it });
  return it;
}

function setStatus(app, status, extra = {}) {
  Object.assign(app, { status, updatedAt: now() }, extra);
  if (status !== "error") delete app.error;
  Object.assign(app, extra);
  broadcast({ type: "app.updated", app });
}

// ---------- APKs

function apkPath(app, number) {
  return join(APK_DIR, `${app.packageName}-${number}.apk`);
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

/** Builds (or reuses) the test APK for this app and version. Returns BuildInfo fields. */
function produceApk(app, number) {
  const file = apkPath(app, number);
  if (!existsSync(file)) {
    if (!toolchain()) throw new Error("The mock can't build APKs: Android build-tools not found (set ANDROID_HOME).");
    const look = looks.get(app.id) ?? {};
    makeApk({ packageName: app.packageName, label: app.name, versionCode: number, color: look.color, glyph: look.glyph, out: file });
  }
  return { sizeBytes: statSync(file).size, sha256: sha256(file) };
}

function seedBuild(app, number, minutesAgo) {
  const base = { number, startedAt: ago(minutesAgo + 2), finishedAt: ago(minutesAgo) };
  try {
    return { ...base, status: "succeeded", ...produceApk(app, number) };
  } catch {
    // No toolchain and no cached APK: pretend with a missing file (GET /apk answers 404).
    return { ...base, status: "succeeded", sizeBytes: 0, sha256: "" };
  }
}

// ---------- seed

function seed() {
  if (EMPTY) return;
  const sunrise = addApp({ name: "Sunrise Clock", status: "creating", color: "#e2711d", glyph: "sun", minutesAgo: 0.2 });
  void sunrise;

  const quiz = addApp({ name: "Kids Quiz", status: "error", color: "#7c3aed", glyph: "star", minutesAgo: 30, error: "The last build failed." });
  item(quiz.id, "user", { text: "A quiz game for my kids with animal pictures, 10 questions per round." }, ago(30));
  item(quiz.id, "assistant", { text: "I made the quiz with 10 animal questions per round and a score at the end." }, ago(28));
  const qb = { number: 1, status: "failed", startedAt: ago(28), finishedAt: ago(27), error: "Couldn't bundle the app: a picture file is missing (assets/lion.png)." };
  item(quiz.id, "build", { build: qb }, ago(28));
  recordBuild(quiz, qb);
  item(quiz.id, "error", { text: "The build failed 3 times, so I stopped. Tell me what to try, or say \"try again\"." }, ago(27));

  const water = addApp({ name: "Water Reminder", status: "building", color: "#0e7490", glyph: "drop", minutesAgo: 60 });
  item(water.id, "user", { text: "Remind me to drink water every 2 hours between 8 am and 10 pm." }, ago(60));
  item(water.id, "assistant", { text: "Done: a reminder every **2 hours** from 8:00 to 22:00. You can change both in the app." }, ago(3));
  const wb = { number: 1, status: "running", startedAt: ago(2) };
  item(water.id, "build", { build: wb }, ago(2));
  recordBuild(water, wb);

  const grocery = addApp({ name: "Grocery List", status: "idle", color: "#22a06b", glyph: "list", minutesAgo: 240 });
  item(grocery.id, "user", { text: "A shared grocery list I can tick off in the shop." }, ago(240));
  item(grocery.id, "assistant", { text: "Your grocery list is ready. Tap an item to tick it off; long-press to delete it." }, ago(236));
  const gb = seedBuild(grocery, 1, 235);
  item(grocery.id, "build", { build: gb }, ago(235));
  recordBuild(grocery, gb);

  const prayer = addApp({ name: "Prayer Alarm", status: "idle", color: "#1f7a5a", glyph: "moon", minutesAgo: 600 });
  const t0 = 600;
  item(prayer.id, "user", { text: "An alarm for the five prayers in Ajman, UAE. Let me adjust each time, and remind me twice before each prayer." }, ago(t0));
  item(prayer.id, "thought", { text: "Ajman is at about 25.40 N, 55.48 E. The UAE uses the Umm al-Qura style with Fajr at 18.2 degrees and Isha at 18.2 degrees. I'll compute times on the phone so it works offline." }, ago(t0 - 0.1));
  item(prayer.id, "plan", {
    plan: [
      { content: "Compute prayer times for Ajman", status: "completed" },
      { content: "Settings screen for adjustments and reminders", status: "completed" },
      { content: "Schedule the alarms", status: "completed" },
    ],
  }, ago(t0 - 0.2));
  item(prayer.id, "tool", { tool: { title: "Read App.tsx", kind: "read", status: "completed", detail: "App.tsx" } }, ago(t0 - 0.3));
  item(prayer.id, "tool", { tool: { title: "Edit src/prayerTimes.ts", kind: "edit", status: "completed", detail: "+ export function prayerTimes(date: Date, lat = 25.4052, lng = 55.5136) {\n+   // Fajr 18.2°, Isha 18.2° (UAE)\n+ }" } }, ago(t0 - 0.4));
  item(prayer.id, "tool", { tool: { title: "Edit src/Settings.tsx", kind: "edit", status: "completed", detail: "src/Settings.tsx" } }, ago(t0 - 0.5));
  item(prayer.id, "tool", { tool: { title: "Run npx tsc --noEmit", kind: "execute", status: "completed", detail: "$ npx tsc --noEmit\n(no errors)" } }, ago(t0 - 0.6));
  item(prayer.id, "assistant", {
    text: "Your prayer alarm for **Ajman** is ready:\n\n- Times for Fajr, Dhuhr, Asr, Maghrib and Isha, worked out on the phone\n- Each time can be moved earlier or later in *Settings*\n- Two reminders before each prayer, 30 and 10 minutes by default\n\nOpen it and allow notifications so the alarms can ring.",
  }, ago(t0 - 1));
  // A page (shared/chat/pages.ts): the plan the agent asks the person to confirm, and an answered one.
  mockPage = item(prayer.id, "page", { text: "Prayer Alarm: the plan", page: { id: "0f1e2d3c4b5a69788796a5b4c3d2e1f0", appId: prayer.id, title: "Prayer Alarm: the plan", questions: ["Build it?", "How should alarms sound?"], createdAt: ago(t0 - 0.05) } }, ago(t0 - 0.05));
  item(prayer.id, "page", { text: "Reminder sounds", page: { id: "aa11bb22cc33dd44ee55ff6677889900", appId: prayer.id, title: "Reminder sounds", questions: ["Which sound?"], answeredAt: ago(t0 - 0.06), createdAt: ago(t0 - 0.06) } }, ago(t0 - 0.06));
  item(prayer.id, "user", { text: '<page-answers page="aa11bb22cc33dd44ee55ff6677889900" title="Reminder sounds">\n{\n  "Which sound?": "Soft chime",\n  "Which sound? (note)": "not too loud at Fajr"\n}\n</page-answers>' }, ago(t0 - 0.07));
  const pb = seedBuild(prayer, 1, t0 - 3);
  item(prayer.id, "build", { build: pb }, ago(t0 - 3));
  recordBuild(prayer, pb);

  // "Making it" and "Building" finish a little after start, so the grid shows changes live.
  setTimeout(() => setStatus(sunrise, "idle"), 25000 / SPEED);
  setTimeout(() => {
    let done;
    try {
      done = { ...wb, status: "succeeded", finishedAt: now(), ...produceApk(water, 1) };
    } catch (e) {
      done = { ...wb, status: "failed", finishedAt: now(), error: e.message };
    }
    recordBuild(water, done);
    const it = chats.get(water.id).find((i) => i.kind === "build");
    update(it, { build: done });
    setStatus(water, done.status === "succeeded" ? "idle" : "error");
    if (done.status === "succeeded") broadcast({ type: "apk.ready", app: water });
  }, 90000 / SPEED);
}

// ---------- the scripted turn

const THOUGHT = "The user wants a change. I'll look at the current screen, make the change in one place, check that it still compiles, and keep the wording short.";
const ANSWER = (prompt) =>
  `Done. Here's what changed:\n\n1. ${capital(prompt.slice(0, 80))}${prompt.length > 80 ? "…" : ""}\n2. The settings screen keeps your choices after a restart\n3. Bigger buttons, easier to tap\n\n> Tip: open the app and try it. If something feels off, just tell me.\n\nThe code that matters:\n\n\`\`\`ts\nexport const reminders = [30, 10]; // minutes before\n\`\`\`\n\nI'm building the new version now, it will install by itself.`;

function capital(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

async function stream(it, text, chunkMs = 60, cancel) {
  const words = text.split(/(\s+)/);
  let out = "";
  for (let i = 0; i < words.length; i += 2) {
    if (cancel.cancelled) break;
    out += words.slice(i, i + 2).join("");
    update(it, { text: out, streaming: true });
    await sleep(chunkMs);
  }
  update(it, { text: cancel.cancelled ? out : text, streaming: false });
}

async function runTurn(app, prompt) {
  const cancel = { cancelled: false };
  turns.set(app.id, cancel);
  try {
    setStatus(app, "working");
    await sleep(700);

    const thought = item(app.id, "thought", { text: "", streaming: true });
    await stream(thought, THOUGHT, 90, cancel);
    if (cancel.cancelled) return stopped(app);

    const plan = item(app.id, "plan", {
      plan: [
        { content: "Look at the current app", status: "in_progress" },
        { content: "Make the change", status: "pending" },
        { content: "Check it still builds", status: "pending" },
      ],
    });
    const setPlan = (i) => update(plan, { plan: plan.plan.map((e, k) => ({ ...e, status: k < i ? "completed" : k === i ? "in_progress" : "pending" })) });

    const read = item(app.id, "tool", { tool: { title: "Read App.tsx", kind: "read", status: "in_progress", detail: "App.tsx" } });
    await sleep(1200);
    update(read, { tool: { ...read.tool, status: "completed" } });
    const search = item(app.id, "tool", { tool: { title: "Search for \"reminder\"", kind: "search", status: "in_progress" } });
    await sleep(900);
    update(search, { tool: { ...search.tool, status: "completed", detail: "src/Settings.tsx:14\nsrc/alarms.ts:3" } });
    setPlan(1);

    if (/permission/i.test(prompt)) {
      const requestId = randomUUID();
      const perm = item(app.id, "permission", {
        permission: {
          requestId,
          title: "Allow running `npm install expo-notifications`?",
          options: [
            { optionId: "allow", label: "Allow", kind: "allow_once" },
            { optionId: "always", label: "Always allow", kind: "allow_always" },
            { optionId: "reject", label: "Don't allow", kind: "reject_once" },
          ],
        },
      });
      const choice = await new Promise((resolve) => pendingPermissions.set(requestId, resolve));
      update(perm, { permission: { ...perm.permission, selectedOptionId: choice } });
      if (cancel.cancelled) return stopped(app);
    }

    for (const [file, ms] of [["App.tsx", 1300], ["src/Settings.tsx", 1100]]) {
      if (cancel.cancelled) return stopped(app);
      const edit = item(app.id, "tool", { tool: { title: `Edit ${file}`, kind: "edit", status: "in_progress", detail: file } });
      await sleep(ms);
      update(edit, { tool: { ...edit.tool, status: "completed", detail: `${file}\n- <Button title="Save" />\n+ <Button title="Save" size="large" />` } });
    }
    setPlan(2);
    const check = item(app.id, "tool", { tool: { title: "Run npx tsc --noEmit", kind: "execute", status: "in_progress", detail: "$ npx tsc --noEmit" } });
    await sleep(1600);
    update(check, { tool: { ...check.tool, status: "completed", detail: "$ npx tsc --noEmit\n(no errors)" } });
    setPlan(3);
    if (cancel.cancelled) return stopped(app);

    const answer = item(app.id, "assistant", { text: "", streaming: true });
    await stream(answer, ANSWER(prompt), 45, cancel);
    if (cancel.cancelled) return stopped(app);
    await runBuild(app, /fail/i.test(prompt));
  } finally {
    turns.delete(app.id);
  }
}

function stopped(app) {
  item(app.id, "error", { text: "Stopped. Nothing was built." });
  setStatus(app, "idle");
}

async function runBuild(app, fail = false) {
  const number = (app.latestBuild?.number ?? 0) + 1;
  const build = { number, status: "running", startedAt: now() };
  recordBuild(app, build);
  setStatus(app, "building");
  const it = item(app.id, "build", { build });
  await sleep(6000);
  let done;
  try {
    if (fail) throw new Error("Couldn't compile: App.tsx line 12, 'Buton' is not defined.");
    done = { ...build, status: "succeeded", finishedAt: now(), ...produceApk(app, number) };
  } catch (e) {
    done = { ...build, status: "failed", finishedAt: now(), error: e.message };
  }
  recordBuild(app, done);
  update(it, { build: done });
  if (done.status === "succeeded") {
    setStatus(app, "idle");
    broadcast({ type: "apk.ready", app });
  } else {
    setStatus(app, "error", { error: "The last build failed." });
  }
}

// ---------- HTTP

const json = (res, status, body) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(body === undefined ? "" : JSON.stringify(body));
};
const fail = (res, status, error) => json(res, status, { error });

async function body(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

const iconCache = new Map();

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  const path = url.pathname;
  const log = () => console.log(`${new Date().toLocaleTimeString()} ${req.method} ${req.url} -> ${res.statusCode}`);
  res.on("finish", log);
  try {
    if (path === "/api/health") return json(res, 200, { ok: true, name: SERVER_NAME, version: "mock-1", protocol: 1 });
    if (path === "/api/pair" && req.method === "POST") {
      const b = await body(req);
      if (String(b.code) !== CODE) return fail(res, 401, "That code didn't work. Check the code on your PC and try again.");
      const token = randomBytes(16).toString("hex");
      tokens.add(token);
      console.log(`paired: ${b.deviceName}`);
      return json(res, 200, { token, serverName: SERVER_NAME });
    }
    // The seeded page, served without a token at its signed address (here a fixed one).
    const pageRoute = path.match(/^\/page\/([0-9a-f]{32})\/mock(\/answers)?$/);
    if (pageRoute && mockPage) {
      if (!pageRoute[2]) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": "sandbox allow-scripts allow-forms allow-popups", "Cache-Control": "no-store" });
        return res.end(MOCK_PAGE_HTML);
      }
      const b = await body(req);
      const at = now();
      mockPage.page = { ...mockPage.page, answeredAt: at };
      mockPage.updatedAt = at;
      broadcast({ type: "chat.item", item: mockPage });
      item(mockPage.appId, "user", { text: '<page-answers page="' + mockPage.page.id + '" title="' + mockPage.page.title + '">\n' + JSON.stringify(b.answers, null, 2) + "\n</page-answers>" });
      res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      return res.end(JSON.stringify({ ok: true, answeredAt: at }));
    }
    const auth = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
    if (!tokens.has(auth)) return fail(res, 401, "This phone isn't paired with this PC.");

    if (path === "/api/apps" && req.method === "GET") {
      return json(res, 200, [...apps.values()]);
    }
    if (path === "/api/apps" && req.method === "POST") {
      const b = await body(req);
      const name = String(b.name ?? "").trim();
      const prompt = String(b.prompt ?? "").trim();
      if (!name || !prompt) return fail(res, 400, "Give the app a name and say what it should do.");
      if (apps.has(`app_${slugify(name)}`)) return fail(res, 409, `You already have an app called ${name}.`);
      const palette = [["#c2410c", "heart"], ["#5b7cfa", "coin"], ["#be185d", "heart"], ["#4d7c0f", "sun"]];
      const [color, glyph] = palette[apps.size % palette.length];
      const app = addApp({ name, status: "creating", color, glyph });
      json(res, 200, app);
      broadcast({ type: "app.updated", app });
      void (async () => {
        await sleep(3000);
        item(app.id, "user", { text: prompt });
        await runTurn(app, prompt);
      })();
      return;
    }
    const m = path.match(/^\/api\/apps\/([^/]+)(?:\/(.*))?$/);
    if (m) {
      const app = apps.get(decodeURIComponent(m[1]));
      if (!app) return fail(res, 404, "That app isn't on your PC any more.");
      const sub = m[2] ?? "";
      if (sub === "" && req.method === "GET") return json(res, 200, app);
      if (sub === "" && req.method === "DELETE") {
        apps.delete(app.id);
        broadcast({ type: "app.deleted", appId: app.id });
        res.writeHead(204);
        return res.end();
      }
      if (sub === "icon") {
        const look = looks.get(app.id) ?? { color: "#5b7cfa", glyph: "star" };
        const key = `${app.id}-${app.iconVersion}`;
        if (!iconCache.has(key)) iconCache.set(key, appIconPng(192, look.color, look.glyph, { fullBleed: true }));
        const png = iconCache.get(key);
        res.writeHead(200, { "Content-Type": "image/png", "Content-Length": png.length, "Cache-Control": "max-age=3600" });
        return res.end(png);
      }
      if (sub === "apk") {
        const n = app.latestApk?.number;
        const file = n ? apkPath(app, n) : null;
        if (!file || !existsSync(file)) return fail(res, 404, "There's no version of this app to install yet.");
        const size = statSync(file).size;
        const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? "");
        const headers = { "Content-Type": "application/vnd.android.package-archive", "Accept-Ranges": "bytes", "Content-Disposition": `attachment; filename="${app.slug}-${n}.apk"` };
        if (range) {
          const start = range[1] ? Number(range[1]) : 0;
          const end = range[2] ? Number(range[2]) : size - 1;
          res.writeHead(206, { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": end - start + 1 });
          return createReadStream(file, { start, end }).pipe(res);
        }
        res.writeHead(200, { ...headers, "Content-Length": size });
        return createReadStream(file).pipe(res);
      }
      if (sub === "messages" && req.method === "GET") {
        const after = url.searchParams.get("afterSeq");
        const list = chats.get(app.id) ?? [];
        return json(res, 200, after == null ? list : list.filter((i) => i.seq > Number(after)));
      }
      if (sub === "messages" && req.method === "POST") {
        const b = await body(req);
        const text = String(b.text ?? "").trim();
        if (!text) return fail(res, 400, "Type what you'd like to change.");
        if (app.status === "working" || app.status === "building" || app.status === "creating") {
          return fail(res, 409, `${app.name} is still busy. Wait for it to finish, or stop it.`);
        }
        json(res, 202);
        item(app.id, "user", { text });
        if (/^try again$/i.test(text)) void runBuild(app);
        else void runTurn(app, text);
        return;
      }
      const open = sub.match(/^pages\/([0-9a-f]{32})\/open$/);
      if (open && req.method === "POST") return json(res, 200, { path: "/page/" + open[1] + "/mock", expiresAt: new Date(Date.now() + 86400000).toISOString() });
      if (sub === "cancel" && req.method === "POST") {
        const turn = turns.get(app.id);
        if (turn) turn.cancelled = true;
        for (const [id, resolve] of pendingPermissions) {
          resolve("reject");
          pendingPermissions.delete(id);
        }
        return json(res, 202);
      }
      if (sub === "build" && req.method === "POST") {
        json(res, 202);
        void runBuild(app);
        return;
      }
      if (sub === "permission" && req.method === "POST") {
        const b = await body(req);
        const resolve = pendingPermissions.get(b.requestId);
        if (!resolve) return fail(res, 404, "That question was already answered.");
        pendingPermissions.delete(b.requestId);
        resolve(b.optionId);
        return json(res, 202);
      }
    }
    return fail(res, 404, "Not found.");
  } catch (e) {
    console.error(e);
    return fail(res, 500, e instanceof Error ? e.message : String(e));
  }
});

// ---------- WebSocket

const wss = new WebSocketServer({ noServer: true });
const sockets = new Set();

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", "http://x");
  if (url.pathname !== "/ws" || !tokens.has(url.searchParams.get("token") ?? "")) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    sockets.add(ws);
    ws.on("close", () => sockets.delete(ws));
    ws.send(JSON.stringify({ type: "hello", serverName: SERVER_NAME, protocol: 1 }));
    console.log(`socket open (${sockets.size})`);
  });
});

// Keep sockets honest: ping every 20 s.
setInterval(() => {
  for (const ws of sockets) ws.ping();
}, 20000).unref();

function broadcast(event) {
  const text = JSON.stringify(event);
  for (const ws of sockets) ws.send(text);
}

// ---------- start

seed();
server.listen(PORT, "0.0.0.0", () => {
  const ips = Object.values(networkInterfaces()).flat().filter((i) => i && i.family === "IPv4" && !i.internal).map((i) => i.address);
  console.log(`Kiwimake mock PC on port ${PORT}${toolchain() ? "" : " (no Android build-tools: builds can't make new APKs)"}`);
  console.log(`  pairing code: ${CODE}`);
  console.log(`  emulator:     10.0.2.2:${PORT}`);
  for (const ip of ips) console.log(`  QR text:      anyappagent://pair?url=${encodeURIComponent(`http://${ip}:${PORT}`)}&code=${CODE}`);
});
