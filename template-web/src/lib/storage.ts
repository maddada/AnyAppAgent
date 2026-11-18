// Persistent storage: JSON values that survive closing the app and new versions.
//
// All of a person's web apps share one web address (<login>.github.io), so they share one
// localStorage and one set of IndexedDB databases. Every name here starts with this app's slug,
// so apps never read or wipe each other's data. Always use this file: never localStorage,
// sessionStorage, indexedDB or caches directly, and never localStorage.clear().
import { useCallback, useEffect, useState } from 'react';

import { APP_SLUG } from './app';

const PREFIX = `${APP_SLUG}:`;
const CHANGED = 'kiwi-storage-changed';

/** The real localStorage key for one of this app's keys. */
export function storageKey(key: string): string {
  return PREFIX + key;
}

function store(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null; // storage switched off in the browser
  }
}

/** The saved value, or `fallback` when there is none (or it cannot be read). */
export function load<T>(key: string, fallback: T): T {
  try {
    const raw = store()?.getItem(storageKey(key));
    return raw == null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

/** Saves a JSON value. Throws when the browser's storage is full (keep values small). */
export function save<T>(key: string, value: T): void {
  store()?.setItem(storageKey(key), JSON.stringify(value));
  window.dispatchEvent(new CustomEvent(CHANGED, { detail: key }));
}

export function remove(key: string): void {
  store()?.removeItem(storageKey(key));
  window.dispatchEvent(new CustomEvent(CHANGED, { detail: key }));
}

/** This app's keys (without the prefix). */
export function keys(): string[] {
  const s = store();
  if (!s) return [];
  const out: string[] = [];
  for (let i = 0; i < s.length; i++) {
    const k = s.key(i);
    if (k?.startsWith(PREFIX)) out.push(k.slice(PREFIX.length));
  }
  return out;
}

/** Removes everything this app saved in localStorage (and nothing of the person's other apps). */
export function clear(): void {
  for (const k of keys()) store()?.removeItem(storageKey(k));
  window.dispatchEvent(new CustomEvent(CHANGED, { detail: null }));
}

/**
 * Like useState, but the value is saved and restored next time. Every component using the same
 * key sees the same value. `loaded` is always true (kept so code reads like the Android apps).
 *
 *   const [todos, setTodos] = usePersistentState<Todo[]>('todos', []);
 */
export function usePersistentState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => load(key, initial));

  useEffect(() => {
    setValue(load(key, initial));
    const onChange = (e: Event) => {
      const changed = (e as CustomEvent<string | null>).detail;
      if (changed === null || changed === key) setValue(load(key, initial));
    };
    // Another tab of this app saved: storage events carry the full key.
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === storageKey(key)) setValue(load(key, initial));
    };
    window.addEventListener(CHANGED, onChange);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(CHANGED, onChange);
      window.removeEventListener('storage', onStorage);
    };
    // `initial` is only the fallback; a new array literal each render must not reload.
  }, [key]);

  const update = useCallback(
    (next: T | ((prev: T) => T)) => {
      const prev = load(key, value);
      const v = typeof next === 'function' ? (next as (prev: T) => T)(prev) : next;
      setValue(v);
      try {
        save(key, v);
      } catch {
        // storage full or switched off: the value still lives until the app is closed
      }
    },
    [key, value],
  );

  return [value, update, true] as const;
}

// ---------- IndexedDB (for big or many records: photos, long lists) ----------

/** The real IndexedDB name for one of this app's databases. */
export function dbName(name: string): string {
  return PREFIX + name;
}

/**
 * Opens (or creates) one of this app's IndexedDB databases. `upgrade` runs when the database is
 * new or `version` went up: create object stores there.
 *
 *   const db = await openDatabase('photos', 1, (db) => db.createObjectStore('photos', { keyPath: 'id' }));
 */
export function openDatabase(
  name: string,
  version: number,
  upgrade: (db: IDBDatabase, oldVersion: number, tx: IDBTransaction) => void,
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName(name), version);
    req.onupgradeneeded = (e) => upgrade(req.result, e.oldVersion, req.transaction!);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Could not open the database.'));
    req.onblocked = () => reject(new Error('The database is open in another tab. Close it and try again.'));
  });
}

/** Deletes one of this app's IndexedDB databases. */
export function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(dbName(name));
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error('Could not delete the database.'));
  });
}

/** Runs one request in a transaction and resolves with its result. */
export function dbRequest<T>(
  db: IDBDatabase,
  storeName: string,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = run(db.transaction(storeName, mode).objectStore(storeName));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('The database request failed.'));
  });
}
