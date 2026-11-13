import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { isEngine } from "../../../shared/engines.mts";
import type { Settings } from "../shared/types.ts";

export const DEFAULT_SETTINGS: Settings = { engine: "claude", onboardingDone: false, githubSkipped: false, startWithWindows: false, closeHintShown: false, phoneApkPath: "", hexModel: "", hexSkipped: false };

export function loadSettings(file: string): Settings {
  try {
    if (existsSync(file)) {
      const saved = JSON.parse(readFileSync(file, "utf8")) as Partial<Settings>;
      return { ...DEFAULT_SETTINGS, ...saved, engine: isEngine(saved.engine) ? saved.engine : "claude" };
    }
  } catch {
    // a damaged file starts fresh
  }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(file: string, settings: Settings): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(settings, null, 2));
}
