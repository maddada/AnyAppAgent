import * as SecureStore from "expo-secure-store";

export interface Pairing {
  baseUrl: string; // http://10.0.2.2:8787
  token: string;
  serverName: string;
}

export type ThemePref = "system" | "light" | "dark";

export interface Prefs {
  theme: ThemePref;
  /** appId -> newest build number already offered for install by itself (never offer twice). */
  offeredBuilds: Record<string, number>;
  askedNotifications: boolean; // Android gave a real answer (allowed, or "don't ask again")
  notificationAsks: number;
}

const PAIRING_KEY = "anyapp.pairing";
const PREFS_KEY = "anyapp.prefs";

export const defaultPrefs: Prefs = { theme: "system", offeredBuilds: {}, askedNotifications: false, notificationAsks: 0 };

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
