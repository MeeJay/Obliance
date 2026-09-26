import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { LiveAlert as SharedLiveAlert } from '@obliance/shared';

export type AlertSeverity = 'info' | 'warning' | 'critical' | 'down' | 'up';

/** Client-side alert object. Mirrors LiveAlert but adds ephemeral UI state. */
export interface LiveAlert extends SharedLiveAlert {
  /** True when the toast popup was dismissed (auto-timer or X button). Ephemeral — resets on reload. */
  toastDismissed: boolean;
}

// ─── Persistent preferences (localStorage) ───────────────────────────────────

interface AlertPrefs {
  /** Show toast popups for the current tenant's alerts */
  localEnabled: boolean;
  /** Show toast popups for other tenants' alerts (visible only when user has multiple tenants) */
  multiTenantEnabled: boolean;
  position: 'top-center' | 'bottom-right';
}

// ─── Full store state ─────────────────────────────────────────────────────────

interface LiveAlertsState extends AlertPrefs {
  alerts: LiveAlert[];

  // ── Preferences ──────────────────────────────────────────────────────────────
  setLocalEnabled: (v: boolean) => void;
  setMultiTenantEnabled: (v: boolean) => void;
  setPosition: (p: 'top-center' | 'bottom-right') => void;
  /** Backward-compat alias used by authStore (reads user.preferences.toastEnabled) */
  setEnabled: (v: boolean) => void;

  // ── Server sync ───────────────────────────────────────────────────────────────
  /** Fetch all alerts (all accessible tenants) from the server and replace local state. */
  fetchAlerts: () => Promise<void>;
  /** Add a single alert received via socket (NOTIFICATION_NEW). */
  addAlertFromServer: (alert: SharedLiveAlert) => void;
  /** Apply a server-side "mark read" (socket NOTIFICATION_READ). */
  markReadFromServer: (ids: number[], readAt: string) => void;
  /**
   * Drop alerts the server resolved (socket NOTIFICATION_RESOLVED): their
   * incident recovered or escalated to a new alert. They leave the bell,
   * the toasts and the unread counts.
   */
  resolveFromServer: (ids: number[]) => void;

  // ── Actions ───────────────────────────────────────────────────────────────────
  /** Dismiss the toast popup for one alert (keeps it in the bell, does NOT mark as read). */
  dismissToast: (id: number) => void;
  /** Mark one alert as read (server + local). Also dismisses the toast. */
  markAlertRead: (id: number) => Promise<void>;
  /** Mark all current-tenant alerts as read (server + local). */
  markAllRead: () => Promise<void>;
  /** Delete one alert (server + local). */
  removeAlert: (id: number) => Promise<void>;
  /** Clear all alerts for current tenant (server + local). */
  clearAll: () => Promise<void>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toLocalAlert(data: SharedLiveAlert): LiveAlert {
  return { ...data, toastDismissed: false };
}

// ─── Socket / fetch reconciliation ───────────────────────────────────────────
// fetchAlerts replaces the list with an HTTP snapshot. Socket events handled
// while that GET is in flight must survive it (a reconnect after a deploy
// brings bursts of them): ids resolved or deleted recently are filtered out
// of every snapshot, and alerts that arrived through the socket after the
// fetch started are kept when the snapshot predates them.

/** Ids resolved (socket) or deleted (user) recently, oldest first; bounded. */
const goneIds = new Set<number>();
const GONE_MAX = 2000;
function rememberGone(ids: number[]): void {
  for (const id of ids) {
    goneIds.delete(id);
    goneIds.add(id);
  }
  while (goneIds.size > GONE_MAX) {
    const oldest = goneIds.values().next().value as number;
    goneIds.delete(oldest);
  }
}

/** Socket arrivals: alert id → arrival sequence (bounded like the list). */
let arrivalSeq = 0;
const arrivals = new Map<number, number>();
function rememberArrival(id: number): void {
  arrivals.set(id, ++arrivalSeq);
  if (arrivals.size > 400) {
    const oldest = arrivals.keys().next().value as number;
    arrivals.delete(oldest);
  }
}

async function apiPatch(path: string): Promise<void> {
  await fetch(path, { method: 'PATCH', credentials: 'include' });
}
async function apiPost(path: string): Promise<void> {
  await fetch(path, { method: 'POST', credentials: 'include' });
}
async function apiDelete(path: string): Promise<void> {
  await fetch(path, { method: 'DELETE', credentials: 'include' });
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useLiveAlertsStore = create<LiveAlertsState>()(
  persist(
    (set, get) => ({
      // Default preferences
      localEnabled: true,
      multiTenantEnabled: true,
      position: 'bottom-right',

      alerts: [],

      // ── Preferences ────────────────────────────────────────────────────────
      setLocalEnabled: (v) => set({ localEnabled: v }),
      setMultiTenantEnabled: (v) => set({ multiTenantEnabled: v }),
      setPosition: (p) => set({ position: p }),
      setEnabled: (v) => set({ localEnabled: v }),

      // ── Server sync ────────────────────────────────────────────────────────
      fetchAlerts: async () => {
        const startSeq = arrivalSeq;
        try {
          const res = await fetch('/api/live-alerts/all', { credentials: 'include' });
          if (!res.ok) return;
          const data = (await res.json()) as { alerts: SharedLiveAlert[] };
          // The server lists ACTIVE alerts only (resolved ones are gone).
          // A re-fetch (socket reconnect) keeps the toasts already
          // dismissed dismissed, and does not undo the socket events
          // handled while it was in flight (see goneIds / arrivals).
          set((s) => {
            const dismissed = new Set(s.alerts.filter((a) => a.toastDismissed).map((a) => a.id));
            const fetched = data.alerts
              .filter((a) => !goneIds.has(a.id))
              .map((a) => ({ ...toLocalAlert(a), toastDismissed: dismissed.has(a.id) }));
            const fetchedIds = new Set(fetched.map((a) => a.id));
            const newer = s.alerts.filter(
              (a) => !fetchedIds.has(a.id) && !goneIds.has(a.id) && (arrivals.get(a.id) ?? 0) > startSeq,
            );
            if (newer.length === 0) return { alerts: fetched };
            return { alerts: [...newer, ...fetched].sort((a, b) => b.id - a.id).slice(0, 200) };
          });
        } catch {
          // Ignore network errors (user may not be logged in yet)
        }
      },

      addAlertFromServer: (alert) => {
        // Skip if already resolved, or already in list (e.g. double-emit)
        if (goneIds.has(alert.id) || get().alerts.some((a) => a.id === alert.id)) return;
        rememberArrival(alert.id);
        set((s) => ({ alerts: [toLocalAlert(alert), ...s.alerts].slice(0, 200) }));
      },

      markReadFromServer: (ids, readAt) =>
        set((s) => {
          const wanted = new Set(ids);
          if (!s.alerts.some((a) => wanted.has(a.id) && !a.readAt)) return s;
          return {
            alerts: s.alerts.map((a) => (wanted.has(a.id) && !a.readAt ? { ...a, readAt, toastDismissed: true } : a)),
          };
        }),

      resolveFromServer: (ids) => {
        // Remembered even when not listed yet: a fetch in flight may
        // still return them.
        rememberGone(ids);
        const gone = new Set(ids);
        set((s) => {
          if (!s.alerts.some((a) => gone.has(a.id))) return s;
          return { alerts: s.alerts.filter((a) => !gone.has(a.id)) };
        });
      },

      // ── Actions ────────────────────────────────────────────────────────────
      dismissToast: (id) =>
        set((s) => ({
          alerts: s.alerts.map((a) => a.id === id ? { ...a, toastDismissed: true } : a),
        })),

      markAlertRead: async (id) => {
        const readAt = new Date().toISOString();
        // Optimistic update
        set((s) => ({
          alerts: s.alerts.map((a) => a.id === id ? { ...a, readAt, toastDismissed: true } : a),
        }));
        await apiPatch(`/api/live-alerts/${id}/read`);
      },

      markAllRead: async () => {
        const readAt = new Date().toISOString();
        set((s) => ({ alerts: s.alerts.map((a) => ({ ...a, readAt })) }));
        await apiPost('/api/live-alerts/read-all');
      },

      removeAlert: async (id) => {
        rememberGone([id]);
        set((s) => ({ alerts: s.alerts.filter((a) => a.id !== id) }));
        await apiDelete(`/api/live-alerts/${id}`);
      },

      clearAll: async () => {
        set({ alerts: [] });
        await apiDelete('/api/live-alerts');
        // Reload to restore cross-tenant alerts that weren't in the cleared tenant
        await get().fetchAlerts();
      },
    }),
    {
      name: 'obliance-alert-prefs',
      // Only persist preferences, NOT the alert list (alerts always fetched fresh from server)
      partialize: (s) => ({
        localEnabled: s.localEnabled,
        multiTenantEnabled: s.multiTenantEnabled,
        position: s.position,
      }),
    },
  ),
);

// ─── Computed helpers (exported for components) ───────────────────────────────

/** Count of unread alerts, optionally filtered to a specific tenant. */
export function countUnread(alerts: LiveAlert[], tenantId?: number | null): number {
  return alerts.filter((a) => !a.readAt && (tenantId == null || a.tenantId === tenantId)).length;
}
