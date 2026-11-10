import { describe, expect, it } from "vitest";
import { inflateSync } from "node:zlib";
import { slugify } from "../src/apps.ts";
import { pickAllowOption } from "../src/acp/claude-session.ts";
import { placeholderIconPng } from "../src/icon.ts";
import { REPO_NAME_PATTERN } from "../src/git.ts";

describe("slugify", () => {
  it("makes a valid Android package segment", () => {
    expect(slugify("Prayer Alarm")).toBe("prayeralarm");
    expect(slugify("Café Menü")).toBe("cafemenu");
    expect(slugify("123 go")).toBe("app123go");
    expect(slugify("منبه الصلاة")).toBe("app");
    expect(slugify("New")).toBe("newapp");
  });
});

describe("pickAllowOption", () => {
  it("prefers allow_once, then allow_always, like bb's full mode", () => {
    expect(
      pickAllowOption([
        { optionId: "a", kind: "allow_always" },
        { optionId: "o", kind: "allow_once" },
        { optionId: "r", kind: "reject_once" },
      ]),
    ).toBe("o");
    expect(pickAllowOption([{ optionId: "a", kind: "allow_always" }])).toBe("a");
    expect(pickAllowOption([{ optionId: "r", kind: "reject_once" }])).toBeUndefined();
  });
});

describe("placeholderIconPng", () => {
  it("is a valid 192x192 PNG whose colour depends on the name", () => {
    const png = placeholderIconPng("Prayer Alarm");
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    expect(png.readUInt32BE(16)).toBe(192);
    const idat = png.indexOf("IDAT");
    const raw = inflateSync(png.subarray(idat + 4, idat + 4 + png.readUInt32BE(idat - 4)));
    expect(raw.length).toBe((192 * 3 + 1) * 192);
    expect(placeholderIconPng("Other").equals(png)).toBe(false);
  });
});

describe("GitHub repo names", () => {
  it("only allows anyapp-<slug>", () => {
    expect(REPO_NAME_PATTERN.test("anyapp-prayeralarm")).toBe(true);
    expect(REPO_NAME_PATTERN.test("anyapp-selftest-ab12")).toBe(true);
    expect(REPO_NAME_PATTERN.test("prayeralarm")).toBe(false);
    expect(REPO_NAME_PATTERN.test("anyapp-../x")).toBe(false);
  });
});
