import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decodeBase32, decodeEasyConnectCode, encodeBase32, encodeEasyConnectCode, EASY_CONNECT_CODE_PREFIX } from "../src/easy-connect/code.ts";
import { allowArgument, redactAddresses, versionIsSupported } from "../src/easy-connect/tailcat.ts";
import { withoutEmDashes } from "../src/apps.ts";

const address = `tc${randomBytes(170).toString("base64url")}`;
const secret = randomBytes(24).toString("base64url");

describe("Easy Connect code", () => {
  it("round-trips address, secret, port and name", () => {
    const text = encodeEasyConnectCode({ address, secret, port: 8787, name: "M7-Desktop" });
    expect(text.startsWith(EASY_CONNECT_CODE_PREFIX)).toBe(true);
    expect(text).toMatch(/^[A-Z0-9:-]+$/);
    expect(decodeEasyConnectCode(text)).toEqual({ address, secret, port: 8787, name: "M7-Desktop" });
    expect(decodeEasyConnectCode(text.toLowerCase())).toEqual({ address, secret, port: 8787, name: "M7-Desktop" });
  });

  it("matches the documented byte layout", () => {
    const text = encodeEasyConnectCode({ address: "tcAQID", secret: "BAU", port: 0x2253, name: "PC" });
    const bytes = decodeBase32(text.slice(EASY_CONNECT_CODE_PREFIX.length))!;
    expect([...bytes]).toEqual([0, 3, 1, 2, 3, 0, 2, 4, 5, 0x22, 0x53, 0, 2, 0x50, 0x43]);
  });

  it("keeps UTF-8 names and ignores bytes after the name", () => {
    const text = encodeEasyConnectCode({ address, secret, port: 1, name: "حاسوب" });
    const bytes = decodeBase32(text.slice(EASY_CONNECT_CODE_PREFIX.length))!;
    const extended = EASY_CONNECT_CODE_PREFIX + encodeBase32(Buffer.concat([bytes, Buffer.from([0, 3, 9, 9, 9])]));
    expect(decodeEasyConnectCode(extended)).toEqual({ address, secret, port: 1, name: "حاسوب" });
  });

  it("rejects foreign or broken codes", () => {
    expect(decodeEasyConnectCode("GHOSTEX-EC2:AAAA")).toBeNull();
    expect(decodeEasyConnectCode(`${EASY_CONNECT_CODE_PREFIX}AA`)).toBeNull();
    expect(decodeEasyConnectCode(`${EASY_CONNECT_CODE_PREFIX}!!!`)).toBeNull();
    expect(() => encodeEasyConnectCode({ address: "xx", secret, port: 1, name: "a" })).toThrow();
  });

  it("base32 is RFC 4648 without padding", () => {
    expect(encodeBase32(Buffer.from("foobar"))).toBe("MZXW6YTBOI");
    expect(decodeBase32("MZXW6YTBOI")!.toString()).toBe("foobar");
  });
});

describe("Tailcat helper", () => {
  it("serves an open list only during the pairing window and never an empty one", () => {
    expect(allowArgument([], true)).toBeNull();
    expect(allowArgument(["nodekey:a", "nodekey:b"], true)).toBeNull();
    expect(allowArgument([], false)).toBe("none");
    expect(allowArgument([" ", ""], false)).toBe("none");
    expect(allowArgument(["nodekey:a", "nodekey:b"], false)).toBe("nodekey:a,nodekey:b");
  });

  it("needs tailcat v0.6.0 or newer, like Ghostex", () => {
    expect(versionIsSupported("v0.6.0")).toBe(true);
    expect(versionIsSupported("v0.7.2")).toBe(true);
    expect(versionIsSupported("v1.0.0")).toBe(true);
    expect(versionIsSupported("v0.5.9")).toBe(false);
    expect(versionIsSupported(null)).toBe(false);
  });

  it("keeps addresses out of logs", () => {
    expect(redactAddresses(`listening on ${address} now`)).toBe("listening on tc… now");
  });
});

const EM_DASH = String.fromCharCode(0x2014);

describe("no em dashes", () => {
  it("replaces them in texts derived from the agent", () => {
    expect(withoutEmDashes(`Tap Counter ${EM_DASH} app memory`)).toBe("Tap Counter, app memory");
    expect(withoutEmDashes("plain")).toBe("plain");
  });
});
