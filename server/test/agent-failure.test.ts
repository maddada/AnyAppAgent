import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { App } from "../../shared/protocol.ts";
import { ClaudeSession } from "../src/acp/claude-session.ts";
import { agentFailure, AppManager } from "../src/apps.ts";
import type { Builder } from "../src/builder.ts";
import type { Config } from "../src/config.ts";
import { Store } from "../src/store.ts";

const quota = `Internal error: You've hit your weekly limit · resets Nov 15, 2pm (Asia/Dubai): {"errorKind":"rate_limit"}`;
afterEach(() => vi.restoreAllMocks());

describe("failed agent prompts", () => {
  it("keeps the limit and reset time without the ACP wrapper", () => {
    expect(agentFailure(new Error(quota))).toBe("Claude usage limit reached. You've hit your weekly limit · resets Nov 15, 2pm (Asia/Dubai). Try again after the limit resets.");
    expect(agentFailure(new Error("Connection closed"))).toBe("The agent stopped unexpectedly: Connection closed");
  });

  it("reports one useful error, keeps v1, and allows Update it again after a quota failure", async () => {
    const root = mkdtempSync(join(tmpdir(), "kiwi-agent-failure-"));
    const state = join(root, "state");
    const dir = join(root, "apps", "tea");
    mkdirSync(state, { recursive: true });
    mkdirSync(dir, { recursive: true });
    mkdirSync(join(root, "template", "modules", "updates"), { recursive: true });
    writeFileSync(join(root, "template", "modules", "updates", "index.ts"), "export {};\n");
    writeFileSync(join(dir, "overview.md"), "# Tea Timer\n");
    execFileSync("git", ["init", "-q"], { cwd: dir });
    const build: App["latestApk"] = { number: 1, status: "succeeded", startedAt: "2026-11-11T04:44:41Z" };
    const app: App = { id: "tea", name: "Tea Timer", slug: "tea", packageName: "com.anyapp.tea", status: "idle", iconVersion: 1, createdAt: "", updatedAt: "", latestBuild: build, latestApk: build };
    writeFileSync(join(state, "apps.json"), JSON.stringify([{ app, dir, ready: true }]));
    vi.spyOn(ClaudeSession.prototype, "start").mockResolvedValue();
    const prompt = vi.spyOn(ClaudeSession.prototype, "prompt").mockRejectedValueOnce(new Error(quota)).mockResolvedValue("end_turn");
    const buildApk = vi.fn<Builder["buildApk"]>();
    const apps = new AppManager({
      store: new Store(state),
      builder: { kind: "fake", createApp: async () => {}, buildApk, getIconPath: () => null },
      config: { stateDir: state, appsDir: join(root, "apps"), github: false, coordinator: false, port: 1 } as Config,
      repoDir: root, broadcast: () => {}, log: () => {},
    });
    try {
      apps.keepHealthy(app.id);
      await vi.waitFor(() => {
        expect(apps.get(app.id).status).toBe("error");
        expect(apps.get(app.id).health?.updating).toBeFalsy();
      }, { timeout: 5000 });
      const errors = apps.messages(app.id, 0).filter((row) => row.kind === "error");
      expect(errors.map((row) => row.text)).toEqual([agentFailure(new Error(quota))]);
      expect(apps.get(app.id).error).toContain("resets Nov 15, 2pm (Asia/Dubai)");
      expect(apps.get(app.id).latestApk).toEqual(build);
      expect(apps.get(app.id).latestBuild).toEqual(build);
      expect(buildApk).not.toHaveBeenCalled();
      apps.keepHealthy(app.id);
      await vi.waitFor(() => {
        expect(prompt).toHaveBeenCalledTimes(2);
        expect(apps.get(app.id).status).toBe("idle");
        expect(apps.get(app.id).health?.updating).toBeFalsy();
      }, { timeout: 5000 });
      expect(apps.get(app.id).error).toBeUndefined();
      expect(buildApk).not.toHaveBeenCalled();
      // Let the care broadcast finish before removing this test's state folder.
      await new Promise((resolve) => setTimeout(resolve, 150));
    } finally {
      await apps.shutdown();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
