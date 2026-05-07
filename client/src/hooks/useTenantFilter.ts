import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * Persistent tenant filter for master/god view list pages.
 *
 * Reads/writes to the URL querystring (`?tenants=1,2,3`) so the
 * selection survives page reloads, deep-links, and back-button
 * navigation — admins regularly bookmark "audit log filtered to
 * tenant Pimkie" or paste links to colleagues.
 *
 * Returns the same shape as a useState pair plus an array form
 * already de-duped, ready to pass to API calls (`tenantIds: ids.length
 * > 0 ? ids : undefined`).
 *
 * The `paramName` defaults to `tenants` but can be overridden when a
 * page already uses that key for something else (rare).
 */
export function useTenantFilter(paramName = 'tenants'): {
  value: Set<number>;
  setValue: (next: Set<number>) => void;
  ids: number[];
  isEmpty: boolean;
} {
  const [searchParams, setSearchParams] = useSearchParams();

  // Initialise from the URL on mount. Subsequent changes via setValue
  // also push back to the URL so the two are kept in sync.
  const [value, setValueState] = useState<Set<number>>(() => parseFromQuery(searchParams.get(paramName)));

  // React to the URL changing externally (back button, manual edit).
  useEffect(() => {
    const next = parseFromQuery(searchParams.get(paramName));
    setValueState((prev) => (sameSet(prev, next) ? prev : next));
  }, [searchParams, paramName]);

  const setValue = useCallback((next: Set<number>) => {
    setValueState(next);
    setSearchParams(
      (prev) => {
        const sp = new URLSearchParams(prev);
        if (next.size === 0) sp.delete(paramName);
        else sp.set(paramName, [...next].sort((a, b) => a - b).join(','));
        return sp;
      },
      { replace: true },
    );
  }, [paramName, setSearchParams]);

  const ids = [...value];
  return { value, setValue, ids, isEmpty: value.size === 0 };
}

function parseFromQuery(raw: string | null): Set<number> {
  if (!raw) return new Set();
  const out = new Set<number>();
  for (const v of raw.split(',')) {
    const n = parseInt(v.trim(), 10);
    if (Number.isFinite(n) && n > 0) out.add(n);
  }
  return out;
}

function sameSet(a: Set<number>, b: Set<number>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}
