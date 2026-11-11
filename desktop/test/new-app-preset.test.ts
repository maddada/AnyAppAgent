import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { AdminClient } from "../src/main/admin-client.ts";
import { PRESET_CHOICES } from "../../shared/presets.ts";

// What the PC's New app sheet sends: the preset only when it is not the default, so an older
// companion keeps accepting the request.
describe("New app preset from the PC", () => {
  const bodies: Record<string, unknown>[] = [];
  let server: Server;
  let base = "";

  beforeAll(async () => {
    server = createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        const body = JSON.parse(raw || "{}") as Record<string, unknown>;
        bodies.push(body);
        res.writeHead(201, { "content-type": "application/json" });
        res.end(JSON.stringify({ id: `app-${bodies.length}`, name: body.name, slug: "x", packageName: "com.anyapp.x", status: "creating", iconVersion: 1, createdAt: "", updatedAt: "" }));
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it("sends preset kotlin, and leaves the default out", async () => {
    const client = new AdminClient(base, "t", "C:\\nowhere", 0, () => {});
    await client.createApp("Tea", "A tea timer", "kotlin");
    await client.createApp("Water", "Count glasses");
    await client.createApp("Plain", "Default said out loud", "react-native");
    expect(bodies).toEqual([
      { name: "Tea", prompt: "A tea timer", preset: "kotlin" },
      { name: "Water", prompt: "Count glasses" },
      { name: "Plain", prompt: "Default said out loud" },
    ]);
  });

  it("shows the same choices as the phone, React Native first and default, Expo Exact last as Alpha", () => {
    expect(PRESET_CHOICES.map((p) => [p.id, p.title, p.tag ?? null])).toEqual([
      ["react-native", "React Native", "Default"],
      ["kotlin", "Kotlin", null],
      ["expo-exact", "Expo Exact", "Alpha"],
    ]);
    for (const p of PRESET_CHOICES) expect(p.line).not.toMatch(/\u2014/);
  });
});
