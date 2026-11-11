#!/usr/bin/env node
// A scripted client of the companion for the helpers UI proof (pairs once like a phone and keeps
// its token in <state>/ui-proof-token.txt). One command per run:
//   node api.mjs create <name> <prompt>          -> prints the app id
//   node api.mjs send <appId> <text>
//   node api.mjs helpers <appId>                 -> one line per helper
//   node api.mjs wait <appId> <condition> [sec]  waits until it holds; conditions:
//       helpers-working=<n>   at least n helpers working at the same time
//       helpers-done=<n>      at least n helpers settled (done, failed or stopped)
//       idle                  the app is idle
//       replied-after=<seq>   an assistant item newer than seq has finished in the main chat
//   node api.mjs lastseq <appId>
// UI_PROOF_PORT (default 8799), UI_PROOF_STATE (the companion's state folder).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const PORT = Number(process.env.UI_PROOF_PORT ?? 8799);
const STATE = process.env.UI_PROOF_STATE ?? "C:\\aa\\e2e\\helpers\\state";
const BASE = `http://127.0.0.1:${PORT}`;
const tokenFile = join(STATE, "ui-proof-token.txt");

async function token() {
  if (existsSync(tokenFile)) return readFileSync(tokenFile, "utf8").trim();
  const code = readFileSync(join(STATE, "pairing-code.txt"), "utf8").trim();
  const res = await fetch(`${BASE}/api/pair`, { method: "POST", body: JSON.stringify({ code, deviceName: "UI proof script" }) });
  if (!res.ok) throw new Error(`pair -> ${res.status}`);
  const { token: t } = await res.json();
  writeFileSync(tokenFile, t);
  return t;
}
async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

const [command, appId, ...rest] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

switch (command) {
  case "create": {
    const app = await api("POST", "/api/apps", { name: appId, prompt: rest.join(" ") });
    console.log(app.id);
    break;
  }
  case "send":
    await api("POST", `/api/apps/${appId}/messages`, { text: rest.join(" ") });
    console.log("sent");
    break;
  case "helpers":
    for (const w of await api("GET", `/api/apps/${appId}/workers`)) console.log(`${w.id} ${w.state.padEnd(8)} ${w.title} | ${w.latest ?? ""}`);
    break;
  case "lastseq": {
    const items = await api("GET", `/api/apps/${appId}/messages`);
    console.log(items.at(-1)?.seq ?? 0);
    break;
  }
  case "wait": {
    const [condition, seconds = "600"] = rest;
    const [name, value] = condition.split("=");
    const until = Date.now() + Number(seconds) * 1000;
    const started = Date.now();
    for (;;) {
      let ok = false;
      if (name === "helpers-working") ok = (await api("GET", `/api/apps/${appId}/workers`)).filter((w) => w.state === "working").length >= Number(value);
      else if (name === "helpers-done") ok = (await api("GET", `/api/apps/${appId}/workers`)).filter((w) => ["done", "failed", "stopped"].includes(w.state)).length >= Number(value);
      else if (name === "idle") ok = (await api("GET", `/api/apps/${appId}`)).status === "idle";
      else if (name === "replied-after") ok = (await api("GET", `/api/apps/${appId}/messages?afterSeq=${value}`)).some((i) => i.kind === "assistant" && !i.streaming);
      else throw new Error(`unknown condition ${name}`);
      if (ok) {
        console.log(`${condition} after ${((Date.now() - started) / 1000).toFixed(1)} s`);
        break;
      }
      if (Date.now() > until) {
        console.log(`TIMEOUT waiting for ${condition}`);
        process.exitCode = 1;
        break;
      }
      await sleep(1000);
    }
    break;
  }
  default:
    console.error("usage: api.mjs create|send|helpers|wait|lastseq ...");
    process.exitCode = 2;
}
