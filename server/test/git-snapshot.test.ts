import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { commitAll, initRepo, run, treeSnapshot } from "../src/git.ts";

const root = mkdtempSync(join(tmpdir(), "anyapp-git-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("treeSnapshot with the real build's output", () => {
  it("ignores native module build output and still sees the agent's changes", async () => {
    const dir = join(root, "app");
    mkdirSync(join(dir, "src"), { recursive: true });
    // The template's own .gitignore: rooted /android and /build, nothing for modules/*/android/build.
    writeFileSync(join(dir, ".gitignore"), "node_modules/\n/android\n/build/\n");
    writeFileSync(join(dir, "src", "App.tsx"), "export const a = 1;\n");
    await initRepo(dir, "Create");
    const before = await treeSnapshot(dir);

    // What Gradle writes for the local native module: a path longer than Windows Git allows by default.
    const deep = join(dir, "modules", "alarms", "android", "build", ".transforms", "x".repeat(40), "transformed", "y".repeat(60), "z".repeat(60));
    mkdirSync(deep, { recursive: true });
    writeFileSync(join(deep, `AnyappAlarmsModule$definition$lambda$8$$inlined$AsyncFunction$1${"q".repeat(40)}.dex`), "dex");
    expect(await treeSnapshot(dir)).toBe(before);

    writeFileSync(join(dir, "src", "App.tsx"), "export const a = 2;\n");
    const after = await treeSnapshot(dir);
    expect(after).not.toBe(before);
    expect(after.startsWith("unknown")).toBe(false);

    expect(await commitAll(dir, "Build 1")).toBe(true);
    const files = (await run("git", ["ls-files"], dir)).stdout;
    expect(files).not.toContain("modules/alarms/android/build");
  });
});
