import { apiClient } from './client';
import type { ApiResponse } from './client';

export interface AuditLogRow {
  id: number;
  tenantId: number;
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
    const res = await apiClient.get<ApiResponse<{ items: AuditLogRow[]; total: number }>>('/audit-log', { params });
    return res.data.data ?? { items: [], total: 0 };
  },
  async distinctActions(): Promise<string[]> {
    const res = await apiClient.get<ApiResponse<string[]>>('/audit-log/distinct-actions');
    return res.data.data ?? [];
  },
};
