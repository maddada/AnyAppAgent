import { describe, expect, it } from "vitest";
import type { App } from "../../shared/protocol.ts";
import { appState } from "../src/renderer/src/ui.tsx";

const app: App = { id: "tea", name: "Tea Timer", slug: "tea", packageName: "com.anyapp.tea", status: "error", iconVersion: 1, createdAt: "", updatedAt: "" };

describe("desktop app status", () => {
  it("names a Claude quota failure in the app list and chat header", () => {
    expect(appState({ ...app, error: "Claude usage limit reached. Resets Nov 15, 2pm (Asia/Dubai)." })).toEqual({ state: "problem", text: "Claude usage limit reached" });
  });

  it("keeps other errors and successful retries on the normal status path", () => {
    expect(appState({ ...app, error: "Connection closed" }).text).toBe("Something went wrong");
    expect(appState({ ...app, status: "idle", error: undefined }).text).toBe("Waiting for the first version");
  });
});
