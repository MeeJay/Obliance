import type { ReactNode } from 'react';
import { useNativeTopOffset } from '@/hooks/useNativeTopOffset';

/** `100dvh` where supported, `100vh` on older WebViews (< 108) — an inline
 *  style cannot carry a CSS fallback declaration. */
const FULL_HEIGHT =
  typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('height', '100dvh')
    ? '100dvh'
    : '100vh';

/**
 * Bottom-right dock for the app-wide floating widgets (live-alert toasts,
 * chat FAB / panel, remote-shell pill) — docs/obli-mobile.md §4.
 *
 * The widgets are stacked in normal flow (top → bottom: toasts, chat, shell
 * pill) instead of each being `position: fixed` at the same corner, so they
 * never cover each other. The dock keeps the historic 16 px corner offset on
 * desktop, adds the safe-area insets (gesture bar / notch) on phones, and
 * spans the full width below `md` so toasts can go edge to edge.
 *
 * The dock itself ignores pointer events (the page under its padding stays
 * clickable); every child opts back in with `pointer-events-auto`. Children
 * that switch to a full-screen `fixed` layer (open shell panel, phone chat)
 * still position against the viewport — the dock has no transform.
 *
 * When the children do not fit (short window, phone in landscape with the
 * soft keyboard open) the shrinkable items give way first (toasts are
 * `min-h-0` + flex-shrink 100), and `justify-end` makes any remaining
 * overflow spill out at the TOP: the bottom-most item — the chat panel with
 * its input, the shell pill — stays on screen right above the keyboard.
 * When everything fits (the normal desktop case) justify-content has no
 * effect: the dock is exactly as tall as its content.
 *
 * Z order inside the dock (it is one stacking context at z-[60]):
 *   chat z-[2] > open shell panel z-[1] (later in DOM) > toasts z-[1].
 */
export function FloatingDock({ children }: { children: ReactNode }) {
  const nativeTop = useNativeTopOffset();
  return (
    <div
      className={[
        'pointer-events-none fixed bottom-0 right-0 z-[60] flex flex-col items-end justify-end gap-3',
        'pb-[calc(1rem+var(--safe-bottom))] pr-[max(1rem,var(--safe-right))]',
        'max-md:left-0 max-md:pb-[calc(0.75rem+var(--safe-bottom))]',
        'max-md:pl-[max(0.75rem,var(--safe-left))] max-md:pr-[max(0.75rem,var(--safe-right))]',
      ].join(' ')}
      // Never taller than the space under the header: children shrink
      // (toasts first) instead of sliding under the topbar.
      style={{ maxHeight: `calc(${FULL_HEIGHT} - ${nativeTop + 68}px - var(--safe-top))` }}
    >
      {children}
    </div>
  );
}
