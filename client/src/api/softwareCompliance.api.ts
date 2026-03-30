import apiClient from './client';
import type { SoftwareComplianceList, SoftwareComplianceResult, KnownSoftwareApp, SoftwareRepoPackage } from '@obliance/shared';

interface ApiResponse<T> { data?: T; error?: string; }

export const softwareRepoApi = {
  async list(): Promise<SoftwareRepoPackage[]> {
    const res = await apiClient.get<ApiResponse<SoftwareRepoPackage[]>>('/software-repo/packages');
    return res.data.data ?? [];
  },
  async upload(file: File, platform: string, displayName?: string): Promise<SoftwareRepoPackage> {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('platform', platform);
    if (displayName) fd.append('displayName', displayName);
    const res = await apiClient.post<ApiResponse<SoftwareRepoPackage>>('/software-repo/packages', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return res.data.data!;
  },
  async delete(id: number): Promise<void> {
    await apiClient.delete(`/software-repo/packages/${id}`);
  },
};

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
