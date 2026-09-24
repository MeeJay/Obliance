import { useCallback, useSyncExternalStore } from 'react';

/**
 * Media-query hooks — docs/obli-mobile.md §4 / §8.
 *
 * One shared MediaQueryList per query string, so hundreds of components
 * calling useMediaQuery('(pointer: coarse)') cost a single listener.
 * SSR-safe: without `window.matchMedia` every query reports `false`.
 */

/** Default Tailwind breakpoints (px) the layout modes are based on. */
export const BREAKPOINTS = { sm: 640, md: 768, lg: 1024, xl: 1280 } as const;

/** Media queries matching the Tailwind variants of tailwind.config.ts. */
export const MEDIA = {
  sm: `(min-width: ${BREAKPOINTS.sm}px)`,
  md: `(min-width: ${BREAKPOINTS.md}px)`,
  lg: `(min-width: ${BREAKPOINTS.lg}px)`,
  xl: `(min-width: ${BREAKPOINTS.xl}px)`,
  coarse: '(pointer: coarse)',
  canHover: '(hover: hover) and (pointer: fine)',
} as const;

export type LayoutMode = 'phone' | 'tablet' | 'desktop';

interface Entry {
  mql: MediaQueryList;
  listeners: Set<() => void>;
  onChange: () => void;
}

const entries = new Map<string, Entry>();

function getEntry(query: string): Entry | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  let entry = entries.get(query);
  if (!entry) {
    const mql = window.matchMedia(query);
    const listeners = new Set<() => void>();
    const onChange = () => listeners.forEach((l) => l());
    entry = { mql, listeners, onChange };
    entries.set(query, entry);
  }
  return entry;
}

function subscribe(query: string, cb: () => void): () => void {
  const entry = getEntry(query);
  if (!entry) return () => {};
  if (entry.listeners.size === 0) {
    // Safari < 14 only has the deprecated addListener API.
    if (typeof entry.mql.addEventListener === 'function') entry.mql.addEventListener('change', entry.onChange);
    else entry.mql.addListener(entry.onChange);
  }
  entry.listeners.add(cb);
  return () => {
    entry.listeners.delete(cb);
    if (entry.listeners.size === 0) {
      if (typeof entry.mql.removeEventListener === 'function') entry.mql.removeEventListener('change', entry.onChange);
      else entry.mql.removeListener(entry.onChange);
    }
  };
}

/** Non-reactive read of a media query (false when matchMedia is unavailable). */
export function matchesMedia(query: string): boolean {
  return getEntry(query)?.mql.matches ?? false;
}

const getServerSnapshot = () => false;

/** Reactive `matchMedia(query).matches`. */
export function useMediaQuery(query: string): boolean {
  // Stable per query: an inline subscribe function would make
  // useSyncExternalStore unsubscribe + resubscribe on every render.
  const subscribeQuery = useCallback((cb: () => void) => subscribe(query, cb), [query]);
  const getSnapshot = useCallback(() => matchesMedia(query), [query]);
  return useSyncExternalStore(subscribeQuery, getSnapshot, getServerSnapshot);
}

/** Non-reactive layout mode: phone < 768 ≤ tablet < 1024 ≤ desktop. */
export function getLayoutMode(): LayoutMode {
  if (matchesMedia(MEDIA.lg)) return 'desktop';
  if (matchesMedia(MEDIA.md)) return 'tablet';
  // Without matchMedia (SSR / tests) assume desktop: the app's historic layout.
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'desktop';
  return 'phone';
}

/** 'phone' (< 768px) | 'tablet' (768–1023px) | 'desktop' (≥ 1024px) — docs §4. */
export function useLayoutMode(): LayoutMode {
  const isLg = useMediaQuery(MEDIA.lg);
  const isMd = useMediaQuery(MEDIA.md);
  const hasMatchMedia = typeof window !== 'undefined' && typeof window.matchMedia === 'function';
  if (!hasMatchMedia || isLg) return 'desktop';
  return isMd ? 'tablet' : 'phone';
}

/** True on touch-first devices (`(pointer: coarse)`, same as the `coarse:` variant). */
export function useIsCoarsePointer(): boolean {
  return useMediaQuery(MEDIA.coarse);
}

/** True with a real hovering pointer (same as the `can-hover:` variant). */
export function useCanHover(): boolean {
  return useMediaQuery(MEDIA.canHover);
}
