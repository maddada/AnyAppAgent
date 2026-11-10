// The Android toolchain the builder needs (JAVA_HOME, ANDROID_HOME). The desktop app sets both
// when it starts the companion. A companion started by hand reads them, in this order, from:
//   1. its own environment, 2. <state>\toolchain.json {"javaHome", "androidHome"},
//   3. the paths in scripts/android-env.ps1 (docs/ENVIRONMENT.md).
// The result goes into process.env, where builder/ reads it.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_DIR } from "./config.ts";
import { readJson } from "./fs-util.ts";

export const TOOLCHAIN_MISSING =
  "The Android build tools were not found on this PC, so apps cannot be built yet. Open the AnyAppAgent desktop app to set them up.";

export interface Toolchain {
  javaHome: string;
  androidHome: string;
  source: string;
}

const EXE = process.platform === "win32" ? ".exe" : "";

export function isJdk(dir: string | undefined): dir is string {
  return !!dir && existsSync(join(dir, "bin", `java${EXE}`));
}

export function isAndroidSdk(dir: string | undefined): dir is string {
  return !!dir && existsSync(join(dir, "platform-tools")) && existsSync(join(dir, "build-tools"));
}

/** JAVA_HOME and ANDROID_HOME as scripts/android-env.ps1 sets them. */
export function fromEnvScript(text: string): { javaHome?: string; androidHome?: string } {
  const vars: Record<string, string> = {};
  for (const match of text.matchAll(/^\s*\$(\w+)\s*=\s*'([^']+)'/gm)) vars[match[1]] = match[2];
  const resolve = (name: string): string | undefined => {
    const literal = new RegExp(`^\\s*\\$env:${name}\\s*=\\s*'([^']+)'`, "m").exec(text);
    if (literal) return literal[1];
    const joined = new RegExp(`^\\s*\\$env:${name}\\s*=\\s*Join-Path\\s+\\$(\\w+)\\s+'([^']+)'`, "m").exec(text);
    if (joined && vars[joined[1]]) return join(vars[joined[1]], joined[2]);
    return undefined;
  };
  return { javaHome: resolve("JAVA_HOME"), androidHome: resolve("ANDROID_HOME") };
}

export function findToolchain(stateDir: string, env: NodeJS.ProcessEnv = process.env): Toolchain | null {
  const candidates: { javaHome?: string; androidHome?: string; source: string }[] = [
    { javaHome: env.JAVA_HOME, androidHome: env.ANDROID_HOME ?? env.ANDROID_SDK_ROOT, source: "environment" },
    { ...readJson<{ javaHome?: string; androidHome?: string }>(join(stateDir, "toolchain.json"), {}), source: "toolchain.json" },
  ];
  const script = join(REPO_DIR, "scripts", "android-env.ps1");
  if (existsSync(script)) candidates.push({ ...fromEnvScript(readFileSync(script, "utf8")), source: "scripts/android-env.ps1" });
  const javaHome = candidates.find((c) => isJdk(c.javaHome));
  const sdk = candidates.find((c) => isAndroidSdk(c.androidHome));
  if (!javaHome || !sdk) return null;
  return {
    javaHome: javaHome.javaHome!,
    androidHome: sdk.androidHome!,
    source: javaHome.source === sdk.source ? javaHome.source : `${javaHome.source} + ${sdk.source}`,
  };
}

/** Puts the toolchain into process.env for the builder. Returns it, or null when none was found. */
export function loadToolchain(stateDir: string): Toolchain | null {
  const found = findToolchain(stateDir);
  if (!found) return null;
  process.env.JAVA_HOME = found.javaHome;
  process.env.ANDROID_HOME = found.androidHome;
  process.env.ANDROID_SDK_ROOT = found.androidHome;
  return found;
}
