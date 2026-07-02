import type { AppTheme } from '@obliance/shared';

export type { AppTheme };

const STORAGE_KEY = 'oa-theme';

/** Every theme id this app knows how to render. */
const KNOWN_THEMES = new Set<AppTheme>(['obli-operator', 'obli-daylight', 'modern', 'neon']);

/**
 * Apply a theme by setting data-theme on <html> and persisting it. Unknown
 * ids (e.g. a future theme Obligate adds and pushes via SSO before this app
 * ships support for it) fall back to obli-operator rather than poisoning
 * data-theme with a value that has no token block — which would leave the UI
 * inheriting the dark :root defaults on an unstyled surface.
 */
export function applyTheme(theme: string): void {
  const safe: AppTheme = KNOWN_THEMES.has(theme as AppTheme) ? (theme as AppTheme) : 'obli-operator';
  document.documentElement.dataset.theme = safe;
  try {
    localStorage.setItem(STORAGE_KEY, safe);
  } catch {
    // localStorage unavailable
  }
}

/** Load the theme from localStorage (used before session check to avoid flash). */
export function loadSavedTheme(): AppTheme {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && KNOWN_THEMES.has(saved as AppTheme)) return saved as AppTheme;
  } catch {
    // ignore
  }
  return 'obli-operator';
}

/** Called once on app boot in main.tsx to prevent flash of wrong theme. */
export function initTheme(): void {
  applyTheme(loadSavedTheme());
}
