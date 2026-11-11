// An app's history and health (docs/VERSIONS.md): the "What changed" lines of a version, the Versions
// list with Go back and Undo, the crash card ("Tea Timer crashed. Fix it?") and the line that says the
// agent read the app's diary. Shared by the phone app and the desktop app; each draws these itself.
import type { App, AppVersion, ChangeNotes, CrashInfo, DiaryReadInfo } from "../protocol.ts";

export interface ChangeLine {
  label: string; // "Changed", "Try it", "Good to know"
  text: string;
}

/** The "What changed" card's lines, in this order; empty when there are no notes. */
export function changeLines(notes: ChangeNotes | undefined): ChangeLine[] {
  if (!notes) return [];
  const lines: ChangeLine[] = [];
  const add = (label: string, text: string | undefined) => {
    const clean = text?.replace(/\s+/g, " ").trim();
    if (clean) lines.push({ label, text: clean });
  };
  add("Changed", notes.changed);
  add("Try it", notes.tryIt);
  add("Good to know", notes.goodToKnow);
  return lines;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Today 15:42", "Yesterday 09:10", "3 Nov 18:00", "3 Nov 2025" (local time of `now`'s clock). */
export function whenLabel(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((day(now) - day(d)) / 86_400_000);
  if (days === 0) return `Today ${time}`;
  if (days === 1) return `Yesterday ${time}`;
  if (d.getFullYear() !== now.getFullYear()) return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${time}`;
}

export interface VersionRow {
  build: number;
  title: string; // "Version 3"
  what: string; // one line: what changed
  when: string;
  badge?: string; // "On your phone" (the newest)
  /** "Go back to this" is offered. */
  canRestore: boolean;
}

/** The Versions list, newest first, as the phone and the PC show it. */
export function versionRows(versions: readonly AppVersion[], now?: Date): VersionRow[] {
  return versions.map((v) => ({
    build: v.build,
    title: `Version ${v.build}`,
    what: v.title,
    when: whenLabel(v.createdAt, now),
    ...(v.current ? { badge: "Newest" } : {}),
    canRestore: v.canRestore && !v.current,
  }));
}

/** What Undo goes back to: the version before the newest one, or null when there is none. */
export function undoTarget(versions: readonly AppVersion[]): AppVersion | null {
  const i = versions.findIndex((v) => v.current);
  if (i < 0) return null;
  const before = versions[i + 1];
  return before && before.canRestore ? before : null;
}

/** The words of the "Go back?" question for a version. */
export function goBackQuestion(build: number): { title: string; body: string; confirm: string } {
  return {
    title: `Go back to version ${build}?`,
    body: "The app is built again as it was then and installs over the one on your phone. Your data in the app stays. Nothing is lost: the newer versions stay in this list, so you can come back to them.",
    confirm: "Go back",
  };
}

/** The words of the "Undo?" question. */
export function undoQuestion(target: AppVersion): { title: string; body: string; confirm: string } {
  return {
    title: "Undo the last change?",
    body: `The app goes back to version ${target.build} (${target.title.trim().replace(/[.!?]+$/, "")}). It is built again and installs over the one on your phone. Nothing is lost: you can redo it from Versions.`,
    confirm: "Undo",
  };
}

/** A busy app cannot go back right now (the PC answers 409 too); the reason in plain words, or null. */
export function goBackBlocked(app: App | undefined): string | null {
  if (!app) return "This app is not on the PC.";
  if (app.status === "creating") return "Wait until the app is made.";
  if (app.status === "building") return "Wait until the new version is built.";
  if (app.status === "working" || (app.activeHelpers ?? 0) > 0) return "Wait until the agent has finished.";
  if (!app.latestApk) return "There is no version yet.";
  return null;
}

export interface CrashCard {
  title: string; // "Tea Timer crashed. Fix it?"
  detail: string; // the error's message, short
  meta: string; // "Version 3, Today 15:42" (+ ", 3 times")
  /** "Fix it" is offered; once asked, the card says so instead. */
  canFix: boolean;
  asked?: string; // "Sent to the agent"
}

export function crashCard(crash: CrashInfo, appName: string, now?: Date): CrashCard {
  const what = crash.kind === "crash" ? "crashed" : "ran into an error";
  const times = crash.count > 1 ? `, ${crash.count} times` : "";
  const version = crash.versionCode ? `Version ${crash.versionCode}, ` : "";
  const detail = crash.message.replace(/\s+/g, " ").trim();
  return {
    title: crash.fixAskedAt ? `${appName} ${what}` : `${appName} ${what}. Fix it?`,
    detail: detail.length > 160 ? `${detail.slice(0, 159)}…` : detail,
    meta: `${version}${whenLabel(crash.lastAt, now)}${times}${crash.screen ? `, on ${crash.screen}` : ""}`,
    canFix: !crash.fixAskedAt,
    ...(crash.fixAskedAt ? { asked: "Sent to the agent to fix" } : {}),
  };
}

/** The quiet line after the agent read the app's diary. */
export function diaryLine(info: DiaryReadInfo | undefined): string {
  if (!info) return "Read the app's diary";
  if (!info.ok) return `Could not read the app's diary: ${info.problem ?? "the phone did not answer"}`;
  if (info.entries === 0) return "Read the app's diary on your phone (it is empty)";
  return `Read the app's diary on your phone (${info.entries} ${info.entries === 1 ? "note" : "notes"})`;
}

/** The privacy line under it. */
export const DIARY_PRIVACY = "The diary stays on your phone and this PC.";
