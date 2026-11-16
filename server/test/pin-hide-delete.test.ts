// Pin, hide and delete (shared/protocol.ts, "Pin, hide and delete"): the Pinned section shared by
// every client, hiding, deleting into Recently deleted, restoring, deleting for good and Empty.
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type { App, ServerEvent } from "../../shared/protocol.ts";
import { AppManager } from "../src/apps.ts";
import type { Builder } from "../src/builder.ts";
import type { Config } from "../src/config.ts";
import type { GithubApi } from "../src/sharing.ts";
import { Store } from "../src/store.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function setup() {
  const root = mkdtempSync(join(tmpdir(), "aa-pins-"));
  dirs.push(root);
  const state = join(root, "state");
  const appsDir = join(root, "apps");
  const events: ServerEvent[] = [];
  const deletedRepos: string[] = [];
  const github = {
    deleteRepo: async (full: string) => {
      if (full.endsWith("-releases")) throw new Error("HTTP 403");
      deletedRepos.push(full);
    },
  } as unknown as GithubApi;
  const builder: Builder = { kind: "fake", createApp: async () => ({}) as never, buildApk: async () => ({}) as never, getIconPath: () => null };
  const config = { stateDir: state, appsDir, github: false, maxBuildFixes: 3 } as Config;
  const store = new Store(state);
  const apps = new AppManager({ store, builder, config, broadcast: (e) => events.push(e), log: () => {}, github });
  const add = (slug: string, extra: Partial<App> = {}): App => {
    const dir = join(appsDir, slug);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "App.tsx"), "export default 1;\n");
    const now = new Date().toISOString();
    return apps.adoptMovedApp(
      { id: crypto.randomUUID(), name: slug, slug, packageName: `com.anyapp.${slug}`, preset: "react-native", status: "idle", iconVersion: 1, createdAt: now, updatedAt: now, ...extra },
      dir,
      [{ id: `c-${slug}`, appId: "x", seq: 1, kind: "user", text: "Make it", createdAt: now, updatedAt: now }],
      [],
    );
  };
  return { apps, store, events, add, appsDir, state, deletedRepos, reload: () => new Store(state) };
}

describe("pins", () => {
  test("the whole section in order, unknown ids dropped, no updatedAt bump, saved", () => {
    const { apps, add, reload, store } = setup();
    const a = add("alpha");
    const b = add("bravo");
    const c = add("charlie");
    const before = apps.get(a.id).updatedAt;
    expect(apps.setPins([b.id, "nope", a.id]).map((x) => x.id)).toEqual([b.id, a.id]);
    expect(apps.get(b.id).pin).toBe(0);
    expect(apps.get(a.id).pin).toBe(1);
    expect(apps.get(c.id).pin).toBeUndefined();
    expect(apps.get(a.id).updatedAt).toBe(before);
    // Reorder and unpin in one call.
    apps.setPins([a.id]);
    expect(apps.get(a.id).pin).toBe(0);
    expect(apps.get(b.id).pin).toBeUndefined();
    apps.setPins([a.id, c.id]);
    store.flush();
    expect(reload().find(c.id)?.app.pin).toBe(1);
  });

  test("hiding unpins and closes the gap; unhiding shows it unpinned", () => {
    const { apps, add } = setup();
    const a = add("alpha");
    const b = add("bravo");
    const c = add("charlie");
    apps.setPins([a.id, b.id, c.id]);
    const hidden = apps.hide(b.id, true);
    expect(hidden.hidden).toBe(true);
    expect(hidden.pin).toBeUndefined();
    expect(apps.get(c.id).pin).toBe(1);
    // A hidden app can't be pinned.
    expect(apps.setPins([b.id, a.id]).map((x) => x.id)).toEqual([a.id]);
    expect(apps.hide(b.id, false).hidden).toBeUndefined();
  });
});

describe("delete", () => {
  test("into Recently deleted, then restore: files kept, unpinned, events sent", async () => {
    const { apps, add, events, appsDir } = setup();
    const a = add("alpha");
    const b = add("bravo");
    apps.setPins([a.id, b.id]);
    const result = await apps.delete(a.id, { uninstall: true });
    expect(result).toEqual({ forGood: false });
    expect(apps.list().map((x) => x.id)).toEqual([b.id]);
    expect(apps.get(b.id).pin).toBe(0);
    expect(events).toContainEqual({ type: "app.deleted", appId: a.id, uninstall: true });
    expect(events).toContainEqual({ type: "trash.updated", count: 1 });
    const trash = apps.trash();
    expect(trash.map((x) => x.id)).toEqual([a.id]);
    expect(trash[0]!.deletedAt).toBeTruthy();
    expect(existsSync(join(appsDir, "alpha"))).toBe(true);
    // Settings shows its icon while it waits in Recently deleted.
    expect(apps.iconApp(a.id).id).toBe(a.id);
    expect(apps.icon(a.id)).toBeTruthy();

    const back = apps.restoreDeleted(a.id);
    expect(back.pin).toBeUndefined();
    expect(apps.list().map((x) => x.id).sort()).toEqual([a.id, b.id].sort());
    expect(apps.trash()).toEqual([]);
    expect(apps.messages(a.id, 0)).toHaveLength(1);
    expect(() => apps.restoreDeleted(a.id)).toThrow(/not in Recently deleted/);
  });

  test("for good: folder, chat and repos gone, never in the bin, slug stays taken", async () => {
    const { apps, add, store, appsDir, deletedRepos } = setup();
    const a = add("alpha", {
      repoUrl: "https://github.com/octo/anyapp-alpha",
      sharing: { shared: true, releasesRepoUrl: "https://github.com/octo/anyapp-alpha-releases", installUrl: "", feedUrl: "", since: "" },
    });
    store.flush();
    expect(existsSync(store.chatPath(a.id))).toBe(true);
    const result = await apps.delete(a.id, { forGood: true });
    expect(result.forGood).toBe(true);
    // GitHub refused the releases repo: said plainly, the rest still done.
    expect(result.problem).toMatch(/anyapp-alpha-releases/);
    expect(deletedRepos).toEqual(["octo/anyapp-alpha"]);
    expect(existsSync(join(appsDir, "alpha"))).toBe(false);
    expect(existsSync(store.chatPath(a.id))).toBe(false);
    expect(apps.trash()).toEqual([]);
    expect(store.allRecords().some((r) => r.app.slug === "alpha")).toBe(true);
  });

  test("Empty deletes the bin's apps for good here but keeps their GitHub repos", async () => {
    const { apps, add, appsDir, events, deletedRepos } = setup();
    const a = add("alpha", { repoUrl: "https://github.com/octo/anyapp-alpha" });
    const b = add("bravo");
    await apps.delete(a.id);
    await apps.delete(b.id);
    expect(apps.trash().map((x) => x.id).sort()).toEqual([a.id, b.id].sort());
    await apps.emptyTrash();
    expect(apps.trash()).toEqual([]);
    expect(existsSync(join(appsDir, "alpha"))).toBe(false);
    expect(existsSync(join(appsDir, "bravo"))).toBe(false);
    expect(deletedRepos).toEqual([]);
    expect(events.at(-1)).toEqual({ type: "trash.updated", count: 0 });
  });

  test("a copy that moved to the cloud leaves the list without reaching the bin", async () => {
    const { apps, add } = setup();
    const a = add("alpha");
    await apps.delete(a.id, { trash: false });
    expect(apps.list()).toEqual([]);
    expect(apps.trash()).toEqual([]);
  });
});
