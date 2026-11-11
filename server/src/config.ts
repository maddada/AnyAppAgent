import { homedir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

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
  /** Each app's main chat is a coordinator that hands work to workers (docs/APP-COORDINATOR.md). */
  coordinator: boolean;
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
    coordinator: !["off", "0", "false", "no"].includes((env.ANYAPP_COORDINATOR ?? "on").toLowerCase()),
  };
}
