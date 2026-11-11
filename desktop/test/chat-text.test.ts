import { describe, expect, it } from "vitest";
// The tool titles now live in the shared chat core (shared/chat/tools.ts), used by the phone too.
import { plainToolTitle, summarizeTools } from "../../shared/chat/index.ts";
import type { ChatItem } from "../../shared/protocol.ts";

describe("chat row titles", () => {
  it("keeps the companion's plain command titles", () => {
    expect(plainToolTitle({ kind: "execute", title: "Checked the app", detail: "npx tsc --noEmit" })).toBe("Checked the app");
    expect(plainToolTitle({ kind: "execute", title: "Made the app icon", detail: "node make-icon.mjs" })).toBe("Made the app icon");
  });

  it("never shows a raw command line as the title (older history)", () => {
    expect(plainToolTitle({ kind: "execute", title: 'T="C:/Users/madda/AppData/Local/Temp/tapcounter-typ" && cd "$T"' })).toBe("Ran a command");
    expect(plainToolTitle({ kind: "execute", title: "node - <<'EOF'\nconst fs = require('fs');" })).toBe("Ran a command");
    expect(plainToolTitle({ kind: "execute", title: "npx tsc --noEmit", detail: "npx tsc --noEmit" })).toBe("Ran a command");
    expect(plainToolTitle({ kind: "execute", title: "cd /c/aa/scratch && node cmp.mjs" })).toBe("Ran a command");
  });

  it("shortens long paths in file rows to the file name", () => {
    expect(plainToolTitle({ kind: "edit", title: String.raw`Write modules\alarms\android\src\main\java\AlarmModule.kt`})).toBe("Write AlarmModule.kt");
    expect(plainToolTitle({ kind: "read", title: "Read assets/icon.png" })).toBe("Read icon.png");
    expect(plainToolTitle({ kind: "edit", title: "Edit App.tsx" })).toBe("Edit App.tsx");
  });
});

describe("search row titles", () => {
  it("reads a raw search command as plain words", () => {
    expect(plainToolTitle({ kind: "search", title: "grep waterglass" })).toBe("Searched the app");
    expect(plainToolTitle({ kind: "search", title: "Find the alarm code" })).toBe("Find the alarm code");
  });
});

describe("folded tool rows", () => {
  it("counts each file once (a real turn: day.ts once, HomeScreen.tsx seven times, the memory file)", () => {
    const tools = [
      { kind: "edit", title: "Changed day.ts", detail: "src/lib/day.ts" },
      ...Array.from({ length: 7 }, () => ({ kind: "edit", title: "Changed HomeScreen.tsx", detail: "src/screens/HomeScreen.tsx" })),
      { kind: "edit", title: "Changed APP_MEMORY.md" },
      { kind: "execute", title: "Run typecheck, lint and bundle checks", detail: "npm run check" },
    ];
    const items = tools.map((tool, i) => ({ id: `t${i}`, appId: "a", seq: i, kind: "tool", tool: { ...tool, status: "completed" }, createdAt: "", updatedAt: "" }) as ChatItem);
    expect(summarizeTools(items)).toBe("Edited 3 files, ran a command");
  });
});
