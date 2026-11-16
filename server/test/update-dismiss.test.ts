// "Dismiss" on an app's update suggestion (docs/TRUST.md): kept on the PC for that one update, so
// every phone and the desktop hide it; a newer template shows it again.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { App } from "../../shared/protocol.ts";
import { AppManager } from "../src/apps.ts";
import type { Config } from "../src/config.ts";
import { Store } from "../src/store.ts";

vi.mock("../../shared/engines.mts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../shared/engines.mts")>()),
  findEngine: () => "/test/bin/claude",
}));

describe("dismissing an update", () => {
  it("hides this update everywhere, keeps it hidden after a restart, and shows a newer one", async () => {
    const root = mkdtempSync(join(tmpdir(), "kiwi-dismiss-"));
    const state = join(root, "state");
    const dir = join(root, "apps", "tea");
    mkdirSync(state, { recursive: true });
    mkdirSync(dir, { recursive: true });
    const part = join(root, "template", "modules", "updates");
    mkdirSync(part, { recursive: true });
    writeFileSync(join(part, "index.ts"), "export const v = 1;\n");
    execFileSync("git", ["init", "-q"], { cwd: dir });
    const app: App = { id: "tea", name: "Tea Timer", slug: "tea", packageName: "com.anyapp.tea", status: "idle", iconVersion: 1, createdAt: "", updatedAt: "" };
    writeFileSync(join(state, "apps.json"), JSON.stringify([{ app, dir, ready: true }]));
    const sent: unknown[] = [];
    const make = () =>
      new AppManager({
        store: new Store(state),
        builder: { kind: "fake", createApp: async () => {}, buildApk: vi.fn(), getIconPath: () => null },
        config: { stateDir: state, appsDir: join(root, "apps"), github: false, coordinator: false, port: 1 } as Config,
        repoDir: root,
        broadcast: (m) => sent.push(m),
        log: () => {},
      });
    let apps = make();
    apps.recover();
    try {
      expect(apps.dismissUpdate(app.id).health).toMatchObject({ behind: true, dismissed: true });
      expect(apps.care().health.behind).toBe(0);
      expect(sent).toContainEqual(expect.objectContaining({ type: "app.updated" }));
      await apps.shutdown();

      apps = make();
      apps.recover();
      expect(apps.get(app.id).health?.dismissed).toBe(true);
      await apps.shutdown();

      // A newer template: the same app is behind again, by a newer update.
      writeFileSync(join(part, "index.ts"), "export const v = 2;\n");
      apps = make();
      apps.recover();
      expect(apps.get(app.id).health?.behind).toBe(true);
      expect(apps.get(app.id).health?.dismissed).toBeUndefined();
      expect(apps.care().health.behind).toBe(1);
    } finally {
      await apps.shutdown();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
