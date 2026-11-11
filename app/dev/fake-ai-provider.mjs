// A local fake AI provider for testing "AI for your apps" without a real key or credit.
// Speaks both APIs AnyAppAgent's proxy uses, streamed (SSE), with tool calls:
//   POST /v1/messages                 Claude (Anthropic Messages API)
//   POST /api/v1/chat/completions     OpenRouter (OpenAI-style chat completions)
//
//   node dev/fake-ai-provider.mjs [--port 8913] [--log <file.jsonl>]
//   adb -s emulator-5560 shell setprop debug.anyapp.ai.url http://10.0.2.2:8913
//   (and `setprop debug.anyapp.ai.url ""` to switch it off)
//
// Behaviour: with tools and no tool result yet, it answers with a short text, a thinking block
// (Claude only) and a call to the first tool, filling required number fields with the numbers in
// the last user message and string fields with that message. Once a tool result is in the
// conversation it answers "Done: <result>". Without tools it echoes the question.
// Each request is logged (no headers except whether the key was the test placeholder).
import { appendFileSync } from "node:fs";
import http from "node:http";

const arg = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const PORT = Number(arg("--port", 8913));
const LOG = arg("--log", null);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function textOf(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((b) => b.type === "text").map((b) => b.text).join(" ");
}

function plan(messages, tools, lastUserText, toolResult) {
  if (toolResult != null) return { text: `Done: ${toolResult}`, call: null };
  if (tools.length === 0) return { text: `OK. You said: ${lastUserText}`, call: null };
  const tool = tools[0];
  const schema = tool.schema ?? {};
  const props = schema.properties ?? {};
  const required = schema.required ?? Object.keys(props);
  const numbers = (lastUserText.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
  const input = {};
  for (const k of required) {
    const t = props[k]?.type;
    if (t === "number" || t === "integer") input[k] = numbers.length ? numbers.shift() : 1;
    else if (t === "boolean") input[k] = true;
    else input[k] = lastUserText;
  }
  return { text: "Let me use a tool for that.", call: { id: `toolu_fake_${Date.now()}`, name: tool.name, input } };
}

function sse(res) {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
}

async function anthropic(body, req, res) {
  const msgs = body.messages ?? [];
  const tools = (body.tools ?? []).map((t) => ({ name: t.name, schema: t.input_schema }));
  const lastUser = [...msgs].reverse().find((m) => m.role === "user");
  const results = Array.isArray(lastUser?.content) ? lastUser.content.filter((b) => b.type === "tool_result") : [];
  const thinkingReplayed = msgs.some((m) => m.role === "assistant" && Array.isArray(m.content) && m.content.some((b) => b.type === "thinking" && b.signature === "fake-signature"));
  const p = plan(msgs, tools, textOf(lastUser?.content), results.length ? String(results[0].content) : null);
  log({ api: "anthropic", model: body.model, maxTokens: body.max_tokens, messages: msgs.length, tools: tools.map((t) => t.name), toolResults: results.length, thinkingReplayed, placeholderKey: req.headers["x-api-key"] === "test-key", version: req.headers["anthropic-version"], images: countImages(msgs, "image") });
  sse(res);
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify({ type: event, ...data })}\n\n`);
  send("message_start", { message: { id: "msg_fake", type: "message", role: "assistant", model: body.model, content: [], usage: { input_tokens: 40 + JSON.stringify(msgs).length / 10, output_tokens: 1 } } });
  let index = 0;
  if (p.call) {
    send("content_block_start", { index, content_block: { type: "thinking", thinking: "" } });
    send("content_block_delta", { index, delta: { type: "signature_delta", signature: "fake-signature" } });
    send("content_block_stop", { index });
    index++;
  }
  send("content_block_start", { index, content_block: { type: "text", text: "" } });
  for (const word of p.text.split(/(?<= )/)) {
    send("content_block_delta", { index, delta: { type: "text_delta", text: word } });
    await sleep(60);
  }
  send("content_block_stop", { index });
  index++;
  if (p.call) {
    send("content_block_start", { index, content_block: { type: "tool_use", id: p.call.id, name: p.call.name, input: {} } });
    const json = JSON.stringify(p.call.input);
    send("content_block_delta", { index, delta: { type: "input_json_delta", partial_json: json.slice(0, 5) } });
    send("content_block_delta", { index, delta: { type: "input_json_delta", partial_json: json.slice(5) } });
    send("content_block_stop", { index });
  }
  send("message_delta", { delta: { stop_reason: p.call ? "tool_use" : "end_turn" }, usage: { output_tokens: 12 + p.text.length } });
  send("message_stop", {});
  res.end();
}

async function openrouter(body, req, res) {
  const msgs = body.messages ?? [];
  const tools = (body.tools ?? []).map((t) => ({ name: t.function?.name, schema: t.function?.parameters }));
  const last = msgs[msgs.length - 1];
  const lastUser = [...msgs].reverse().find((m) => m.role === "user");
  const p = plan(msgs, tools, textOf(lastUser?.content), last?.role === "tool" ? String(last.content) : null);
  log({ api: "openrouter", model: body.model, maxTokens: body.max_tokens, messages: msgs.length, tools: tools.map((t) => t.name), toolResults: msgs.filter((m) => m.role === "tool").length, placeholderKey: req.headers.authorization === "Bearer test-key", images: countImages(msgs, "image_url") });
  sse(res);
  const chunk = (delta, finish = null, extra = {}) => res.write(`data: ${JSON.stringify({ id: "gen-fake", choices: [{ index: 0, delta, finish_reason: finish }], ...extra })}\n\n`);
  res.write(": OPENROUTER PROCESSING\n\n");
  for (const word of p.text.split(/(?<= )/)) {
    chunk({ content: word });
    await sleep(60);
  }
  if (p.call) {
    const args = JSON.stringify(p.call.input);
    chunk({ tool_calls: [{ index: 0, id: p.call.id, type: "function", function: { name: p.call.name, arguments: args.slice(0, 4) } }] });
    chunk({ tool_calls: [{ index: 0, function: { arguments: args.slice(4) } }] });
  }
  chunk({}, p.call ? "tool_calls" : "stop");
  res.write(`data: ${JSON.stringify({ id: "gen-fake", choices: [], usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 } })}\n\n`);
  res.write("data: [DONE]\n\n");
  res.end();
}

function countImages(msgs, type) {
  let n = 0;
  for (const m of msgs) if (Array.isArray(m.content)) n += m.content.filter((b) => b.type === type).length;
  return n;
}

function log(entry) {
  const line = JSON.stringify({ at: new Date().toISOString(), ...entry });
  console.log(line);
  if (LOG) appendFileSync(LOG, line + "\n");
}

http
  .createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      let body;
      try {
        body = JSON.parse(raw || "{}");
      } catch {
        res.writeHead(400).end('{"error":{"message":"bad json"}}');
        return;
      }
      if (req.method === "POST" && req.url === "/v1/messages") return void anthropic(body, req, res);
      if (req.method === "POST" && req.url === "/api/v1/chat/completions") return void openrouter(body, req, res);
      res.writeHead(404, { "content-type": "application/json" }).end('{"error":{"message":"not found"}}');
    });
  })
  .listen(PORT, "0.0.0.0", () => console.log(`fake AI provider on http://0.0.0.0:${PORT}`));
