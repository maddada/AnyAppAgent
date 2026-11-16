#!/usr/bin/env node
/**
 * Publishes the phone app's over-the-air updates to Kiwimake's update server (website/ota-server),
 * signing each manifest or directive with the private key (docs/RELEASING.md). Copied from Ghostex's
 * tooling/release-mobile/ota-publish.mjs (read only, never imported), for Android only.
 *
 *   node scripts/ota-publish.mjs publish <export-dir> [--new-runtime] [--dry-run]
 *       Publishes what scripts/ota-export.mjs wrote. Refuses a runtime version the server has never
 *       served unless --new-runtime: then no installed app runs it yet, which is only right when an
 *       APK with that runtime is being released at the same time.
 *   node scripts/ota-publish.mjs status [--runtime <rv>]
 *       What phones on that runtime (default: this checkout's) are served now. No token needed.
 *   node scripts/ota-publish.mjs rollback-to-embedded --runtime <rv>
 *       Phones on that runtime drop their downloaded update and run the code inside the APK.
 *   node scripts/ota-publish.mjs republish --runtime <rv> --from <history-name>
 *       Serves an earlier update again (new id and date, so phones on a later update take it).
 *   node scripts/ota-publish.mjs history --runtime <rv>
 *   Every command takes [--channel production].
 *
 * Environment: KIWIMAKE_OTA_SIGNING_KEY_FILE (default ~/.anyappagent-release/ota-signing/private-key.pem),
 * KIWIMAKE_OTA_UPLOAD_TOKEN (or the file ~/.anyappagent-release/ota-upload-token), and optionally
 * KIWIMAKE_OTA_SERVER (default https://ota.kiwimake.ai). Every signature is checked against the
 * certificate the app ships before anything is uploaded, so a wrong key fails here, not on phones.
 * Neither the key nor the token is ever printed.
 */

import { createHash, createSign, createVerify, randomUUID, X509Certificate } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_CHANNEL, DEFAULT_KEY_FILE, DEFAULT_TOKEN_FILE, fetchServed, manifestAssetKey, otaServer, PLATFORM, unreachableAssetKeys } from "./ota-lib.mjs";

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVER = otaServer();
const KEY_ID = "main";

const CONTENT_TYPES = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  ttf: "font/ttf",
  otf: "font/otf",
  woff: "font/woff",
  woff2: "font/woff2",
  json: "application/json",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  mp4: "video/mp4",
  html: "text/html",
  js: "application/javascript",
};

function fail(message) {
  console.error(`ota-publish: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = { channel: DEFAULT_CHANNEL, dryRun: false, newRuntime: false, positional: [] };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--new-runtime") options.newRuntime = true;
    else if (arg.startsWith("--")) {
      const value = rest[index + 1];
      if (value === undefined) fail(`${arg} needs a value`);
      options[arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
      index += 1;
    } else options.positional.push(arg);
  }
  return { command, options };
}

function signingKey() {
  const file = process.env.KIWIMAKE_OTA_SIGNING_KEY_FILE || DEFAULT_KEY_FILE;
  if (!existsSync(file)) fail(`the signing key is not at ${file} (set KIWIMAKE_OTA_SIGNING_KEY_FILE)`);
  return readFileSync(file, "utf8");
}

function uploadToken() {
  const fromEnv = process.env.KIWIMAKE_OTA_UPLOAD_TOKEN;
  if (fromEnv) return fromEnv;
  if (existsSync(DEFAULT_TOKEN_FILE)) return readFileSync(DEFAULT_TOKEN_FILE, "utf8").trim();
  return fail(`KIWIMAKE_OTA_UPLOAD_TOKEN is not set and ${DEFAULT_TOKEN_FILE} does not exist`);
}

function certificatePath(bundleDir) {
  const inBundle = bundleDir === undefined ? null : path.join(bundleDir, "certificate.pem");
  if (inBundle !== null && existsSync(inBundle)) return inBundle;
  return path.join(APP_ROOT, "certs", "certificate.pem");
}

/** Signs `text` and proves the signature verifies against the certificate inside the app. */
function sign(text, certificateFile) {
  const signer = createSign("RSA-SHA256");
  signer.update(text, "utf8");
  const signature = signer.sign(signingKey(), "base64");
  const certificate = new X509Certificate(readFileSync(certificateFile));
  const verifier = createVerify("RSA-SHA256");
  verifier.update(text, "utf8");
  if (!verifier.verify(certificate.publicKey, signature, "base64")) {
    fail(`the signing key does not match ${certificateFile}; phones would refuse this update`);
  }
  // An Expo structured-field dictionary; base64 never contains a quote or backslash.
  return `sig="${signature}", keyid="${KEY_ID}"`;
}

async function api(method, route, { body, headers = {}, auth = true, expect = [200, 201] } = {}) {
  const response = await fetch(`${SERVER}${route}`, {
    method,
    body,
    headers: { ...(auth ? { authorization: `Bearer ${uploadToken()}` } : {}), ...headers },
  });
  if (!expect.includes(response.status)) fail(`${method} ${route} answered ${response.status}: ${await response.text()}`);
  return response;
}

function sha256(bytes) {
  const digest = createHash("sha256").update(bytes).digest();
  return { hex: digest.toString("hex"), base64url: digest.toString("base64url") };
}

/** What the update says about itself in `extra.kiwimake`, read by the phone's Settings (src/lib/overTheAir.ts). */
function kiwimakeDetails(info) {
  return {
    version: info.version,
    commit: info.commit,
    ...(Array.isArray(info.whatsNew) && info.whatsNew.length > 0 ? { whatsNew: info.whatsNew } : {}),
  };
}

/** The folder ota-export.mjs wrote: android/export (expo export), android/expo-config.json, android/ota.json. */
function buildUpdate(platformDir) {
  const info = JSON.parse(readFileSync(path.join(platformDir, "ota.json"), "utf8"));
  if (info.platform !== PLATFORM) fail(`${platformDir}/ota.json is for ${info.platform}`);
  const exportDir = path.join(platformDir, "export");
  const metadata = JSON.parse(readFileSync(path.join(exportDir, "metadata.json"), "utf8"));
  const files = metadata.fileMetadata?.[PLATFORM];
  if (!files?.bundle) fail(`${exportDir}/metadata.json has no ${PLATFORM} bundle`);
  const expoConfig = JSON.parse(readFileSync(path.join(platformDir, "expo-config.json"), "utf8"));
  if (expoConfig.version !== info.version) fail(`${platformDir}: the app config says ${expoConfig.version}, the export says ${info.version}`);

  const uploads = [];
  const entry = (relative, ext, launch) => {
    const bytes = readFileSync(path.join(exportDir, relative));
    const { hex, base64url } = sha256(bytes);
    const contentType = launch ? "application/javascript" : CONTENT_TYPES[ext] || "application/octet-stream";
    uploads.push({ hex, bytes, contentType });
    let key = hex;
    if (!launch) {
      try {
        key = manifestAssetKey(bytes, relative);
      } catch (error) {
        fail(error.message);
      }
    }
    return { hash: base64url, key, contentType, ...(launch ? {} : { fileExtension: `.${ext}` }), url: `${SERVER}/v1/assets/${hex}` };
  };
  const manifest = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    runtimeVersion: info.runtimeVersion,
    launchAsset: entry(files.bundle, null, true),
    assets: (files.assets ?? []).map((item) => entry(item.path, item.ext, false)),
    metadata: {},
    extra: { expoClient: expoConfig, kiwimake: kiwimakeDetails(info) },
  };
  return { info, manifest, uploads };
}

async function postRecord({ channel, runtime, record, dryRun }) {
  const route = `/v1/admin/updates/${channel}/${PLATFORM}/${encodeURIComponent(runtime)}`;
  if (dryRun) {
    console.log(`[dry run] POST ${route} (${record.kind}, ${record.version ?? "no version"})`);
    return;
  }
  const response = await api("POST", route, { body: JSON.stringify(record), headers: { "content-type": "application/json" } });
  console.log(`Published ${record.kind} for runtime ${runtime}: ${JSON.stringify(await response.json())}`);
}

async function publish(options) {
  const bundleDir = options.positional[0];
  if (!bundleDir) fail("publish needs the folder ota-export.mjs wrote");
  const platformDir = path.join(bundleDir, PLATFORM);
  if (!existsSync(path.join(platformDir, "ota.json"))) fail(`${platformDir} has no ota.json`);
  const { info, manifest, uploads } = buildUpdate(platformDir);
  const served = await fetchServed({ runtime: info.runtimeVersion, channel: options.channel, server: SERVER });
  if (served.kind === "none" && !options.newRuntime) {
    fail(
      `no installed app runs runtime ${info.runtimeVersion} (the server has never served it). The phone's native side ` +
        "changed since the last APK (modules, native dependencies, app.json, icons, fonts or the Easy Connect bridge), and " +
        "an over-the-air update cannot carry native code. Release a new APK; publish this update with --new-runtime alongside it.",
    );
  }
  if (served.kind === "rollBackToEmbedded") console.log(`Runtime ${info.runtimeVersion} is rolled back to the code inside the APK; this update replaces the rollback.`);
  const body = JSON.stringify(manifest);
  const signature = sign(body, certificatePath(bundleDir));
  console.log(`Kiwimake ${info.version}, runtime ${info.runtimeVersion}, ${uploads.length} files, update ${manifest.id}`);
  for (const upload of uploads) {
    if (options.dryRun) continue;
    const head = await api("HEAD", `/v1/assets/${upload.hex}`, { auth: false, expect: [200, 404] });
    if (head.status === 200) continue;
    await api("PUT", `/v1/admin/assets/${upload.hex}`, { body: upload.bytes, headers: { "content-type": upload.contentType } });
  }
  await postRecord({
    channel: options.channel,
    runtime: info.runtimeVersion,
    record: { kind: "update", version: info.version, createdAt: manifest.createdAt, body, signature },
    dryRun: options.dryRun,
  });
}

function requireRuntime(options) {
  if (!options.runtime) fail("--runtime is required (node scripts/ota-runtime-version.js prints this checkout's)");
}

async function status(options) {
  const runtime = options.runtime ?? createRequire(import.meta.url)("./ota-runtime-version.js").otaRuntimeVersion();
  const served = await fetchServed({ runtime, channel: options.channel, server: SERVER });
  console.log(JSON.stringify({ server: SERVER, channel: options.channel, runtime, served }, null, 2));
}

async function rollbackToEmbedded(options) {
  requireRuntime(options);
  const createdAt = new Date().toISOString();
  const body = JSON.stringify({ type: "rollBackToEmbedded", parameters: { commitTime: createdAt } });
  await postRecord({
    channel: options.channel,
    runtime: options.runtime,
    record: { kind: "rollBackToEmbedded", version: null, createdAt, body, signature: sign(body, certificatePath()) },
    dryRun: options.dryRun,
  });
}

async function history(options) {
  requireRuntime(options);
  const response = await api("GET", `/v1/admin/updates/${options.channel}/${PLATFORM}/${encodeURIComponent(options.runtime)}/history`);
  for (const name of (await response.json()).history) console.log(name);
}

async function republish(options) {
  requireRuntime(options);
  if (!options.from) fail("--from <history-name> is required (see the history command)");
  const route = `/v1/admin/updates/${options.channel}/${PLATFORM}/${encodeURIComponent(options.runtime)}`;
  const old = await (await api("GET", `${route}/history/${options.from}`)).json();
  if (old.kind !== "update") fail(`${options.from} is a ${old.kind}, not an update`);
  const oldManifest = JSON.parse(old.body);
  if (unreachableAssetKeys(oldManifest).length > 0) fail(`${options.from} keys assets the app cannot find; publish a fresh export instead`);
  const manifest = { ...oldManifest, id: randomUUID(), createdAt: new Date().toISOString() };
  const body = JSON.stringify(manifest);
  await postRecord({
    channel: options.channel,
    runtime: options.runtime,
    record: { kind: "update", version: old.version, createdAt: manifest.createdAt, body, signature: sign(body, certificatePath()) },
    dryRun: options.dryRun,
  });
}

const { command, options } = parseArgs(process.argv.slice(2));
const commands = { publish, status, "rollback-to-embedded": rollbackToEmbedded, republish, history };
if (!commands[command]) {
  console.error(readFileSync(fileURLToPath(import.meta.url), "utf8").split("*/")[0]);
  process.exit(2);
}
await commands[command](options);
