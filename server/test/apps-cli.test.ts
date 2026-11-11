import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import {
  appsCliEnv,
  backfillOverview,
  ENV_SELF_APP,
  ENV_STATE_DIR,
  firstOverview,
  installAppsCli,
  OVERVIEW_DRAFT_MARK,
  overviewNeedsAgent,
  runCli,
} from "../src/apps-cli.ts";
import { agentEnv } from "../src/acp/claude-session.ts";
import { appPlaybook, overviewNudge } from "../src/playbook.ts";
import { coordinatorPlaybook, workerPlaybook } from "../src/coordinator-playbook.ts";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "anyapp-cli-"));
  const state = join(root, "state");
  const apps = join(root, "apps");
  const prayer = join(apps, "prayer");
  const quran = join(apps, "quran");
  const gone = join(apps, "gone");
  for (const d of [state, prayer, quran, gone, join(state, "chat")]) mkdirSync(d, { recursive: true });
  const app = (id: string, slug: string, name: string, extra: object = {}) => ({
    id,
    name,
    slug,
    packageName: `com.anyapp.${slug}`,
    status: "idle",
    iconVersion: 1,
    createdAt: "",
    updatedAt: "",
    ...extra,
  });
  writeFileSync(
    join(state, "apps.json"),
    JSON.stringify([
      { app: app("11111111-aaaa", "prayer", "Prayer Alarm", { latestApk: { number: 4, status: "succeeded", startedAt: "" } }), dir: prayer, ready: true },
      { app: app("22222222-bbbb", "quran", "Quran Reader", { preset: "kotlin" }), dir: quran, ready: true },
      { app: app("33333333-cccc", "gone", "Gone"), dir: gone, deleted: true },
    ]),
  );
  writeFileSync(join(prayer, "overview.md"), "# Prayer Alarm\n\n- Prayer times for Ajman\n");
  writeFileSync(
    join(state, "chat", "22222222-bbbb.json"),
    JSON.stringify([
      { seq: 2, kind: "assistant", text: "Done" },
      { seq: 1, kind: "user", text: "Show the Quran\n with big text" },
      { seq: 3, kind: "user", text: "Add a bookmark" },
    ]),
  );
  return { root, state, prayer, quran };
}

describe("anyapp CLI", () => {
  it("lists the apps that are not deleted and marks this app", () => {
    const f = fixture();
    const env = { [ENV_STATE_DIR]: f.state, [ENV_SELF_APP]: "22222222-bbbb" };
    const out = runCli(["apps"], env);
    expect(out.code).toBe(0);
    expect(out.out).toContain("prayer");
    expect(out.out).toContain("build 4");
    expect(out.out).toMatch(/\* quran\s+Quran Reader\s+kotlin\s+no build yet/);
    expect(out.out).not.toContain("Gone");
    const json = JSON.parse(runCli(["apps", "--json"], env).out) as { slug: string; self: boolean; folder: string; hasOverview: boolean }[];
    expect(json.map((a) => a.slug)).toEqual(["prayer", "quran"]);
    expect(json.find((a) => a.slug === "quran")).toMatchObject({ self: true, folder: f.quran, hasOverview: false });
  });

  it("prints an overview and a folder by slug, name, id prefix or self", () => {
    const f = fixture();
    const env = { [ENV_STATE_DIR]: f.state, [ENV_SELF_APP]: "11111111-aaaa" };
    expect(runCli(["overview", "prayer"], env).out).toContain("Prayer times for Ajman");
    expect(runCli(["overview", "Prayer Alarm"], env).out).toContain("Prayer times for Ajman");
    expect(runCli(["overview", "prayer", "alarm"], env).out).toContain("Prayer times for Ajman");
    // An empty ANYAPP_CLI_STATE_DIR means "not set", never the current folder.
    expect(runCli([`--default-state-dir=${f.state}`, "path", "self"], { ...env, [ENV_STATE_DIR]: "" }).out).toBe(f.prayer);
    expect(runCli(["path", "11111111"], env).out).toBe(f.prayer);
    expect(runCli(["path", "self"], env).out).toBe(f.prayer);
    expect(runCli(["path", "com.anyapp.quran"], env).out).toBe(f.quran);
    const missing = runCli(["overview", "nope"], env);
    expect(missing.code).toBe(1);
    expect(missing.out).toContain("prayer, quran");
  });

  it("falls back to the person's messages when an app has no overview.md", () => {
    const f = fixture();
    const out = runCli(["--state-dir", f.state, "overview", "quran"], {}).out;
    expect(out).toContain("no overview.md yet");
    expect(out.indexOf("Show the Quran with big text")).toBeLessThan(out.indexOf("Add a bookmark"));
    writeFileSync(join(f.quran, "APP_MEMORY.md"), "Goal: read the Quran");
    expect(runCli(["--state-dir", f.state, "overview", "quran"], {}).out).toContain("Goal: read the Quran");
  });

  it("finds the state folder: --state-dir, then the environment, then the launcher's default", () => {
    const f = fixture();
    const empty = mkdtempSync(join(tmpdir(), "anyapp-empty-"));
    expect(runCli([`--default-state-dir=${f.state}`, "apps"], {}).out).toContain("prayer");
    expect(runCli([`--default-state-dir=${f.state}`, "apps"], { [ENV_STATE_DIR]: empty }).out).toContain("No apps yet");
    expect(runCli(["--state-dir", f.state, `--default-state-dir=${empty}`, "apps"], { [ENV_STATE_DIR]: empty }).out).toContain("prayer");
  });

  it("installs launchers that run with this Node and read their own state folder", () => {
    const f = fixture();
    const bin = installAppsCli(f.state);
    expect(readFileSync(join(bin, "anyapp.cmd"), "utf8")).toContain("ELECTRON_RUN_AS_NODE=1");
    const env = { ...process.env, ...appsCliEnv(f.state, "22222222-bbbb", process.env) };
    delete env[ENV_STATE_DIR]; // the launcher's own default must be enough
    const run =
      process.platform === "win32"
        ? spawnSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/c", "anyapp", "apps"], { env, encoding: "utf8" })
        : spawnSync("anyapp", ["apps"], { env, encoding: "utf8" });
    expect(run.stderr).toBe("");
    expect(run.stdout).toMatch(/\* quran/);
    if (process.platform !== "win32") return;
    // Git Bash (Claude Code's Bash tool on Windows) runs the sh launcher.
    const bash = "C:\\Program Files\\Git\\bin\\bash.exe";
    let out = "";
    try {
      out = execFileSync(bash, ["-lc", `"${join(bin, "anyapp").replace(/\\/g, "/")}" path prayer`], { env, encoding: "utf8" });
    } catch {
      return; // no Git Bash on this machine
    }
    expect(out.trim()).toBe(f.prayer);
  });

  it("puts its folder first on the agent's PATH and survives agentEnv's stripping", () => {
    const base = { Path: "C:\\x", ANYAPP_PORT: "1", OTHER: "y" };
    const env = agentEnv(base, appsCliEnv("C:\\state", "id1", base));
    expect(env.ANYAPP_PORT).toBeUndefined();
    expect(env.Path).toBe(["C:\\state\\bin", "C:\\x"].join(delimiter).replace(/\//g, "\\"));
    expect(env[ENV_SELF_APP]).toBe("id1");
    expect(env[ENV_STATE_DIR]).toContain("state");
  });
});

describe("overview.md", () => {
  it("a first draft is marked, so the agent is told to write its own", () => {
    const dir = mkdtempSync(join(tmpdir(), "anyapp-ov-"));
    expect(overviewNeedsAgent(dir)).toBe(true);
    writeFileSync(join(dir, "overview.md"), firstOverview("Prayer", "Prayer times\nfor Ajman"));
    expect(readFileSync(join(dir, "overview.md"), "utf8")).toContain("> for Ajman");
    expect(overviewNeedsAgent(dir)).toBe(true);
    writeFileSync(join(dir, "overview.md"), "# Prayer\n- Times for Ajman\n");
    expect(overviewNeedsAgent(dir)).toBe(false);
  });

  it("the backfill lists the person's messages, oldest first", () => {
    const f = fixture();
    const text = backfillOverview(f.state, { id: "22222222-bbbb", name: "Quran Reader", folder: f.quran });
    expect(text.startsWith(OVERVIEW_DRAFT_MARK)).toBe(true);
    expect(text).toContain("- Show the Quran with big text\n- Add a bookmark");
  });

  it("every playbook tells the agent about overview.md and the anyapp command, without em dashes", () => {
    const info = { name: "T", packageName: "com.anyapp.t", dir: "d" };
    const texts = [appPlaybook(info), coordinatorPlaybook(info), workerPlaybook(info, { title: "x", changesApp: true }), overviewNudge()];
    for (const t of texts) {
      expect(t).toContain("overview.md");
      expect(t).toContain("anyapp apps");
      expect(t).not.toContain("\u2014");
    }
    expect(coordinatorPlaybook(info)).toContain("After every message from the person that changes what the app should do");
    expect(workerPlaybook(info, { title: "x", changesApp: true })).toContain("do not edit them");
  });
});
