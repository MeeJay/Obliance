import { create } from 'zustand';
import type { User } from '@obliance/shared';

export type PermissionLevel = 'ro' | 'rw';

export interface UserPermissions {
  canCreate: boolean;
  permissions: Record<string, PermissionLevel>;
}
import { authApi, type LoginResult } from '../api/auth.api';
import { connectSocket, disconnectSocket } from '../socket/socketClient';
import { useLiveAlertsStore } from './liveAlertsStore';
import { setLanguage } from '../i18n';
import { useTenantStore } from './tenantStore';

function syncPreferencesToStore(user: User) {
  const prefs = user.preferences;
  if (prefs) {
    useLiveAlertsStore.getState().setEnabled(prefs.toastEnabled ?? true);
    useLiveAlertsStore.getState().setPosition(prefs.toastPosition ?? 'bottom-right');
  }
  if (user.preferredLanguage) {
    setLanguage(user.preferredLanguage);
  }
}

interface AuthState {
  user: User | null;
  permissions: UserPermissions | null;
  requires2faSetup: boolean;
  isLoading: boolean;
  isInitialized: boolean;

  login: (username: string, password: string) => Promise<LoginResult>;
  logout: () => Promise<void>;
  checkSession: () => Promise<void>;
  refreshPermissions: () => Promise<void>;

  // Convenience permission checkers
  isAdmin: () => boolean;
  canCreate: () => boolean;
  canWriteDevice: (deviceId: number, groupId: number | null) => boolean;
  canWriteGroup: (groupId: number) => boolean;
  getDevicePermission: (deviceId: number, groupId: number | null) => PermissionLevel | null;
  getGroupPermission: (groupId: number) => PermissionLevel | null;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  permissions: null,
  requires2faSetup: false,
  isLoading: false,
  isInitialized: false,

  login: async (username: string, password: string) => {
    set({ isLoading: true });
    try {
      const result = await authApi.login({ username, password });

      // 2FA required — don't set user yet, return the challenge to caller
      if (result.requires2fa) {
        set({ isLoading: false });
        return result;
      }

      const user = result.user;
      set({ user, isLoading: false });
      syncPreferencesToStore(user);
      connectSocket(user.id);
      useTenantStore.getState().fetchTenants();
      useLiveAlertsStore.getState().fetchAlerts();
      // Fetch permissions in the background; failure is non-fatal here.
      authApi.me()
        .then(({ permissions, user: fullUser, requires2faSetup, currentTenantId }) => {
          set({ permissions, requires2faSetup: requires2faSetup ?? false });
          syncPreferencesToStore(fullUser);
          if (currentTenantId != null) {
            useTenantStore.setState({ currentTenantId });
          }
        })
        .catch(() => { /* non-critical — permissions will load on next checkSession */ });
      return result;
    } catch (err) {
      set({ isLoading: false });
      const axiosErr = err as { response?: { data?: { error?: string }; status?: number }; message?: string };
      const serverMessage = axiosErr?.response?.data?.error;
      const status = axiosErr?.response?.status;
      if (status === 429) {
        throw new Error(serverMessage ?? 'Too many login attempts, please try again later');
      } else if (status === 401) {
        throw new Error(serverMessage ?? 'Invalid username or password');
      } else if (serverMessage) {
        throw new Error(serverMessage);
      } else {
        throw new Error(axiosErr?.message ?? 'Unable to connect to the server');
      }
    }
  },

  logout: async () => {
    // Fetch Obligate logout URL BEFORE destroying local state
    let obligateLogoutUrl: string | null = null;
    try {
      const res = await fetch('/api/auth/sso-logout-url', { credentials: 'include' });
      const data = await res.json() as { success: boolean; data: string | null };
      if (data.success && data.data) obligateLogoutUrl = data.data;
    } catch { /* ignore */ }

    try {
      await authApi.logout();
    } finally {
      disconnectSocket();
      set({ user: null, permissions: null, requires2faSetup: false });
    }

    if (obligateLogoutUrl) {
      window.location.href = obligateLogoutUrl;
    }
  },

  checkSession: async () => {
    try {
      const { user, permissions, requires2faSetup, currentTenantId } = await authApi.me();
      set({ user, permissions, requires2faSetup: requires2faSetup ?? false, isInitialized: true });
      syncPreferencesToStore(user);
      connectSocket(user.id, currentTenantId ?? undefined);
      useTenantStore.getState().fetchTenants();
      useLiveAlertsStore.getState().fetchAlerts();
      if (currentTenantId != null) {
        useTenantStore.setState({ currentTenantId });
      }
    } catch {
      set({ user: null, permissions: null, requires2faSetup: false, isInitialized: true });
    }
  },

  refreshPermissions: async () => {
    try {
      const permissions = await authApi.getPermissions();
      set({ permissions });
    } catch {
      // Ignore errors
    }
  },

  isAdmin: () => get().user?.role === 'admin',

  canCreate: () => {
    const { user, permissions } = get();
    if (!user) return false;
    if (user.role === 'admin') return true;
    return permissions?.canCreate ?? false;
  },

  canWriteDevice: (deviceId: number, groupId: number | null) => {
    const { user, permissions } = get();
    if (!user) return false;
    if (user.role === 'admin') return true;
    if (!permissions) return false;

    // Check direct device permission
    const devicePerm = permissions.permissions[`device:${deviceId}`];
    if (devicePerm === 'rw') return true;

    // Check group permission
    if (groupId !== null) {
      const groupPerm = permissions.permissions[`group:${groupId}`];
      if (groupPerm === 'rw') return true;
    }

    return false;
  },

  canWriteGroup: (groupId: number) => {
    const { user, permissions } = get();
    if (!user) return false;
    if (user.role === 'admin') return true;
    if (!permissions) return false;
    return permissions.permissions[`group:${groupId}`] === 'rw';
  },

  getDevicePermission: (deviceId: number, groupId: number | null) => {
    const { user, permissions } = get();
    if (!user) return null;
    if (user.role === 'admin') return 'rw';
    if (!permissions) return null;

    const devicePerm = permissions.permissions[`device:${deviceId}`];
    const groupPerm = groupId !== null ? permissions.permissions[`group:${groupId}`] : null;

    if (devicePerm === 'rw' || groupPerm === 'rw') return 'rw';
    if (devicePerm === 'ro' || groupPerm === 'ro') return 'ro';
    return null;
  },

  getGroupPermission: (groupId: number) => {
    const { user, permissions } = get();
    if (!user) return null;
    if (user.role === 'admin') return 'rw';
    if (!permissions) return null;
    return permissions.permissions[`group:${groupId}`] ?? null;
  },
}));
