import { createServer, type Server } from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PageInfo } from "../../shared/protocol.ts";
import { parsePageAnswers } from "../../shared/chat/pages.ts";
import { inlineLocalImages, pageAwaitsSeen, pageQuestions, pageTitle, Pages, withKit } from "../src/pages.ts";

const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex");

const QUESTIONS = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Prayer alarm: the plan</title></head><body><gx-questions submit="Send">
<header><h1>The plan</h1></header><img src="shot.png">
<gx-question tag="P1" name="Build it?" title="Shall I build it like this?"><gx-choice value="Build it" recommended>Build it</gx-choice><gx-choice>Change something</gx-choice></gx-question>
</gx-questions></body></html>`;

describe("pages", () => {
  const state = mkdtempSync(join(tmpdir(), "anyapp-pages-"));
  const files = mkdtempSync(join(tmpdir(), "anyapp-page-files-"));
  const cards: { itemId: string; page: PageInfo }[] = [];
  const delivered: string[] = [];
  const pages = new Pages({
    stateDir: state,
    log: () => {},
    appExists: (id) => id === "app1",
    showCard: (_appId, itemId, page) => cards.push({ itemId, page }),
    deliver: (_appId, text) => delivered.push(text),
  });
  let server: Server;
  let base = "";

  beforeAll(async () => {
    server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const handle = url.pathname.startsWith("/mcp/") ? pages.mcpRoute(req, res, url.pathname, url) : pages.route(req, res, url.pathname, url);
      void handle.then((ours) => {
        if (!ours) res.writeHead(404).end();
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const address = server.address();
    base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  });
  afterAll(() => server.close());

  it("reads titles, questions and whether a page waits to be seen", () => {
    expect(pageTitle(QUESTIONS)).toBe("Prayer alarm: the plan");
    expect(pageQuestions(QUESTIONS)).toEqual(["Shall I build it like this?"]);
    expect(pageAwaitsSeen(QUESTIONS)).toBe(false);
    expect(pageAwaitsSeen("<gx-page><h1>x</h1></gx-page>")).toBe(true);
    expect(pageAwaitsSeen("<script>anyapp.submit({a:1})</script>")).toBe(false);
  });

  it("puts the kit after the head, never before the doctype", () => {
    const out = withKit("<!doctype html><html><head><title>t</title></head><body></body></html>", { answered: false });
    expect(out.startsWith("<!doctype html><html><head><!--anyapp-builtin-->")).toBe(true);
    expect(out).toContain('ghostex.__state({"answered":false})');
    expect(out).toContain("window.anyapp=window.ghostex");
    expect(withKit("<p>bare</p>", {})).toMatch(/^<head><!--anyapp-builtin-->/);
  });

  it("inlines local pictures and names missing ones", () => {
    writeFileSync(join(files, "a.png"), PNG);
    const ok = inlineLocalImages(`<img src="a.png"><div style="background:url(${join(files, "a.png")})"></div><img src="https://x.test/b.png">`, files);
    expect(ok.problems).toEqual([]);
    expect(ok.html.match(/data:image\/png;base64/g)?.length).toBe(2);
    expect(ok.html).toContain("https://x.test/b.png");
    expect(inlineLocalImages(`<img src="missing.png">`, files).problems[0]).toContain("missing.png: not found");
  });

  it("refuses em dashes and pages without a title", () => {
    expect(() => pages.publish({ appId: "app1", html: "<title>A \u2014 B</title>" })).toThrow(/em dash/);
    expect(() => pages.publish({ appId: "app1", html: "<p>no title</p>" })).toThrow(/title/);
  });

  it("publishes, serves sandboxed, takes one set of answers and tells the agent", async () => {
    writeFileSync(join(files, "shot.png"), PNG);
    writeFileSync(join(files, "plan.html"), QUESTIONS);
    const { page } = pages.publish({ appId: "app1", path: join(files, "plan.html") });
    expect(page.questions).toEqual(["Shall I build it like this?"]);
    expect(cards.at(-1)?.itemId).toBe(`page-${page.id}`);
    expect(pages.list("app1").map((p) => p.id)).toEqual([page.id]);

    const { path } = pages.open("app1", page.id);
    expect(path).toMatch(new RegExp(`^/page/${page.id}/`));
    expect((await fetch(`${base}/page/${page.id}/0.${"a".repeat(32)}`)).status).toBe(404);

    const served = await fetch(`${base}${path}`);
    expect(served.status).toBe(200);
    const csp = served.headers.get("content-security-policy") ?? "";
    expect(csp).toMatch(/^sandbox allow-scripts allow-forms allow-popups;/);
    expect(csp).toContain(`connect-src https: http://127.0.0.1:${new URL(base).port}${path}/`);
    const html = await served.text();
    expect(html).toContain("data:image/png;base64");
    expect(html).toContain('"answered":false');

    const draft = await fetch(`${base}${path}/draft`, { method: "POST", body: JSON.stringify({ draft: { kit: { "Build it?": "Build it" } }, editedAt: 5 }) });
    expect(await draft.json()).toEqual({ ok: true, kept: true });
    expect(((await (await fetch(`${base}${path}/draft`)).json()) as { draft: unknown }).draft).toEqual({ kit: { "Build it?": "Build it" } });

    const sent = await fetch(`${base}${path}/answers`, { method: "POST", body: JSON.stringify({ answers: { "Build it?": "Build it", "Additional notes": "bigger times" } }) });
    expect(sent.headers.get("access-control-allow-origin")).toBe("*");
    expect(((await sent.json()) as { ok: boolean }).ok).toBe(true);
    const parsed = parsePageAnswers(delivered.at(-1));
    expect(parsed?.pageId).toBe(page.id);
    expect(parsed?.answers).toEqual({ "Build it?": "Build it", "Additional notes": "bigger times" });
    expect(cards.at(-1)?.page.answeredAt).toBeTruthy();

    expect((await fetch(`${base}${path}/answers`, { method: "POST", body: JSON.stringify({ answers: {} }) })).status).toBe(409);
    expect(await (await fetch(`${base}${path}`)).text()).toContain('"answered":true');
  });

  it("marks a page with no questions as seen", async () => {
    const { page } = pages.publish({ appId: "app1", html: "<title>Snooze: how it works</title><gx-page><h1>Snooze</h1></gx-page>", from: { workerId: "w1", title: "Explain snooze" } });
    expect(page.awaitsSeen).toBe(true);
    const { path } = pages.open("app1", page.id);
    await fetch(`${base}${path}/answers`, { method: "POST", body: JSON.stringify({ answers: { seen: true, reply: "nice" } }) });
    expect(cards.at(-1)?.page.seen).toBe(true);
    expect(delivered.at(-1)).toContain('The helper "Explain snooze" (w1) made this page');
  });

  it("serves the show_page tool over MCP to Claude Code only", async () => {
    const rpc = (body: unknown, token = pages.toolsToken) =>
      fetch(`${base}/mcp/pages/app1`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    expect((await rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }, "wrong")).status).toBe(401);
    const list = (await (await rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" })).json()) as { result: { tools: { name: string }[] } };
    expect(list.result.tools.map((t) => t.name)).toEqual(["show_page", "list_pages"]);
    writeFileSync(join(files, "feature.html"), "<title>Reminders: snooze</title><gx-page><h1>Snooze</h1></gx-page>");
    const call = (await (await rpc({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "show_page", arguments: { path: join(files, "feature.html") } } })).json()) as {
      result: { content: { text: string }[]; isError?: boolean };
    };
    expect(call.result.isError).toBeUndefined();
    expect(call.result.content[0].text).toMatch(/^Page [0-9a-f]{32} "Reminders: snooze" is in the chat now/);
  });

  it("serves the Workbench fonts to pages", async () => {
    const font = await fetch(`${base}/page-kit/fonts/BricolageGrotesque-Text-Regular.ttf`);
    expect(font.status).toBe(200);
    expect(font.headers.get("content-type")).toBe("font/ttf");
  });
});
