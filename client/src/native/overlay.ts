/**
 * Shared overlay plumbing for components/common/{Modal,Drawer,ActionMenu,Tip}:
 * reference-counted body scroll lock, focus trap and viewport-clamped popover
 * positioning. Internal to the primitives — pages should not need it.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

// ── Body scroll lock (ref-counted so stacked overlays don't fight) ───────────

let lockCount = 0;
let savedOverflow = '';

export function lockBodyScroll(): () => void {
  if (typeof document === 'undefined') return () => {};
  if (lockCount === 0) {
    savedOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  lockCount++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    lockCount = Math.max(0, lockCount - 1);
    if (lockCount === 0) document.body.style.overflow = savedOverflow;
  };
}

export function useBodyScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    return lockBodyScroll();
  }, [active]);
}

// ── Focus management ─────────────────────────────────────────────────────────

const FOCUSABLE = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(',');

function focusableIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.hasAttribute('inert') && (el.offsetParent !== null || el === document.activeElement),
  );
}

/**
 * While `active`: moves focus into `ref` (unless something inside already has
 * it, e.g. an autoFocus input), keeps Tab / Shift+Tab inside it, and restores
 * focus to the previously focused element on deactivation.
 */
export function useFocusTrap(ref: RefObject<HTMLElement>, active: boolean): void {
  const restoreRef = useRef<HTMLElement | null>(null);
  const wasActive = useRef(false);
  // Capture the previously focused element during the render that activates
  // the trap — before React commits (and runs autoFocus inside the overlay).
  if (active && !wasActive.current && typeof document !== 'undefined') {
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }
  wasActive.current = active;
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    if (!active) return;
    const root = ref.current;
    if (!root) return;
    if (!root.contains(document.activeElement)) {
      root.focus({ preventScroll: true });
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const current = ref.current;
      if (!current) return;
      const items = focusableIn(current);
      if (items.length === 0) {
        e.preventDefault();
        current.focus({ preventScroll: true });
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const activeEl = document.activeElement;
      if (e.shiftKey && (activeEl === first || activeEl === current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && activeEl === last) {
        e.preventDefault();
        first.focus();
      } else if (!current.contains(activeEl)) {
        e.preventDefault();
        first.focus();
      }
    };
    root.addEventListener('keydown', onKeyDown);

    return () => {
      root.removeEventListener('keydown', onKeyDown);
      // Deferred: runs after the overlay's DOM is gone. Skipped when the trap
      // is still active and mounted (StrictMode's simulated unmount/remount).
      setTimeout(() => {
        if (root.isConnected && activeRef.current) return;
        const prev = restoreRef.current;
        restoreRef.current = null;
        // Don't steal focus if something else already took it (e.g. the
        // action that closed the overlay focused an input).
        const cur = document.activeElement;
        if (cur && cur !== document.body && cur !== document.documentElement && !root.contains(cur)) return;
        if (prev && prev.isConnected && typeof prev.focus === 'function') {
          try { prev.focus({ preventScroll: true }); } catch { /* ignore */ }
        }
      }, 0);
    };
  }, [active, ref]);
}

// ── Anchored popover positioning ─────────────────────────────────────────────

export interface PopoverPosition {
  top: number;
  left: number;
  maxHeight: number;
  placement: 'top' | 'bottom';
}

export interface PopoverPositionOptions {
  /** Preferred side (flips when the other side has more room). Default 'bottom'. */
  placement?: 'top' | 'bottom';
  /** Horizontal alignment with the anchor. Default 'end' (right edges aligned). */
  align?: 'start' | 'center' | 'end';
  /** Gap between anchor and popover (px). Default 6. */
  offset?: number;
  /** Minimum distance to the viewport edges (px). Default 8. */
  margin?: number;
}

/** Pure computation: place `pop` (w×h) next to `anchor`, flipped / clamped inside the viewport. */
export function computePopoverPosition(
  anchor: DOMRect,
  popWidth: number,
  popHeight: number,
  opts: PopoverPositionOptions = {},
): PopoverPosition {
  const { placement = 'bottom', align = 'end', offset = 6, margin = 8 } = opts;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const spaceBelow = vh - anchor.bottom - offset - margin;
  const spaceAbove = anchor.top - offset - margin;
  let side: 'top' | 'bottom' = placement;
  if (side === 'bottom' && popHeight > spaceBelow && spaceAbove > spaceBelow) side = 'top';
  else if (side === 'top' && popHeight > spaceAbove && spaceBelow > spaceAbove) side = 'bottom';

  const maxHeight = Math.max(80, side === 'bottom' ? spaceBelow : spaceAbove);
  const h = Math.min(popHeight, maxHeight);
  const top = side === 'bottom' ? anchor.bottom + offset : anchor.top - offset - h;

  let left: number;
  if (align === 'start') left = anchor.left;
  else if (align === 'center') left = anchor.left + anchor.width / 2 - popWidth / 2;
  else left = anchor.right - popWidth;
  left = Math.min(Math.max(margin, left), Math.max(margin, vw - margin - popWidth));

  return { top: Math.max(margin, top), left, maxHeight, placement: side };
}

/**
 * Keeps a `position: fixed` popover glued to its anchor while `open`
 * (recomputes on scroll in any ancestor, resize and popover size changes).
 * Returns null until the first measurement — render the popover with
 * `visibility: hidden` until then.
 */
export function useAnchoredPosition(
  anchorRef: RefObject<HTMLElement>,
  popRef: RefObject<HTMLElement>,
  open: boolean,
  opts: PopoverPositionOptions = {},
): PopoverPosition | null {
  const [pos, setPos] = useState<PopoverPosition | null>(null);
  const { placement, align, offset, margin } = opts;

  const update = useCallback(() => {
    const anchor = anchorRef.current;
    const pop = popRef.current;
    if (!anchor || !pop) return;
    const next = computePopoverPosition(
      anchor.getBoundingClientRect(),
      pop.offsetWidth,
      pop.scrollHeight,
      { placement, align, offset, margin },
    );
    setPos((prev) =>
      prev &&
      prev.top === next.top &&
      prev.left === next.left &&
      prev.maxHeight === next.maxHeight &&
      prev.placement === next.placement
        ? prev
        : next,
    );
  }, [anchorRef, popRef, placement, align, offset, margin]);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    update();
    let raf = 0;
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(update);
    };
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null;
    if (ro && popRef.current) ro.observe(popRef.current);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
      ro?.disconnect();
    };
  }, [open, update, popRef]);

  return pos;
}
