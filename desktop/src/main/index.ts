// AnyAppAgent desktop: runs the companion, onboarding and the main window, sits in the tray.
import { app, BrowserWindow, clipboard, ipcMain, Menu, nativeImage, nativeTheme, Notification, shell, Tray } from "electron";
import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import QRCode from "qrcode";
import type { ChatItem } from "../../../shared/protocol.ts";
import type { Checks, ImageUpload, PairingView, PhoneDownload, PhoneRelease, Settings, Snapshot } from "../shared/types.ts";
import { PHONE_RELEASE_URL } from "../shared/types.ts";
// Window background before first paint, from the shared theme (shared/theme/tokens.ts).
import { color as themeColor } from "../../../shared/theme/tokens.ts";
import { AdminClient, lanAddresses } from "./admin-client.ts";
import { Companion } from "./companion.ts";
import { claudeCliCandidates, detectClaude } from "./detect/claude.ts";
import { detectGitHub, ghCandidates, type GhLocation } from "./detect/github.ts";
import { detectTools } from "./detect/tools.ts";
import { detectDeps } from "./detect/deps.ts";
import { run } from "./exec.ts";
import { ToolsInstaller } from "./install/tools-installer.ts";
import { firstExisting, resolvePaths } from "./paths.ts";
import { loadSettings, saveSettings } from "./settings.ts";
import { ClaudeSignIn, GitHubSignIn } from "./signin.ts";
import { runScreenshots } from "./shots.ts";

const here = dirname(fileURLToPath(import.meta.url));
const env = process.env;

// Tests and screenshots use their own settings folder (fresh onboarding) without touching the real one.
if (env.ANYAPP_DESKTOP_USERDATA) app.setPath("userData", env.ANYAPP_DESKTOP_USERDATA);
if (env.ANYAPP_DESKTOP_THEME === "dark" || env.ANYAPP_DESKTOP_THEME === "light") nativeTheme.themeSource = env.ANYAPP_DESKTOP_THEME;

const paths = resolvePaths({ packaged: app.isPackaged, resourcesPath: process.resourcesPath, appPath: app.getAppPath(), env });
const settingsFile = join(app.getPath("userData"), "settings.json");
let settings: Settings = loadSettings(settingsFile);
const port = Number(env.ANYAPP_PORT ?? 8787);
const mode: "real" | "fake" = env.ANYAPP_DESKTOP_COMPANION === "fake" ? "fake" : "real";
const adminToken = randomBytes(24).toString("base64url");
const logFile = join(app.getPath("userData"), "logs", "desktop.log");
const logTail: string[] = [];

function log(line: string): void {
  const stamped = `${new Date().toISOString()} ${line}`;
  logTail.push(stamped);
  if (logTail.length > 400) logTail.shift();
  try {
    mkdirSync(dirname(logFile), { recursive: true });
    appendFileSync(logFile, `${stamped}\n`);
  } catch {
    // logging must never break the app
  }
}

/** Dev only: ANYAPP_DESKTOP_SIMULATE="claude=needed,github=needed,tools=needed,phone=none" forces states for screenshots. */
const simulate = new Map((env.ANYAPP_DESKTOP_SIMULATE ?? "").split(",").filter(Boolean).map((kv) => kv.split("=") as [string, string]));

let win: BrowserWindow | undefined;
let tray: Tray | undefined;
let quitting = false;

const checks: Checks = {
  claude: { state: "checking", summary: "Checking…" },
  github: { state: "checking", summary: "Checking…" },
  tools: { state: "checking", summary: "Checking…", pieces: [] },
  phone: { state: "checking", summary: "Checking…", pairedCount: 0, connectedCount: 0 },
};

let ghLocation: GhLocation | undefined;
const claudeSignIn = new ClaudeSignIn();
const githubSignIn = new GitHubSignIn(paths.toolsDir);
let installer: ToolsInstaller | undefined;
const icons: Record<string, string> = {};
const iconVersions: Record<string, number> = {};
/** The AnyAppAgent phone app (APK) the companion serves for the install QR: the setting first, then the usual places. */
function phoneApk(): string | undefined {
  return firstExisting([settings.phoneApkPath || undefined, env.ANYAPP_HOST_APK || undefined, ...paths.phoneApkCandidates]);
}
let easyConnectAutoTried = false;

const claudeCli = () => firstExisting(claudeCliCandidates(paths.serverDir, env));

// ---------------------------------------------------------------- companion

const companion = new Companion({
  serverDir: paths.serverDir,
  fakeScript: join(app.getAppPath(), "dev", "fake-companion.mjs"),
  mode,
  port,
  adminToken,
  log,
  env: () => {
    const t = checks.tools.env;
    return {
      ...(t?.JAVA_HOME ? { JAVA_HOME: t.JAVA_HOME } : {}),
      ...(t?.ANDROID_HOME ? { ANDROID_HOME: t.ANDROID_HOME, ANDROID_SDK_ROOT: t.ANDROID_HOME } : {}),
      ...(t?.gitBash ? { CLAUDE_CODE_GIT_BASH_PATH: t.gitBash } : {}),
      // The companion serves the phone app at /download/anyappagent.apk for the install QR.
      ...(phoneApk() ? { ANYAPP_HOST_APK: phoneApk() } : {}),
      // The builder also reads these first (builder/lib/env.mjs).
      ...(t?.JAVA_HOME ? { ANYAPP_JAVA_HOME: t.JAVA_HOME } : {}),
      ...(t?.ANDROID_HOME ? { ANYAPP_ANDROID_HOME: t.ANDROID_HOME } : {}),
    };
  },
  pathPrefix: () => [...(checks.tools.env?.path ?? []), ...(ghLocation?.source === "tools" ? [dirname(ghLocation.path)] : [])],
});

let admin: AdminClient | undefined;

companion.on("status", (status) => {
  if (status.phase === "starting" || status.phase === "restarting") void connectAdmin();
  if (status.phase === "stopped" || status.phase === "failed") {
    admin?.close();
    admin = undefined;
  }
  broadcast();
  updateTray();
});

let connecting = false;
async function connectAdmin(): Promise<void> {
  if (connecting) return;
  connecting = true;
  try {
    admin?.close();
    const client = new AdminClient(`http://127.0.0.1:${port}`, adminToken, paths.stateDir, port, log);
    admin = client;
    const ok = await client.waitHealthy(90_000);
    if (!ok || admin !== client) return;
    client.on("state", () => {
      updatePhoneCheck();
      broadcast();
    });
    client.on("apps", () => {
      void loadIcons();
      broadcast();
    });
    client.on("chat", (item: ChatItem) => win?.webContents.send("chat:item", item));
    await client.connect();
    companion.markRunning(client.adminRoutes);
    log(`[desktop] companion answering; admin routes: ${client.adminRoutes ? "yes" : "no (fallback)"}`);
    updatePhoneCheck();
    void loadIcons();
    broadcast();
  } finally {
    connecting = false;
  }
}

async function loadIcons(): Promise<void> {
  if (!admin) return;
  for (const a of admin.apps) {
    if (iconVersions[a.id] === a.iconVersion && icons[a.id]) continue;
    const data = await admin.icon(a.id);
    if (data) {
      icons[a.id] = data;
      iconVersions[a.id] = a.iconVersion;
    }
  }
  broadcast();
}

// ---------------------------------------------------------------- checks

function updatePhoneCheck(): void {
  const devices = admin?.state?.devices ?? [];
  const forced = simulate.get("phone");
  const paired = forced === "none" ? 0 : devices.length;
  const connected = forced === "none" ? 0 : devices.filter((d) => d.connected).length;
  checks.phone = {
    state: paired > 0 ? "done" : "needed",
    summary: paired === 0 ? "No phone connected yet." : paired === 1 ? `${devices[0].name} is connected.` : `${paired} phones are connected.`,
    pairedCount: paired,
    connectedCount: connected,
  };
}

async function checkClaude(): Promise<void> {
  if (claudeSignIn.running) return;
  const result = await detectClaude(claudeCli(), run);
  const forced = simulate.get("claude");
  checks.claude =
    forced === "needed"
      ? { state: "needed", summary: "Claude is not signed in on this PC yet." }
      : forced === "signing-in"
        ? { state: "working", summary: "Signing in…", signingIn: true, loginUrl: "https://claude.com/cai/oauth/authorize" }
        : result;
  if (claudeSignIn.error && checks.claude.state !== "done") checks.claude.error = claudeSignIn.error;
  broadcast();
}

async function checkGitHub(): Promise<void> {
  if (githubSignIn.flow) return;
  ghLocation = ghCandidates(paths.toolsDir, env).find((c) => existsSync(c.path));
  const result = await detectGitHub(ghLocation, run, settings.githubSkipped);
  const forced = simulate.get("github");
  checks.github =
    forced === "needed"
      ? { state: "needed", summary: "Not connected yet.", source: "system" }
      : forced === "code"
        ? { state: "working", summary: "Signing in…", source: "system", flow: { phase: "code", code: "WDJB-MJHT", url: "https://github.com/login/device" } }
        : result;
  if (githubSignIn.error && checks.github.state !== "done") checks.github.error = githubSignIn.error;
  broadcast();
}

async function checkTools(): Promise<void> {
  if (installer) return;
  const result = await detectTools({ toolsDir: paths.toolsDir, env, runner: run });
  // The builder's dependency cache is the fifth piece: without it the first app waits minutes.
  const deps = await detectDeps(paths.repoRoot);
  result.pieces.push({ id: "deps", label: "App starter kit", ok: deps.ok, path: deps.dir, source: deps.ok ? "tools" : "none" });
  if (deps.error) log(`[tools] could not check the builder's cache: ${deps.error}`);
  if (!deps.ok && result.state === "done") {
    result.state = "needed";
    result.summary = "Almost ready: one more download (about 450 MB).";
  }
  const forced = simulate.get("tools");
  if (forced === "needed" || forced === "installing") {
    checks.tools = { ...result, state: "needed", summary: "Needs a one-time download (about 2.5 GB).", pieces: result.pieces.map((p) => ({ ...p, ok: p.id === "git", source: p.id === "git" ? "system" : "none" })) };
    if (forced === "installing") {
      checks.tools = { ...checks.tools, state: "working", install: { running: true, progress: 0.46, label: "Getting the Android native kit (the biggest part)", detail: "Downloading…" } };
    }
  } else {
    checks.tools = { ...result, install: checks.tools.install?.error ? checks.tools.install : undefined };
  }
  broadcast();
}

async function recheckAll(): Promise<void> {
  await Promise.all([checkClaude(), checkGitHub(), checkTools()]);
  updatePhoneCheck();
  broadcast();
}

claudeSignIn.on("change", () => {
  checks.claude = {
    ...checks.claude,
    signingIn: claudeSignIn.running,
    loginUrl: claudeSignIn.url,
    state: claudeSignIn.running ? "working" : checks.claude.state === "working" ? "needed" : checks.claude.state,
    error: claudeSignIn.error,
  };
  broadcast();
});
claudeSignIn.on("done", () => void checkClaude());

// While the browser sign-in runs, look every 3 s: finishing in the browser ends it.
setInterval(async () => {
  if (!claudeSignIn.running) return;
  const cli = claudeCli();
  const result = await detectClaude(cli, run);
  if (result.state === "done") {
    claudeSignIn.cancel();
    checks.claude = result;
    broadcast();
  }
}, 3_000);

githubSignIn.on("change", () => {
  const flow = githubSignIn.flow;
  checks.github = flow
    ? { ...checks.github, state: "working", flow, error: undefined }
    : { ...checks.github, flow: undefined, error: githubSignIn.error, state: checks.github.state === "working" ? "needed" : checks.github.state };
  broadcast();
});
githubSignIn.on("done", async () => {
  await checkGitHub();
  // A gh we downloaded must be on the companion's PATH: restart it once GitHub is connected.
  if (checks.github.state === "done" && ghLocation?.source === "tools") await companion.restart();
});

async function installTools(): Promise<void> {
  if (installer) return;
  const pieces = checks.tools.pieces;
  installer = new ToolsInstaller({
    toolsDir: paths.toolsDir,
    pieces,
    log,
    warm: {
      cli: join(paths.repoRoot, "builder", "cli.mjs"),
      probeDir: join(paths.appsDir, "warm-probe"),
      env: { ...process.env, PATH: [...(checks.tools.env?.path ?? []), process.env.PATH ?? ""].join(";") },
    },
    onProgress: (p) => {
      checks.tools = { ...checks.tools, state: "working", install: { running: true, progress: p.progress, label: p.label, detail: p.detail } };
      broadcast();
    },
  });
  checks.tools = { ...checks.tools, state: "working", install: { running: true, progress: 0, label: "Starting…" } };
  broadcast();
  try {
    await installer.run();
    installer = undefined;
    checks.tools.install = undefined;
    await checkTools();
    // The companion needs JAVA_HOME / ANDROID_HOME from the new tools.
    await companion.restart();
  } catch (error) {
    installer = undefined;
    const message = (error as Error).message;
    log(`[tools] failed: ${message}`);
    await checkTools();
    checks.tools = { ...checks.tools, install: { running: false, progress: 0, label: "", error: message === "Stopped." ? "Stopped. You can start again any time; finished parts are kept." : message } };
    broadcast();
  }
}

// ---------------------------------------------------------------- snapshot

const qrCache = new Map<string, string>();
/** Long payloads (the ~354-character Easy Connect code) get more error correction ("Q"). */
async function qrSvg(payload: string): Promise<string> {
  let svg = qrCache.get(payload);
  if (!svg) {
    const level = payload.length > 200 ? "Q" : "M";
    svg = await QRCode.toString(payload, { type: "svg", margin: 2, errorCorrectionLevel: level, color: { dark: "#000000", light: "#ffffff" } });
    qrCache.set(payload, svg);
  }
  return svg;
}

async function pairingView(): Promise<PairingView> {
  const s = admin?.state;
  if (!s) return { kind: "none", otherAddresses: [], easyConnect: "off" };
  const code = s.pairing.code.length === 6 ? `${s.pairing.code.slice(0, 3)} ${s.pairing.code.slice(3)}` : s.pairing.code;
  const base = {
    code,
    address: s.pairing.lanUrls[0],
    otherAddresses: s.pairing.lanUrls.slice(1),
    easyConnect: s.easyConnect.state,
    easyConnectError: s.easyConnect.error,
    easyConnectDetail: s.easyConnect.state === "starting" ? (s.easyConnect as { detail?: string }).detail : undefined,
    // Ready without a code: the last one was used or expired; the panel asks for a new one.
    needsNewCode: s.easyConnect.state === "ready" && !s.easyConnect.code,
  };
  if (s.easyConnect.state === "ready" && s.easyConnect.code)
    return {
      ...base,
      kind: "easy-connect",
      qrSvg: await qrSvg(s.easyConnect.code),
      // For a phone that cannot scan: the same code as a link the AnyAppAgent app opens.
      easyConnectLink: `anyappagent://pair?ec=${s.easyConnect.code}`,
    };
  return { ...base, kind: "same-network", qrSvg: await qrSvg(s.pairing.qrPayload) };
}

async function snapshot(): Promise<Snapshot> {
  return {
    companion: companion.status,
    admin: admin?.state ?? null,
    pairing: await pairingView(),
    apps: admin?.apps ?? [],
    icons,
    checks,
    settings,
    advanced: { toolsDir: paths.toolsDir, stateDir: paths.stateDir, appsDir: paths.appsDir, companionDir: paths.serverDir, logTail: logTail.slice(-80) },
  };
}

let broadcastTimer: NodeJS.Timeout | undefined;
function broadcast(): void {
  if (broadcastTimer) return;
  broadcastTimer = setTimeout(async () => {
    broadcastTimer = undefined;
    if (win && !win.isDestroyed()) win.webContents.send("snapshot", await snapshot());
  }, 60);
}

function setSetting<K extends keyof Settings>(key: K, value: Settings[K]): void {
  settings = { ...settings, [key]: value };
  saveSettings(settingsFile, settings);
  if (key === "startWithWindows") {
    app.setLoginItemSettings({ openAtLogin: Boolean(value), args: ["--hidden"] });
    updateTray();
  }
  if (key === "githubSkipped") void checkGitHub();
  // The companion reads ANYAPP_HOST_APK at start.
  if (key === "phoneApkPath") void companion.restart();
  broadcast();
}

// ---------------------------------------------------------------- window and tray

/** The shared Windows icons (shared/theme/mark/windows); packaged under resources/mark. */
function markFile(name: string): string {
  return app.isPackaged ? join(process.resourcesPath, "mark", name) : join(paths.repoRoot, "shared", "theme", "mark", "windows", name);
}

function appIcon(name = "anyappagent.ico"): Electron.NativeImage {
  const file = markFile(name);
  return existsSync(file) ? nativeImage.createFromPath(file) : nativeImage.createEmpty();
}

function createWindow(show: boolean): void {
  const dark = nativeTheme.shouldUseDarkColors;
  win = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: "AnyAppAgent",
    icon: appIcon(),
    backgroundColor: dark ? themeColor.dark.bg : themeColor.light.bg,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(here, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.setMenuBarVisibility(false);
  win.once("ready-to-show", () => {
    if (show) win?.show();
  });
  win.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    win?.hide();
    if (!settings.closeHintShown && Notification.isSupported()) {
      new Notification({ title: "AnyAppAgent is still running", body: "Your PC keeps making apps for your phone. Find AnyAppAgent next to the clock.", icon: appIcon("icon-256.png") }).show();
      setSetting("closeHintShown", true);
    }
  });
  // Links open in the browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith("http://localhost") && !url.startsWith("file:")) event.preventDefault();
  });
  if (!app.isPackaged && env.ELECTRON_RENDERER_URL) void win.loadURL(env.ELECTRON_RENDERER_URL);
  else void win.loadFile(join(here, "../renderer/index.html"));
}

function showWindow(where?: "connect-phone"): void {
  if (!win || win.isDestroyed()) createWindow(true);
  win?.show();
  win?.focus();
  if (where) win?.webContents.send("navigate", where);
}

function updateTray(): void {
  if (!tray) return;
  const status = companion.status;
  const label = status.phase === "running" ? "Ready to make apps" : status.phase === "failed" ? "Needs attention" : "Starting…";
  tray.setToolTip(`AnyAppAgent: ${label}`);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `AnyAppAgent: ${label}`, enabled: false },
      { type: "separator" },
      { label: "Open AnyAppAgent", click: () => showWindow() },
      { label: "Connect a phone", click: () => showWindow("connect-phone") },
      { type: "separator" },
      { label: "Start with Windows", type: "checkbox", checked: settings.startWithWindows, click: (item) => setSetting("startWithWindows", item.checked) },
      { label: "Quit AnyAppAgent", click: () => app.quit() },
    ]),
  );
}

// ---------------------------------------------------------------- IPC

function ipc(): void {
  ipcMain.handle("snapshot", () => snapshot());
  ipcMain.handle("recheck", () => recheckAll());
  ipcMain.handle("claude:signin", () => {
    const cli = claudeCli();
    if (cli) claudeSignIn.start(cli);
  });
  ipcMain.handle("claude:cancel", () => claudeSignIn.cancel());
  ipcMain.handle("claude:code", (_e, code: string) => claudeSignIn.submitCode(String(code)));
  ipcMain.handle("github:start", () => void githubSignIn.start(ghLocation?.path));
  ipcMain.handle("github:open", async () => {
    const url = githubSignIn.flow?.url ?? "https://github.com/login/device";
    await shell.openExternal(url);
    githubSignIn.opened();
  });
  ipcMain.handle("github:cancel", () => githubSignIn.cancel());
  ipcMain.handle("github:skip", (_e, skipped: boolean) => setSetting("githubSkipped", Boolean(skipped)));
  ipcMain.handle("tools:install", () => void installTools());
  ipcMain.handle("tools:cancel", () => installer?.cancel());
  ipcMain.handle("phone:download", async (): Promise<PhoneDownload> => {
    // The companion serves the phone app without a token at /download/anyappagent.apk
    // (ANYAPP_HOST_APK); the QR encodes that link on this PC's best LAN address.
    const apk = phoneApk();
    if (!apk) return { available: false };
    try {
      const res = await fetch(`http://127.0.0.1:${port}/download/anyappagent.apk`, { method: "HEAD", signal: AbortSignal.timeout(3_000) });
      if (!res.ok) return { available: false };
    } catch {
      return { available: false };
    }
    const url = `http://${lanAddresses()[0] ?? "127.0.0.1"}:${port}/download/anyappagent.apk`;
    const { statSync } = await import("node:fs");
    return { available: true, url, qrSvg: await qrSvg(url), sizeBytes: statSync(apk).size };
  });
  // The phone app from this project's public GitHub release: works on any network, phone camera only.
  ipcMain.handle("phone:release", async (): Promise<PhoneRelease> => ({ url: PHONE_RELEASE_URL, qrSvg: await qrSvg(PHONE_RELEASE_URL) }));
  // The phone step turns Easy Connect on once (it is off by default and its first start takes a few minutes).
  ipcMain.handle("pairing:easy-auto", async () => {
    if (easyConnectAutoTried || !admin?.adminRoutes || admin.state?.easyConnect.state !== "off") return;
    easyConnectAutoTried = true;
    log("[desktop] turning Easy Connect on for the phone step");
    await admin.easyConnect(true).catch((e) => log(`[desktop] easy connect: ${(e as Error).message}`));
  });
  ipcMain.handle("pairing:new", () => admin?.newPairing());
  ipcMain.handle("pairing:easy", (_e, enabled: boolean) => admin?.easyConnect(Boolean(enabled)));
  ipcMain.handle("devices:remove", (_e, id: string) => admin?.removeDevice(String(id)));
  ipcMain.handle("apps:messages", (_e, appId: string) => admin?.messages(String(appId)) ?? []);
  // Chat actions answer { ok, error } with a plain sentence instead of throwing across IPC.
  const chatAction = (run: (client: AdminClient) => Promise<unknown>) => async () => {
    try {
      if (!admin) throw new Error("AnyAppAgent is still starting.");
      const value = await run(admin);
      return { ok: true, ...(value && typeof value === "object" ? { app: value } : {}) };
    } catch (error) {
      const message = (error as Error).message;
      return { ok: false, error: /fetch failed|ECONNREFUSED|aborted|timeout/i.test(message) ? "The companion on this PC is not answering. It restarts by itself; try again in a moment." : message };
    }
  };
  ipcMain.handle("apps:send", (_e, appId: string, text: string, images?: ImageUpload[]) =>
    chatAction((c) => c.send(String(appId), String(text), Array.isArray(images) ? images : []))(),
  );
  ipcMain.handle("apps:image", (_e, appId: string, imageId: string) => admin?.image(String(appId), String(imageId)));
  ipcMain.handle("apps:cancel", (_e, appId: string) => chatAction((c) => c.cancel(String(appId)))());
  ipcMain.handle("apps:rebuild", (_e, appId: string) => chatAction((c) => c.rebuild(String(appId)))());
  ipcMain.handle("apps:permission", (_e, appId: string, requestId: string, optionId: string) =>
    chatAction((c) => c.answerPermission(String(appId), String(requestId), String(optionId)))(),
  );
  ipcMain.handle("apps:create", (_e, name: string, prompt: string, preset?: string) =>
    // Only a known preset passes; anything else is the default (React Native).
    chatAction((c) => c.createApp(String(name), String(prompt), preset === "kotlin" ? "kotlin" : undefined))(),
  );
  ipcMain.handle("settings:set", (_e, key: keyof Settings, value: unknown) => {
    if (key in settings && typeof value === typeof settings[key]) setSetting(key, value as never);
  });
  ipcMain.handle("companion:restart", () => companion.restart());
  ipcMain.handle("app:quit", () => app.quit());
  ipcMain.handle("copy", (_e, text: string) => clipboard.writeText(String(text)));
  ipcMain.handle("open-external", (_e, url: string) => {
    if (/^https:\/\//.test(String(url))) return shell.openExternal(String(url));
  });
  ipcMain.handle("open-folder", (_e, which: "tools" | "state" | "apps") => {
    const dir = which === "tools" ? paths.toolsDir : which === "state" ? paths.stateDir : paths.appsDir;
    mkdirSync(dir, { recursive: true });
    return shell.openPath(dir);
  });
}

// ---------------------------------------------------------------- lifecycle

if (!app.requestSingleInstanceLock() || process.argv.includes("--quit")) {
  app.quit();
} else {
  // `AnyAppAgent.exe --quit` asks the running app to quit the normal way (as Quit in the tray does), for updates.
  app.on("second-instance", (_e, argv) => (argv.includes("--quit") ? app.quit() : showWindow()));
  app.setAppUserModelId("com.anyappagent.desktop");

  app.whenReady().then(async () => {
    log(`[desktop] start ${app.getVersion()} mode=${mode} port=${port} electron=${process.versions.electron} node=${process.versions.node}`);
    ipc();
    const hidden = process.argv.includes("--hidden");
    createWindow(!hidden);
    tray = new Tray(markFile("tray.png"));
    tray.on("click", () => showWindow());
    updateTray();
    if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: settings.startWithWindows, args: ["--hidden"] });

    // Tools first: the companion gets JAVA_HOME / ANDROID_HOME from them.
    await checkTools();
    companion.start();
    void checkClaude();
    void checkGitHub();

    win?.on("focus", () => {
      void checkClaude();
      void checkGitHub();
    });
    if (env.ANYAPP_DESKTOP_SHOTS && win) {
      const pairFakePhone = async () => {
        await fetch(`http://127.0.0.1:${port}/__fake/pair-phone`, { method: "POST", body: JSON.stringify({ name: "Pixel 7" }) });
      };
      void runScreenshots(win, env.ANYAPP_DESKTOP_SHOTS, log, mode === "fake" ? { pairFakePhone } : {}).then(() => app.quit());
    }
  });

  app.on("window-all-closed", () => {
    // Stay in the tray.
  });

  app.on("before-quit", (event) => {
    if (quitting) return;
    quitting = true;
    event.preventDefault();
    log("[desktop] quitting: stopping the companion");
    win?.hide();
    claudeSignIn.cancel();
    githubSignIn.cancel();
    installer?.cancel();
    admin?.close();
    void companion.stop().finally(() => {
      log("[desktop] companion stopped; bye");
      tray?.destroy();
      app.exit(0);
    });
  });
}
