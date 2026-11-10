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
      { id: "id1", kind: "tool", tool: { title: "Install packages", kind: "execute", status: "pending", detail: "npm install" } },
    ]);
    expect(t.translate({ sessionUpdate: "tool_call_update", toolCallId: "t1", status: "in_progress" })).toEqual([
      { id: "id1", kind: "tool", tool: { title: "Install packages", kind: "execute", status: "in_progress", detail: "npm install" } },
    ]);
    expect(t.translate({ sessionUpdate: "tool_call_update", toolCallId: "t1", status: "completed" })).toEqual([
      { id: "id1", kind: "tool", tool: { title: "Install packages", kind: "execute", status: "completed", detail: "npm install" } },
    ]);
    expect(t.finishTurn("end_turn")).toEqual([]);
  });

  it("drops the detail when the title already says it", () => {
    const t = translator();
    const out = t.translate({ sessionUpdate: "tool_call", toolCallId: "c", title: "`npm test`", kind: "execute", rawInput: { command: "npm test" } });
    expect(out[0].tool).toEqual({ title: "`npm test`", kind: "execute", status: "pending" });
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
    expect(out[0].tool).toEqual({ title: "Edit App.tsx", kind: "edit", status: "in_progress", detail: "src/App.tsx" });
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
    expect(closed).toEqual([{ id: "id2", kind: "tool", tool: { title: "Run tests", kind: "execute", status: "failed" } }]);
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
