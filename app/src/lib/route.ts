import { AnyAppNative } from "anyapp-native";
import { health } from "./api";
import type { Pairing } from "./storage";

/**
 * How the phone reaches its PC right now: the saved same-network URL, or an Easy Connect tunnel
 * (docs/EASY-CONNECT.md 4.3 and 4.4). Dialing is copied from Ghostex's phone app:
 * - one dial at a time; callers that arrive meanwhile join it (Ghostex `ensureConnected`);
 * - `reset` stops the old forward first, so a stalled tunnel is not probed for 4 s
 *   (Ghostex `redialAfterServerStop`, `recoverMachine` after a stalled probe);
 * - after a (re)built tunnel, `GET /api/health` (5 s) is polled every 1.5 s, three times, before
 *   the tunnel is trusted: a request right after the PC's helper restarts can hang on the old
 *   tunnel (Ghostex `boxLink.ts`).
 * The tunnel's local port changes on every start: never keep it across app starts.
 */

export class RouteError extends Error {}

let dialing: Promise<string> | null = null;
let revision = 0;

export function usesEasyConnect(pairing: Pairing | null): pairing is Pairing & { easy: { address: string; port: number } } {
  return !!pairing && pairing.via === "easy" && !!pairing.easy;
}

export function routeBaseUrl(pairing: Pairing, options: { reset?: boolean } = {}): Promise<string> {
  if (!usesEasyConnect(pairing)) return Promise.resolve(pairing.baseUrl);
  if (dialing && !options.reset) return dialing;
  const mine = ++revision;
  const attempt = dialEasyConnect(pairing.easy.address, pairing.easy.port, !!options.reset);
  dialing = attempt;
  void attempt.catch(() => undefined).finally(() => {
    if (revision === mine) dialing = null;
  });
  return attempt;
}

/** Opens (or reuses) the tunnel and returns http://127.0.0.1:<localPort> once the PC answers. */
export async function dialEasyConnect(address: string, port: number, reset: boolean): Promise<string> {
  if (!AnyAppNative) throw new RouteError("Easy Connect needs the AnyAppAgent app, not a preview.");
  const started = Date.now();
  const took = () => `${((Date.now() - started) / 1000).toFixed(1)} s`;
  if (reset) await AnyAppNative.easyConnectStop().catch(() => undefined);
  let localPort: number;
  try {
    ({ localPort } = await AnyAppNative.easyConnectStart(address, port));
  } catch (e) {
    console.log(`link: Easy Connect could not reach the PC (${took()})`);
    throw new RouteError(e instanceof Error ? scrub(e.message) : "tailcat: cannot reach paired machine");
  }
  console.log(`link: Easy Connect tunnel ready in ${took()}`);
  const base = `http://127.0.0.1:${localPort}`;
  for (let i = 0; i < 4; i++) {
    try {
      await health(base, 3000);
      console.log(`link: the PC answers through Easy Connect (${took()})`);
      return base;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  // The tunnel is up but the PC does not answer through it: drop it so the next dial rebuilds.
  await AnyAppNative.easyConnectStop().catch(() => undefined);
  throw new RouteError("The PC did not answer through Easy Connect.");
}

/** Error texts from the bridge can carry the tc... address: never let it reach logs or the screen. */
export function scrub(message: string): string {
  return message.replace(/tc[A-Za-z0-9_-]{20,}/g, "[address]").slice(0, 400);
}
