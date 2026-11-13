// Run after the release workflow verifies the draft's APKs, before compiling the desktop.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url)));
const apk = readFileSync(new URL("../../app/dist/AnyAppAgent.apk", import.meta.url));
writeFileSync(new URL("../phone-release.json", import.meta.url), JSON.stringify({ version: pkg.version, sha256: createHash("sha256").update(apk).digest("hex"), bytes: apk.length }, null, 2) + "\n");
