import { useEffect, useRef, type RefObject } from 'react';

type Refs = RefObject<HTMLElement | null> | ReadonlyArray<RefObject<HTMLElement | null>>;

/**
 * Calls `handler` on a `pointerdown` outside every element in `refs`
 * (mouse, touch and pen alike — replaces the old document 'mousedown'
 * listeners, which only fire on touch through compatibility events).
 *
 *   const ref = useRef<HTMLDivElement>(null);
 *   useClickOutside(ref, () => setOpen(false), open);
 *   useClickOutside([triggerRef, menuRef], close, open);
 */
export function useClickOutside(
  refs: Refs,
  handler: (event: PointerEvent) => void,
  active = true,
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  const refsRef = useRef(refs);
  refsRef.current = refs;

  useEffect(() => {
    if (!active) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      // Ignore clicks on nodes removed during the same event (e.g. a list item
      // that re-rendered away) — they are no longer "inside" anything.
      if (!target.isConnected) return;
      const current = refsRef.current;
      const list: ReadonlyArray<RefObject<HTMLElement | null>> = Array.isArray(current)
        ? (current as ReadonlyArray<RefObject<HTMLElement | null>>)
        : [current as RefObject<HTMLElement | null>];
      for (const r of list) {
        if (r.current && r.current.contains(target)) return;
      }
      handlerRef.current(event);
    };
    // Capture phase so stopPropagation() in the page doesn't hide the event.
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [active]);
}
