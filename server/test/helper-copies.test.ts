// Helper copies against a real Git repository: two helpers land side by side, a clash is handed
// back and resolved in the helper's copy, leftover conflict markers are caught, node_modules is a
// real copy, and a failed landing can be undone.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { initRepo, run } from "../src/git.ts";
import {
  appBranch,
  ensureHelperCopy,
  helperCopyDir,
  landHelperWork,
  leftoverConflictMarkers,
  removeHelperCopy,
  saveHelperWork,
  undoLanding,
} from "../src/helper-copies.ts";

const root = mkdtempSync(join(tmpdir(), "anyapp-copies-"));
const apps = join(root, "apps");
const app = join(apps, "demo");
afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 3 }));

const read = (dir: string, file: string) => readFileSync(join(dir, file), "utf8").replace(/\r\n/g, "\n");
const lines = (n: number, change: Record<number, string> = {}) =>
  Array.from({ length: n }, (_, i) => change[i + 1] ?? `line ${i + 1}`).join("\n") + "\n";

describe("helper copies", () => {
  it("lands two helpers that change different files, then catches and resolves a clash on one file", async () => {
    mkdirSync(join(app, "node_modules", "react"), { recursive: true });
    writeFileSync(join(app, "node_modules", "react", "package.json"), '{"name":"react"}');
    writeFileSync(join(app, "App.tsx"), lines(20));
    writeFileSync(join(app, "Other.tsx"), lines(5));
    await initRepo(app, "Create demo");
    const base = await appBranch(app);

    const a = helperCopyDir(apps, "demo", "aaaaaa");
    const b = helperCopyDir(apps, "demo", "bbbbbb");
    const c = helperCopyDir(apps, "demo", "cccccc");
    for (const [dir, id] of [[a, "aaaaaa"], [b, "bbbbbb"], [c, "cccccc"]] as const) await ensureHelperCopy(app, dir, id, () => {});

    // Each copy has its own node_modules: a real copy, and changing it never reaches the app.
    const copied = join(a, "node_modules", "react", "package.json");
    expect(statSync(copied).nlink).toBe(1);
    writeFileSync(copied, '{"name":"patched"}');
    expect(read(app, "node_modules/react/package.json")).toBe('{"name":"react"}');

    // A and B change different files at the same time; both land, one after the other.
    writeFileSync(join(a, "App.tsx"), lines(20, { 2: "line 2 from A" }));
    writeFileSync(join(b, "Other.tsx"), lines(5, { 5: "line 5 from B" }));
    expect(await saveHelperWork(app, a, "A")).toBe(true);
    expect(await saveHelperWork(app, b, "B")).toBe(true);
    const landA = await landHelperWork(app, a, "aaaaaa", "A");
    expect(landA.ok).toBe(true);
    const landB = await landHelperWork(app, b, "bbbbbb", "B");
    expect(landB.ok).toBe(true);
    expect(read(app, "App.tsx")).toContain("line 2 from A");
    expect(read(app, "Other.tsx")).toContain("line 5 from B");

    // C changed the same line as A: its landing is refused with the file, and the app is untouched.
    writeFileSync(join(c, "App.tsx"), lines(20, { 2: "line 2 from C" }));
    await saveHelperWork(app, c, "C");
    const before = (await run("git", ["rev-parse", "HEAD"], app)).stdout.trim();
    const clash = await landHelperWork(app, c, "cccccc", "C");
    expect(clash).toEqual({ ok: false, conflict: ["App.tsx"] });
    expect((await run("git", ["rev-parse", "HEAD"], app)).stdout.trim()).toBe(before);
    expect(existsSync(join(c, ".git"))).toBe(true);
    expect((await run("git", ["status", "--porcelain"], c)).stdout.trim()).toBe(""); // the merge was undone

    // What the helper does when asked: merge the app in, which leaves markers. They are caught.
    await run("git", ["merge", base], c);
    expect(await leftoverConflictMarkers(c)).toEqual(["App.tsx"]);
    // It resolves the clash keeping both, and its change lands.
    writeFileSync(join(c, "App.tsx"), lines(20, { 2: "line 2 from A", 3: "line 3 from C" }));
    expect(await leftoverConflictMarkers(c)).toEqual([]);
    const landC = await landHelperWork(app, c, "cccccc", "C");
    expect(landC.ok).toBe(true);
    expect(read(app, "App.tsx")).toContain("line 2 from A");
    expect(read(app, "App.tsx")).toContain("line 3 from C");

    // A landing whose build failed is undone; the app's unsaved notes stay.
    writeFileSync(join(app, "APP_MEMORY.md"), "notes\n");
    if (!landC.ok) throw new Error("unreachable");
    expect(await undoLanding(app, landC.before)).toBe(true);
    expect(read(app, "App.tsx")).not.toContain("line 3 from C");

    for (const [dir, id] of [[a, "aaaaaa"], [b, "bbbbbb"], [c, "cccccc"]] as const) await removeHelperCopy(app, dir, id);
    expect(existsSync(a) || existsSync(b) || existsSync(c)).toBe(false);
    expect((await run("git", ["branch", "--list", "helper/*"], app)).stdout.trim()).toBe("");
  }, 60_000);
});
