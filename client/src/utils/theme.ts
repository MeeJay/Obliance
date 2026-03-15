import type { AppTheme } from '@obliance/shared';

export type { AppTheme };

const STORAGE_KEY = 'oa-theme';

/** Apply a theme by setting data-theme on <html> and persisting it. */
export function applyTheme(theme: AppTheme): void {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // localStorage unavailable
  }
}

/** Load the theme from localStorage (used before session check to avoid flash). */
export function loadSavedTheme(): AppTheme {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'modern' || saved === 'neon') return saved;
  } catch {
    // ignore
  }
  return 'modern';
}

/** Called once on app boot in main.tsx to prevent flash of wrong theme. */
export function initTheme(): void {
  applyTheme(loadSavedTheme());
}
