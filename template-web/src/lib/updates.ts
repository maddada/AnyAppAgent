// New versions: every build Kiwimake makes goes online at once. This file notices that a newer
// version is online (version.json, written by the builder) and switches to it on Reload.
// <WebReady /> shows the "Version N is ready" card. Leave this file as it is.
import { useCallback, useEffect, useState } from 'react';

import { APP_BUILD } from './app';

export type NewVersion = { build: number; changed?: string };

const EVERY = 5 * 60_000;

/** Registers the service worker (offline use and Add to home screen). Only over https or on localhost. */
export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator) || !window.isSecureContext || APP_BUILD === 0) return;
  navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {
    // no offline support this time; the app works the same online
  });
}

/** The newest version online, or null when it is not newer than the running one (or offline). */
export async function checkForUpdate(): Promise<NewVersion | null> {
  try {
    const res = await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const v = (await res.json()) as { build?: unknown; changed?: unknown };
    const build = Number(v.build);
    if (!Number.isInteger(build) || build <= APP_BUILD) return null;
    const changed = typeof v.changed === 'string' && v.changed.trim() ? v.changed.trim() : undefined;
    return { build, changed };
  } catch {
    return null;
  }
}

/**
 * Checks on start, when the app comes back to the front, every 5 minutes, and when Kiwimake says
 * a new version is out (the `kiwimake:check-update` event).
 */
export function useNewVersion(): NewVersion | null {
  const [next, setNext] = useState<NewVersion | null>(null);
  const check = useCallback(() => {
    checkForUpdate().then((v) => v && setNext((old) => (old && old.build >= v.build && old.changed === v.changed ? old : v)));
  }, []);
  useEffect(() => {
    if (APP_BUILD === 0) return; // built outside Kiwimake: there is no version.json
    check();
    const onVisible = () => document.visibilityState === 'visible' && check();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('kiwimake:check-update', check);
    const timer = window.setInterval(check, EVERY);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('kiwimake:check-update', check);
      window.clearInterval(timer);
    };
  }, [check]);
  return next;
}

/**
 * Starts the newest version: with a service worker, fetch it, let the new worker take over, then
 * reload; without one, a plain reload.
 */
export async function reloadToNewVersion(): Promise<void> {
  const sw = 'serviceWorker' in navigator ? navigator.serviceWorker : null;
  const reg = sw?.controller ? await sw.getRegistration().catch(() => undefined) : undefined;
  if (!sw || !reg) {
    location.reload();
    return;
  }
  let reloading = false;
  const reload = () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  };
  sw.addEventListener('controllerchange', reload);
  // Whatever happens, the person gets the new version within a few seconds.
  window.setTimeout(reload, 10_000);
  try {
    await reg.update();
  } catch {
    reload();
    return;
  }
  const worker = await installedWorker(reg);
  if (!worker) {
    reload();
    return;
  }
  worker.postMessage({ type: 'skipWaiting' });
}

/** The new worker once it is installed (waiting), or null when there is none. */
function installedWorker(reg: ServiceWorkerRegistration): Promise<ServiceWorker | null> {
  if (reg.waiting) return Promise.resolve(reg.waiting);
  const w = reg.installing;
  if (!w) return Promise.resolve(null);
  return new Promise((resolve) => {
    const onState = () => {
      if (w.state === 'installed') {
        w.removeEventListener('statechange', onState);
        resolve(reg.waiting ?? w);
      } else if (w.state === 'redundant') {
        w.removeEventListener('statechange', onState);
        resolve(null);
      }
    };
    w.addEventListener('statechange', onState);
  });
}
