// A Codex app-server signed in to a ChatGPT plan (FAKE_PLAN, "free" by default) that does not include
// gpt-6.1-sol: every turn on it fails with Codex's refusal. Its reply says which model answered and
// how many messages the thread holds, so a retry that says the message twice shows.
import { createInterface } from "node:readline";
const plan = process.env.FAKE_PLAN ?? "free";
const send = (value) => process.stdout.write(JSON.stringify(value) + "\n");
const notify = (method, params) => send({ method, params });
const history = [];
let turns = 0;
createInterface({ input: process.stdin }).on("line", (line) => {
  const { method, id, params: p } = JSON.parse(line);
  if (!method || id === undefined) return;
  if (method === "initialize") return send({ id, result: {} });
  if (method === "account/read") return send({ id, result: { account: { type: "chatgpt", email: "someone@example.com", planType: plan }, userId: "user-1" } });
  if (method === "thread/start" || method === "thread/resume") return send({ id, result: { thread: { id: "codex-thread" }, model: p.model } });
  if (method === "thread/revert") {
    const at = history.findIndex((h) => h.turn === p.beforeTurnId);
    if (at >= 0) history.splice(at);
    return send({ id, result: { thread: { id: "codex-thread", turns: [] } } });
  }
  if (method === "turn/start") {
    const turn = `turn-${++turns}`;
    history.push({ turn, text: p.input[0].text });
    send({ id, result: { turn: { id: turn } } });
    notify("turn/started", { threadId: "codex-thread", turn: { id: turn } });
    if (p.input[0].text === "limit") {
      return notify("turn/completed", { threadId: "codex-thread", turn: { id: turn, status: "failed", error: { message: "Usage limit reached. Try again at 16:30." } } });
    }
    if (p.model === "gpt-6.1-sol" && plan === "free") {
      return notify("turn/completed", { threadId: "codex-thread", turn: { id: turn, status: "failed", error: { message: "The 'gpt-6.1-sol' model is not supported when using Codex with a ChatGPT account." } } });
    }
    const text = `${p.model} says hi (${history.length} message${history.length === 1 ? "" : "s"})`;
    notify("item/completed", { threadId: "codex-thread", item: { id: `msg-${turn}`, type: "agentMessage", text } });
    notify("turn/completed", { threadId: "codex-thread", turn: { id: turn, status: "completed" } });
  }
});
