import { create } from 'zustand';
import type { TenantWithRole } from '@obliance/shared';

interface TenantState {
  currentTenantId: number | null;
  tenants: TenantWithRole[];
  isLoading: boolean;
  fetchTenants: () => Promise<void>;
  setCurrentTenant: (tenantId: number) => Promise<void>;
}

export const useTenantStore = create<TenantState>((set) => ({
  currentTenantId: null,
  tenants: [],
  isLoading: false,

  fetchTenants: async () => {
    try {
      set({ isLoading: true });
      const res = await fetch('/api/tenants', { credentials: 'include' });
      if (!res.ok) { set({ isLoading: false }); return; }
      const data = await res.json();
      set({ tenants: data.data ?? [], isLoading: false });
    } catch {
      set({ isLoading: false });
    }
  },

  setCurrentTenant: async (tenantId: number) => {
    try {
      const res = await fetch('/api/tenant/switch', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId }),
      });
      if (!res.ok) return;
      set({ currentTenantId: tenantId });
    } catch {
      // ignore
    }
  },
}));
