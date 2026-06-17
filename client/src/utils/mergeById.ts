/**
 * Reconcile a freshly-fetched list into the previous one, preserving object
 * identity for rows whose data hasn't changed.
 *
 * Why: the Hyper-V / Veeam grids poll every few seconds and re-receive the full
 * list. Calling `setState(freshArray)` every tick replaces every row object,
 * forcing React to re-render the whole table — visible flicker, lost hover, and
 * needless work even when nothing actually changed.
 *
 * mergeById returns:
 *  - the SAME `prev` reference when the data is identical (so `setState` is a
 *    no-op and React skips the render entirely — the common idle-poll case), or
 *  - a new array that REUSES the unchanged row objects and only swaps in the
 *    ones that really changed (stable keys + stable identity → minimal repaint).
 *
 * Equality is a cheap JSON compare; rows here are small flat-ish objects.
 */
export function mergeById<T>(prev: T[], next: T[], idOf: (x: T) => string | number): T[] {
  const prevById = new Map(prev.map((x) => [idOf(x), x] as const));
  let changed = next.length !== prev.length;
  const merged = next.map((n) => {
    const old = prevById.get(idOf(n));
    if (old !== undefined && JSON.stringify(old) === JSON.stringify(n)) return old;
    changed = true;
    return n;
  });
  return changed ? merged : prev;
}
