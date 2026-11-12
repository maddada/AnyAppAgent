import { homedir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { cloudSettingsFromEnv, type CloudSettings } from "./cloud-settings.ts";

export const SERVER_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const REPO_DIR = resolve(SERVER_DIR, "..");

const pkg = JSON.parse(readFileSync(join(SERVER_DIR, "package.json"), "utf8")) as { version: string };

export interface Config {
  version: string;
  host: string;
  port: number;
  stateDir: string;
  appsDir: string;
  builder: "auto" | "real" | "fake";
  github: boolean;
  acpLaunch: "local" | "npx";
  maxBuildFixes: number;
  /** Dev and tests only: ANYAPP_ASK_PERMISSIONS=1 shows every permission request in the chat instead of allowing it. */
  askPermissions: boolean;
  /** Each app's main chat is a coordinator that hands work to workers (docs/APP-COORDINATOR.md). */
  coordinator: boolean;
  /** The agent explains its plan (bullets and a page) and waits for a yes before it builds a new app. ANYAPP_PLAN_FIRST=off skips that (scripts). */
  planFirst: boolean;
  /** The cloud runner only (ANYAPP_CLOUD=1, docs/CLOUD.md): models per session, the agent as another Unix user. */
  cloud?: CloudSettings;
  /** The Kiwimake cloud this PC signs in to in the browser (ANYAPP_CLOUD_SITE, https://<deployment>.convex.site); without it, only a phone can link the PC. */
  cloudSite?: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const builder = env.ANYAPP_BUILDER === "real" || env.ANYAPP_BUILDER === "fake" ? env.ANYAPP_BUILDER : "auto";
  return {
    version: pkg.version,
    host: env.ANYAPP_HOST ?? "0.0.0.0",
    port: Number(env.ANYAPP_PORT ?? 8787),
    stateDir: resolve(env.ANYAPP_STATE_DIR ?? join(homedir(), ".anyappagent")),
    appsDir: resolve(env.ANYAPP_APPS_DIR ?? (process.platform === "win32" ? "C:\\aa\\apps" : join(homedir(), "aa", "apps"))),
    builder,
    github: !["off", "0", "false", "no"].includes((env.ANYAPP_GITHUB ?? "on").toLowerCase()),
    acpLaunch: env.ANYAPP_ACP_LAUNCH === "npx" ? "npx" : "local",
    maxBuildFixes: 3,
    askPermissions: env.ANYAPP_ASK_PERMISSIONS === "1",
    coordinator: !["off", "0", "false", "no"].includes((env.ANYAPP_COORDINATOR ?? "on").toLowerCase()),
    planFirst: !["off", "0", "false", "no"].includes((env.ANYAPP_PLAN_FIRST ?? "on").toLowerCase()),
    ...(cloudSettingsFromEnv(env) ? { cloud: cloudSettingsFromEnv(env) } : {}),
    ...(env.ANYAPP_CLOUD_SITE ? { cloudSite: env.ANYAPP_CLOUD_SITE } : {}),
  };
}
