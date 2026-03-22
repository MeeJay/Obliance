import apiClient from './client';
import type { Device, FleetSummary, AgentApiKey, ServiceInfo } from '@obliance/shared';

interface ApiResponse<T> { data?: T; error?: string; }

export interface GroupStats {
  groupId: number | null;
  groupName: string | null;
  online: number;
  offline: number;
  warning: number;
  critical: number;
  total: number;
  complianceScore: number | null;
  policyCount: number;
  pendingUpdates: number;
}

export const deviceApi = {
  // Fleet
  async list(params?: { groupId?: number; status?: string; search?: string; approvalStatus?: string }): Promise<Device[]> {
    const res = await apiClient.get<ApiResponse<{ items: Device[]; total: number }>>('/devices', { params });
    const data = res.data.data;
    // Support both paginated response { items, total } and legacy array
    return Array.isArray(data) ? data : (data?.items ?? []);
  },
  async listPaginated(params?: {
    groupId?: number; status?: string; search?: string;
    approvalStatus?: string; osType?: string; page?: number; pageSize?: number;
  }): Promise<{ items: Device[]; total: number; page: number; pageSize: number }> {
    const res = await apiClient.get<ApiResponse<{ items: Device[]; total: number; page: number; pageSize: number }>>('/devices', { params });
    return res.data.data ?? { items: [], total: 0, page: 1, pageSize: 100 };
  },
  async getSummary(): Promise<FleetSummary> {
    const res = await apiClient.get<ApiResponse<FleetSummary>>('/devices/summary');
    return res.data.data!;
  },
  async getGroupStats(): Promise<GroupStats[]> {
    const res = await apiClient.get<ApiResponse<GroupStats[]>>('/devices/group-stats');
    return res.data.data ?? [];
  },
  async getById(id: number): Promise<Device> {
    const res = await apiClient.get<ApiResponse<Device>>(`/devices/${id}`);
    return res.data.data!;
  },
  async update(id: number, data: Partial<Pick<Device, 'displayName' | 'description' | 'groupId' | 'tags' | 'customFields' | 'displayConfig' | 'pushIntervalSeconds' | 'scanIntervalSeconds' | 'overrideGroupSettings' | 'maxMissedPushes' | 'notificationTypes' | 'sensorDisplayNames' | 'complianceRemediationEnabled'>>): Promise<Device> {
    const res = await apiClient.patch<ApiResponse<Device>>(`/devices/${id}`, data);
    return res.data.data!;
  },
  async approve(id: number): Promise<Device> {
    const res = await apiClient.post<ApiResponse<Device>>(`/devices/${id}/approve`);
    return res.data.data!;
  },
  async refuse(id: number): Promise<Device> {
    const res = await apiClient.post<ApiResponse<Device>>(`/devices/${id}/refuse`);
    return res.data.data!;
  },
  async delete(id: number): Promise<void> {
    await apiClient.delete(`/devices/${id}`);
  },
  async bulkApprove(deviceIds: number[]): Promise<void> {
    await apiClient.post('/devices/bulk/approve', { deviceIds });
  },
  async bulkDelete(deviceIds: number[]): Promise<void> {
    await apiClient.delete('/devices/bulk/delete', { data: { deviceIds } });
  },
  async suspend(id: number): Promise<Device> {
    const res = await apiClient.post<ApiResponse<Device>>(`/devices/${id}/suspend`);
    return res.data.data!;
  },
  async unsuspend(id: number): Promise<Device> {
    const res = await apiClient.post<ApiResponse<Device>>(`/devices/${id}/unsuspend`);
    return res.data.data!;
  },
  async batch(params: { groupId?: number; deviceIds?: number[]; action: string }): Promise<{ dispatched: number }> {
    const res = await apiClient.post<ApiResponse<{ dispatched: number }>>('/devices/batch', params);
    return res.data.data ?? { dispatched: 0 };
  },
  async disablePrivacyMode(id: number): Promise<void> {
    await apiClient.post(`/devices/${id}/privacy-mode/disable`);
  },
  async initiateUninstall(id: number): Promise<Device> {
    const res = await apiClient.post<ApiResponse<Device>>(`/devices/${id}/uninstall`);
    return res.data.data!;
  },
  async cancelUninstall(id: number): Promise<Device> {
    const res = await apiClient.post<ApiResponse<Device>>(`/devices/${id}/cancel-uninstall`);
    return res.data.data!;
  },

  // API Keys
  async listKeys(): Promise<AgentApiKey[]> {
    const res = await apiClient.get<ApiResponse<AgentApiKey[]>>('/agent/keys');
    return res.data.data ?? [];
  },
  async createKey(name: string, defaultGroupId?: number | null): Promise<AgentApiKey> {
    const res = await apiClient.post<ApiResponse<AgentApiKey>>('/agent/keys', { name, defaultGroupId });
    return res.data.data!;
  },
  async updateKey(id: number, data: { name?: string; defaultGroupId?: number | null }): Promise<void> {
    await apiClient.put(`/agent/keys/${id}`, data);
  },
  async deleteKey(id: number): Promise<void> {
    await apiClient.delete(`/agent/keys/${id}`);
  },

  // Services
  async getServices(deviceId: number): Promise<ServiceInfo[]> {
    const res = await apiClient.get<ApiResponse<ServiceInfo[]>>(`/devices/${deviceId}/services`);
    return res.data.data ?? [];
  },

  // Installer URLs
  getInstallerUrl(platform: 'linux' | 'windows' | 'macos', apiKey: string): string {
    return `${window.location.origin}/api/agent/installer/${platform}?key=${encodeURIComponent(apiKey)}`;
  },
};
