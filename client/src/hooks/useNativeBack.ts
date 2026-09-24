import { useEffect, useRef } from 'react';
import { registerBackHandler, type BackHandler } from '@/native/bridge';

export interface UseNativeBackOptions {
  /**
   * Also receive the Escape key (handler gets `source === 'escape'`). Escape
   * only visits Escape-enabled entries, top-most first, so stacked overlays
   * close one at a time. Modal, Drawer, ConfirmDialog, ActionMenu and Tip use
   * it; default false (page-level handlers should not react to Escape).
   */
  escape?: boolean;
}

/**
 * Register `handler` for the Android back button while `active` is true
 * (docs/obli-mobile.md §3). The most recently activated handler runs first;
 * return `false` from it to let the press fall through to the previous one
 * (and ultimately to the shell's webView.goBack()).
 *
 * The handler may change on every render — only `active` toggles the
 * registration, so the stack order is the activation order.
 *
 *   useNativeBack(() => setOpen(false), open);
 */
export function useNativeBack(handler: BackHandler, active = true, options?: UseNativeBackOptions): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  const escape = !!options?.escape;

  useEffect(() => {
    if (!active) return;
    return registerBackHandler((source) => handlerRef.current(source), { escape });
  }, [active, escape]);
}
