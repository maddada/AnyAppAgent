// Persistent storage: JSON values in AsyncStorage that survive app restarts and updates.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState } from 'react';

export async function load<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw == null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export async function save<T>(key: string, value: T): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify(value));
}

export async function remove(key: string): Promise<void> {
  await AsyncStorage.removeItem(key);
}

/**
 * Like useState, but the value is saved on the phone and restored next time.
 * `loaded` is false until the saved value has been read.
 *
 *   const [todos, setTodos, loaded] = usePersistentState<Todo[]>('todos', []);
 */
export function usePersistentState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(initial);
  const [loaded, setLoaded] = useState(false);
  const initialRef = useRef(initial);

  useEffect(() => {
    let alive = true;
    load(key, initialRef.current).then((v) => {
      if (alive) {
        setValue(v);
        setLoaded(true);
      }
    });
    return () => {
      alive = false;
    };
  }, [key]);

  const update = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const v = typeof next === 'function' ? (next as (prev: T) => T)(prev) : next;
        save(key, v).catch(() => {});
        return v;
      });
    },
    [key],
  );

  return [value, update, loaded] as const;
}
