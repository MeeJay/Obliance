// In-memory cache of the latest VM console thumbnail per (hostDeviceId, vmId).
// Frames are pushed by host agents and relayed live via Socket.io; this cache
// only serves the first paint when a viewer opens (so it doesn't wait a full
// poll cycle for the first frame). Bounded + TTL'd — never persisted.

interface Frame {
  pngBase64: string;
  width: number;
  height: number;
  at: number;
}

const TTL_MS = 60_000;     // a frame older than this is considered stale
const MAX_ENTRIES = 500;   // hard cap to bound memory

const store = new Map<string, Frame>();

function key(hostDeviceId: number, vmId: string): string {
  return `${hostDeviceId}:${vmId}`;
}

export const hyperVConsoleStore = {
  put(hostDeviceId: number, vmId: string, frame: Omit<Frame, 'at'>): void {
    if (store.size >= MAX_ENTRIES) {
      // Evict the oldest entry.
      let oldestK: string | null = null;
      let oldestAt = Infinity;
      for (const [k, v] of store) {
        if (v.at < oldestAt) { oldestAt = v.at; oldestK = k; }
      }
      if (oldestK) store.delete(oldestK);
    }
    store.set(key(hostDeviceId, vmId), { ...frame, at: Date.now() });
  },

  get(hostDeviceId: number, vmId: string): Frame | null {
    const f = store.get(key(hostDeviceId, vmId));
    if (!f) return null;
    if (Date.now() - f.at > TTL_MS) {
      store.delete(key(hostDeviceId, vmId));
      return null;
    }
    return f;
  },
};
