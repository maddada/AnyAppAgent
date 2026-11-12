// Proof helper: asks a companion (admin token) for its live Easy Connect code and opens the
// Kiwimake deep link anyappagent://pair?ec=<code> on the emulator, as a tapped link would.
// The code is never printed (it holds the PC's address and a one-time secret).
//
//   node dev/ec-link.mjs --port 8781 --admin <token> [--serial emulator-5560] [--new]
// --new asks for a fresh code first (POST /api/admin/pairing/new).
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const arg = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : d;
};
const port = arg("port", "8781");
const admin = arg("admin", process.env.ANYAPP_ADMIN_TOKEN);
const serial = arg("serial", process.env.ANYAPP_ADB_SERIAL || "emulator-5560");
const adb = [process.env.ANDROID_HOME && join(process.env.ANDROID_HOME, "platform-tools", "adb.exe"), "D:\\tools\\android\\sdk\\platform-tools\\adb.exe"].find(
  (p) => p && existsSync(p),
);
if (!adb) throw new Error("No Android SDK adb (see docs/ENVIRONMENT.md); the adb on PATH is never used.");

const H = { Authorization: `Bearer ${admin}`, "Content-Type": "application/json" };
const base = `http://127.0.0.1:${port}`;
if (args.includes("--new")) await fetch(`${base}/api/admin/pairing/new`, { method: "POST", headers: H, body: "{}" });
const state = await (await fetch(`${base}/api/admin/state`, { headers: H })).json();
const code = state.easyConnect?.code;
if (!code) {
  console.error(`No live Easy Connect code (state ${state.easyConnect?.state}). Use --new.`);
  process.exit(1);
}
console.log(`code: ${code.length} chars, expires ${state.easyConnect.expiresAt}`);
execFileSync(adb, ["-s", serial, "shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", `'anyappagent://pair?ec=${code}'`, "com.anyappagent"], {
  stdio: ["ignore", "ignore", "inherit"],
});
console.log("deep link opened");
