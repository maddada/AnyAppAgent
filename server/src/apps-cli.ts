// The `anyapp` command: lets an app's agent see the person's other apps (list them, read each
// one's overview.md, find its folder to read its code) so it can reuse what already works.
//
// It reads the companion's state folder (apps.json) and the apps' folders directly, and never talks
// to the running companion. Why: the only token that could read the app list over HTTP is the admin
// token, which can also delete apps and pair phones, and it must never sit in an agent's
// environment. Reading files needs no secret, works while the companion is busy or restarting, and
// is read only by construction. apps.json is written atomically, so a read never sees half a file.
//
// The companion installs it at start (installAppsCli): small `anyapp` and `anyapp.cmd` launchers in
// <state>/bin that run this file with the companion's own Node (Electron in Node mode when the
// desktop app runs it). Each Claude Code session it starts gets that folder first on PATH, plus
// ANYAPP_CLI_STATE_DIR (which companion's apps) and ANYAPP_CLI_APP (which app is "this app").
// A dev companion on its own port and state folder installs its own launchers there, so its agents
// see its apps, never the user's.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { App } from "../../shared/protocol.ts";

export const OVERVIEW_FILE = "overview.md";
/** First line of an overview.md the PC wrote (from the first message or the chat), not the agent. */
export const OVERVIEW_DRAFT_MARK = "<!-- anyapp: draft written by the PC; the app's agent rewrites it -->";
export const CLI_NAME = "anyapp";
export const ENV_STATE_DIR = "ANYAPP_CLI_STATE_DIR";
export const ENV_SELF_APP = "ANYAPP_CLI_APP";

const CLI_ENTRY = resolve(dirname(fileURLToPath(import.meta.url)), "..", "bin", "anyapp.mjs");

interface StoredRecord {
  app: App;
  dir: string;
  deleted?: boolean;
  ready?: boolean;
}

export interface CliApp {
  id: string;
  slug: string;
  name: string;
  preset: string;
  /** The newest build that installs (its Android versionCode), or null before the first one. */
  version: number | null;
  status: string;
  folder: string;
  hasOverview: boolean;
  self: boolean;
}

export function defaultStateDir(): string {
  return join(homedir(), ".anyappagent");
}

export function loadApps(stateDir: string, selfId?: string): CliApp[] {
  const path = join(stateDir, "apps.json");
  if (!existsSync(path)) return [];
  const records = JSON.parse(readFileSync(path, "utf8")) as StoredRecord[];
  return records
    .filter((r) => !r.deleted && r.app && typeof r.dir === "string")
    .map((r) => ({
      id: r.app.id,
      slug: r.app.slug,
      name: r.app.name,
      preset: r.app.preset ?? "react-native",
      version: r.app.latestApk?.number ?? null,
      status: r.app.status,
      folder: r.dir,
      hasOverview: existsSync(join(r.dir, OVERVIEW_FILE)),
      self: selfId !== undefined && r.app.id === selfId,
    }));
}

/** Finds an app by id, id prefix (8+ characters), slug, package name, name, or "self". */
export function findApp(apps: CliApp[], query: string): CliApp | undefined {
  const q = query.trim().toLowerCase();
  if (q === "") return undefined;
  if (q === "self" || q === ".") return apps.find((a) => a.self);
  return (
    apps.find((a) => a.id.toLowerCase() === q) ??
    apps.find((a) => a.slug.toLowerCase() === q) ??
    apps.find((a) => `com.anyapp.${a.slug}` === q) ??
    apps.find((a) => a.name.toLowerCase() === q) ??
    (q.length >= 8 ? apps.find((a) => a.id.toLowerCase().startsWith(q)) : undefined)
  );
}

/** Builds overview.md text when an app has none yet: APP_MEMORY.md, else what the person first asked. */
function fallbackOverview(stateDir: string, app: CliApp): string {
  const memory = join(app.folder, "APP_MEMORY.md");
  if (existsSync(memory)) {
    return `(${app.name} has no ${OVERVIEW_FILE} yet. Its agent's notes, APP_MEMORY.md, instead:)\n\n${readFileSync(memory, "utf8").trim()}\n`;
  }
  const asks = userPrompts(stateDir, app.id).slice(0, 6);
  if (asks.length === 0) return `(${app.name} has no ${OVERVIEW_FILE} yet and no notes.)\n`;
  return `(${app.name} has no ${OVERVIEW_FILE} yet. What the person asked for in its chat:)\n\n${asks.map((t) => `- ${t}`).join("\n")}\n`;
}

/** The person's own messages in an app's chat, oldest first, each on one line and shortened. */
export function userPrompts(stateDir: string, appId: string): string[] {
  const path = join(stateDir, "chat", `${appId}.json`);
  if (!existsSync(path)) return [];
  const items = JSON.parse(readFileSync(path, "utf8")) as { kind: string; text?: string; seq: number }[];
  return items
    .filter((i) => i.kind === "user" && typeof i.text === "string" && i.text.trim() !== "")
    .sort((a, b) => a.seq - b.seq)
    .map((i) => {
      const line = i.text!.replace(/\s+/g, " ").trim();
      return line.length > 300 ? `${line.slice(0, 299)}…` : line;
    });
}

const HELP = `anyapp: the person's other apps on this PC, to reuse what already works.

  anyapp apps [--json]      Every app: slug, name, preset, version, folder ("*" marks this app)
  anyapp overview <app>     Print the app's overview.md (what the person wants it to do)
  anyapp path <app>         Print the app's folder, to read its code
  anyapp copy <app>         Fetch an app's code into a new read-only scratch folder and print it:
                            one of these apps, or someone's shared app by its releases page
                            (owner/anyapp-<slug>-releases or its GitHub link; --build <n> for an
                            older published version). Take from it only what the person asked for.

<app> is a slug, a name, an id, or "self". Other apps are read only: read and copy from their
folders, never change, build or commit anything in them.`;

export interface CliResult {
  code: number;
  out: string;
}

function pad(text: string, width: number): string {
  return text.length >= width ? text : text + " ".repeat(width - text.length);
}

export function runCli(argv: string[], env: NodeJS.ProcessEnv = process.env): CliResult {
  const args = [...argv];
  let stateDir: string | undefined;
  let fallbackDir: string | undefined;
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--state-dir") stateDir = args[++i];
    else if (a.startsWith("--state-dir=")) stateDir = a.slice("--state-dir=".length);
    else if (a.startsWith("--default-state-dir=")) fallbackDir = a.slice("--default-state-dir=".length);
    else rest.push(a);
  }
  const dir = resolve(stateDir || env[ENV_STATE_DIR] || fallbackDir || defaultStateDir());
  const json = rest.includes("--json");
  // A name with spaces works without quotes: `anyapp overview Ajman Prayers`.
  const [command, ...words] = rest.filter((a) => a !== "--json");
  const target = words.length > 0 ? words.join(" ") : undefined;
  const self = env[ENV_SELF_APP] || undefined;

  if (!command || command === "help" || command === "--help" || command === "-h") return { code: 0, out: HELP };

  let apps: CliApp[];
  try {
    apps = loadApps(dir, self);
  } catch (error) {
    return { code: 1, out: `Could not read the app list in ${dir}: ${(error as Error).message}` };
  }

  if (command === "apps" || command === "list") {
    if (json) return { code: 0, out: JSON.stringify(apps, null, 2) };
    if (apps.length === 0) return { code: 0, out: `No apps yet (state folder ${dir}).` };
    const rows = apps.map((a) => [
      `${a.self ? "*" : " "} ${a.slug}`,
      a.name,
      a.preset,
      a.version === null ? "no build yet" : `build ${a.version}`,
      a.folder,
    ]);
    const header = ["  SLUG", "NAME", "PRESET", "VERSION", "FOLDER"];
    const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)));
    const line = (r: string[]) => r.map((c, i) => (i === r.length - 1 ? c : pad(c, widths[i]!))).join("  ");
    const ids = apps.map((a) => `  ${a.slug}: ${a.id}${a.hasOverview ? "" : " (no overview.md yet)"}`);
    return { code: 0, out: [line(header), ...rows.map(line), "", "Ids:", ...ids].join("\n") };
  }

  if (command === "overview" || command === "path") {
    if (!target) return { code: 2, out: `Say which app: anyapp ${command} <app>. "anyapp apps" lists them.` };
    const app = findApp(apps, target);
    if (!app) return { code: 1, out: `No app "${target}". These are the apps: ${apps.map((a) => a.slug).join(", ") || "none"}.` };
    if (command === "path") return { code: 0, out: app.folder };
    const file = join(app.folder, OVERVIEW_FILE);
    if (!existsSync(file)) return { code: 0, out: fallbackOverview(dir, app).trimEnd() };
    const text = readFileSync(file, "utf8").replace(OVERVIEW_DRAFT_MARK, "").trim();
    return { code: 0, out: `${text}\n\n(Folder: ${app.folder})` };
  }

  return { code: 2, out: `Unknown command "${command}".\n\n${HELP}` };
}

// ---------- installing it for the agents

/** Writes <state>/bin/anyapp (sh, for Git Bash) and anyapp.cmd (cmd and PowerShell). Returns the folder. */
export function installAppsCli(stateDir: string, nodePath: string = process.execPath): string {
  const binDir = join(stateDir, "bin");
  mkdirSync(binDir, { recursive: true });
  const entry = CLI_ENTRY;
  const state = resolve(stateDir);
  // ELECTRON_RUN_AS_NODE: under the desktop app, process.execPath is AnyAppAgent.exe in Node mode.
  const cmd = [
    "@echo off",
    "setlocal",
    "set ELECTRON_RUN_AS_NODE=1",
    `"${nodePath}" "${entry}" "--default-state-dir=${state}" %*`,
    "",
  ].join("\r\n");
  const slash = (p: string) => p.replace(/\\/g, "/");
  const sh = [
    "#!/bin/sh",
    `ELECTRON_RUN_AS_NODE=1 exec "${slash(nodePath)}" "${slash(entry)}" "--default-state-dir=${slash(state)}" "$@"`,
    "",
  ].join("\n");
  writeIfChanged(join(binDir, `${CLI_NAME}.cmd`), cmd);
  writeIfChanged(join(binDir, CLI_NAME), sh, 0o755);
  return binDir;
}

function writeIfChanged(path: string, text: string, mode?: number): void {
  if (existsSync(path) && readFileSync(path, "utf8") === text) return;
  writeFileSync(path, text, mode === undefined ? undefined : { mode });
}

/** The environment an app's (or a helper's) Claude Code session gets so `anyapp` works in it. */
export function appsCliEnv(stateDir: string, appId: string, base: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const pathKey = Object.keys(base).find((k) => k.toLowerCase() === "path") ?? "PATH";
  const binDir = join(stateDir, "bin");
  return {
    [pathKey]: [binDir, base[pathKey] ?? ""].filter(Boolean).join(delimiter),
    [ENV_STATE_DIR]: resolve(stateDir),
    [ENV_SELF_APP]: appId,
  };
}

// ---------- overview.md drafts written by the PC

/** The first overview.md of a new app, from its name and the person's first message. */
export function firstOverview(name: string, prompt: string): string {
  return `${OVERVIEW_DRAFT_MARK}
# ${name}

What the person asked for when they made this app:

> ${prompt.trim().replace(/\r?\n/g, "\n> ")}
`;
}

/** An overview.md for an app made before overviews existed, from its notes or its chat. */
export function backfillOverview(stateDir: string, app: { id: string; name: string; folder: string }): string {
  const asks = userPrompts(stateDir, app.id).slice(0, 12);
  const lines = asks.length ? asks.map((t) => `- ${t}`).join("\n") : "- (no messages yet)";
  return `${OVERVIEW_DRAFT_MARK}
# ${app.name}

What the person asked for in this app's chat, oldest first:

${lines}
`;
}

/** True when the app has no overview.md, or only a draft the PC wrote: its agent should write it. */
export function overviewNeedsAgent(dir: string): boolean {
  const file = join(dir, OVERVIEW_FILE);
  if (!existsSync(file)) return true;
  return readFileSync(file, "utf8").startsWith(OVERVIEW_DRAFT_MARK);
}

// ---------- anyapp copy: another app's code, read only, for taking a piece of it (docs/CHANGE-THIS-APP.md)

/** A scratch folder name: letters, digits and dashes, plus the time. */
function scratchName(label: string): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*$/, "").replace("T", "-");
  return `${label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "app"}-${stamp}`;
}

/**
 * `anyapp copy <app | owner/anyapp-<slug>-releases | github link> [--build <n>]`. Own apps: the
 * committed code (git archive of HEAD, so no build output or secrets files). Shared apps: the code
 * zip of a published version, downloaded anonymously. Either lands in <state>/scratch/copies/...,
 * every file read only.
 */
export async function runCopy(argv: string[], env: NodeJS.ProcessEnv = process.env, fetchImpl: typeof fetch = fetch): Promise<CliResult> {
  const { downloadSource, extractZip, findReleaseSource, makeReadOnly, repoFromText, SourceError, SOURCE_LEFT_OUT } = await import("./release-source.ts");
  let stateDir: string | undefined;
  let fallbackDir: string | undefined;
  let build: number | undefined;
  const words: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--state-dir") stateDir = argv[++i];
    else if (a.startsWith("--state-dir=")) stateDir = a.slice("--state-dir=".length);
    else if (a.startsWith("--default-state-dir=")) fallbackDir = a.slice("--default-state-dir=".length);
    else if (a === "--build") build = Number(argv[++i]);
    else if (a.startsWith("--build=")) build = Number(a.slice("--build=".length));
    else if (a !== "copy") words.push(a);
  }
  const dir = resolve(stateDir || env[ENV_STATE_DIR] || fallbackDir || defaultStateDir());
  const target = words.join(" ").trim();
  if (!target) return { code: 2, out: "Say which app: anyapp copy <app>, or anyapp copy owner/anyapp-<slug>-releases." };
  const copies = join(dir, "scratch", "copies");
  const repo = repoFromText(target);
  if (repo) {
    try {
      const source = await findReleaseSource(repo, Number.isInteger(build) && build! > 0 ? build : undefined, fetchImpl);
      const zip = await downloadSource(source, fetchImpl);
      const out = join(copies, scratchName(`${repo.split("/")[1]!.replace(/^anyapp-|-releases$/g, "")}-${source.version}`));
      mkdirSync(out, { recursive: true });
      const files = extractZip(zip, out, { readOnly: true });
      return { code: 0, out: `${out}\n(${files} files: ${repo} version ${source.version}${source.build ? `, build ${source.build}` : ""}, read only. Take what you need into this app.)` };
    } catch (error) {
      return { code: 1, out: error instanceof SourceError ? error.message : `Could not copy ${repo}: ${(error as Error).message}` };
    }
  }
  let apps: CliApp[];
  try {
    apps = loadApps(dir, env[ENV_SELF_APP] || undefined);
  } catch (error) {
    return { code: 1, out: `Could not read the app list in ${dir}: ${(error as Error).message}` };
  }
  const app = findApp(apps, target);
  if (!app) return { code: 1, out: `No app "${target}". These are the apps: ${apps.map((a) => a.slug).join(", ") || "none"}. For someone's shared app, give its releases page (owner/anyapp-<slug>-releases).` };
  if (app.self) return { code: 2, out: "That is this app. Copy from another one." };
  const out = join(copies, scratchName(app.slug));
  mkdirSync(out, { recursive: true });
  const zipPath = join(copies, `${scratchName(app.slug)}.zip`);
  const r = spawnSync("git", ["archive", "--format=zip", "-o", zipPath, "HEAD", "--", ".", ...SOURCE_LEFT_OUT.flatMap((x) => x.specs)], { cwd: app.folder, encoding: "utf8", windowsHide: true });
  if (r.status !== 0 || !existsSync(zipPath)) {
    rmSync(out, { recursive: true, force: true });
    return { code: 1, out: `Could not copy ${app.name}: ${(r.stderr || "git archive failed").trim().split(/\r?\n/).at(-1)}. Its folder is ${app.folder} (read only).` };
  }
  try {
    const files = extractZip(readFileSync(zipPath), out);
    makeReadOnly(out);
    return { code: 0, out: `${out}\n(${files} files: ${app.name}${app.version ? `, build ${app.version}` : ""}, its committed code without its private notes, .env files or keys, read only. Take what you need into this app.)` };
  } finally {
    rmSync(zipPath, { force: true });
  }
}
