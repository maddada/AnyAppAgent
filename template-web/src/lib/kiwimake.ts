// The bridge Kiwimake adds when this app is opened inside Kiwimake on the phone. In a plain
// browser `window.kiwimake` is undefined: everything here then does nothing (or says so).
// Kiwimake may add it a moment after the app started: read it when you need it (never keep it from
// the start), and listen for the window event "kiwimake:ready", which it sends once it is there.

export interface KiwimakeBridge {
  version: 1;
  /** The PC's id for this app. */
  appId: string;
  ai: {
    status(): Promise<{ ready: boolean; reason?: string; provider?: string; model?: string }>;
    chat(request: object, onEvent: (event: object) => void): { cancel(): void };
  };
  /** Back to Kiwimake's home. */
  close(): void;
  /** "Change this app": opens this app's chat in Kiwimake. */
  openChat(): void;
}

declare global {
  interface Window {
    kiwimake?: KiwimakeBridge;
  }
}

/** The bridge, or null in a plain browser. */
export function kiwimake(): KiwimakeBridge | null {
  return typeof window !== 'undefined' && window.kiwimake?.version ? window.kiwimake : null;
}

/** True when the app runs inside Kiwimake. */
export function inKiwimake(): boolean {
  return kiwimake() !== null;
}

/** Opens this app's chat in Kiwimake, where the person asks for changes. False outside Kiwimake. */
export function openChangeChat(): boolean {
  const k = kiwimake();
  if (!k) return false;
  k.openChat();
  return true;
}

/** Goes back to Kiwimake's home. False outside Kiwimake. */
export function closeApp(): boolean {
  const k = kiwimake();
  if (!k) return false;
  k.close();
  return true;
}
