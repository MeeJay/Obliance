import { io, Socket } from 'socket.io-client';
import { useSocketStore } from '../store/socketStore';

let socket: Socket | null = null;

/** Guards against registering the visibilitychange listener more than once. */
let visibilityListenerAdded = false;

/**
 * Timestamp (ms) at which the page was last hidden.
 * Used to decide whether a re-visible page has been asleep long enough
 * to suspect a stale WebSocket connection.
 */
let hiddenAt: number | null = null;

/**
 * If the page was hidden for longer than this threshold we force a
 * disconnect → reconnect on wake-up so the stale connection is replaced
 * immediately rather than waiting up to 45 s for the ping-timeout to fire.
 */
const STALE_THRESHOLD_MS = 30_000;

export function getSocket(): Socket | null {
  return socket;
}

export function connectSocket(userId: number, tenantId?: number): Socket {
  if (socket?.connected) {
    return socket;
  }

  socket = io(window.location.origin, {
    auth: { userId, tenantId },
    transports: ['websocket', 'polling'],
    withCredentials: true,
  });

  const { setStatus } = useSocketStore.getState();

  socket.on('connect', () => {
    console.log('Socket connected');
    setStatus('connected');
  });

  socket.on('disconnect', () => {
    setStatus('disconnected');
  });

  socket.on('connect_error', () => {
    setStatus('disconnected');
  });

  // socket.io is the Manager; these fire during auto-reconnect cycles.
  socket.io.on('reconnect_attempt', () => {
    setStatus('reconnecting');
  });

  socket.io.on('reconnect', () => {
    setStatus('connected');
  });

  // ── Sleep / wake detection ───────────────────────────────────────────────
  // When the OS suspends the machine the underlying TCP connection dies, but
  // socket.io can take up to ~45 s to notice (pingInterval + pingTimeout).
  // We track how long the page was hidden and, if it looks like a real sleep
  // rather than a quick tab-switch, we force a disconnect → reconnect so the
  // UI reflects reality immediately.
  if (!visibilityListenerAdded && typeof document !== 'undefined') {
    visibilityListenerAdded = true;

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now();
        return;
      }

      // Page became visible again.
      const s = getSocket();
      if (!s) return;

      const wasHiddenForMs = hiddenAt !== null ? Date.now() - hiddenAt : 0;
      hiddenAt = null;

      if (!s.connected) {
        // Already detected as disconnected — update store immediately so the
        // indicator turns red without waiting for the next render cycle.
        useSocketStore.getState().setStatus('disconnected');
      } else if (wasHiddenForMs > STALE_THRESHOLD_MS) {
        // Hidden long enough to be suspicious of a stale connection.
        // Force a full reconnect so we know for sure.
        s.disconnect().connect();
      }
    });
  }

  return socket;
}

export function disconnectSocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  useSocketStore.getState().setStatus('disconnected');
}
