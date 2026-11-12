#!/usr/bin/env node
// Starts the Kiwimake PC companion. Node 24 runs the TypeScript sources directly.
const [major] = process.versions.node.split(".").map(Number);
if (major < 24) {
  console.error(`Kiwimake needs Node 24 or newer (this is ${process.versions.node}).`);
  process.exit(1);
}
const { main } = await import("../src/main.ts");
await main();
