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
        try {
          const res = await fetch('/api/live-alerts/all', { credentials: 'include' });
          if (!res.ok) return;
          const data = (await res.json()) as { alerts: SharedLiveAlert[] };
          set({ alerts: data.alerts.map(toLocalAlert) });
        } catch {
          // Ignore network errors (user may not be logged in yet)
        }
      },

      addAlertFromServer: (alert) =>
        set((s) => {
          // Skip if already in list (e.g. double-emit)
          if (s.alerts.some((a) => a.id === alert.id)) return s;
          return { alerts: [toLocalAlert(alert), ...s.alerts].slice(0, 200) };
        }),

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
