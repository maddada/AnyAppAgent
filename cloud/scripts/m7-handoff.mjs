// Milestone 7 proof: the PC hands its sign-in to a phone, against the live dev deployment. Reads the
// companion's PC link from its state folder (never printed), asks Convex for a one-time hand-over
// code, signs in with it exactly as the phone does ("pc-handoff"), and checks the session is the
// PC link's account; then that the code does not work twice.
//   node scripts/m7-handoff.mjs <companion state dir>
import { readFileSync } from "node:fs";
import { join } from "node:path";

const stateDir = process.argv[2];
const link = JSON.parse(readFileSync(join(stateDir, "cloud-link.json"), "utf8"));
const cloud = readFileSync("C:/aa/t/convex-url.txt", "utf8").trim();

const post = async (url, body, token) => {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};
const convex = (kind, path, args, token) => post(`${cloud}/api/${kind}`, { path, args, format: "json" }, token);

const hello = await post(`${link.site}/pc/hello`, {}, link.token);
console.log("PC link:", hello.status, "linkedFrom", hello.body.linkedFrom, "account test:", hello.body.account?.anonymous);
const h = await post(`${link.site}/pc/handoff`, {}, link.token);
console.log("hand-over code:", h.status, h.body.code ? `${h.body.code.length} chars` : h.body.error);
const signIn = await convex("action", "auth:signIn", { provider: "pc-handoff", params: { code: h.body.code } });
const tokens = signIn.body.value?.tokens;
console.log("sign-in with it:", signIn.body.status, tokens ? "got a session" : signIn.body.errorMessage);
const me = await convex("query", "accounts:me", {}, tokens?.token);
const pcs = me.body.value?.pcs ?? [];
console.log("the session's account lists this PC:", pcs.some((p) => p.name === hello.body.deviceName), "linked from:", pcs.map((p) => p.linkedFrom).join(","));
const again = await convex("action", "auth:signIn", { provider: "pc-handoff", params: { code: h.body.code } });
console.log("the same code again:", again.body.status, again.body.value?.tokens ? "WRONGLY signed in" : "refused");
