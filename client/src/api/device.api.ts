import apiClient from './client';
import type { Device, FleetSummary, AgentApiKey } from '@obliance/shared';

interface ApiResponse<T> { data?: T; error?: string; }

export const deviceApi = {
  // Fleet
  async list(params?: { groupId?: number; status?: string; search?: string; approvalStatus?: string }): Promise<Device[]> {
    const res = await apiClient.get<ApiResponse<Device[]>>('/devices', { params });
    return res.data.data ?? [];
  },
  async getSummary(): Promise<FleetSummary> {
    const res = await apiClient.get<ApiResponse<FleetSummary>>('/devices/summary');
    return res.data.data!;
  },
  async getById(id: number): Promise<Device> {
    const res = await apiClient.get<ApiResponse<Device>>(`/devices/${id}`);
    return res.data.data!;
  },
  async update(id: number, data: Partial<Pick<Device, 'displayName' | 'description' | 'groupId' | 'tags' | 'customFields' | 'displayConfig' | 'pushIntervalSeconds' | 'overrideGroupSettings' | 'maxMissedPushes' | 'notificationTypes' | 'sensorDisplayNames'>>): Promise<Device> {
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

  // API Keys
  async listKeys(): Promise<AgentApiKey[]> {
    const res = await apiClient.get<ApiResponse<AgentApiKey[]>>('/agent/keys');
    return res.data.data ?? [];
  },
  async createKey(name: string): Promise<AgentApiKey> {
    const res = await apiClient.post<ApiResponse<AgentApiKey>>('/agent/keys', { name });
    return res.data.data!;
  },
  async deleteKey(id: number): Promise<void> {
    await apiClient.delete(`/agent/keys/${id}`);
  },

  // Installer URLs
  getInstallerUrl(platform: 'linux' | 'windows' | 'macos', apiKey: string): string {
    return `${window.location.origin}/api/agent/installer/${platform}?key=${encodeURIComponent(apiKey)}`;
  },
};
