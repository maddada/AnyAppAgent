// electron-builder afterPack hook: electron-builder leaves node_modules out of extraResources, but
// the companion (server/) and the template the builder copies need theirs. Copy them into the
// unpacked app before the installer is made. Dev-only packages of the server are skipped.
const { cpSync, existsSync } = require("node:fs");
const { join, resolve, sep } = require("node:path");

const SKIP = ["vitest", "@vitest", "typescript", "@typescript", "@types"].map((n) => `${sep}node_modules${sep}${n}`);

exports.default = async function afterPack(context) {
  const repo = resolve(__dirname, "..", "..");
  const companion = join(context.appOutDir, "resources", "companion");
  // Only the companion needs its node_modules. The builder never uses template/node_modules: it
  // copies apps from its own dependency cache (.anyappagent/cache in the user folder), which the
  // setup fills in its "Tools for building apps" step.
  for (const part of ["server"]) {
    const from = join(repo, part, "node_modules");
    const to = join(companion, part, "node_modules");
    if (!existsSync(from)) throw new Error(`${from} is missing: run npm install in ${part}/ first`);
    console.log(`  • copying ${part}/node_modules into the app`);
    cpSync(from, to, {
      recursive: true,
      dereference: true,
      filter: (src) => !SKIP.some((s) => src.includes(s) && (src.endsWith(s) || src.includes(s + sep))),
    });
  }
};
