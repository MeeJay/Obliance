import apiClient from './client';
import type { AppConfigData, DeviceNotificationTypes } from '@obliance/shared';

interface ApiResponse<T> { data?: T; error?: string; }

export interface AgentGlobalConfig {
  checkIntervalSeconds: number | null;
  heartbeatMonitoring: boolean;
  maxMissedPushes: number | null;
  notificationTypes: DeviceNotificationTypes | null;
}

export const appConfigApi = {
  async getConfig(): Promise<AppConfigData> {
    const res = await apiClient.get<ApiResponse<AppConfigData>>('/admin/config');
    return res.data.data!;
  },

  async setConfig(key: keyof AppConfigData, value: boolean | number | null): Promise<void> {
    await apiClient.put(`/admin/config/${key}`, { value: String(value ?? '') });
  },

  async getAgentGlobal(): Promise<AgentGlobalConfig> {
    const res = await apiClient.get<ApiResponse<AgentGlobalConfig>>('/admin/config/agent-global');
    return res.data.data!;
  },

  async patchAgentGlobal(patch: Partial<AgentGlobalConfig>): Promise<AgentGlobalConfig> {
    const res = await apiClient.patch<ApiResponse<AgentGlobalConfig>>('/admin/config/agent-global', patch);
    return res.data.data!;
  },
};
