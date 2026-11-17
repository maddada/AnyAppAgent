// Ready apps (docs/GALLERY.md): the companion reads the gallery list, keeps it a while, falls back
// to the next source and to the last good list, and reads a test list from a file.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Gallery } from "../src/gallery.ts";
import { HttpError } from "../src/http-error.ts";

const CERT = "ab".repeat(32);
const LIST = {
  format: 1,
  apps: [{ package: "com.anyapp.waterglass", name: "Water Glass", line: "One tap per glass.", repo: "maddada/anyapp-waterglass-releases", certSha256: CERT, latest: { version: "1.0", build: 3 } }],
};

function fakeFetch(answers: Record<string, unknown>, calls: string[]): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    if (!(url in answers)) return new Response("nope", { status: 404 });
    const body = answers[url];
    if (body instanceof Error) throw body;
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

describe("gallery list on the companion", () => {
  it("reads the first source that answers and keeps it a while", async () => {
    const calls: string[] = [];
    let now = 1000;
    const g = new Gallery({ sources: ["https://a.example/g.json", "https://b.example/g.json"], fetch: fakeFetch({ "https://b.example/g.json": LIST }, calls), keepMs: 60_000, now: () => now });
    const list = await g.list();
    expect(list.apps.map((a) => a.name)).toEqual(["Water Glass"]);
    expect(list.maker).toBe("Kiwimake");
    expect(calls).toEqual(["https://a.example/g.json", "https://b.example/g.json"]);
    now += 30_000;
    await g.list();
    expect(calls.length).toBe(2);
  });

  it("keeps the last good list when every source fails later", async () => {
    const calls: string[] = [];
    let now = 0;
    const answers: Record<string, unknown> = { "https://a.example/g.json": LIST };
    const g = new Gallery({ sources: ["https://a.example/g.json"], fetch: fakeFetch(answers, calls), keepMs: 10, now: () => now });
    await g.list();
    answers["https://a.example/g.json"] = new Error("offline");
    now += 100;
    expect((await g.list()).apps.length).toBe(1);
  });

  it("says so in a sentence (502) when no list was ever read; a newer format asks to update", async () => {
    const g = new Gallery({ sources: ["https://a.example/g.json"], fetch: fakeFetch({}, []) });
    await expect(g.list()).rejects.toMatchObject({ status: 502 });
    const newer = new Gallery({ sources: ["https://a.example/g.json"], fetch: fakeFetch({ "https://a.example/g.json": { format: 2, apps: [] } }, []) });
    const error = await newer.list().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpError);
    expect((error as Error).message).toMatch(/newer Kiwimake/);
  });

  it("reads a test list from a file on this PC", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gallery-"));
    const file = join(dir, "gallery.json");
    writeFileSync(file, JSON.stringify(LIST));
    const g = new Gallery({ sources: [file], fetch: fakeFetch({}, []) });
    expect((await g.list()).apps[0]!.certSha256).toBe(CERT);
  });
});
