import { createInterface } from "node:readline";
const send = (value) => process.stdout.write(JSON.stringify(value) + "\n");
const notify = (method, params) => send({ method, params });
createInterface({ input: process.stdin }).on("line", (line) => {
  const { method, id, params: p } = JSON.parse(line);
  if (!method || id === undefined) return;
  if (method === "initialize") return send({ id, result: {} });
  if (method === "thread/start" || method === "thread/resume") {
    if (p.model !== "gpt-6.1-sol" || p.config.model_reasoning_effort !== "high" || p.sandbox !== "danger-full-access") return send({ id, error: { message: "wrong policy" } });
    return send({ id, result: { thread: { id: p.threadId ?? "codex-thread" }, model: p.model } });
  }
  if (method === "turn/interrupt") {
    send({ id, result: {} }); notify("turn/completed", { threadId: "codex-thread", turn: { id: "turn", status: "interrupted" } }); return;
  }
  if (method === "turn/start") {
    if (p.model !== "gpt-6.1-sol" || p.effort !== "high") return send({ id, error: { message: "wrong turn policy" } });
    send({ id, result: { turn: { id: "turn" } } });
    notify("turn/started", { threadId: "codex-thread", turn: { id: "turn" } });
    if (p.input[0].text === "wait") return;
    notify("item/agentMessage/delta", { threadId: "codex-thread", itemId: "msg", delta: "Made it." });
    notify("item/completed", { threadId: "codex-thread", item: { id: "msg", type: "agentMessage", text: "Made it." } });
    notify("item/started", { threadId: "codex-thread", item: { id: "tool", type: "mcpToolCall", server: "pages", tool: "show_page", arguments: {} } });
    notify("item/completed", { threadId: "codex-thread", item: { id: "tool", type: "mcpToolCall", server: "pages", tool: "show_page", status: "completed" } });
    notify("account/rateLimits/updated", { rateLimits: { primary: { usedPercent: 100, resetsAt: 1900000000 } } });
    notify("thread/tokenUsage/updated", { threadId: "codex-thread", tokenUsage: { last: { inputTokens: 100, cachedInputTokens: 40, outputTokens: 8 } } });
    notify("turn/completed", { threadId: "codex-thread", turn: { id: "turn", status: p.input[0].text === "limit" ? "failed" : "completed", error: { message: "Usage limit reached. Try again at 16:30." } } });
  }
});
