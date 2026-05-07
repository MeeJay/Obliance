import apiClient from './client';

interface ApiResponse<T> { data?: T; error?: string; }

export interface AuditLogRow {
  id: number;
  tenantId: number;
  /** Resolved tenant display name. Always populated by the server now
   *  (left join on tenants); on master view the AuditLogPage uses it
   *  to render the tenant chip + drives the tenant filter. */
  tenantName: string | null;
  userId: number | null;
  username: string | null;
  deviceId: number | null;
  deviceName: string | null;
  action: string;
  resourceType: string | null;
  resourcePath: string | null;
  details: Record<string, unknown> | null;
  ipAddress: string | null;
  createdAt: string;
}

export interface AuditLogFilters {
  action?: string;        // exact match, or prefix if ends with "."
  userId?: number;
  deviceId?: number;
  resourceType?: string;
  search?: string;
  since?: string;
  until?: string;
  limit?: number;
  offset?: number;
  /** Master-only: narrow the god view to one tenant. Server drops the
   *  param when the caller isn't on master. */
  filterTenantId?: number;
}

export const auditApi = {
  async list(filters: AuditLogFilters = {}): Promise<{ items: AuditLogRow[]; total: number }> {
    const params: any = {};
    if (filters.action) params.action = filters.action;
    if (filters.userId) params.userId = filters.userId;
    if (filters.deviceId) params.deviceId = filters.deviceId;
    if (filters.resourceType) params.resourceType = filters.resourceType;
    if (filters.search) params.search = filters.search;
    if (filters.since) params.since = filters.since;
    if (filters.until) params.until = filters.until;
    if (filters.limit) params.limit = filters.limit;
    if (filters.offset) params.offset = filters.offset;
    if (filters.filterTenantId) params.filterTenantId = filters.filterTenantId;
    const res = await apiClient.get<ApiResponse<{ items: AuditLogRow[]; total: number }>>('/audit-log', { params });
    return res.data.data ?? { items: [], total: 0 };
  },
  async distinctActions(filterTenantId?: number): Promise<string[]> {
    const params: any = {};
    if (filterTenantId) params.filterTenantId = filterTenantId;
    const res = await apiClient.get<ApiResponse<string[]>>('/audit-log/distinct-actions', { params });
    return res.data.data ?? [];
  },
  async clear(): Promise<{ deleted: number }> {
    const res = await apiClient.delete<ApiResponse<{ deleted: number }>>('/audit-log');
    return res.data.data ?? { deleted: 0 };
  },
};
