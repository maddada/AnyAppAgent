import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Settings } from "../shared/types.ts";

export const DEFAULT_SETTINGS: Settings = { onboardingDone: false, githubSkipped: false, startWithWindows: false, closeHintShown: false, phoneApkPath: "" };

export function loadSettings(file: string): Settings {
  try {
    if (existsSync(file)) return { ...DEFAULT_SETTINGS, ...(JSON.parse(readFileSync(file, "utf8")) as Partial<Settings>) };
  } catch {
    // a damaged file starts fresh
  }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(file: string, settings: Settings): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(settings, null, 2));
}
