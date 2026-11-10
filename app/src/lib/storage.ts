import * as SecureStore from "expo-secure-store";

export interface Pairing {
  /** Same network: http://10.0.2.2:8787. Easy Connect: "" (the tunnel's local port changes). */
  baseUrl: string;
  token: string;
  serverName: string;
  /** How this phone reaches the PC. Missing means "lan" (pairings saved before Easy Connect). */
  via?: "lan" | "easy";
  /** Easy Connect: the tailcat address (a secret: never log or show it) and the companion's port. */
  easy?: { address: string; port: number };
}

export type ThemePref = "system" | "light" | "dark";

export interface Prefs {
  theme: ThemePref;
  /** appId -> newest build number already offered for install by itself (never offer twice). */
  offeredBuilds: Record<string, number>;
  askedNotifications: boolean; // Android gave a real answer (allowed, or "don't ask again")
  notificationAsks: number;
  /**
   * Downloads and installs that started but did not finish (AnyAppAgent was closed, replaced or
   * lost the PC). Retried once, by themselves, after AnyAppAgent starts again.
   */
  unfinishedInstalls: Record<string, { build: number; retried: boolean }>;
  /** The name this phone pairs under, chosen once and reused (the PC recognises it by name). */
  deviceName?: string;
  /**
   * Disconnects the PC has not heard about yet (same network, the PC was off or the network
   * dropped the request): sent again in the background until the PC answers.
   */
  pendingUnpairs?: { baseUrl: string; token: string }[];
}

const PAIRING_KEY = "anyapp.pairing";
const PREFS_KEY = "anyapp.prefs";

export const defaultPrefs: Prefs = { theme: "system", offeredBuilds: {}, askedNotifications: false, notificationAsks: 0, unfinishedInstalls: {} };

async function readJson<T>(key: string): Promise<T | null> {
  try {
    const raw = await SecureStore.getItemAsync(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

async function writeJson(key: string, value: unknown): Promise<void> {
  try {
    if (value == null) await SecureStore.deleteItemAsync(key);
    else await SecureStore.setItemAsync(key, JSON.stringify(value));
  } catch {
    // Storage is best effort; the app keeps working for this session.
  }
}

export const loadPairing = () => readJson<Pairing>(PAIRING_KEY);
export const savePairing = (p: Pairing | null) => writeJson(PAIRING_KEY, p);
export const loadPrefs = async (): Promise<Prefs> => ({ ...defaultPrefs, ...(await readJson<Partial<Prefs>>(PREFS_KEY)) });
export const savePrefs = (p: Prefs) => writeJson(PREFS_KEY, p);
