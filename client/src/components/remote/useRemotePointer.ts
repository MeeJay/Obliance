import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type WheelEvent as ReactWheelEvent,
} from 'react';

/**
 * Pointer → remote-mouse translation for a remote screen canvas (ObliReach,
 * Hyper-V console…) — docs/obli-mobile.md §5.
 *
 * Mouse / pen: forwarded exactly as before (move throttled to 60/s, button
 * down / up with the real button, wheel = scroll), plus a stuck-button
 * guard on pointercancel / lost capture.
 *
 * Touch (`touch-action: none` on the canvas), "direct" mode:
 *   - tap                      → left click at the finger (a quick second tap
 *                                 snaps to the first one so double-clicks land)
 *   - long-press (500 ms)      → right click; long-press then drag → left drag
 *   - one-finger drag          → left drag (or pans the view while zoomed in)
 *   - two-finger drag          → mouse wheel
 *   - two-finger tap           → right click
 *   - pinch                    → LOCAL zoom 1–5× + pan (never sent to the remote)
 * "trackpad" mode: the finger moves a cursor relatively (tap = click at the
 * cursor, long-press = right click, long-press + drag = left drag), which is
 * far more precise on a phone where 1 CSS px ≈ 5 remote px.
 *
 * Coordinates always come from the canvas' transformed bounding box, so
 * clicks stay exact at any zoom level.
 */

export type TouchInputMode = 'direct' | 'trackpad';

export interface RemoteView {
  scale: number;
  x: number;
  y: number;
}

export interface UseRemotePointerOptions {
  canvasRef: RefObject<HTMLCanvasElement>;
  /** Remote screen size in agent pixels. */
  agentDims: { w: number; h: number };
  /** Sends one control message ({ type: 'mouse', … }). */
  send: (msg: object) => void;
  touchMode?: TouchInputMode;
  /** Wraps touch-originated button presses (lets the owner press latched modifiers around them). */
  onTouchButton?: (phase: 'down' | 'up') => void;
  /** Every touch that starts on the surface (user activation: resume audio, focus…). */
  onTouchStart?: () => void;
  /** Max local zoom (default 5). */
  maxScale?: number;
}

export interface UseRemotePointerResult {
  handlers: {
    onPointerDown: (e: ReactPointerEvent<HTMLCanvasElement>) => void;
    onPointerMove: (e: ReactPointerEvent<HTMLCanvasElement>) => void;
    onPointerUp: (e: ReactPointerEvent<HTMLCanvasElement>) => void;
    onPointerCancel: (e: ReactPointerEvent<HTMLCanvasElement>) => void;
    onLostPointerCapture: (e: ReactPointerEvent<HTMLCanvasElement>) => void;
    onWheel: (e: ReactWheelEvent<HTMLCanvasElement>) => void;
    onContextMenu: (e: { preventDefault: () => void }) => void;
  };
  /** Style for the canvas: touch-action + the local zoom transform. */
  style: CSSProperties;
  view: RemoteView;
  isZoomed: boolean;
  resetView: () => void;
  zoomBy: (factor: number) => void;
  /** Trackpad mode: style for a cursor marker positioned in the canvas' container (null otherwise). */
  cursorStyle: CSSProperties | null;
}

const MOVE_THROTTLE_MS = 16;
const TAP_SLOP = 8;
const LONG_PRESS_MS = 500;
const DOUBLE_TAP_MS = 400;
const DOUBLE_TAP_SLOP = 24;
const TWO_FINGER_TAP_MS = 250;
const PINCH_THRESHOLD = 16;
const SCROLL_STEP = 40;
const TRACKPAD_SPEED = 1.25;

interface Pt { x: number; y: number }

type Gesture =
  | { kind: 'idle' }
  | { kind: 'pending'; id: number; start: Pt; last: Pt; timer: ReturnType<typeof setTimeout> | null }
  | { kind: 'held'; id: number; start: Pt; last: Pt }
  | { kind: 'drag'; id: number; last: Pt }
  | { kind: 'pan'; id: number; last: Pt }
  | { kind: 'track'; id: number; last: Pt }
  | {
      kind: 'two';
      startTime: number;
      d0: number;
      c0: Pt;
      lastC: Pt;
      view0: RemoteView;
      mode: 'undecided' | 'pinch' | 'scroll';
      acc: number;
    }
  | { kind: 'ignore' };

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const IDENTITY: RemoteView = { scale: 1, x: 0, y: 0 };

export function useRemotePointer({
  canvasRef,
  agentDims,
  send,
  touchMode = 'direct',
  onTouchButton,
  onTouchStart,
  maxScale = 5,
}: UseRemotePointerOptions): UseRemotePointerResult {
  const [view, setViewState] = useState<RemoteView>(IDENTITY);
  const viewRef = useRef<RemoteView>(IDENTITY);
  const [cursor, setCursor] = useState<Pt | null>(null);
  const cursorRef = useRef<Pt | null>(null);

  const dimsRef = useRef(agentDims);
  dimsRef.current = agentDims;
  const sendRef = useRef(send);
  sendRef.current = send;
  const modeRef = useRef(touchMode);
  modeRef.current = touchMode;
  const onTouchButtonRef = useRef(onTouchButton);
  onTouchButtonRef.current = onTouchButton;
  const onTouchStartRef = useRef(onTouchStart);
  onTouchStartRef.current = onTouchStart;

  const lastMoveRef = useRef(0);
  const mouseButtonsRef = useRef<Set<number>>(new Set());
  const lastMousePosRef = useRef<Pt>({ x: 0, y: 0 });
  const touchesRef = useRef<Map<number, Pt>>(new Map());
  const gestureRef = useRef<Gesture>({ kind: 'idle' });
  const lastTapRef = useRef<{ t: number; client: Pt; agent: Pt } | null>(null);

  // ── Geometry ───────────────────────────────────────────────────────────────

  const toAgent = useCallback((clientX: number, clientY: number, clamp = false): Pt => {
    const canvas = canvasRef.current;
    const { w, h } = dimsRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    let x = Math.round((clientX - rect.left) * w / (rect.width || 1));
    let y = Math.round((clientY - rect.top) * h / (rect.height || 1));
    if (clamp) {
      x = Math.min(Math.max(0, x), Math.max(0, w - 1));
      y = Math.min(Math.max(0, y), Math.max(0, h - 1));
    }
    return { x, y };
  }, [canvasRef]);

  /** Keep the zoomed content covering the container (centred when smaller). */
  const clampView = useCallback((v: RemoteView): RemoteView => {
    const canvas = canvasRef.current;
    const container = canvas?.offsetParent as HTMLElement | null;
    if (!canvas || !container) return v;
    const scale = Math.min(Math.max(1, v.scale), maxScale);
    const W = canvas.offsetWidth;
    const H = canvas.offsetHeight;
    const ox = canvas.offsetLeft;
    const oy = canvas.offsetTop;
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    const axis = (pos: number, size: number, off: number, box: number) => {
      const scaled = size * scale;
      if (scaled <= box) return (box - scaled) / 2 - off;
      return Math.min(-off, Math.max(box - scaled - off, pos));
    };
    return { scale, x: axis(v.x, W, ox, cw), y: axis(v.y, H, oy, ch) };
  }, [canvasRef, maxScale]);

  const setView = useCallback((v: RemoteView) => {
    const next = v.scale <= 1.001 ? IDENTITY : clampView(v);
    viewRef.current = next;
    setViewState(next);
  }, [clampView]);

  const resetView = useCallback(() => setView(IDENTITY), [setView]);

  /** Zoom keeping the content point under (clientX, clientY) in place. */
  const zoomAround = useCallback((base: RemoteView, scale: number, from: Pt, to: Pt) => {
    const canvas = canvasRef.current;
    const container = canvas?.offsetParent as HTMLElement | null;
    if (!canvas || !container) return;
    const cr = container.getBoundingClientRect();
    const ox = canvas.offsetLeft;
    const oy = canvas.offsetTop;
    const s = Math.min(Math.max(1, scale), maxScale);
    const lx = (from.x - cr.left - ox - base.x) / base.scale;
    const ly = (from.y - cr.top - oy - base.y) / base.scale;
    setView({ scale: s, x: to.x - cr.left - ox - s * lx, y: to.y - cr.top - oy - s * ly });
  }, [canvasRef, maxScale, setView]);

  const zoomBy = useCallback((factor: number) => {
    const container = canvasRef.current?.offsetParent as HTMLElement | null;
    if (!container) return;
    const cr = container.getBoundingClientRect();
    const c = { x: cr.left + cr.width / 2, y: cr.top + cr.height / 2 };
    const base = viewRef.current;
    zoomAround(base, base.scale * factor, c, c);
  }, [canvasRef, zoomAround]);

  // A new remote resolution / monitor invalidates the zoom; a resized window
  // only needs re-clamping.
  useEffect(() => { resetView(); }, [agentDims.w, agentDims.h, resetView]);
  useEffect(() => {
    const onResize = () => {
      if (viewRef.current.scale > 1) setView(viewRef.current);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [setView]);

  // ── Messages ───────────────────────────────────────────────────────────────

  const sendMove = useCallback((p: Pt, force = false) => {
    const now = performance.now();
    if (!force && now - lastMoveRef.current < MOVE_THROTTLE_MS) return;
    lastMoveRef.current = now;
    sendRef.current({ type: 'mouse', action: 'move', x: p.x, y: p.y });
  }, []);

  const click = useCallback((p: Pt, button: number) => {
    onTouchButtonRef.current?.('down');
    sendRef.current({ type: 'mouse', action: 'move', x: p.x, y: p.y });
    sendRef.current({ type: 'mouse', action: 'down', button, x: p.x, y: p.y });
    sendRef.current({ type: 'mouse', action: 'up', button, x: p.x, y: p.y });
    onTouchButtonRef.current?.('up');
  }, []);

  const buttonDown = useCallback((p: Pt) => {
    onTouchButtonRef.current?.('down');
    sendRef.current({ type: 'mouse', action: 'move', x: p.x, y: p.y });
    sendRef.current({ type: 'mouse', action: 'down', button: 0, x: p.x, y: p.y });
  }, []);

  const buttonUp = useCallback((p: Pt) => {
    sendRef.current({ type: 'mouse', action: 'up', button: 0, x: p.x, y: p.y });
    onTouchButtonRef.current?.('up');
  }, []);

  // ── Trackpad cursor ────────────────────────────────────────────────────────

  const getCursor = useCallback((): Pt => {
    if (cursorRef.current) return cursorRef.current;
    const { w, h } = dimsRef.current;
    const c = { x: Math.round(w / 2), y: Math.round(h / 2) };
    cursorRef.current = c;
    return c;
  }, []);

  const moveCursor = useCallback((dxCss: number, dyCss: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return getCursor();
    const rect = canvas.getBoundingClientRect();
    const { w, h } = dimsRef.current;
    const cur = getCursor();
    const next = {
      x: Math.round(Math.min(Math.max(0, cur.x + dxCss * TRACKPAD_SPEED * w / (rect.width || 1)), w - 1)),
      y: Math.round(Math.min(Math.max(0, cur.y + dyCss * TRACKPAD_SPEED * h / (rect.height || 1)), h - 1)),
    };
    cursorRef.current = next;
    setCursor(next);
    // Zoomed in: follow the cursor so it never leaves the screen.
    const v = viewRef.current;
    const container = canvas.offsetParent as HTMLElement | null;
    if (v.scale > 1 && container) {
      const cr = container.getBoundingClientRect();
      const sx = rect.left + (next.x / w) * rect.width - cr.left;
      const sy = rect.top + (next.y / h) * rect.height - cr.top;
      const margin = 48;
      let dx = 0;
      let dy = 0;
      if (sx < margin) dx = margin - sx;
      else if (sx > cr.width - margin) dx = cr.width - margin - sx;
      if (sy < margin) dy = margin - sy;
      else if (sy > cr.height - margin) dy = cr.height - margin - sy;
      if (dx || dy) setView({ ...v, x: v.x + dx, y: v.y + dy });
    }
    return next;
  }, [canvasRef, getCursor, setView]);

  useEffect(() => {
    if (touchMode !== 'trackpad') {
      cursorRef.current = null;
      setCursor(null);
      return;
    }
    // Entering trackpad mode: park the remote pointer under the marker.
    const c = getCursor();
    setCursor(c);
    sendRef.current({ type: 'mouse', action: 'move', x: c.x, y: c.y });
  }, [touchMode, getCursor]);

  // ── Touch gestures ─────────────────────────────────────────────────────────

  const clearTimer = (g: Gesture) => {
    if (g.kind === 'pending' && g.timer) clearTimeout(g.timer);
  };

  /** Abort the one-finger gesture in progress (a second finger arrived, cancel…). */
  const abortOne = useCallback(() => {
    const g = gestureRef.current;
    clearTimer(g);
    if (g.kind === 'drag') {
      buttonUp(modeRef.current === 'trackpad' ? getCursor() : toAgent(g.last.x, g.last.y, true));
    }
  }, [buttonUp, getCursor, toAgent]);

  const twoFingerState = (): { c: Pt; d: number } | null => {
    const pts = Array.from(touchesRef.current.values());
    if (pts.length < 2) return null;
    const [a, b] = pts;
    return { c: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, d: dist(a, b) };
  };

  const onTouchDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    // No compatibility mouse events (and no focus change) for touches.
    e.preventDefault();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    const p = { x: e.clientX, y: e.clientY };
    touchesRef.current.set(e.pointerId, p);
    onTouchStartRef.current?.();

    const count = touchesRef.current.size;
    if (count === 1) {
      const id = e.pointerId;
      const timer = setTimeout(() => {
        const g = gestureRef.current;
        if (g.kind === 'pending' && g.id === id) {
          gestureRef.current = { kind: 'held', id, start: g.start, last: g.last };
          try { navigator.vibrate?.(15); } catch { /* ignore */ }
        }
      }, LONG_PRESS_MS);
      gestureRef.current = { kind: 'pending', id, start: p, last: p, timer };
    } else if (count === 2) {
      abortOne();
      const s = twoFingerState();
      if (!s) return;
      gestureRef.current = {
        kind: 'two',
        startTime: performance.now(),
        d0: Math.max(1, s.d),
        c0: s.c,
        lastC: s.c,
        view0: viewRef.current,
        mode: 'undecided',
        acc: 0,
      };
    } else {
      abortOne();
      gestureRef.current = { kind: 'ignore' };
    }
  };

  const onTouchMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!touchesRef.current.has(e.pointerId)) return;
    const p = { x: e.clientX, y: e.clientY };
    const prev = touchesRef.current.get(e.pointerId)!;
    touchesRef.current.set(e.pointerId, p);
    const g = gestureRef.current;
    const trackpad = modeRef.current === 'trackpad';

    switch (g.kind) {
      case 'pending': {
        if (g.id !== e.pointerId) return;
        g.last = p;
        if (dist(p, g.start) <= TAP_SLOP) return;
        clearTimer(g);
        if (trackpad) {
          gestureRef.current = { kind: 'track', id: g.id, last: p };
          sendMove(moveCursor(p.x - g.start.x, p.y - g.start.y));
        } else if (viewRef.current.scale > 1.01) {
          gestureRef.current = { kind: 'pan', id: g.id, last: p };
          const v = viewRef.current;
          setView({ ...v, x: v.x + (p.x - g.start.x), y: v.y + (p.y - g.start.y) });
        } else {
          buttonDown(toAgent(g.start.x, g.start.y, true));
          gestureRef.current = { kind: 'drag', id: g.id, last: p };
          sendMove(toAgent(p.x, p.y, true), true);
        }
        return;
      }
      case 'held': {
        if (g.id !== e.pointerId) return;
        g.last = p;
        if (dist(p, g.start) <= TAP_SLOP) return;
        // Long-press then drag = left-button drag.
        if (trackpad) {
          buttonDown(getCursor());
          sendMove(moveCursor(p.x - g.start.x, p.y - g.start.y), true);
        } else {
          buttonDown(toAgent(g.start.x, g.start.y, true));
          sendMove(toAgent(p.x, p.y, true), true);
        }
        gestureRef.current = { kind: 'drag', id: g.id, last: p };
        return;
      }
      case 'drag': {
        if (g.id !== e.pointerId) return;
        g.last = p;
        if (trackpad) sendMove(moveCursor(p.x - prev.x, p.y - prev.y));
        else sendMove(toAgent(p.x, p.y, true));
        return;
      }
      case 'pan': {
        if (g.id !== e.pointerId) return;
        g.last = p;
        const v = viewRef.current;
        setView({ ...v, x: v.x + (p.x - prev.x), y: v.y + (p.y - prev.y) });
        return;
      }
      case 'track': {
        if (g.id !== e.pointerId) return;
        g.last = p;
        sendMove(moveCursor(p.x - prev.x, p.y - prev.y));
        return;
      }
      case 'two': {
        const s = twoFingerState();
        if (!s) return;
        if (g.mode === 'undecided') {
          if (Math.abs(s.d - g.d0) > PINCH_THRESHOLD) {
            g.mode = 'pinch';
          } else if (dist(s.c, g.c0) > TAP_SLOP * 1.5) {
            g.mode = 'scroll';
            // Scroll where the fingers are (direct) or at the cursor (trackpad).
            sendMove(trackpad ? getCursor() : toAgent(g.c0.x, g.c0.y, true), true);
          }
        }
        if (g.mode === 'pinch') {
          zoomAround(g.view0, g.view0.scale * (s.d / g.d0), g.c0, s.c);
        } else if (g.mode === 'scroll') {
          g.acc += s.c.y - g.lastC.y;
          while (Math.abs(g.acc) >= SCROLL_STEP) {
            const up = g.acc < 0; // fingers moving up = content moves up = scroll down
            sendRef.current({ type: 'mouse', action: 'scroll', delta: up ? -1 : 1, x: 0, y: 0 });
            g.acc += up ? SCROLL_STEP : -SCROLL_STEP;
          }
        }
        g.lastC = s.c;
        return;
      }
      default:
        return;
    }
  };

  const onTouchEnd = (e: ReactPointerEvent<HTMLCanvasElement>, cancelled: boolean) => {
    if (!touchesRef.current.has(e.pointerId)) return;
    const p = { x: e.clientX, y: e.clientY };
    touchesRef.current.delete(e.pointerId);
    const g = gestureRef.current;
    const trackpad = modeRef.current === 'trackpad';
    const remaining = touchesRef.current.size;

    switch (g.kind) {
      case 'pending': {
        if (g.id !== e.pointerId) break;
        clearTimer(g);
        if (cancelled) break;
        if (trackpad) {
          click(getCursor(), 0);
        } else {
          const now = performance.now();
          let target = toAgent(p.x, p.y, true);
          const last = lastTapRef.current;
          if (last && now - last.t < DOUBLE_TAP_MS && dist(last.client, p) < DOUBLE_TAP_SLOP) {
            target = last.agent; // land the double-click inside the remote's double-click rectangle
            lastTapRef.current = null;
          } else {
            lastTapRef.current = { t: now, client: p, agent: target };
          }
          click(target, 0);
        }
        break;
      }
      case 'held': {
        if (g.id !== e.pointerId || cancelled) break;
        click(trackpad ? getCursor() : toAgent(g.start.x, g.start.y, true), 2);
        break;
      }
      case 'drag': {
        if (g.id !== e.pointerId) break;
        buttonUp(trackpad ? getCursor() : toAgent(g.last.x, g.last.y, true));
        break;
      }
      case 'two': {
        if (!cancelled && g.mode === 'undecided' && performance.now() - g.startTime < TWO_FINGER_TAP_MS) {
          click(trackpad ? getCursor() : toAgent(g.c0.x, g.c0.y, true), 2);
        }
        gestureRef.current = remaining > 0 ? { kind: 'ignore' } : { kind: 'idle' };
        return;
      }
      default:
        break;
    }
    gestureRef.current = remaining > 0 ? { kind: 'ignore' } : { kind: 'idle' };
  };

  // ── Handlers ───────────────────────────────────────────────────────────────

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === 'touch') { onTouchDown(e); return; }
    // Mouse / pen: unchanged behaviour.
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    const p = toAgent(e.clientX, e.clientY);
    lastMousePosRef.current = p;
    mouseButtonsRef.current.add(e.button);
    send({ type: 'mouse', action: 'down', button: e.button, x: p.x, y: p.y });
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === 'touch') { onTouchMove(e); return; }
    const now = performance.now();
    if (now - lastMoveRef.current < MOVE_THROTTLE_MS) return;
    lastMoveRef.current = now;
    const p = toAgent(e.clientX, e.clientY);
    lastMousePosRef.current = p;
    send({ type: 'mouse', action: 'move', x: p.x, y: p.y });
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === 'touch') { onTouchEnd(e, false); return; }
    const p = toAgent(e.clientX, e.clientY);
    lastMousePosRef.current = p;
    mouseButtonsRef.current.delete(e.button);
    send({ type: 'mouse', action: 'up', button: e.button, x: p.x, y: p.y });
  };

  /** Release whatever is still pressed (the browser took the pointer away). */
  const releaseStuck = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === 'touch') { onTouchEnd(e, true); return; }
    const buttons = mouseButtonsRef.current;
    if (buttons.size === 0) return;
    const p = lastMousePosRef.current;
    for (const button of buttons) send({ type: 'mouse', action: 'up', button, x: p.x, y: p.y });
    buttons.clear();
  };

  const onWheel = (e: ReactWheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const p = toAgent(e.clientX, e.clientY);
    send({ type: 'mouse', action: 'scroll', delta: e.deltaY > 0 ? -1 : 1, x: p.x, y: p.y });
  };

  // Clear a pending long-press timer on unmount.
  useEffect(() => () => clearTimer(gestureRef.current), []);

  // ── Output ─────────────────────────────────────────────────────────────────

  const isZoomed = view.scale > 1.001;
  const style: CSSProperties = isZoomed
    ? { touchAction: 'none', transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`, transformOrigin: '0 0' }
    : { touchAction: 'none' };

  let cursorStyle: CSSProperties | null = null;
  const canvas = canvasRef.current;
  if (touchMode === 'trackpad' && canvas && canvas.offsetWidth > 0) {
    const c = cursor ?? { x: agentDims.w / 2, y: agentDims.h / 2 };
    const left = canvas.offsetLeft + view.x + (c.x / (agentDims.w || 1)) * canvas.offsetWidth * view.scale;
    const top = canvas.offsetTop + view.y + (c.y / (agentDims.h || 1)) * canvas.offsetHeight * view.scale;
    cursorStyle = { position: 'absolute', left, top, pointerEvents: 'none' };
  }

  return {
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: releaseStuck,
      onLostPointerCapture: releaseStuck,
      onWheel,
      onContextMenu: (e) => e.preventDefault(),
    },
    style,
    view,
    isZoomed,
    resetView,
    zoomBy,
    cursorStyle,
  };
}
