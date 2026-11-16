// Over-the-air updates of Kiwimake's own JavaScript (expo-updates), from Kiwimake's update server
// (website/ota-server, ota.kiwimake.ai). Copied from Ghostex's src/updates/overTheAir.ts (read only,
// never imported).
//
// expo-updates checks at every launch and downloads in the background; the update runs from the
// next launch, or at once when the person taps Restart (Settings, or the notice on the home
// screen). A phone keeps Kiwimake alive for days, so initOverTheAirUpdates also checks when it comes
// back to the front, at most every CHECK_INTERVAL_MS. Release builds turn updates on (app.config.js);
// debug builds and Metro leave OTA_ENABLED false and everything here does nothing.
//
// An update only reaches an APK with the same runtime version (scripts/ota-runtime-version.js), so
// new native code still needs a new APK (src/lib/appUpdate.ts installs it). expo-updates also keeps
// phones safe on its own: an update that crashes before its first screen is rolled back to the one
// before, and the server can tell every phone to go back to the code inside the APK
// (scripts/ota-publish.mjs rollback-to-embedded).
import Constants from "expo-constants";
import * as Updates from "expo-updates";
import { useUpdates } from "expo-updates";
import { AppState, type AppStateStatus } from "react-native";

export const OTA_ENABLED = Updates.isEnabled;

const CHECK_INTERVAL_MS = 30 * 60 * 1000;

/** `https://ota.kiwimake.ai/v1/manifest/production` -> that server's status URL for `runtime`. */
function statusUrl(runtimeVersion: string): string | null {
  const manifestUrl = Constants.expoConfig?.updates?.url;
  const match = manifestUrl === undefined ? null : /^(.*)\/v1\/manifest\/([^/]+)$/u.exec(manifestUrl);
  if (match === null) return null;
  return `${match[1]}/v1/status/${match[2]}/android/${encodeURIComponent(runtimeVersion)}`;
}

let lastCheckAt = Date.now();

/** What one over-the-air check found. */
export type OverTheAirCheckOutcome = { kind: "off" } | { kind: "none" } | { kind: "downloaded" } | { kind: "rollback" } | { kind: "error"; message: string };

let checkInFlight: Promise<OverTheAirCheckOutcome> | null = null;

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === "string" ? message : String(error);
}

/** Asks the server for an update and downloads it when there is one. */
export function checkForOverTheAirUpdate(): Promise<OverTheAirCheckOutcome> {
  if (!OTA_ENABLED) return Promise.resolve({ kind: "off" });
  if (checkInFlight !== null) return checkInFlight;
  lastCheckAt = Date.now();
  checkInFlight = (async (): Promise<OverTheAirCheckOutcome> => {
    try {
      const result = await Updates.checkForUpdateAsync();
      if (result.isRollBackToEmbedded) {
        await Updates.fetchUpdateAsync();
        return { kind: "rollback" };
      }
      if (!result.isAvailable) return { kind: "none" };
      await Updates.fetchUpdateAsync();
      return { kind: "downloaded" };
    } catch (error) {
      return { kind: "error", message: errorText(error) };
    } finally {
      checkInFlight = null;
    }
  })();
  return checkInFlight;
}

/** Runs the downloaded update now. */
export function restartToApplyUpdate(): Promise<void> {
  return Updates.reloadAsync();
}

let installed = false;

/** Checks when Kiwimake comes back to the front, on top of expo-updates' own check at launch. */
export function initOverTheAirUpdates(): void {
  if (!OTA_ENABLED || installed) return;
  installed = true;
  AppState.addEventListener("change", (status: AppStateStatus) => {
    if (status === "active" && Date.now() - lastCheckAt >= CHECK_INTERVAL_MS) void checkForOverTheAirUpdate();
  });
}

/**
 * The release the update server gives this APK over the air (it keeps the newest one per runtime
 * version), or null when it gives none. A newer release at or below it needs no new APK: its
 * JavaScript arrives over the air.
 */
export async function overTheAirReleaseVersion(): Promise<string | null> {
  const runtimeVersion = Updates.runtimeVersion;
  if (!OTA_ENABLED || runtimeVersion === null) return null;
  const url = statusUrl(runtimeVersion);
  if (url === null) return null;
  let response: Response;
  try {
    response = await fetch(url, { headers: { Accept: "application/json" } });
  } catch {
    return null; // the APK check still works without it
  }
  if (!response.ok) return null;
  const body = (await response.json()) as { version?: unknown };
  return typeof body.version === "string" ? body.version : null;
}

/** What an update says about itself (`extra.kiwimake`, written by scripts/ota-publish.mjs). */
export type UpdateDetails = { id: string | null; createdAt: Date | null; version: string | null; commit: string | null; whatsNew: string[] };

function updateDetails(manifest: Partial<Updates.Manifest> | undefined, id: string | undefined | null, createdAt: Date | undefined | null): UpdateDetails {
  const extra = (manifest as { extra?: { kiwimake?: Record<string, unknown>; expoClient?: { version?: unknown } } } | undefined)?.extra;
  const own = extra?.kiwimake ?? {};
  const whatsNew = Array.isArray(own.whatsNew) ? own.whatsNew.filter((line): line is string => typeof line === "string" && line.length > 0) : [];
  const version = typeof own.version === "string" ? own.version : typeof extra?.expoClient?.version === "string" ? extra.expoClient.version : null;
  return {
    id: id ?? null,
    createdAt: createdAt instanceof Date && !Number.isNaN(createdAt.getTime()) ? createdAt : null,
    version,
    commit: typeof own.commit === "string" ? own.commit : null,
    whatsNew,
  };
}

/** The JavaScript running now: the APK's own (`builtIn`), or a downloaded update and what it carries. */
export function useRunningUpdate(): { builtIn: boolean; details: UpdateDetails } {
  const { currentlyRunning } = useUpdates();
  return {
    builtIn: currentlyRunning.isEmbeddedLaunch,
    details: updateDetails(currentlyRunning.manifest, currentlyRunning.updateId, currentlyRunning.createdAt),
  };
}

/** A downloaded update waiting for a restart, with what it carries, or null. */
export function useDownloadedUpdate(): UpdateDetails | null {
  const { isUpdatePending, downloadedUpdate } = useUpdates();
  if (!isUpdatePending) return null;
  return updateDetails(downloadedUpdate?.manifest, downloadedUpdate?.updateId, downloadedUpdate?.createdAt);
}

