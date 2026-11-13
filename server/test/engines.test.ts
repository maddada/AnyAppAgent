import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { CodexSession, codexMcpConfig } from "../src/acp/codex-session.ts";
import { resumeFor, rememberSession, selectedEngine, type SessionRecord } from "../src/acp/session.ts";
import { agentFailure } from "../src/apps.ts";

describe("both engines", () => {
  it("keeps resume ids separate and preserves legacy Claude sessions", () => {
    const r: SessionRecord = { sessionId: "claude-old" };
    expect(resumeFor(r, "codex")).toBeUndefined();
    rememberSession(r, "codex", "codex-new");
    expect(resumeFor(r, "claude")).toBe("claude-old");
    expect(resumeFor(r, "codex")).toBe("codex-new");
    expect(selectedEngine({ engine: "codex", cloud: {} as never })).toBe("claude");
  });
  it("maps per-session MCP headers without persisting global configuration", () => {
    expect(codexMcpConfig([{ type: "http", name: "pages", url: "http://localhost:9001/mcp", headers: [{ name: "Authorization", value: "Bearer test" }] }])).toEqual({ pages: { url: "http://localhost:9001/mcp", http_headers: { Authorization: "Bearer test" } } });
  });
  it("retains provider limit and reset time for either engine", () => {
    expect(agentFailure(Error("Usage limit reached. Try again at 16:30."), "codex")).toContain("Codex usage limit reached.");
    expect(agentFailure(Error("Usage limit reached. Try again at 16:30."), "codex")).toContain("16:30");
    expect(agentFailure(Error("You've hit your limit. Resets tomorrow."))).toContain("Claude usage limit reached.");
    // What a Codex workspace without credits answered on this PC (2026-11-13).
    expect(agentFailure(Error("Your workspace is out of credits. Ask your workspace owner to refill in order to continue."), "codex"))
      .toBe("Codex has no credits left. Your workspace is out of credits. Ask your workspace owner to refill in order to continue. Add credits to your account, then try again.");
  });
  it("runs, resumes, streams, counts usage, reports limits and cancels via app-server", async () => {
    const updates: any[] = []; const usage: any[] = []; const limits: any[] = [];
    const session = new CodexSession({ cwd: process.cwd(), instructions: "Make an app", resumeSessionId: "codex-thread", launch: { command: process.execPath, args: [fileURLToPath(new URL("./fixtures/codex-server.mjs", import.meta.url))] }, onUpdate: (v) => updates.push(v), onUsage: (v) => usage.push(v), onPlanLimit: (v) => limits.push(v), onPermission: () => {}, onExit: () => {}, log: () => {} });
    try {
      await session.start(); expect(session.resumed).toBe(true);
      expect(await session.prompt("build")).toBe("end_turn");
      expect(updates.filter((u) => u.sessionUpdate === "agent_message_chunk")).toHaveLength(1);
      expect(updates.find((u) => u.name === "mcp__pages__show_page")).toBeTruthy();
      expect(usage[0]).toEqual({ inputTokens: 60, cacheReadTokens: 40, cacheWriteTokens: 0, outputTokens: 8 });
      expect(limits[0]).toMatchObject({ engine: "codex", status: "rejected" });
      await expect(session.prompt("limit")).rejects.toThrow("16:30");
      const wait = session.prompt("wait"); session.cancel(); expect(await wait).toBe("cancelled");
    } finally { await session.stop(); }
  }, 15_000);
});
