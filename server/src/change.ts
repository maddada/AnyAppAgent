// "Change this app" on the PC (docs/CHANGE-THIS-APP.md): the "From others" inbox of suggestions
// people sent the owner as text, and the owner's name the apps show ("Made by Mohamad",
// "Suggest a change to Mohamad"). Suggestions are kept per app in <state>/suggestions/<appId>.json.
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { userInfo } from "node:os";
import { join } from "node:path";
import type { Suggestion } from "../../shared/protocol.ts";
import type { ParsedSuggestion } from "../../shared/chat/suggestions.ts";
import { nowIso, readJson, writeJsonAtomic } from "./fs-util.ts";

const MAX_KEPT = 100;

export class Suggestions {
  private readonly stateDir: string;

  constructor(stateDir: string) {
    this.stateDir = stateDir;
  }

  private file(appId: string): string {
    return join(this.stateDir, "suggestions", `${appId}.json`);
  }

  list(appId: string): Suggestion[] {
    const path = this.file(appId);
    if (!existsSync(path)) return [];
    try {
      const all = readJson<Suggestion[]>(path, []);
      return Array.isArray(all) ? all : [];
    } catch {
      return [];
    }
  }

  private save(appId: string, list: Suggestion[]): void {
    mkdirSync(join(this.stateDir, "suggestions"), { recursive: true });
    writeJsonAtomic(this.file(appId), list.slice(0, MAX_KEPT));
  }

  /** Files a suggestion; the same one again (same words, name and version) is kept once. */
  add(appId: string, parsed: ParsedSuggestion): { suggestion: Suggestion; added: boolean } {
    const list = this.list(appId);
    const same = list.find((s) => s.text === parsed.text && (s.from ?? "") === (parsed.from ?? "") && (s.build ?? 0) === (parsed.build ?? 0));
    if (same) return { suggestion: same, added: false };
    const suggestion: Suggestion = {
      id: randomUUID(),
      appId,
      ...(parsed.from ? { from: parsed.from } : {}),
      text: parsed.text,
      ...(parsed.build ? { build: parsed.build } : {}),
      receivedAt: nowIso(),
    };
    this.save(appId, [suggestion, ...list]);
    return { suggestion, added: true };
  }

  open(appId: string, id: string): Suggestion | null {
    const list = this.list(appId);
    const s = list.find((x) => x.id === id);
    if (!s) return null;
    s.opened = true;
    this.save(appId, list);
    return s;
  }

  remove(appId: string, id: string): boolean {
    const list = this.list(appId);
    const next = list.filter((x) => x.id !== id);
    if (next.length === list.length) return false;
    this.save(appId, next);
    return true;
  }

  forget(appId: string): void {
    rmSync(this.file(appId), { force: true });
  }

  /** Suggestions the owner has not opened yet (App.fromOthers). */
  waiting(appId: string): number {
    return this.list(appId).filter((s) => !s.opened).length;
  }
}

// ---------- the owner's name

interface ChangeState {
  ownerName?: string;
}

function statePath(stateDir: string): string {
  return join(stateDir, "change.json");
}

/** A first name from Git's user.name on this PC, else the Windows user name. */
export function guessOwnerName(): string {
  try {
    const r = spawnSync("git", ["config", "--global", "user.name"], { encoding: "utf8", timeout: 5000, windowsHide: true });
    const first = (r.stdout ?? "").trim().split(/\s+/)[0];
    if (first) return first.slice(0, 40);
  } catch {
    // no git: fall through
  }
  try {
    const name = userInfo().username.trim();
    return name ? name.charAt(0).toUpperCase() + name.slice(1, 40) : "";
  } catch {
    return "";
  }
}

export function ownerName(stateDir: string): string {
  try {
    const s = readJson<ChangeState>(statePath(stateDir), {});
    if (s.ownerName) return s.ownerName;
  } catch {
    // unreadable: guess again
  }
  return guessOwnerName();
}

export function setOwnerName(stateDir: string, name: string): string {
  const clean = name.normalize("NFC").replace(/[^\p{L}\p{N} .-]/gu, "").replace(/\s+/g, " ").trim().slice(0, 40);
  mkdirSync(stateDir, { recursive: true });
  writeJsonAtomic(statePath(stateDir), { ownerName: clean || undefined } satisfies ChangeState);
  return clean || guessOwnerName();
}
