// A ChatGPT plan without Kiwimake's Codex model (a free plan): the turn runs again once on the
// fallback, and the PC remembers it until the next day or a sign-in change (acp/codex-model.ts).
import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CODEX_FALLBACK_MODEL, CODEX_MODEL } from "../../shared/engines.mts";
import { accountKey, CodexModels, isPlanModelRefusal } from "../src/acp/codex-model.ts";
import { CodexSession } from "../src/acp/codex-session.ts";

const REFUSAL = "The 'gpt-6.1-sol' model is not supported when using Codex with a ChatGPT account.";
const fixture = fileURLToPath(new URL("./fixtures/codex-free-plan.mjs", import.meta.url));

describe("Codex on a plan without its usual model", () => {
  it("knows Codex's refusal of exactly this model, and nothing else", () => {
    expect(CODEX_MODEL).toBe("gpt-6.1-sol");
    expect(CODEX_FALLBACK_MODEL).toBe("gpt-6-luna");
    expect(isPlanModelRefusal(REFUSAL, CODEX_MODEL)).toBe(true);
    expect(isPlanModelRefusal(`Error: ${REFUSAL.toLowerCase()}`, CODEX_MODEL)).toBe(true);
    expect(isPlanModelRefusal(REFUSAL, CODEX_FALLBACK_MODEL)).toBe(false);
    expect(isPlanModelRefusal("The 'gpt-6.1-sol-mini' model is not supported when using Codex with a ChatGPT account.", CODEX_MODEL)).toBe(false);
    expect(isPlanModelRefusal("The 'gpt-6x1-sol' model is not supported when using Codex with a ChatGPT account.", CODEX_MODEL)).toBe(false);
    expect(isPlanModelRefusal("Usage limit reached. Try again at 16:30.", CODEX_MODEL)).toBe(false);
    expect(isPlanModelRefusal("The 'gpt-6.1-sol' model is not supported.", CODEX_MODEL)).toBe(false);
  });

  it("keys the sign-in by a hash of the account and plan, never the account itself", () => {
    const free = accountKey({ account: { type: "chatgpt", email: "someone@example.com", planType: "free" }, userId: "u1" });
    const plus = accountKey({ account: { type: "chatgpt", email: "someone@example.com", planType: "plus" }, userId: "u1" });
    expect(free).toMatch(/^[0-9a-f]{16}$/);
    expect(free).not.toBe(plus);
    expect(free).not.toContain("someone");
    expect(accountKey({})).toBe("");
    expect(accountKey(undefined)).toBe("");
  });

  it("remembers the fallback for a day and for this sign-in only", () => {
    const state = mkdtempSync(join(tmpdir(), "anyapp-codex-model-"));
    try {
      let now = Date.parse("2026-11-20T10:00:00Z");
      const models = new CodexModels(state, () => now);
      expect(models.modelFor("a")).toBe(CODEX_MODEL);
      expect(models.state()).toEqual({ model: CODEX_MODEL });
      expect(models.refused("a")).toBe(CODEX_FALLBACK_MODEL);
      expect(models.modelFor("a")).toBe(CODEX_FALLBACK_MODEL);
      expect(new CodexModels(state, () => now).modelFor("a")).toBe(CODEX_FALLBACK_MODEL); // kept in the PC's state
      expect(models.state()).toEqual({ model: CODEX_FALLBACK_MODEL, fallback: true });
      expect(models.modelFor("b")).toBe(CODEX_MODEL); // another sign-in tries the usual model
      now += 23 * 3600_000;
      expect(models.modelFor("a")).toBe(CODEX_FALLBACK_MODEL);
      now += 2 * 3600_000;
      expect(models.modelFor("a")).toBe(CODEX_MODEL); // a day later
      models.worked(CODEX_FALLBACK_MODEL);
      expect(models.state().fallback).toBe(true);
      models.worked(CODEX_MODEL); // the usual model works again: forget the fallback
      expect(models.state()).toEqual({ model: CODEX_MODEL });
      expect(existsSync(join(state, "codex-model.json"))).toBe(false);
    } finally {
      rmSync(state, { recursive: true, force: true });
    }
  });

  it("runs a refused turn again once on the fallback, and later chats start there", async () => {
    const state = mkdtempSync(join(tmpdir(), "anyapp-codex-free-"));
    const sessions: CodexSession[] = [];
    const open = async (plan = "free") => {
      const updates: any[] = [];
      const logs: string[] = [];
      const session = new CodexSession({
        cwd: process.cwd(), instructions: "Make an app", env: { FAKE_PLAN: plan }, models: new CodexModels(state),
        launch: { command: process.execPath, args: [fixture] },
        onUpdate: (v) => updates.push(v), onPermission: () => {}, onExit: () => {}, log: (m) => logs.push(m),
      });
      sessions.push(session);
      await session.start();
      const said = () => updates.filter((u) => u.sessionUpdate === "agent_message_chunk").map((u) => u.content.text).join("");
      return { session, said, logs };
    };
    try {
      const first = await open();
      expect(first.session.model).toBe(CODEX_MODEL);
      await expect(first.session.prompt("A water reminder")).resolves.toBe("end_turn");
      // The refused turn was dropped from the thread, so the message is there once.
      expect(first.said()).toBe("gpt-6-luna says hi (1 message)");
      expect(first.session.model).toBe(CODEX_FALLBACK_MODEL);
      expect(first.logs.join("\n")).toContain("does not include gpt-6.1-sol");
      expect(new CodexModels(state).state()).toEqual({ model: CODEX_FALLBACK_MODEL, fallback: true });
      // The same chat keeps the fallback.
      await first.session.prompt("Make it blue");
      expect(first.said()).toContain("gpt-6-luna says hi (2 messages)");

      // A later chat starts on the fallback without a refused turn first.
      const later = await open();
      expect(later.session.model).toBe(CODEX_FALLBACK_MODEL);
      await later.session.prompt("A space shooter");
      expect(later.said()).toBe("gpt-6-luna says hi (1 message)");

      // Another failure is never retried.
      await expect(later.session.prompt("limit")).rejects.toThrow(/Usage limit/);

      // A new sign-in (a paid plan) tries the usual model again, and it working forgets the fallback.
      const paid = await open("plus");
      expect(paid.session.model).toBe(CODEX_MODEL);
      await paid.session.prompt("A bakery menu");
      expect(paid.said()).toBe("gpt-6.1-sol says hi (1 message)");
      expect(new CodexModels(state).state()).toEqual({ model: CODEX_MODEL });
    } finally {
      await Promise.all(sessions.map((s) => s.stop()));
      rmSync(state, { recursive: true, force: true });
    }
  });

  it("without the PC's remembered model (no models), a refusal stays an error", async () => {
    const session = new CodexSession({
      cwd: process.cwd(), instructions: "Make an app", launch: { command: process.execPath, args: [fixture] },
      onUpdate: () => {}, onPermission: () => {}, onExit: () => {}, log: () => {},
    });
    try {
      await session.start();
      await expect(session.prompt("A water reminder")).rejects.toThrow(/not supported when using Codex/);
    } finally {
      await session.stop();
    }
  });
});
