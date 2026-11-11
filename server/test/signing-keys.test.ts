import { describe, expect, it } from "vitest";
import type { Builder } from "../src/builder.ts";
import { HttpError } from "../src/apps.ts";
import { SigningKeys } from "../src/signing-keys.ts";

function fakeBuilder(): { builder: Builder; calls: { backup: unknown[]; restore: unknown[] } } {
  const calls = { backup: [] as unknown[], restore: [] as unknown[] };
  const builder = {
    kind: "fake",
    createApp: async () => {},
    buildApk: async () => ({ apkPath: "", sizeBytes: 0, sha256: "" }),
    getIconPath: () => null,
    keys: {
      list: async () => ({
        keys: [
          { id: "shared", kind: "shared" as const, certSha256: "aa" },
          { id: "com.anyapp.tea", kind: "own" as const, certSha256: "bb" },
        ],
        lastBackupAt: null,
        notBackedUp: ["shared", "com.anyapp.tea"],
      }),
      backup: async (args: { file: string; password: string }) => {
        calls.backup.push(args);
        return { file: args.file, count: 2, createdAt: "2026-11-11T00:00:00.000Z" };
      },
      restore: async (args: { file: string; password: string }) => {
        calls.restore.push(args);
        return { added: ["com.anyapp.tea"], same: ["shared"], conflicts: [] };
      },
    },
  } satisfies Builder;
  return { builder, calls };
}

describe("SigningKeys", () => {
  it("summarises the keys with app names, and tells the desktop app when they change", async () => {
    const { builder } = fakeBuilder();
    const keys = new SigningKeys(builder, () => new Map([["com.anyapp.tea", "Tea Timer"]]), () => {});
    let changes = 0;
    keys.onChange = () => changes++;
    await keys.refresh();
    await keys.refresh();
    expect(changes).toBe(1);
    expect(keys.state()).toEqual({
      keys: [
        { id: "shared", kind: "shared", certSha256: "aa" },
        { id: "com.anyapp.tea", kind: "own", certSha256: "bb", appName: "Tea Timer" },
      ],
      lastBackupAt: null,
      notBackedUp: ["shared", "com.anyapp.tea"],
    });
  });

  it("checks the file and password before the builder sees them", async () => {
    const { builder, calls } = fakeBuilder();
    const keys = new SigningKeys(builder, () => new Map(), () => {});
    await expect(keys.backup("relative.json", "long enough")).rejects.toThrow(HttpError);
    await expect(keys.backup("C:\\keys.json", "short")).rejects.toThrow(/at least 8/);
    await expect(keys.restore("C:\\keys.json", 12345678)).rejects.toThrow(/at least 8/);
    expect(calls.backup).toHaveLength(0);
    expect(await keys.backup("C:\\keys.json", "long enough")).toEqual({ file: "C:\\keys.json", count: 2, createdAt: "2026-11-11T00:00:00.000Z" });
    expect(await keys.restore("C:\\keys.json", "long enough")).toEqual({ added: ["com.anyapp.tea"], same: ["shared"], conflicts: [] });
  });

  it("turns a builder error (wrong password) into a 400 with its message", async () => {
    const { builder } = fakeBuilder();
    builder.keys!.restore = async () => {
      throw new Error("Wrong password, or the backup file was changed.");
    };
    const keys = new SigningKeys(builder, () => new Map(), () => {});
    const error = await keys.restore("C:\\keys.json", "long enough").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(400);
    expect((error as Error).message).toBe("Wrong password, or the backup file was changed.");
  });

  it("is unavailable without the real builder's keys", async () => {
    const { builder } = fakeBuilder();
    const keys = new SigningKeys({ ...builder, keys: undefined }, () => new Map(), () => {});
    expect(keys.available).toBe(false);
    await keys.refresh();
    expect(keys.state()).toBeUndefined();
    await expect(keys.backup("C:\\keys.json", "long enough")).rejects.toThrow(/real builder/);
  });
});
