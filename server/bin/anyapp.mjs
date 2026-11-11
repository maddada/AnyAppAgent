#!/usr/bin/env node
// `anyapp`: the person's other apps on this PC, for an app's agent (see src/apps-cli.ts).
// The companion installs launchers for it in <state>/bin and puts that folder on its agents' PATH.
const { runCli } = await import("../src/apps-cli.ts");
const { code, out } = runCli(process.argv.slice(2));
(code === 0 ? process.stdout : process.stderr).write(`${out}\n`);
process.exitCode = code;
