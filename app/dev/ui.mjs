// Drives the emulator with adb for proving screens: find a view by testID (resource-id) or text,
// tap it, type, take screenshots. Always targets one device (ANYAPP_ADB_SERIAL, default emulator-5560).
//
//   node dev/ui.mjs tap <testID|text:Some text>      tap the view's centre
//   node dev/ui.mjs type <text>                      type into the focused field
//   node dev/ui.mjs shot <name>                      save docs/screens/<name>.png
//   node dev/ui.mjs dump                             list visible ids and texts
//   node dev/ui.mjs wait <testID|text:...> [sec]     wait until it is on screen
//   node dev/ui.mjs key <BACK|HOME|ENTER|...>
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const SERIAL = process.env.ANYAPP_ADB_SERIAL || "emulator-5560";
const ADB = process.env.ANDROID_HOME ? join(process.env.ANDROID_HOME, "platform-tools", "adb.exe") : "adb";

const adb = (...args) => execFileSync(ADB, ["-s", SERIAL, ...args], { encoding: "buffer", maxBuffer: 64 << 20, timeout: 45000 });

function dump() {
  // exec-out streams the file back; writing to /sdcard and pulling hangs on some images.
  const xml = adb("exec-out", "uiautomator", "dump", "/dev/tty").toString("utf8");
  const nodes = [];
  for (const m of xml.matchAll(/<node ([^>]*?)\/?>/g)) {
    const attr = (k) => (new RegExp(`${k}="([^"]*)"`).exec(m[1]) ?? [])[1] ?? "";
    const b = /\[(\d+),(\d+)\]\[(\d+),(\d+)\]/.exec(attr("bounds"));
    if (!b) continue;
    const decode = (s) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    nodes.push({
      id: attr("resource-id").replace(/^.*:id\//, ""),
      text: decode(attr("text")),
      desc: decode(attr("content-desc")),
      x: (Number(b[1]) + Number(b[3])) / 2,
      y: (Number(b[2]) + Number(b[4])) / 2,
      w: Number(b[3]) - Number(b[1]),
    });
  }
  return nodes;
}

function find(nodes, query) {
  if (query.startsWith("text:")) {
    const q = query.slice(5).toLowerCase();
    return nodes.find((n) => n.text.toLowerCase() === q || n.desc.toLowerCase() === q) ?? nodes.find((n) => n.text.toLowerCase().includes(q) || n.desc.toLowerCase().includes(q));
  }
  return nodes.find((n) => n.id === query);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const [cmd, ...rest] = process.argv.slice(2);

// The emulator is shared with other threads: only ever send input to our own windows (and the
// system screens our flow opens). If someone else's app is in front, bring ours back first.
const OURS = [/com\.anyappagent/, /packageinstaller/, /permissioncontroller/, /com\.android\.settings/, /^$/];
function focused() {
  const out = adb("shell", "dumpsys", "window", "displays").toString("utf8");
  return (/mCurrentFocus=Window\{\S+ \S+ ([^}\s]+)/.exec(out) ?? [])[1] ?? "";
}
async function ensureOurs() {
  for (let i = 0; i < 3; i++) {
    const f = focused();
    if (OURS.some((r) => r.test(f.split("/")[0]))) return;
    console.error(`(someone else's window is in front: ${f}; bringing AnyAppAgent back)`);
    adb("shell", "am", "start", "-n", "com.anyappagent/.MainActivity");
    await sleep(1500);
  }
  console.error("could not get AnyAppAgent to the front");
  process.exit(2);
}
if (["tap", "longpress", "type", "key", "clear"].includes(cmd)) await ensureOurs();

switch (cmd) {
  case "tap": {
    const n = find(dump(), rest[0]);
    if (!n) {
      console.error(`not found: ${rest[0]}`);
      process.exit(1);
    }
    adb("shell", "input", "tap", String(Math.round(n.x)), String(Math.round(n.y)));
    console.log(`tapped ${rest[0]} at ${Math.round(n.x)},${Math.round(n.y)}`);
    await sleep(Number(process.env.UI_SETTLE_MS ?? 900)); // let the keyboard / next screen come up
    break;
  }
  case "longpress": {
    const n = find(dump(), rest[0]);
    if (!n) process.exit(1);
    const x = String(Math.round(n.x)), y = String(Math.round(n.y));
    adb("shell", "input", "swipe", x, y, x, y, "900");
    break;
  }
  case "type": {
    // adb input text: spaces as %s, and shell metacharacters escaped.
    const text = rest.join(" ").replace(/([\\'"`$&|;<>()*?!#~])/g, "\\$1").replace(/ /g, "%s");
    adb("shell", "input", "text", text);
    break;
  }
  case "clear": {
    // Focus a field and delete what's in it.
    const n = find(dump(), rest[0]);
    if (!n) process.exit(1);
    adb("shell", "input", "tap", String(Math.round(n.x)), String(Math.round(n.y)));
    adb("shell", "input", "keyevent", "KEYCODE_MOVE_END", ...Array(40).fill("KEYCODE_DEL"));
    break;
  }
  case "key":
    adb("shell", "input", "keyevent", `KEYCODE_${rest[0]}`);
    break;
  case "shot": {
    const out = join(here, "..", "docs", "screens", `${rest[0]}.png`);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, adb("exec-out", "screencap", "-p"));
    console.log(out);
    break;
  }
  case "wait": {
    const until = Date.now() + Number(rest[1] ?? 30) * 1000;
    for (;;) {
      if (find(dump(), rest[0])) {
        console.log(`found ${rest[0]}`);
        break;
      }
      if (Date.now() > until) {
        console.error(`timed out waiting for ${rest[0]}`);
        process.exit(1);
      }
      await sleep(1000);
    }
    break;
  }
  case "dump":
    for (const n of dump()) if (n.id || n.text || n.desc) console.log(`${n.id || "-"} | ${n.text || n.desc} @ ${Math.round(n.x)},${Math.round(n.y)}`);
    break;
  default:
    console.log("usage: node dev/ui.mjs tap|longpress|type|key|shot|wait|dump ...");
}
