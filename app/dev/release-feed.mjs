// A stand-in for GitHub's newest-release answer, for proving the APK self-update on the emulator
// (docs/RELEASING.md, "Updates of the phone app"): it answers like
// https://api.github.com/repos/maddada/Kiwimake/releases/latest, with the APKs in a folder as the
// release's files (name, size, SHA-256 digest), and serves them.
//
//   node dev/release-feed.mjs --dir <folder with AnyAppAgent.apk / AnyAppAgent-universal.apk> --version 0.3.4 [--port 8792]
//
// Build the app with KIWIMAKE_RELEASE_FEED=http://10.0.2.2:8792/releases/latest to use it. Never
// port 8787 (the companion's).
import { createHash } from "node:crypto";
import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";

const arg = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  return at > 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
};
const port = Number(arg("port", "8792"));
if (port === 8787) throw new Error("8787 is the companion's port; pick another.");
const dir = arg("dir", null);
const version = arg("version", null);
if (!dir || !version) throw new Error("usage: node dev/release-feed.mjs --dir <folder> --version <x.y.z> [--port 8792]");

const assets = readdirSync(dir)
  .filter((name) => name.endsWith(".apk"))
  .map((name) => {
    const path = join(dir, name);
    return { name, path, size: statSync(path).size, digest: `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}` };
  });

createServer((req, res) => {
  const base = `http://${req.headers.host}`;
  console.log(`${new Date().toISOString()} ${req.method} ${req.url}`);
  if (req.url === "/releases/latest") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ tag_name: `v${version}`, assets: assets.map((a) => ({ name: a.name, size: a.size, digest: a.digest, browser_download_url: `${base}/download/${a.name}` })) }));
    return;
  }
  const asset = assets.find((a) => req.url === `/download/${a.name}`);
  if (asset && existsSync(asset.path)) {
    res.writeHead(200, { "content-type": "application/vnd.android.package-archive", "content-length": asset.size });
    createReadStream(asset.path).pipe(res);
    return;
  }
  res.writeHead(404).end();
}).listen(port, "0.0.0.0", () => console.log(`Release feed (local) for v${version} on http://0.0.0.0:${port}/releases/latest: ${assets.map((a) => a.name).join(", ")}`));
