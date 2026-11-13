// The cloud's pieces in the companion (docs/CLOUD.md, milestone 2): levels and models, the
// orchestrator's playbook in the cloud, the agent as another Unix user, and the runner's helpers.
import { describe, expect, test } from "vitest";
import { claudeLaunchSpec } from "../src/acp/claude-session.ts";
import { cloudSettingsFromEnv, DEFAULT_CLOUD, levelChoice } from "../src/cloud-settings.ts";
import { _test } from "../src/cloud-runner.ts";
import { coordinatorPlaybook, workerPlaybook, cloudWords } from "../src/coordinator-playbook.ts";
import { loadConfig } from "../src/config.ts";

const app = { name: "Prayer Alarm", packageName: "com.anyappcloud.prayeralarm", dir: "/data/apps/prayeralarm", preset: "react-native" as const };

describe("cloud settings", () => {
  test("off on a PC, on with ANYAPP_CLOUD=1", () => {
    expect(loadConfig({}).cloud).toBeUndefined();
    const c = loadConfig({ ANYAPP_CLOUD: "1", ANYAPP_AGENT_PREFIX: '["sudo","-n","-u","agent"]' }).cloud!;
    expect(c.orchestrator).toEqual({ model: "claude-opus-5-5", effort: "high" });
    expect(c.agentPrefix).toEqual(["sudo", "-n", "-u", "agent"]);
  });

  test("the three levels pick their model and effort", () => {
    expect(levelChoice(DEFAULT_CLOUD, "deep")).toEqual({ model: "claude-opus-5-5", effort: "high" });
    expect(levelChoice(DEFAULT_CLOUD, "focused")).toEqual({ model: "claude-opus-5-5", effort: "medium" });
    expect(levelChoice(DEFAULT_CLOUD, "simple")).toEqual({ model: "claude-sonnet-5-5", effort: "high" });
    expect(levelChoice(DEFAULT_CLOUD, undefined)).toEqual(DEFAULT_CLOUD.levels.focused);
    expect(levelChoice(DEFAULT_CLOUD, "nonsense")).toEqual(DEFAULT_CLOUD.levels.focused);
  });

  test("a bad agent prefix is refused", () => {
    expect(() => cloudSettingsFromEnv({ ANYAPP_CLOUD: "1", ANYAPP_AGENT_PREFIX: '"sudo"' })).toThrow();
  });
});

describe("the agent as another Unix user", () => {
  test("the launch goes through the prefix", () => {
    const plain = claudeLaunchSpec("local");
    const spec = claudeLaunchSpec("local", ["sudo", "-n", "-u", "agent", "-H", "/opt/kiwi/agent.sh"]);
    expect(spec.command).toBe("sudo");
    expect(spec.args).toEqual(["-n", "-u", "agent", "-H", "/opt/kiwi/agent.sh", plain.command, ...plain.args]);
  });
});

describe("the playbook in the cloud", () => {
  test("the orchestrator learns the levels and who it is; no PC in its words", () => {
    const text = coordinatorPlaybook(app, { cloud: true });
    expect(text).toContain("deep: complex work across several areas");
    expect(text).toContain("simple: simple work in one area");
    expect(text).toContain("Kiwimake's AI agent, powered by Claude");
    expect(text).not.toMatch(/\bthe PC\b|\bthis PC\b/);
    expect(text).not.toContain(String.fromCharCode(0x2014));
  });

  test("Reload only for a quick update; a new install is installed; never Claude Code", () => {
    const text = coordinatorPlaybook(app, { cloud: true });
    expect(text).toContain('Never say "tap Reload" for a new install');
    expect(text).toMatch(/then install it on your\s+phone/);
    expect(text).toContain("never promise either one");
    // "Claude Code" only in the rule that forbids it.
    expect(text.split("Claude Code").length - 1).toBe(1);
    expect(text).toMatch(/Never call yourself\s+or the helpers "Claude Code"/);
    const helper = cloudWords(workerPlaybook(app, { title: "Make the button green", changesApp: true }));
    expect(helper).not.toContain("Claude Code");
    expect(helper).not.toMatch(/same popup appears, and Reload/);
    expect(helper).toContain("Say \"tap Reload\" only for a quick update, never for a new install");
  });

  test("a PC's playbook is unchanged", () => {
    const text = coordinatorPlaybook(app);
    expect(text).not.toContain("Levels (the cloud)");
    expect(text).toMatch(/the PC/);
  });

  test("a helper's playbook in cloud words", () => {
    const text = cloudWords(workerPlaybook(app, { title: "Make the button green", changesApp: true }));
    expect(text).not.toMatch(/\bthe PC\b|\bthis PC\b/);
    expect(text).toContain("Kiwimake saves your work");
  });
});

describe("the runner's helpers", () => {
  test("the builder CLI's last JSON object is the result", () => {
    const out = `Building...\nGradle 1/3\n{\n  "apkPath": "/a.apk",\n  "unsigned": true\n}\n`;
    expect(_test.lastJson(out)).toEqual({ apkPath: "/a.apk", unsigned: true });
  });

  test("runAs without a prefix runs the command as ourselves with the extra env", async () => {
    const lines: string[] = [];
    const r = await _test.runAs([], [process.execPath, "-e", "console.log(process.env.KIWI_TEST_VAR)"], { KIWI_TEST_VAR: "hello" }, process.cwd(), (l) => lines.push(l));
    expect(r.code).toBe(0);
    expect(lines).toContain("hello");
  });
});
