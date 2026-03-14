import type {
  MaintenanceWindow,
  CreateMaintenanceWindowRequest,
  UpdateMaintenanceWindowRequest,
} from '@obliance/shared';

const BASE = '/api/maintenance';

async function req<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.error || 'Request failed');
  return json.data as T;
}

export const maintenanceApi = {
  /** List all windows, optionally filtered by scope type/id */
  list(params?: { scopeType?: string; scopeId?: number }): Promise<MaintenanceWindow[]> {
    const qs = new URLSearchParams();
    if (params?.scopeType) qs.set('scopeType', params.scopeType);
    if (params?.scopeId !== undefined) qs.set('scopeId', String(params.scopeId));
    const query = qs.toString() ? `?${qs}` : '';
    return req<MaintenanceWindow[]>(`${BASE}${query}`);
  },

  getById(id: number): Promise<MaintenanceWindow> {
    return req<MaintenanceWindow>(`${BASE}/${id}`);
  },

  create(data: CreateMaintenanceWindowRequest): Promise<MaintenanceWindow> {
    return req<MaintenanceWindow>(BASE, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  update(id: number, data: UpdateMaintenanceWindowRequest): Promise<MaintenanceWindow> {
    return req<MaintenanceWindow>(`${BASE}/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  delete(id: number): Promise<void> {
    return req<void>(`${BASE}/${id}`, { method: 'DELETE' });
  },

  /**
   * Get all effective windows (local + inherited) for a scope entity.
   * Each window includes source, isDisabledHere, canDisable, canEnable, etc.
   */
  getEffective(scopeType: 'monitor' | 'agent' | 'group', scopeId: number): Promise<MaintenanceWindow[]> {
    return req<MaintenanceWindow[]>(`${BASE}/effective/${scopeType}/${scopeId}`);
  },

  /**
   * Disable an inherited window at the given scope.
   */
  disableForScope(windowId: number, scopeType: 'group' | 'monitor' | 'agent', scopeId: number): Promise<void> {
    return req<void>(`${BASE}/${windowId}/disable`, {
      method: 'POST',
      body: JSON.stringify({ scopeType, scopeId }),
    });
  },

  /**
   * Re-enable a previously disabled inherited window at the given scope.
   */
  enableForScope(windowId: number, scopeType: 'group' | 'monitor' | 'agent', scopeId: number): Promise<void> {
    return req<void>(`${BASE}/${windowId}/disable`, {
      method: 'DELETE',
      body: JSON.stringify({ scopeType, scopeId }),
    });
  },
};
