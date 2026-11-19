import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { AdminClient } from "../src/main/admin-client.ts";
import { PRESET_CHOICES } from "../../shared/presets.ts";

// What the PC's New app sheet sends: no preset for "Let the agent decide" (the default), and any
// preset the person picked under Advanced, React Native too (the agent then keeps it).
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

  it("sends a picked preset, React Native too, and leaves it out when the agent decides", async () => {
    const client = new AdminClient(base, "t", "C:\\nowhere", 0, () => {});
    await client.createApp("Tea", "A tea timer", "kotlin");
    await client.createApp("Water", "Count glasses");
    await client.createApp("Plain", "Default said out loud", "react-native");
    await client.createApp("Catch", "A catching game", "game");
    expect(bodies).toEqual([
      { name: "Tea", prompt: "A tea timer", preset: "kotlin" },
      { name: "Water", prompt: "Count glasses" },
      { name: "Plain", prompt: "Default said out loud", preset: "react-native" },
      { name: "Catch", prompt: "A catching game", preset: "game" },
    ]);
  });

  it("shows the same choices as the phone, Let the agent decide first and default, Game before Expo Exact, Expo Exact last as Alpha", () => {
    expect(PRESET_CHOICES.map((p) => [p.id, p.title, p.tag ?? null])).toEqual([
      [null, "Let the agent decide", "Default"],
      ["react-native", "React Native", null],
      ["kotlin", "Kotlin", null],
      ["game", "Game", null],
      ["expo-exact", "Expo Exact", "Alpha"],
    ]);
    for (const p of PRESET_CHOICES) expect(p.line).not.toMatch(/\u2014/);
  });
});
