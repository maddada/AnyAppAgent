import { describe, expect, it } from "vitest";
import { ChatTranslator, type ChatDraft } from "../src/acp/translate.ts";

function translator() {
  let n = 0;
  return new ChatTranslator({ cwd: "C:\\aa\\apps\\demo", newId: () => `id${++n}` });
}

function text(content: string) {
  return { type: "text", text: content };
}

function last(drafts: ChatDraft[]): ChatDraft {
  return drafts[drafts.length - 1];
}

describe("ChatTranslator", () => {
  it("streams assistant chunks into one item and closes it at the end of the turn", () => {
    const t = translator();
    t.startTurn();
    expect(t.translate({ sessionUpdate: "agent_message_chunk", content: text("Hel") })).toEqual([
      { id: "id1", kind: "assistant", text: "Hel", streaming: true },
    ]);
    expect(t.translate({ sessionUpdate: "agent_message_chunk", content: text("lo") })).toEqual([
      { id: "id1", kind: "assistant", text: "Hello", streaming: true },
    ]);
    expect(t.finishTurn("end_turn")).toEqual([{ id: "id1", kind: "assistant", text: "Hello", streaming: false }]);
    expect(t.lastTurnText).toBe("Hello");
  });

  it("closes the thought when the answer starts, and starts a new assistant item after a tool call", () => {
    const t = translator();
    t.startTurn();
    t.translate({ sessionUpdate: "agent_thought_chunk", content: text("thinking") });
    const answer = t.translate({ sessionUpdate: "agent_message_chunk", content: text("First.") });
    expect(answer).toEqual([
      { id: "id1", kind: "thought", text: "thinking", streaming: false },
      { id: "id2", kind: "assistant", text: "First.", streaming: true },
    ]);
    const tool = t.translate({ sessionUpdate: "tool_call", toolCallId: "t1", title: "Read App.tsx", kind: "read", status: "pending" });
    expect(tool[0]).toEqual({ id: "id2", kind: "assistant", text: "First.", streaming: false });
    expect(last(tool).kind).toBe("tool");
    const second = t.translate({ sessionUpdate: "agent_message_chunk", content: text("Second.") });
    expect(second).toEqual([{ id: "id4", kind: "assistant", text: "Second.", streaming: true }]);
  });

  it("merges tool_call_update into the open tool call and keeps its id", () => {
    const t = translator();
    t.startTurn();
    const opened = t.translate({
      sessionUpdate: "tool_call",
      toolCallId: "t1",
      title: "Install packages",
      kind: "execute",
      status: "pending",
      rawInput: { command: "npm install" },
    });
    expect(opened).toEqual([
      { id: "id1", kind: "tool", tool: { title: "Added a part to the app", kind: "execute", status: "pending", detail: "npm install" } },
    ]);
    expect(t.translate({ sessionUpdate: "tool_call_update", toolCallId: "t1", status: "in_progress" })).toEqual([
      { id: "id1", kind: "tool", tool: { title: "Added a part to the app", kind: "execute", status: "in_progress", detail: "npm install" } },
    ]);
    expect(t.translate({ sessionUpdate: "tool_call_update", toolCallId: "t1", status: "completed" })).toEqual([
      { id: "id1", kind: "tool", tool: { title: "Added a part to the app", kind: "execute", status: "completed", detail: "npm install" } },
    ]);
    expect(t.finishTurn("end_turn")).toEqual([]);
  });

  it("drops the detail when the title already says it", () => {
    const t = translator();
    const out = t.translate({ sessionUpdate: "tool_call", toolCallId: "c", title: "Read App.tsx", kind: "read", rawInput: { file_path: "App.tsx" } });
    expect(out[0].tool).toEqual({ title: "Read App.tsx", kind: "read", status: "pending" });
  });

  it("gives command rows a plain title and keeps the command line in the detail", () => {
    const t = translator();
    const run = (rawInput: Record<string, string>) =>
      t.translate({ sessionUpdate: "tool_call", toolCallId: Math.random().toString(), title: `\`${rawInput.command}\``, kind: "execute", rawInput })[0].tool!;
    expect(run({ command: 'cd "C:/aa/apps/tapcounter" && npm run check 2>&1 | tail -20' })).toEqual({
      title: "Checked the app",
      kind: "execute",
      status: "pending",
      detail: 'cd "C:/aa/apps/tapcounter" && npm run check 2>&1 | tail -20',
    });
    expect(run({ command: "npm run icon -- --bg \"#0E7C66\" --glyph mosque" }).title).toBe("Made the app icon");
    expect(run({ command: "npx expo install expo-battery" }).title).toBe("Added a part to the app");
    expect(run({ command: "T=\"C:/Users/x/tapcounter-typ\"; whoami" }).title).toBe("Ran a command");
    expect(run({ command: "python3 x.py", description: "Measure the adhan recording." }).title).toBe("Measure the adhan recording");
    expect(t.translate({ sessionUpdate: "tool_call", toolCallId: "z", title: "Terminal", kind: "execute" })[0].tool?.title).toBe("Running a command");
  });

  it("shows edited file paths relative to the project", () => {
    const t = translator();
    const out = t.translate({
      sessionUpdate: "tool_call",
      toolCallId: "e1",
      title: "Edit App.tsx",
      kind: "edit",
      status: "in_progress",
      locations: [{ path: "C:\\aa\\apps\\demo\\src\\App.tsx" }],
    });
    expect(out[0].tool).toEqual({ title: "Changed App.tsx", kind: "edit", status: "in_progress", detail: "src/App.tsx" });
  });

  it("gives every kind of row a plain title; paths, patterns and URLs stay in the detail", () => {
    const t = translator();
    const row = (u: Record<string, unknown>) => t.translate({ sessionUpdate: "tool_call", toolCallId: Math.random().toString(), ...u })[0].tool!;
    expect(row({ title: "grep waterglass", kind: "search", rawInput: { pattern: "waterglass", path: "C:\\aa\\apps\\demo\\src" } })).toEqual({
      title: "Searched the app",
      kind: "search",
      status: "pending",
      detail: "waterglass in src",
    });
    expect(row({ title: "Read C:\\aa\\apps\\demo\\src\\screens\\HomeScreen.tsx", kind: "read", locations: [{ path: "C:\\aa\\apps\\demo\\src\\screens\\HomeScreen.tsx" }] })).toEqual({
      title: "Read HomeScreen.tsx",
      kind: "read",
      status: "pending",
      detail: "src/screens/HomeScreen.tsx",
    });
    expect(row({ title: "Read File", kind: "read" }).title).toBe("Read a file");
    expect(row({ title: "Write C:/aa/apps/demo/APP_MEMORY.md", kind: "edit", rawInput: { file_path: "C:/aa/apps/demo/APP_MEMORY.md" } }).title).toBe("Wrote APP_MEMORY.md");
    expect(row({ title: "Edit `C:\\aa\\apps\\demo\\App.tsx`", kind: "edit", rawInput: { file_path: "C:\\aa\\apps\\demo\\App.tsx" } }).title).toBe("Changed App.tsx");
    expect(row({ title: "Fetch https://example.com/x", kind: "fetch", rawInput: { url: "https://example.com/x" } })).toMatchObject({ title: "Looked something up online", detail: "https://example.com/x" });
    expect(row({ title: "mcp__x__y", kind: "other" }).title).toBe("Used a tool");
    for (const tool of [row({ title: "Find `src/**/*.tsx`", kind: "search", rawInput: { pattern: "src/**/*.tsx" } })]) {
      expect(tool.title).not.toMatch(/[\\/`]/);
    }
  });

  it("maps unknown tool kinds to other and failed calls carry their output", () => {
    const t = translator();
    t.translate({ sessionUpdate: "tool_call", toolCallId: "x", title: "Mystery", kind: "telepathy", status: "pending" });
    const failed = t.translate({
      sessionUpdate: "tool_call_update",
      toolCallId: "x",
      status: "failed",
      content: [{ type: "content", content: text("boom: permission denied") }],
    });
    expect(failed[0].tool).toEqual({ title: "Mystery", kind: "other", status: "failed", detail: "boom: permission denied" });
  });

  it("keeps one plan item per turn and replaces its entries", () => {
    const t = translator();
    t.startTurn();
    const first = t.translate({ sessionUpdate: "plan", entries: [{ content: "Design", status: "in_progress" }, { content: "Build" }] });
    expect(first).toEqual([
      { id: "id1", kind: "plan", plan: [{ content: "Design", status: "in_progress" }, { content: "Build", status: "pending" }] },
    ]);
    const second = t.translate({ sessionUpdate: "plan", entries: [{ content: "Design", status: "completed" }, { content: "Build", status: "in_progress" }] });
    expect(second[0].id).toBe("id1");
    t.startTurn();
    expect(t.translate({ sessionUpdate: "plan", entries: [] })[0].id).toBe("id2");
  });

  it("closes open tool calls as failed when the turn is cancelled", () => {
    const t = translator();
    t.startTurn();
    t.translate({ sessionUpdate: "agent_message_chunk", content: text("Working") });
    t.translate({ sessionUpdate: "tool_call", toolCallId: "t9", title: "Run tests", kind: "execute", status: "in_progress" });
    const closed = t.finishTurn("cancelled");
    expect(closed).toEqual([{ id: "id2", kind: "tool", tool: { title: "Running a command", kind: "execute", status: "failed" } }]);
  });

  it("ignores updates it does not show and malformed ones", () => {
    const t = translator();
    expect(t.translate({ sessionUpdate: "usage_update", used: 1, size: 2 })).toEqual([]);
    expect(t.translate({ sessionUpdate: "available_commands_update", availableCommands: [] })).toEqual([]);
    expect(t.translate({ sessionUpdate: "agent_message_chunk", content: { type: "image", data: "" } })).toEqual([]);
    expect(t.translate({ sessionUpdate: "tool_call" })).toEqual([]);
    expect(t.translate(null)).toEqual([]);
  });
});
