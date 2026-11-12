import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AppPreset } from "../../shared/protocol.ts";
import { AppManager, HttpError, PRESETS } from "../src/apps.ts";
import type { Builder } from "../src/builder.ts";
import type { Config } from "../src/config.ts";
import { appPlaybook, buildFixPrompt, checkCommand } from "../src/playbook.ts";
import { Store } from "../src/store.ts";

function manager() {
  const state = mkdtempSync(join(tmpdir(), "anyapp-preset-"));
  const calls: { preset?: AppPreset }[] = [];
  const builder: Builder = {
    kind: "fake",
    // Fails on purpose, so creation stops before any agent session starts.
    createApp: async (args) => {
      calls.push({ preset: args.preset });
      throw new Error("stop here");
    },
    buildApk: async () => {
      throw new Error("not used");
    },
    getIconPath: () => null,
  };
  const config = { stateDir: state, appsDir: join(state, "apps"), github: false, maxBuildFixes: 3 } as Config;
  const apps = new AppManager({ store: new Store(state), builder, config, broadcast: () => {}, log: () => {} });
  return { apps, calls, done: () => rmSync(state, { recursive: true, force: true }) };
}

describe("app presets", () => {
  it("keeps the preset on the app and hands it to the builder; React Native is the default", async () => {
    const { apps, calls, done } = manager();
    try {
      const kotlin = apps.create("Tea Timer", "A tea timer", "kotlin");
      const plain = apps.create("Water", "Drink water");
      expect(kotlin.preset).toBe("kotlin");
      expect(plain.preset).toBe("react-native");
      await new Promise((r) => setTimeout(r, 50));
      expect(calls).toEqual([{ preset: "kotlin" }, { preset: "react-native" }]);
    } finally {
      done();
    }
  });

  it("says the app waits for the person while a question page is open, until it is answered", async () => {
    const { apps, done } = manager();
    try {
      const app = apps.create("Tea Timer", "A tea timer");
      await new Promise((r) => setTimeout(r, 50));
      apps.pages.publish({ appId: app.id, html: "<title>Tea: a look</title><gx-page><h1>Look</h1></gx-page>" });
      expect(apps.get(app.id).waitingForAnswer).toBeFalsy();
      const { page } = apps.pages.publish({ appId: app.id, html: '<title>Tea: the plan</title><gx-questions><gx-question title="Build it?"><gx-choice>Build it</gx-choice></gx-question></gx-questions>' });
      expect(apps.get(app.id).waitingForAnswer).toBe(true);
      const server = (await import("node:http")).createServer((req, res) => {
        const url = new URL(req.url ?? "/", "http://localhost");
        void apps.pages.route(req, res, url.pathname, url);
      });
      await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
      const port = (server.address() as { port: number }).port;
      const { path } = apps.pages.open(app.id, page.id);
      await fetch(`http://127.0.0.1:${port}${path}/answers`, { method: "POST", body: JSON.stringify({ answers: { "Build it?": "Build it" } }) });
      server.close();
      expect(apps.get(app.id).waitingForAnswer).toBe(false);
    } finally {
      done();
    }
  });

  it("refuses an unknown preset with a plain 400", () => {
    const { apps, done } = manager();
    try {
      expect(() => apps.create("X", "y", "flutter")).toThrow(HttpError);
      expect(apps.list()).toEqual([]);
    } finally {
      done();
    }
  });

  it("points each app's agent at its own check command", () => {
    expect(PRESETS).toEqual(["react-native", "kotlin", "expo-exact"]);
    const exact = appPlaybook({ name: "T", packageName: "com.anyapp.t", dir: "d", preset: "expo-exact" });
    expect(exact).toContain("bun exact.mjs contract build app.contract --json");
    expect(exact).toContain("no AI through Kiwimake yet");
    expect(exact).not.toContain("npm run check");
    expect(checkCommand(undefined)).toBe("npm run check");
    const kotlin = appPlaybook({ name: "T", packageName: "com.anyapp.t", dir: "C:\\aa\\apps\\t", preset: "kotlin" });
    expect(kotlin).toContain("native Android app (Kotlin, Jetpack Compose");
    expect(kotlin).toContain(":app:compileReleaseKotlin");
    expect(kotlin).not.toContain("npm run check");
    expect(kotlin).toContain("the Ai object in ai/Ai.kt");
    expect(kotlin).not.toContain("src/lib/ai.ts");
    expect(appPlaybook({ name: "T", packageName: "com.anyapp.t", dir: "d" })).toContain("npm run check");
    expect(buildFixPrompt({ buildNumber: 2, attempt: 1, maxAttempts: 3, error: "e", preset: "kotlin" })).toContain(":app:compileReleaseKotlin");
  });
});
