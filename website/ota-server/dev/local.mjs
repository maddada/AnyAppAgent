// The update server on this PC, for the local proof (README.md, "Testing locally"): the Worker
// (src/worker.js) unchanged, in Node, with the R2 bucket kept in a folder (dev/bucket.mjs).
//
//   KIWIMAKE_OTA_UPLOAD_TOKEN=<32+ characters> node dev/local.mjs [--port 8791] [--data <folder>]
//
// The emulator reaches it at http://10.0.2.2:<port>. Never port 8787 (the companion's).
import { createServer } from "node:http";
import { join } from "node:path";
import worker from "../src/worker.js";
import { folderBucket } from "./bucket.mjs";

const arg = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  return at > 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
};
const port = Number(arg("port", "8791"));
if (port === 8787) throw new Error("8787 is the companion's port; pick another.");
const data = arg("data", join(process.cwd(), ".ota-data"));
const token = process.env.KIWIMAKE_OTA_UPLOAD_TOKEN ?? "";
if (token.length < 32) throw new Error("Set KIWIMAKE_OTA_UPLOAD_TOKEN to 32 or more characters.");
const env = { OTA: folderBucket(data), UPLOAD_TOKEN: token };

createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = chunks.length > 0 && req.method !== "GET" && req.method !== "HEAD" ? Buffer.concat(chunks) : undefined;
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) if (typeof value === "string") headers.set(name, value);
  const response = await worker.fetch(new Request(`http://${req.headers.host ?? "localhost"}${req.url}`, { method: req.method, headers, body }), env);
  const out = response.body ? Buffer.from(await response.arrayBuffer()) : null;
  console.log(`${new Date().toISOString()} ${req.method} ${req.url} ${response.status}${req.headers["expo-runtime-version"] ? ` runtime=${req.headers["expo-runtime-version"]} current=${req.headers["expo-current-update-id"] ?? "-"}` : ""}`);
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(out);
}).listen(port, "0.0.0.0", () => console.log(`Kiwimake update server (local) on http://0.0.0.0:${port}, data in ${data}`));
