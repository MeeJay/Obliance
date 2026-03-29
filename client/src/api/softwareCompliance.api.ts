import apiClient from './client';
import type { SoftwareComplianceList, SoftwareComplianceResult, KnownSoftwareApp } from '@obliance/shared';

interface ApiResponse<T> { data?: T; error?: string; }

export const softwareComplianceApi = {
  async listLists(): Promise<SoftwareComplianceList[]> {
    const res = await apiClient.get<ApiResponse<SoftwareComplianceList[]>>('/software-compliance/lists');
    return res.data.data ?? [];
  },
  async createList(data: Omit<SoftwareComplianceList, 'id' | 'uuid' | 'tenantId' | 'createdBy' | 'createdAt' | 'updatedAt'>): Promise<SoftwareComplianceList> {
    const res = await apiClient.post<ApiResponse<SoftwareComplianceList>>('/software-compliance/lists', data);
    return res.data.data!;
  },
  async updateList(id: number, data: Partial<SoftwareComplianceList>): Promise<SoftwareComplianceList> {
    const res = await apiClient.put<ApiResponse<SoftwareComplianceList>>(`/software-compliance/lists/${id}`, data);
    return res.data.data!;
  },
  async deleteList(id: number): Promise<void> {
    await apiClient.delete(`/software-compliance/lists/${id}`);
  },
  async listResults(params?: { deviceId?: number; page?: number }): Promise<{ items: SoftwareComplianceResult[]; total: number }> {
    const res = await apiClient.get<ApiResponse<{ items: SoftwareComplianceResult[]; total: number }>>(
      '/software-compliance/results',
      { params },
    );
    return res.data.data ?? { items: [], total: 0 };
  },
  async getDeviceResults(deviceId: number): Promise<SoftwareComplianceResult[]> {
    const res = await apiClient.get<ApiResponse<{ items: SoftwareComplianceResult[]; total: number }>>(`/software-compliance/results/device/${deviceId}`);
    return res.data.data?.items ?? [];
  },
  async triggerCheck(deviceId: number, listId?: number): Promise<void> {
    await apiClient.post('/software-compliance/check', { deviceId, listId });
  },
  async remediate(deviceId: number, listId: number, entryIds: number[]): Promise<void> {
    await apiClient.post('/software-compliance/remediate', { deviceId, listId, entryIds });
  },
  async getKnownApps(osType?: string): Promise<KnownSoftwareApp[]> {
    const res = await apiClient.get<ApiResponse<KnownSoftwareApp[]>>('/software-compliance/known-apps', { params: { osType } });
    return res.data.data ?? [];
  },
};
