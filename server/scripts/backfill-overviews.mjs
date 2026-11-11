#!/usr/bin/env node
// One-time backfill: writes a draft overview.md (what the person asked for in the app's chat) into
// every app folder that has none, so `anyapp overview` has something before the app's agent
// writes its own. The draft's first line marks it, and the agent replaces it on its next turn.
// Nothing is committed here: the PC saves it with the app's next change.
//
//   node scripts/backfill-overviews.mjs [--state-dir <dir>] [--write]
// Without --write it only says what it would do.
import { existsSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
const { backfillOverview, defaultStateDir, loadApps, OVERVIEW_FILE } = await import("../src/apps-cli.ts");

const args = process.argv.slice(2);
const at = args.indexOf("--state-dir");
const stateDir = resolve(at >= 0 ? args[at + 1] : process.env.ANYAPP_STATE_DIR ?? defaultStateDir());
const write = args.includes("--write");
const apps = loadApps(stateDir);
console.log(`${apps.length} apps in ${stateDir}${write ? "" : " (dry run; --write to write)"}`);
for (const app of apps) {
  const file = join(app.folder, OVERVIEW_FILE);
  if (existsSync(file)) {
    console.log(`  ${app.slug}: has ${OVERVIEW_FILE}, left alone`);
    continue;
  }
  if (!existsSync(app.folder)) {
    console.log(`  ${app.slug}: folder ${app.folder} is missing, skipped`);
    continue;
  }
  const text = backfillOverview(stateDir, app);
  if (write) writeFileSync(file, text);
  console.log(`  ${app.slug}: ${write ? "wrote" : "would write"} ${file} (${text.split("\n").filter((l) => l.startsWith("- ")).length} requests)`);
}
