// The update feeds (dev/update-feed.mjs): what electron-updater reads, and the checks before a release.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error js-yaml comes with electron-updater, without types: it is the parser the updater uses
import { load } from "js-yaml";
import { afterAll, describe, expect, it } from "vitest";
// @ts-expect-error plain ESM script without types
import { checkFeed, feedYaml, parseFeed, sha512 } from "../dev/update-feed.mjs";

const dir = mkdtempSync(join(tmpdir(), "kiwimake-feed-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
writeFileSync(join(dir, "Kiwimake-x86_64.AppImage"), "appimage bytes");
writeFileSync(join(dir, "kiwimake_amd64.deb"), "deb bytes");
const files = ["Kiwimake-x86_64.AppImage", "kiwimake_amd64.deb"].map((name) => ({ name, size: name.endsWith("deb") ? 9 : 14, sha512: sha512(join(dir, name)) }));

describe("update feeds", () => {
  const text = feedYaml({ version: "0.4.0", files, releaseDate: "2026-11-17T00:00:00.000Z" });

  it("is the YAML electron-updater expects", () => {
    const y = load(text) as { version: string; files: { url: string; sha512: string; size: number }[]; path: string; sha512: string; releaseDate: string };
    expect(y.version).toBe("0.4.0");
    expect(y.files.map((f) => f.url)).toEqual(["Kiwimake-x86_64.AppImage", "kiwimake_amd64.deb"]);
    expect(y.files[0].sha512).toBe(files[0].sha512);
    expect(y.files[1].size).toBe(9);
    expect(y.path).toBe("Kiwimake-x86_64.AppImage");
    expect(y.sha512).toBe(files[0].sha512);
    expect(parseFeed(text)).toMatchObject({ version: "0.4.0", files });
  });

  it("checks every file against the folder", () => {
    expect(checkFeed("latest-linux.yml", text, dir, "0.4.0")).toEqual([]);
    expect(checkFeed("latest-linux.yml", text, dir, "0.4.1")).toEqual(["latest-linux.yml says version 0.4.0, expected 0.4.1"]);
    writeFileSync(join(dir, "kiwimake_amd64.deb"), "deb byteZ");
    expect(checkFeed("latest-linux.yml", text, dir)).toEqual(["kiwimake_amd64.deb: SHA-512 differs from the feed"]);
    writeFileSync(join(dir, "kiwimake_amd64.deb"), "deb bytes");
  });

  it("refuses a feed without a file the installers need", () => {
    const onlyAppImage = feedYaml({ version: "0.4.0", files: files.slice(0, 1), releaseDate: "x" });
    expect(checkFeed("latest-linux.yml", onlyAppImage, dir)).toEqual(["latest-linux.yml lists no file matching /^kiwimake_amd64\\.deb$/"]);
    expect(checkFeed("latest-mac.yml", onlyAppImage, dir).filter((p: string) => p.includes("lists no file"))).toHaveLength(2);
    expect(() => feedYaml({ version: "v0.4", files, releaseDate: "x" })).toThrow(/MAJOR.MINOR.PATCH/);
  });
});
