import {
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type KeyboardCoordinateGetter,
} from '@dnd-kit/core';

export interface DndSensorsOptions {
  /** Keyboard coordinate getter — pass `sortableKeyboardCoordinates` for sortable lists. */
  coordinateGetter?: KeyboardCoordinateGetter;
  /** Mouse drag starts after moving this many px (default 5 — same as the old PointerSensor setup). */
  mouseDistance?: number;
  /** Touch drag starts after a long-press of this many ms (default 250) … */
  touchDelay?: number;
  /** … while the finger moves less than this many px (default 5); moving more scrolls instead. */
  touchTolerance?: number;
}

/**
 * dnd-kit sensors that work with mouse, touch (long-press to drag, so a
 * normal swipe still scrolls) and keyboard — docs/obli-mobile.md §5.3.
 * Use it INSTEAD of PointerSensor (never both).
 *
 *   const sensors = useDndSensors({ coordinateGetter: sortableKeyboardCoordinates });
 *   <DndContext sensors={sensors} ...>
 */
export function useDndSensors(options: DndSensorsOptions = {}) {
  const {
    coordinateGetter,
    mouseDistance = 5,
    touchDelay = 250,
    touchTolerance = 5,
  } = options;

  return useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: mouseDistance } }),
    useSensor(TouchSensor, { activationConstraint: { delay: touchDelay, tolerance: touchTolerance } }),
    useSensor(KeyboardSensor, coordinateGetter ? { coordinateGetter } : {}),
  );
}
