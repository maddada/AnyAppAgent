// AnyAppAgent PC companion: `npm start` in server/, or `node server/bin/anyappagent.mjs`.
import { networkInterfaces } from "node:os";
import qrcode from "qrcode-terminal";
import type { ServerEvent } from "../../shared/protocol.ts";
import { AppManager } from "./apps.ts";
import { Auth } from "./auth.ts";
import { loadBuilder } from "./builder.ts";
import { loadConfig } from "./config.ts";
import { log } from "./fs-util.ts";
import { serverName, startHttpServer } from "./http.ts";
import { Store } from "./store.ts";

const VIRTUAL_ADAPTER = /vethernet|wsl|hyper-v|virtualbox|vmware|tailscale|zerotier|docker|loopback|vpn/i;

/** IPv4 addresses, real LAN adapters on private ranges first (they are what a phone on Wi-Fi reaches). */
function lanAddresses(): string[] {
  const found: { address: string; rank: number }[] = [];
  for (const [name, entries] of Object.entries(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family !== "IPv4" || entry.internal || entry.address.startsWith("169.254.")) continue;
      const privateRange = /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(entry.address);
      found.push({ address: entry.address, rank: (VIRTUAL_ADAPTER.test(name) ? 2 : 0) + (privateRange ? 0 : 1) });
    }
  }
  return found.sort((a, b) => a.rank - b.rank).map((f) => f.address);
}

/** What the terminal QR code encodes; the phone app parses it (see shared/protocol.ts). */
export function pairingUri(address: string, port: number, code: string): string {
  return `anyappagent://pair?url=${encodeURIComponent(`http://${address}:${port}`)}&code=${code}`;
}

export async function main(): Promise<void> {
  const config = loadConfig();
  const store = new Store(config.stateDir);
  const auth = new Auth(config.stateDir);
  const builder = await loadBuilder(config.builder);

  let broadcast: (event: ServerEvent) => void = () => {};
  const apps = new AppManager({ store, builder, config, broadcast: (event) => broadcast(event), log });
  apps.recover();

  const http = startHttpServer({ host: config.host, port: config.port, version: config.version, auth, apps });
  broadcast = http.broadcast;
  try {
    await http.ready;
  } catch (error) {
    console.error(`Could not listen on ${config.host}:${config.port}: ${(error as Error).message}`);
    console.error("Is the companion already running? Close the other window, or set ANYAPP_PORT.");
    process.exit(1);
  }

  const addresses = lanAddresses();
  const lines = [
    "",
    `  AnyAppAgent is running on ${serverName()} (port ${config.port})`,
    "",
    `  Pairing code:  ${auth.code.slice(0, 3)} ${auth.code.slice(3)}`,
    "",
    "  Addresses for the phone:",
    ...addresses.map((a) => `    http://${a}:${config.port}`),
    `    http://10.0.2.2:${config.port}   (Android emulator on this PC)`,
    "",
    `  Builder: ${builder.kind}   GitHub: ${config.github ? "on" : "off"}   Apps: ${config.appsDir}`,
    `  State: ${config.stateDir}`,
    "",
  ];
  console.log(lines.join("\n"));
  const qrAddress = addresses[0] ?? "10.0.2.2";
  qrcode.generate(pairingUri(qrAddress, config.port, auth.code), { small: true }, (qr: string) => {
    console.log(qr);
    console.log(`  Scan with AnyAppAgent on the phone (encodes http://${qrAddress}:${config.port} and the code).\n`);
  });

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    log("stopping…");
    http.server.close();
    await apps.shutdown();
    process.exit(0);
  };
  process.on("SIGINT", () => void stop());
  process.on("SIGTERM", () => void stop());
  process.on("SIGBREAK", () => void stop());
}
