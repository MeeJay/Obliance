import { useState, useCallback } from 'react';

/**
 * A useState variant backed by localStorage. Reads the initial value from
 * storage (falling back to `initial` on miss or parse error) and writes
 * back on every change. Safe to call with the same key from multiple
 * components — each instance keeps its own in-memory copy, but persists
 * to the same slot.
 */
export function usePersistedState<T>(key: string, initial: T): [T, (v: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key);
      return stored !== null ? (JSON.parse(stored) as T) : initial;
    } catch {
      return initial;
    }
  });
  const set = useCallback((v: T | ((prev: T) => T)) => {
    setValue((prev) => {
      const next = typeof v === 'function' ? (v as (p: T) => T)(prev) : v;
      try { localStorage.setItem(key, JSON.stringify(next)); } catch {}
      return next;
    });
  }, [key]);
  return [value, set];
}
