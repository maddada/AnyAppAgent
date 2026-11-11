// "Keep my apps healthy" (docs/TRUST.md): which apps are behind the newest template, a reminder
// once a month while any is, and the message that asks an app's agent to bring it up to date.
//
// Behind means one of these, read from the app's own files (never guessed):
//   React Native: an older Expo SDK than the template (package.json "expo"), or a built-in part
//     the template carries and says to keep as it is (modules/updates, modules/feedback, modules/ai)
//     missing or older (its files differ from the template's).
//   Kotlin: a lower targetSdk or compileSdk than template-kotlin (app/build.gradle.kts).
//   Expo Exact (alpha): not checked.
// The reminder's state is <state>/health.json.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { AppHealth, AppPreset, HealthReminder } from "../../shared/protocol.ts";
import { nowIso, readJson, writeJsonAtomic } from "./fs-util.ts";

/** The template's own parts every app keeps as they are (template/AGENTS.md), in plain words. */
export const BUILT_IN_PARTS: { dir: string; words: string }[] = [
  { dir: "updates", words: "updates and Change this app inside the app" },
  { dir: "feedback", words: "shake to give feedback" },
  { dir: "ai", words: "AI for your apps" },
];

const SKIP_DIRS = new Set(["build", ".cxx", ".gradle", "node_modules"]);
export const REMINDER_EVERY_MS = 30 * 24 * 3600_000;

function filesOf(root: string, dir = root, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) filesOf(root, join(dir, e.name), out);
    } else if (e.isFile()) out.push(relative(root, join(dir, e.name)).replace(/\\/g, "/"));
  }
  return out.sort();
}

function fileHash(path: string): string {
  // Line endings do not make a part older (Git on Windows may check files out with CRLF).
  return createHash("sha256").update(readFileSync(path, "utf8").replace(/\r\n/g, "\n")).digest("hex");
}

function expoMajor(dir: string): number | null {
  try {
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { dependencies?: Record<string, string> };
    const m = /(\d+)\./.exec(pkg.dependencies?.expo ?? "");
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
}

function gradleSdk(dir: string): { target: number | null; compile: number | null } {
  try {
    const text = readFileSync(join(dir, "app", "build.gradle.kts"), "utf8");
    const num = (name: string) => {
      const m = new RegExp(`\\b${name}\\s*=\\s*(\\d+)`).exec(text);
      return m ? Number(m[1]) : null;
    };
    return { target: num("targetSdk"), compile: num("compileSdk") };
  } catch {
    return { target: null, compile: null };
  }
}

interface TemplateFacts {
  expoMajor: number | null;
  parts: { dir: string; words: string; files: Map<string, string> }[];
  kotlin: { target: number | null; compile: number | null };
}

/** Reads the newest templates once; `stamp` changes when one of their files does. */
export class Templates {
  private facts: TemplateFacts | undefined;
  private stamp = "";
  readonly reactNativeDir: string;
  readonly kotlinDir: string;

  constructor(repoDir: string) {
    this.reactNativeDir = join(repoDir, "template");
    this.kotlinDir = join(repoDir, "template-kotlin");
  }

  private currentStamp(): string {
    const parts = [join(this.reactNativeDir, "package.json"), join(this.kotlinDir, "app", "build.gradle.kts")];
    for (const p of BUILT_IN_PARTS) parts.push(join(this.reactNativeDir, "modules", p.dir));
    return parts.map((p) => (existsSync(p) ? String(statSync(p).mtimeMs) : "-")).join("|");
  }

  read(): TemplateFacts {
    const stamp = this.currentStamp();
    if (this.facts && stamp === this.stamp) return this.facts;
    const parts: TemplateFacts["parts"] = [];
    for (const p of BUILT_IN_PARTS) {
      const root = join(this.reactNativeDir, "modules", p.dir);
      if (!existsSync(root)) continue;
      parts.push({ ...p, files: new Map(filesOf(root).map((f) => [f, fileHash(join(root, f))])) });
    }
    this.facts = { expoMajor: expoMajor(this.reactNativeDir), parts, kotlin: gradleSdk(this.kotlinDir) };
    this.stamp = stamp;
    return this.facts;
  }
}

/** Plain sentences for each way the app at `dir` is behind the newest template; [] when it is not. */
export function behindReasons(dir: string, preset: AppPreset | undefined, templates: Templates): string[] {
  if (!existsSync(dir)) return [];
  const t = templates.read();
  const reasons: string[] = [];
  if ((preset ?? "react-native") === "react-native") {
    const major = expoMajor(dir);
    if (major !== null && t.expoMajor !== null && major < t.expoMajor) {
      reasons.push(`Built on an older Expo (SDK ${major}; the newest is ${t.expoMajor}), so newer Android versions may not get the best from it.`);
    }
    const older: string[] = [];
    for (const part of t.parts) {
      const root = join(dir, "modules", part.dir);
      if (!existsSync(root)) {
        older.push(part.words);
        continue;
      }
      for (const [file, hash] of part.files) {
        const mine = join(root, file);
        if (!existsSync(mine) || fileHash(mine) !== hash) {
          older.push(part.words);
          break;
        }
      }
    }
    if (older.length > 0) reasons.push(`Missing or older built-in parts: ${listWords(older)}.`);
  } else if (preset === "kotlin") {
    const mine = gradleSdk(dir);
    const { target, compile } = t.kotlin;
    if (mine.target !== null && target !== null && mine.target < target) {
      reasons.push(`Targets an older Android (API ${mine.target}; the newest is ${target}).`);
    } else if (mine.compile !== null && compile !== null && mine.compile < compile) {
      reasons.push(`Built against an older Android (API ${mine.compile}; the newest is ${compile}).`);
    }
  }
  return reasons;
}

function listWords(words: string[]): string {
  return words.length <= 1 ? (words[0] ?? "") : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
}

export function appHealth(dir: string, preset: AppPreset | undefined, templates: Templates): AppHealth | undefined {
  const reasons = behindReasons(dir, preset, templates);
  return reasons.length > 0 ? { behind: true, reasons, checkedAt: nowIso() } : undefined;
}

/**
 * The message "Update it" sends to the app's agent, as the person's own message. The agent's
 * playbook hands real work to a helper; the PC then builds it (a quick update or a full build,
 * docs/FAST-LANE.md, whichever the change needs).
 */
export function keepHealthyMessage(health: AppHealth, preset: AppPreset | undefined, templates: Templates): string {
  const kotlin = preset === "kotlin";
  const templateDir = kotlin ? templates.kotlinDir : templates.reactNativeDir;
  const how = kotlin
    ? `Move it to the Android versions in its app/build.gradle.kts and gradle/libs.versions.toml.`
    : `Copy the missing or older built-in parts from its modules folder exactly as they are, wire them in the way its AGENTS.md says (also the Change this app row: src/components/ChangeThisApp.tsx, kept last in the app's Settings, with a way to reach Settings), and move to the Expo SDK and the dependency versions in its package.json (npx expo install --fix after changing expo).`;
  return [
    "Keep this app healthy: bring it up to date with the newest AnyAppAgent template. Keep everything it does, its look and its saved data exactly as they are.",
    "",
    "What is behind:",
    ...health.reasons.map((r) => `- ${r}`),
    "",
    `The newest template is in ${templateDir} (read it and copy from it; never change it). ${how} Then make sure the app still builds and works as before.`,
  ].join("\n");
}

interface ReminderFile {
  lastAt: string | null;
}

/** The monthly reminder: due while any app is behind and it was not put away in the last 30 days. */
export class HealthReminders {
  private readonly path: string;
  private data: ReminderFile;
  private readonly now: () => number;

  constructor(stateDir: string, now: () => number = () => Date.now()) {
    this.path = join(stateDir, "health.json");
    this.now = now;
    this.data = readJson<ReminderFile>(this.path, { lastAt: null });
  }

  state(behind: number): HealthReminder {
    const last = this.data.lastAt ? Date.parse(this.data.lastAt) : NaN;
    const next = Number.isFinite(last) ? last + REMINDER_EVERY_MS : this.now();
    return {
      due: behind > 0 && next <= this.now(),
      behind,
      lastAt: this.data.lastAt,
      nextAt: behind > 0 ? new Date(next).toISOString() : null,
    };
  }

  dismiss(): void {
    this.data = { lastAt: new Date(this.now()).toISOString() };
    writeJsonAtomic(this.path, this.data);
  }
}
