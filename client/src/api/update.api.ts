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
};
