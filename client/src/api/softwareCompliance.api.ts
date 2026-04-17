import apiClient from './client';
import type { SoftwareComplianceList, SoftwareComplianceResult, KnownSoftwareApp, SoftwareRepoPackage } from '@obliance/shared';

interface ApiResponse<T> { data?: T; error?: string; }

export interface SoftwareComplianceHistoryItem {
  id: string;
  status: string;
  deviceId: number;
  deviceName: string;
  deviceOsType: string | null;
  entryName: string | null;
  exitCode: number | null;
  stdout: string | null;
  stderr: string | null;
  triggeredAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface SoftwareComplianceHistoryBatch {
  batchId: string;
  triggeredAt: string;
  listId: number;
  listName: string;
  type: 'check_software_compliance' | 'install_software' | 'uninstall_software';
  total: number;
  ok: number;
  fail: number;
  pending: number;
  items: SoftwareComplianceHistoryItem[];
}

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
  async scanList(listId: number): Promise<{ enqueued: number }> {
    const res = await apiClient.post<ApiResponse<{ enqueued: number }>>(`/software-compliance/${listId}/scan`);
    return res.data.data ?? { enqueued: 0 };
  },
  async history(params: { listId?: number; limit?: number } = {}): Promise<SoftwareComplianceHistoryBatch[]> {
    const res = await apiClient.get<ApiResponse<SoftwareComplianceHistoryBatch[]>>('/software-compliance/history', {
      params: { listId: params.listId, limit: params.limit ?? 10 },
    });
    return res.data.data ?? [];
  },
  async remediate(deviceId: number, listId: number, entryIds: number[]): Promise<void> {
    await apiClient.post('/software-compliance/remediate', { deviceId, listId, entryIds });
  },
  async getKnownApps(osType?: string): Promise<KnownSoftwareApp[]> {
    const res = await apiClient.get<ApiResponse<KnownSoftwareApp[]>>('/software-compliance/known-apps', { params: { osType } });
    return res.data.data ?? [];
  },
};
