// AnyAppAgent PC companion: `npm start` in server/, or `node server/bin/anyappagent.mjs`.
// The desktop app (desktop/) starts it as a child process with ANYAPP_ADMIN_TOKEN set.
import qrcode from "qrcode-terminal";
import type { ServerEvent } from "../../shared/protocol.ts";
import { AppManager } from "./apps.ts";
import { installAppsCli } from "./apps-cli.ts";
import { Auth } from "./auth.ts";
import { loadBuilder } from "./builder.ts";
import { loadConfig } from "./config.ts";
import { EasyConnect } from "./easy-connect/controller.ts";
import { log } from "./fs-util.ts";
import { serverName, startHttpServer } from "./http.ts";
import { lanAddresses, pairingUri } from "./net.ts";
import { Store } from "./store.ts";
import { loadToolchain, TOOLCHAIN_MISSING } from "./toolchain.ts";
import { warmBuilder } from "./warm.ts";

export { pairingUri };

export async function main(): Promise<void> {
  // One stray rejection must never take the companion (and every app's session) down.
  process.on("unhandledRejection", (reason) => log("unexpected error:", reason instanceof Error ? reason.message : reason));
  const config = loadConfig();
  const adminToken = process.env.ANYAPP_ADMIN_TOKEN;
  const store = new Store(config.stateDir);
  // The `anyapp` command for the apps' agents (their sessions get its folder on PATH).
  let cliDir = "";
  try {
    cliDir = installAppsCli(config.stateDir);
  } catch (error) {
    log("could not install the anyapp command:", (error as Error).message);
  }
  const auth = new Auth(config.stateDir, adminToken);
  const toolchain = loadToolchain(config.stateDir);
  const builder = await loadBuilder(config.builder);
  const easyConnect = new EasyConnect({ stateDir: config.stateDir, port: config.port, auth, log });

  let broadcast: (event: ServerEvent) => void = () => {};
  const apps = new AppManager({
    store,
    builder,
    config,
    broadcast: (event) => broadcast(event),
    log,
    checkToolchain: () => (builder.kind === "real" && !toolchain ? TOOLCHAIN_MISSING : null),
  });
  apps.recover();

  const http = startHttpServer({
    host: config.host,
    port: config.port,
    version: config.version,
    auth,
    apps,
    easyConnect,
    ...(process.env.ANYAPP_HOST_APK ? { hostApkPath: process.env.ANYAPP_HOST_APK } : {}),
  });
  broadcast = http.broadcast;
  auth.onChange = () => http.adminChanged();
  easyConnect.onChange = () => http.adminChanged();
  try {
    await http.ready;
  } catch (error) {
    console.error(`Could not listen on ${config.host}:${config.port}: ${(error as Error).message}`);
    console.error("Is the companion already running? Close the other window, or set ANYAPP_PORT.");
    process.exit(1);
  }
  easyConnect.init();
  apps.startWork();
  if (builder.kind === "real") warmBuilder(config.appsDir, log);

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
    builder.kind === "real"
      ? toolchain
        ? `  Android tools: ${toolchain.javaHome}, ${toolchain.androidHome} (from ${toolchain.source})`
        : `  ${TOOLCHAIN_MISSING}`
      : "  Android tools: not needed (fake builder)",
    `  Builder: ${builder.kind}   GitHub: ${config.github ? "on" : "off"}   Desktop app: ${auth.hasAdmin ? "connected" : "not used"}   Apps: ${config.appsDir}`,
    `  State: ${config.stateDir}`,
    ...(cliDir ? [`  Agents' anyapp command: ${cliDir}`] : []),
    "",
  ];
  console.log(lines.join("\n"));
  if (!auth.hasAdmin) {
    const qrAddress = addresses[0] ?? "10.0.2.2";
    qrcode.generate(pairingUri(qrAddress, config.port, auth.code), { small: true }, (qr: string) => {
      console.log(qr);
      console.log(`  Scan with AnyAppAgent on the phone (encodes http://${qrAddress}:${config.port} and the code).\n`);
    });
  }

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    log("stopping…");
    easyConnect.stop();
    http.close();
    await apps.shutdown();
    auth.flush();
    process.exit(0);
  };
  process.on("SIGINT", () => void stop());
  process.on("SIGTERM", () => void stop());
  process.on("SIGBREAK", () => void stop());
  // The desktop app closes our stdin when it quits; treat that as "stop" so no helper is left behind.
  if (process.env.ANYAPP_STOP_ON_STDIN_END === "1") {
    process.stdin.on("end", () => void stop());
    process.stdin.resume();
  }
}
