// Which Codex model this PC uses. Kiwimake asks for CODEX_MODEL; a ChatGPT plan that does not
// include it (a free plan) refuses every turn. Then the turn runs again once on
// CODEX_FALLBACK_MODEL, and the PC remembers that in its state, so later chats start there. It
// tries CODEX_MODEL again after a sign-in change (another account or plan) or once a day, so a
// plan that gains the better model gets it back by itself.
import { createHash } from "node:crypto";
import { join } from "node:path";
import { rmSync } from "node:fs";
import { CODEX_FALLBACK_MODEL, CODEX_MODEL } from "../../../shared/engines.mts";
import { readJson, writeJsonAtomic } from "../fs-util.ts";

const RETRY_AFTER_MS = 24 * 60 * 60 * 1000;

interface Saved {
  model: string;
  /** When the plan last refused CODEX_MODEL. */
  since: string;
  /** A hash of the signed-in account and plan (never the account itself). */
  account: string;
}

/**
 * Codex's refusal of a model the ChatGPT plan does not include, for exactly this model:
 * "The 'gpt-6.1-sol' model is not supported when using Codex with a ChatGPT account."
 * Anything else (rate limits, a network error, another model's name) is not this.
 */
export function isPlanModelRefusal(message: string, model: string): boolean {
  return /\bmodel is not supported when using Codex with a ChatGPT account\b/i.test(message)
    && new RegExp(`(['"\`])${model.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\1`).test(message);
}

/** The account and plan from Codex's account/read, as a hash: a different sign-in gives another one. */
export function accountKey(read: unknown): string {
  const r = (read && typeof read === "object" ? read : {}) as Record<string, any>;
  const a = (r.account && typeof r.account === "object" ? r.account : {}) as Record<string, any>;
  const parts = [a.type, r.userId ?? a.email, a.planType, a.workspaceName].map((v) => typeof v === "string" ? v : "");
  if (!parts.some(Boolean)) return "";
  return createHash("sha256").update(parts.join("\n")).digest("hex").slice(0, 16);
}

export class CodexModels {
  private readonly path: string;
  private readonly now: () => number;
  constructor(stateDir: string, now: () => number = Date.now) {
    this.path = join(stateDir, "codex-model.json");
    this.now = now;
  }

  private saved(): Saved | undefined {
    const s = readJson<Saved | null>(this.path, null);
    return s && typeof s.model === "string" && typeof s.since === "string" ? s : undefined;
  }

  /** The model a new chat starts on for this sign-in. */
  modelFor(account: string): string {
    const s = this.saved();
    if (!s) return CODEX_MODEL;
    const age = this.now() - Date.parse(s.since);
    if (s.account !== account || !(age >= 0 && age < RETRY_AFTER_MS)) return CODEX_MODEL;
    return s.model;
  }

  /** The plan refused CODEX_MODEL: start on the fallback from now on (for a day, or until the sign-in changes). */
  refused(account: string): string {
    writeJsonAtomic(this.path, { model: CODEX_FALLBACK_MODEL, since: new Date(this.now()).toISOString(), account } satisfies Saved);
    return CODEX_FALLBACK_MODEL;
  }

  /** A turn finished on `model`. CODEX_MODEL working again forgets the fallback. */
  worked(model: string): void {
    if (model === CODEX_MODEL && this.saved()) rmSync(this.path, { force: true });
  }

  /** For the PC's engine settings: the model in use, and whether it is the fallback. */
  state(): { model: string; fallback?: true } {
    const s = this.saved();
    return s ? { model: s.model, fallback: true } : { model: CODEX_MODEL };
  }
}
