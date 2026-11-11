// Drives the running desktop app for proofs, over the Chrome DevTools protocol. Start the app
// with --remote-debugging-port=<port> (dev/proof runs only), then:
//
//   node dev/drive.mjs [--port 9333] [--target /page/] shot <file.png>   window screenshot
//   node dev/drive.mjs [--port 9333] click "<visible text>"   clicks the first button/link with that text
//   node dev/drive.mjs [--port 9333] eval "<js>"              runs JS in the page, prints the result (JSON)
//   node dev/drive.mjs [--port 9333] text                     prints the visible text of the window
//   node dev/drive.mjs [--port 9333] wait "<text>" [sec]      waits until the text is on screen
//   --theme light|dark: shot in that colour scheme (CSS prefers-color-scheme, this call only)
import { writeFileSync } from "node:fs";
import WebSocket from "ws";

const argv = process.argv.slice(2);
const pi = argv.indexOf("--port");
const port = pi >= 0 ? argv.splice(pi, 2)[1] : "9333";
// --target <text>: the window whose address or title contains it (a page window: --target /page/). Default: the app's window.
const ti = argv.indexOf("--target");
const want = ti >= 0 ? argv.splice(ti, 2)[1] : undefined;
const thi = argv.indexOf("--theme");
const theme = thi >= 0 ? argv.splice(thi, 2)[1] : undefined;
const [cmd, a1, a2] = argv;

const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = targets.find((t) => t.type === "page" && !t.url.startsWith("devtools") && (want ? t.url.includes(want) || t.title.includes(want) : !t.url.includes("/page/")));
if (!page) throw new Error("no page target");
const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
await new Promise((r, j) => {
  ws.once("open", r);
  ws.once("error", j);
});
let id = 0;
const pending = new Map();
ws.on("message", (m) => {
  const msg = JSON.parse(String(m));
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
});
const call = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const n = ++id;
    pending.set(n, (msg) => (msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result)));
    ws.send(JSON.stringify({ id: n, method, params }));
  });
const evaluate = async (expression) => {
  const r = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};

const CLICK = (text) => `(() => {
  const want = ${JSON.stringify(text)}.trim();
  const els = [...document.querySelectorAll("button, a, [role=switch], summary")];
  const el = els.find((e) => e.textContent.replace(/\\s+/g, " ").trim() === want) ?? els.find((e) => e.textContent.replace(/\\s+/g, " ").trim().includes(want));
  if (!el) return "not found";
  el.scrollIntoView({ block: "center" });
  el.click();
  return "clicked";
})()`;

try {
  if (cmd === "shot") {
    if (theme) {
      await call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }] });
      await new Promise((r) => setTimeout(r, 400));
    }
    const r = await call("Page.captureScreenshot", { format: "png" });
    writeFileSync(a1, Buffer.from(r.data, "base64"));
    console.log(`saved ${a1}`);
  } else if (cmd === "click") {
    const r = await evaluate(CLICK(a1));
    console.log(r);
    if (r !== "clicked") process.exitCode = 2;
  } else if (cmd === "eval") {
    console.log(JSON.stringify(await evaluate(a1), null, 1));
  } else if (cmd === "text") {
    console.log(await evaluate("document.body.innerText"));
  } else if (cmd === "wait") {
    const until = Date.now() + Number(a2 ?? 60) * 1000;
    let ok = false;
    while (Date.now() < until) {
      if (await evaluate(`document.body.innerText.includes(${JSON.stringify(a1)})`)) {
        ok = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    console.log(ok ? "found" : "timed out");
    if (!ok) process.exitCode = 2;
  } else {
    console.error("commands: shot, click, eval, text, wait");
    process.exitCode = 1;
  }
} finally {
  ws.close();
}
