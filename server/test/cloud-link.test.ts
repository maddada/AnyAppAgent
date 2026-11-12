// The PC link on the companion (src/cloud-link.ts, docs/CLOUD.md section 3): the phone hands a
// link over, the desktop signs in through the browser (start, poll), the hand-over to the phone,
// unlink, a link revoked elsewhere, and the token never leaving the companion. Convex is a fake.
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test, vi } from "vitest";
import { allowedSite, CloudLink } from "../src/cloud-link.ts";

const SITE = "https://fake-deploy-123.convex.site";

function fakeConvex() {
  const live = new Map<string, { linkedFrom: "phone" | "pc"; linkedFromName: string | null }>();
  const calls: string[] = [];
  let approved = false;
  const fetchImpl = (async (url: string | URL, init: RequestInit = {}) => {
    const path = String(url).replace(SITE, "");
    calls.push(path);
    const token = /^Bearer (.+)$/.exec(String((init.headers as Record<string, string>)?.Authorization ?? ""))?.[1];
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    if (path === "/pc/hello") {
      const l = token ? live.get(token) : undefined;
      if (!l) return json(401, { error: "no" });
      return json(200, { linkId: "l1", scopes: ["share", "web", "move"], deviceName: "MADDA-PC", ...l, account: { email: "a@example.com", name: null, anonymous: false } });
    }
    if (path === "/pc/unlink") {
      if (token) live.delete(token);
      return json(200, { ok: true });
    }
    if (path === "/pc/handoff") {
      const l = token ? live.get(token) : undefined;
      if (!l) return json(401, {});
      return l.linkedFrom === "pc" ? json(200, { code: "handoff-code-0123456789abcdef" }) : json(409, { error: "This PC was linked from a phone." });
    }
    if (path === "/pc/link/start") return json(200, { code: "ABCDEFGH", shown: "ABCD-EFGH", poll: "poll-secret", url: `${SITE}/pc/link?l=ABCDEFGH`, expiresInMs: 600_000 });
    if (path === "/pc/link/poll") {
      if (!approved) return json(200, { state: "pending" });
      live.set("kpc_browser", { linkedFrom: "pc", linkedFromName: null });
      return json(200, { state: "linked", token: "kpc_browser" });
    }
    return json(404, {});
  }) as typeof fetch;
  return { live, calls, fetchImpl, approve: () => (approved = true) };
}

function make(fake: ReturnType<typeof fakeConvex>, dir = mkdtempSync(join(tmpdir(), "aa-link-"))) {
  const link = new CloudLink({ stateDir: dir, site: SITE, deviceName: () => "MADDA-PC", log: () => {}, fetch: fake.fetchImpl, pollEveryMs: 5 });
  const events: string[] = [];
  link.onChange = (info) => events.push(info.state);
  return { link, dir, events };
}

describe("the PC link on the companion", () => {
  test("the phone hands a link over; it is kept in the state folder and survives a restart", async () => {
    const fake = fakeConvex();
    fake.live.set("kpc_phone", { linkedFrom: "phone", linkedFromName: "Pixel 8" });
    const { link, dir, events } = make(fake);
    const info = await link.link({ token: "kpc_phone", site: SITE, phoneName: "Pixel 8" });
    expect(info).toMatchObject({ state: "linked", linkedFrom: "phone", linkedFromName: "Pixel 8", account: { email: "a@example.com" }, canHandOff: false });
    expect(JSON.stringify(info)).not.toContain("kpc_");
    expect(events).toEqual(["linked"]);
    expect(JSON.parse(readFileSync(join(dir, "cloud-link.json"), "utf8")).token).toBe("kpc_phone");
    const again = make(fake, dir).link;
    expect(again.info()).toMatchObject({ state: "linked", linkedFromName: "Pixel 8" });
    // A PC the phone linked does not hand a sign-in back.
    await expect(link.handoff()).rejects.toThrow(/linked from a phone/);
  });

  test("a bad token or an address that is not a Kiwimake cloud is refused", async () => {
    const fake = fakeConvex();
    const { link } = make(fake);
    await expect(link.link({ token: "kpc_unknown", site: SITE })).rejects.toThrow(/does not work/);
    await expect(link.link({ token: "nope", site: SITE })).rejects.toThrow(/PC link/);
    await expect(link.link({ token: "kpc_x", site: "https://evil.example.com" })).rejects.toThrow(/not a Kiwimake cloud/);
    expect(allowedSite("https://perceptive-gnu-478.convex.site")).toBe(true);
    expect(allowedSite("http://perceptive-gnu-478.convex.site")).toBe(false);
    expect(allowedSite("https://x.convex.site.evil.com")).toBe(false);
    expect(link.info().state).toBe("none");
  });

  test("the desktop signs in through the browser: start, then the poll collects the link", async () => {
    const fake = fakeConvex();
    const { link, events } = make(fake);
    const started = await link.startSignIn();
    expect(started).toMatchObject({ state: "signingIn", signIn: { url: `${SITE}/pc/link?l=ABCDEFGH`, code: "ABCD-EFGH" } });
    await vi.waitFor(() => expect(fake.calls.filter((c) => c === "/pc/link/poll").length).toBeGreaterThan(1));
    expect(link.info().state).toBe("signingIn");
    fake.approve();
    await vi.waitFor(() => expect(link.info().state).toBe("linked"));
    expect(link.info()).toMatchObject({ linkedFrom: "pc", canHandOff: true });
    expect(events).toEqual(["signingIn", "linked"]);
    // A PC that signed in itself hands its sign-in to its phone.
    expect(await link.handoff()).toEqual({ code: "handoff-code-0123456789abcdef", site: SITE });
  });

  test("unlink revokes in Convex and forgets the token; a link revoked elsewhere goes at the next check", async () => {
    const fake = fakeConvex();
    fake.live.set("kpc_phone", { linkedFrom: "phone", linkedFromName: "Pixel 8" });
    const { link, dir } = make(fake);
    await link.link({ token: "kpc_phone", site: SITE });
    expect((await link.unlink()).state).toBe("none");
    expect(fake.live.has("kpc_phone")).toBe(false);
    expect(existsSync(join(dir, "cloud-link.json"))).toBe(false);

    fake.live.set("kpc_two", { linkedFrom: "phone", linkedFromName: "Pixel 8" });
    await link.link({ token: "kpc_two", site: SITE });
    fake.live.delete("kpc_two"); // unlinked on the phone
    await link.check();
    expect(link.info().state).toBe("none");
  });
});
