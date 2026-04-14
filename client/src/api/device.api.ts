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
    groupId?: number; includeSubgroups?: boolean; status?: string; search?: string;
    approvalStatus?: string; osType?: string; page?: number; pageSize?: number;
    sortBy?: string; sortOrder?: 'asc' | 'desc';
  }): Promise<{ items: Device[]; total: number; page: number; pageSize: number }> {
    const res = await apiClient.get<ApiResponse<{ items: Device[]; total: number; page: number; pageSize: number }>>('/devices', { params });
    return res.data.data ?? { items: [], total: 0, page: 1, pageSize: 100 };
  },
  // ── Privacy gate ─────────────────────────────────────────────────────
  async setPrivacyPassword(id: number, password: string): Promise<void> {
    await apiClient.post(`/devices/${id}/privacy/password`, { action: 'set', password });
  },
  async changePrivacyPassword(id: number, oldPassword: string, newPassword: string): Promise<void> {
    await apiClient.post(`/devices/${id}/privacy/password`, { action: 'change', password: oldPassword, newPassword });
  },
  async removePrivacyPassword(id: number, password: string): Promise<void> {
    await apiClient.post(`/devices/${id}/privacy/password`, { action: 'remove', password });
  },
  async unlockPrivacyFeature(id: number, password: string, feature: string): Promise<{ ttlSeconds: number }> {
    const res = await apiClient.post<ApiResponse<{ unlocked: boolean; feature: string; ttlSeconds: number }>>(`/devices/${id}/privacy/unlock`, { password, feature });
    return { ttlSeconds: res.data.data?.ttlSeconds ?? 900 };
  },
  async disablePrivacyWithPassword(id: number, password: string): Promise<void> {
    await apiClient.post(`/devices/${id}/privacy/disable-with-password`, { password });
  },
  async listPrivacyUnlocks(id: number): Promise<Array<{ feature: string; expiresAt: number }>> {
    const res = await apiClient.get<ApiResponse<Array<{ feature: string; expiresAt: number }>>>(`/devices/${id}/privacy/unlocks`);
    return res.data.data ?? [];
  },

  async export(format: 'csv' | 'xlsx' | 'pdf', params?: {
    groupId?: number; includeSubgroups?: boolean; status?: string; search?: string;
    approvalStatus?: string; osType?: string; sortBy?: string; sortOrder?: 'asc' | 'desc';
  }): Promise<{ blob: Blob; filename: string }> {
    const res = await apiClient.get('/devices/export', {
      params: { ...params, format },
      responseType: 'blob',
    });
    const cd = res.headers['content-disposition'] || res.headers['Content-Disposition'] || '';
    const match = /filename="([^"]+)"/.exec(cd);
    const filename = match ? match[1] : `obliance-devices.${format}`;
    return { blob: res.data as Blob, filename };
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
  async update(id: number, data: Partial<Pick<Device, 'displayName' | 'description' | 'groupId' | 'tags' | 'customFields' | 'displayConfig' | 'pushIntervalSeconds' | 'scanIntervalSeconds' | 'overrideGroupSettings' | 'maxMissedPushes' | 'notificationTypes' | 'sensorDisplayNames' | 'complianceRemediationEnabled' | 'purchaseDate' | 'warrantyExpiry' | 'warrantyVendor' | 'warrantyStatus' | 'expectedLifetimeYears' | 'lifecycleStatus'>>): Promise<Device> {
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
  enableAirgap: (deviceId: number) => apiClient.post(`/devices/${deviceId}/airgap/enable`),
  disableAirgap: (deviceId: number) => apiClient.post(`/devices/${deviceId}/airgap/disable`),
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
  getInstallerUrl(platform: 'linux' | 'windows' | 'macos' | 'freebsd', apiKey: string): string {
    return `${window.location.origin}/api/agent/installer/${platform}?key=${encodeURIComponent(apiKey)}`;
  },
};
