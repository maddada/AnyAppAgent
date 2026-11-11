#!/usr/bin/env node
// Drives a desktop app (desktop/, Electron) started with --remote-debugging-port, for proving
// screens. One command per run:
//   node desk.mjs shot <file.png> [light|dark]   screenshot of the window, in that colour scheme
//   node desk.mjs click <css selector>           click the first match
//   node desk.mjs clicktext <selector> <text>    click the first match whose text contains <text>
//   node desk.mjs text [selector]                print the visible text (of the selector, or the page)
//   node desk.mjs exists <css selector>          prints yes or no
// DESK_CDP_PORT (default 9339). Uses Node's built-in WebSocket; no dependencies.
import { writeFileSync } from "node:fs";

const PORT = Number(process.env.DESK_CDP_PORT ?? 9339);
const [command, ...args] = process.argv.slice(2);

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = targets.find((t) => t.type === "page" && !t.url.startsWith("devtools"));
if (!page) throw new Error("no desktop window found");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, j) => {
  ws.addEventListener("open", r, { once: true });
  ws.addEventListener("error", j, { once: true });
});
let next = 0;
const pending = new Map();
ws.addEventListener("message", (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
});
function send(method, params = {}) {
  const id = ++next;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) =>
    pending.set(id, (msg) => (msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolve(msg.result))),
  );
}
async function evaluate(expression) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? "evaluate failed");
  return r.result.value;
}
const q = (s) => JSON.stringify(s);

switch (command) {
  case "shot": {
    const [file, scheme = "light"] = args;
    await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }] });
    await new Promise((r) => setTimeout(r, 600));
    const { data } = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(file, Buffer.from(data, "base64"));
    console.log(file);
    break;
  }
  case "click":
    console.log(await evaluate(`(() => { const el = document.querySelector(${q(args[0])}); if (!el) return "missing"; el.click(); return "clicked"; })()`));
    break;
  case "clicktext":
    console.log(
      await evaluate(
        `(() => { const el = [...document.querySelectorAll(${q(args[0])})].find((e) => e.innerText.includes(${q(args[1])})); if (!el) return "missing"; el.click(); return "clicked"; })()`,
      ),
    );
    break;
  case "text":
    console.log(await evaluate(`(document.querySelector(${q(args[0] ?? "body")})?.innerText ?? "")`));
    break;
  case "reload":
    await send("Page.reload", {});
    console.log("reloaded");
    break;
  case "size": {
    // Lays the page out at this size in CSS px (as a window that size would); "size reset" ends it.
    if (args[0] === "reset") await send("Emulation.clearDeviceMetricsOverride", {});
    else await send("Emulation.setDeviceMetricsOverride", { width: Number(args[0]), height: Number(args[1]), deviceScaleFactor: 1, mobile: false });
    console.log(`size ${args.join(" ")}`);
    break;
  }
  case "exists":
    console.log((await evaluate(`!!document.querySelector(${q(args[0])})`)) ? "yes" : "no");
    break;
  default:
    console.error("usage: desk.mjs shot|click|clicktext|text|exists ...");
    process.exitCode = 2;
}
ws.close();
