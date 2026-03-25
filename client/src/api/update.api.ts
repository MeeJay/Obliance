import apiClient from './client';
import type { DeviceUpdate, UpdatePolicy } from '@obliance/shared';

interface ApiResponse<T> { data?: T; error?: string; }

export const updateApi = {
  async listUpdates(params?: { deviceId?: number; groupId?: number; status?: string; severity?: string; page?: number }): Promise<{ items: DeviceUpdate[]; total: number }> {
    const res = await apiClient.get<ApiResponse<{ items: DeviceUpdate[]; total: number }>>('/updates', { params });
    return res.data.data ?? { items: [], total: 0 };
  },
  async approveUpdate(deviceId: number, updateId: number): Promise<void> {
    await apiClient.post(`/updates/device/${deviceId}/approve`, { updateId });
  },
  async approveAll(deviceId: number, severities?: string[]): Promise<void> {
    await apiClient.post(`/updates/device/${deviceId}/approve`, {
      severities: severities ?? ['critical', 'important', 'moderate', 'optional', 'unknown'],
    });
  },
  async deployApproved(deviceId: number): Promise<{ dispatched: number }> {
    const res = await apiClient.post<{ dispatched: number }>(`/updates/device/${deviceId}/deploy`);
    return res.data;
  },
  async retryUpdate(deviceId: number, updateId: number): Promise<void> {
    await apiClient.post(`/updates/device/${deviceId}/retry/${updateId}`);
  },
  async triggerScan(deviceId: number): Promise<void> {
    await apiClient.post(`/updates/scan/${deviceId}`);
  },
  async listPolicies(): Promise<UpdatePolicy[]> {
    const res = await apiClient.get<ApiResponse<UpdatePolicy[]>>('/updates/policies');
    return res.data.data ?? [];
  },
  async createPolicy(data: Omit<UpdatePolicy, 'id' | 'createdAt' | 'updatedAt' | 'createdBy'>): Promise<UpdatePolicy> {
    const res = await apiClient.post<ApiResponse<UpdatePolicy>>('/updates/policies', data);
    return res.data.data!;
  },
  async updatePolicy(id: number, data: Partial<UpdatePolicy>): Promise<UpdatePolicy> {
    const res = await apiClient.patch<ApiResponse<UpdatePolicy>>(`/updates/policies/${id}`, data);
    return res.data.data!;
  },
  async deletePolicy(id: number): Promise<void> {
    await apiClient.delete(`/updates/policies/${id}`);
  },

  // ── Aggregated view ──────────────────────────────────────────────────────
  async listAggregated(params?: {
    severity?: string; source?: string; groupId?: number; status?: string;
    page?: number; pageSize?: number;
  }): Promise<{ items: AggregatedUpdate[]; total: number; page: number; pageSize: number }> {
    const res = await apiClient.get<ApiResponse<{ items: AggregatedUpdate[]; total: number; page: number; pageSize: number }>>('/updates/aggregated', { params });
    return res.data.data ?? { items: [], total: 0, page: 1, pageSize: 50 };
  },
  async getUpdateDevices(updateUid: string): Promise<Array<{ id: number; deviceId: number; deviceName: string; groupId: number | null; status: string }>> {
    const res = await apiClient.get<ApiResponse<Array<any>>>(`/updates/aggregated/${encodeURIComponent(updateUid)}/devices`);
    return res.data.data ?? [];
  },
  async bulkApproveByTitle(updateUid: string, groupId?: number): Promise<{ approved: number }> {
    const res = await apiClient.post<ApiResponse<{ approved: number }>>('/updates/bulk-approve', { updateUid, groupId });
    return res.data.data ?? { approved: 0 };
  },
  async bulkApproveBySeverity(severities: string[], groupId?: number): Promise<{ approved: number }> {
    const res = await apiClient.post<ApiResponse<{ approved: number }>>('/updates/bulk-approve-severity', { severities, groupId });
    return res.data.data ?? { approved: 0 };
  },
  async bulkApproveTitles(updateUids: string[], groupId?: number): Promise<{ approved: number }> {
    const res = await apiClient.post<ApiResponse<{ approved: number }>>('/updates/bulk-approve-titles', { updateUids, groupId });
    return res.data.data ?? { approved: 0 };
  },
  async bulkDeploy(): Promise<{ dispatched: number; devices: number }> {
    const res = await apiClient.post<ApiResponse<{ dispatched: number; devices: number }>>('/updates/bulk-deploy');
    return res.data.data ?? { dispatched: 0, devices: 0 };
  },
  async bulkApproveAndDeploy(updateUids: string[], groupId?: number): Promise<{ approved: number; dispatched: number; devices: number }> {
    const res = await apiClient.post<ApiResponse<{ approved: number; dispatched: number; devices: number }>>('/updates/bulk-approve-and-deploy', { updateUids, groupId });
    return res.data.data ?? { approved: 0, dispatched: 0, devices: 0 };
  },
};

export interface AggregatedUpdate {
  updateUid: string;
  title: string;
  severity: string;
  category: string;
  source: string;
  sizeBytes: number;
  requiresReboot: boolean;
  deviceCount: number;
}
