import { useEffect, useState } from 'react';

// useState backed by sessionStorage. Survives in-tab navigation (React Router
// route changes, history.back) but resets on tab close / new tab — exactly
// the shape needed for "restore filters when I navigate back from a device
// detail" without polluting state across browser sessions.
//
// usePersistedState already exists but uses localStorage, which would carry
// the user's last search across days and tabs — too sticky for filter state.
//
// Sets serialise as `{ __set: [...] }` so a `new Set()` round-trips
// correctly; everything else goes through plain JSON.stringify.

type Initial<T> = T | (() => T);

function serialise<T>(value: T): unknown {
  if (value instanceof Set) return { __set: Array.from(value) };
  return value;
}

function deserialise<T>(raw: unknown): T {
  if (raw && typeof raw === 'object' && '__set' in (raw as Record<string, unknown>)) {
    return new Set((raw as { __set: unknown[] }).__set) as unknown as T;
  }
  return raw as T;
}

function readInitial<T>(initial: Initial<T>): T {
  return typeof initial === 'function' ? (initial as () => T)() : initial;
}

export function useSessionState<T>(key: string, initial: Initial<T>): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = sessionStorage.getItem(key);
      if (raw !== null) return deserialise<T>(JSON.parse(raw));
    } catch { /* corrupt entry — fall through to initial */ }
    return readInitial(initial);
  });
  useEffect(() => {
    try { sessionStorage.setItem(key, JSON.stringify(serialise(value))); } catch { /* quota or disabled */ }
  }, [key, value]);
  return [value, setValue];
}
