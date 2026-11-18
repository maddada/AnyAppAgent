import { describe, expect, it } from "vitest";
import type { App, BuildInfo, ChatItem } from "../../shared/protocol.ts";
import { buildCard } from "../../shared/chat/index.ts";
import { appState } from "../src/renderer/src/ui.tsx";
import { webAppState, webPartView } from "../src/renderer/src/web.ts";
import { isOpenableUrl } from "../src/shared/links.ts";

// Web apps on the PC (docs/WEB-APPS.md): the build card's web part and the app's state line.
const ADDRESS = "https://sara.github.io/anyapp-tipsplitter-web/";
const NOW = Date.parse("2026-11-18T12:00:00Z");
const at = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000).toISOString();

const base: App = { id: "tip", name: "Tip Splitter", slug: "tipsplitter", packageName: "com.anyapp.tipsplitter", status: "idle", iconVersion: 1, createdAt: "", updatedAt: "" };

function build(number: number, web?: BuildInfo["web"], extra: Partial<BuildInfo> = {}): BuildInfo {
  return { number, status: "succeeded", startedAt: at(3), finishedAt: at(2), ...(web ? { web } : {}), ...extra };
}
function item(b: BuildInfo): ChatItem {
  return { id: `b${b.number}`, appId: "tip", seq: b.number, kind: "build", build: b, createdAt: "", updatedAt: "" } as ChatItem;
}
const webApp = (b: BuildInfo, extra: Partial<App> = {}): App => ({ ...base, preset: "web", latestBuild: b, latestApk: b, ...extra });

describe("build card web part on the PC", () => {
  it("a live web app: the short address, the full address for Open, Copy link and the QR", () => {
    const b = build(8, { sizeBytes: 412_000, files: 9, state: "live", address: ADDRESS });
    const card = buildCard(item(b), webApp(b, { web: { address: ADDRESS, repo: "sara/anyapp-tipsplitter-web", repoUrl: "", since: "", liveBuild: 8 } }), "pc");
    expect(card?.state).toBe("ready");
    if (card?.state !== "ready" || !card.web) throw new Error("no web part");
    expect(card.title).toBe("Version 8 is live");
    // Nothing about the phone or installing on a web app's card.
    expect(`${card.title} ${card.sub}`).not.toMatch(/phone|install/i);
    const view = webPartView(card.web, false);
    expect(view.live).toEqual({ address: ADDRESS, short: "sara.github.io/anyapp-tipsplitter-web" });
    expect(view.heading).toBeUndefined();
    expect(view.line).not.toMatch(/phone|install/i);
  });

  it("publishing, failed and local: the line only, no buttons", () => {
    const cases = [
      [{ sizeBytes: 1, files: 1, state: "publishing" }, "working", /online/],
      [{ sizeBytes: 1, files: 1, state: "failed", error: "GitHub did not answer." }, "problem", /GitHub did not answer/],
      [{ sizeBytes: 1, files: 1, state: "local" }, "idle", /Not online/],
    ] as const;
    for (const [web, state, line] of cases) {
      const b = build(4, web);
      const card = buildCard(item(b), webApp(b), "pc");
      if (card?.state !== "ready" || !card.web) throw new Error("no web part");
      const view = webPartView(card.web, false);
      expect(view.live).toBeUndefined();
      expect(view.state).toBe(state);
      expect(view.line).toMatch(line);
      expect(`${card.title} ${card.sub} ${view.line}`).not.toMatch(/phone|install/i);
    }
  });

  it("an app with both targets: the Android card as before, the web part under it with its heading", () => {
    const b = build(5, { sizeBytes: 412_000, files: 9, state: "live", address: ADDRESS }, { sizeBytes: 31_000_000 });
    const app: App = { ...base, targets: ["android", "web"], latestBuild: b, latestApk: b };
    const card = buildCard(item(b), app, "pc");
    if (card?.state !== "ready" || !card.web) throw new Error("no web part");
    expect(card.title).toBe("Your app is ready");
    expect(card.sub).toMatch(/Sent to your phone/);
    expect(webPartView(card.web, true)).toMatchObject({ heading: "Web version", live: { address: ADDRESS } });
  });

  it("never offers Open for an address the browser should not get", () => {
    expect(webPartView({ state: "live", address: "javascript:alert(1)", line: "x" }, false).live).toBeUndefined();
    expect(webPartView({ state: "live", address: "file:///etc/passwd", line: "x" }, false).live).toBeUndefined();
    expect(webPartView({ state: "live", line: "x" }, false)).toMatchObject({ state: "ready", line: "x" });
  });
});

describe("links the desktop opens", () => {
  it("https anywhere, http only on this PC", () => {
    expect(isOpenableUrl(ADDRESS)).toBe(true);
    expect(isOpenableUrl("http://localhost:8797/web/abc/ticket/")).toBe(true);
    expect(isOpenableUrl("http://127.0.0.1:8797/")).toBe(true);
    expect(isOpenableUrl("http://example.com/")).toBe(false);
    expect(isOpenableUrl("http://localhost.example.com/")).toBe(false);
    expect(isOpenableUrl("https://user:pw@example.com/")).toBe(false);
    expect(isOpenableUrl("file:///C:/x")).toBe(false);
    expect(isOpenableUrl("javascript:alert(1)")).toBe(false);
    expect(isOpenableUrl("not a url")).toBe(false);
    expect(isOpenableUrl(undefined)).toBe(false);
  });
});

describe("a web app's state line", () => {
  it("live: Live on the web with its version, never the phone", () => {
    const b = build(8);
    const st = webAppState(webApp(b, { web: { address: ADDRESS, repo: "", repoUrl: "", since: "", liveBuild: 8 } }), NOW);
    expect(st).toEqual({ state: "ready", text: "Live on the web, version 8" });
    // An hour later it is quiet.
    const old = build(8, undefined, { finishedAt: at(90) });
    expect(webAppState(webApp(old, { web: { address: ADDRESS, repo: "", repoUrl: "", since: "", liveBuild: 8 } }), NOW)).toEqual({ state: "idle", text: "Live on the web, version 8" });
  });

  it("not online yet: Web app", () => {
    expect(webAppState(webApp(build(2)), NOW)).toEqual({ state: "idle", text: "Web app, version 2" });
    expect(webAppState({ ...base, preset: "web" }, NOW)).toEqual({ state: "idle", text: "Web app, no version yet" });
    expect(webAppState(webApp(build(2), { web: { address: ADDRESS, repo: "", repoUrl: "", since: "", error: "GitHub did not answer." } }), NOW)).toEqual({ state: "problem", text: "Web app, not online" });
  });

  it("going online, and busy states as for any app", () => {
    expect(webAppState(webApp(build(3), { web: { address: ADDRESS, repo: "", repoUrl: "", since: "", liveBuild: 2, publishing: 3 } }), NOW)).toEqual({ state: "working", text: "Putting version 3 online" });
    expect(webAppState({ ...base, preset: "web", status: "working" }, NOW)).toEqual({ state: "working", text: "Making changes" });
  });

  it("an Android app, or one with both targets, keeps the shared words", () => {
    expect(webAppState({ ...base, latestApk: build(3), latestBuild: build(3) }, NOW)).toBeNull();
    expect(webAppState({ ...base, targets: ["android", "web"] }, NOW)).toBeNull();
    // appState (the list row and the chat header) uses the web words for a web app.
    expect(appState(webApp(build(8, undefined, { finishedAt: "2020-01-01T00:00:00Z" }), { web: { address: ADDRESS, repo: "", repoUrl: "", since: "", liveBuild: 8 } }))).toEqual({ state: "idle", text: "Live on the web, version 8" });
  });
});
