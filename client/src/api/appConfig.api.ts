import apiClient from './client';
import type { AppConfigData, DeviceNotificationTypes, ObligateConfig } from '@obliance/shared';

interface ApiResponse<T> { data?: T; error?: string; }

export interface AgentGlobalConfig {
  checkIntervalSeconds: number | null;
  scanIntervalSeconds: number | null;  // 0 = disabled
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

  // ── Obligate SSO gateway ────────────────────────────────────────────────

  async getObligateConfig(): Promise<ObligateConfig> {
    const res = await apiClient.get<ApiResponse<ObligateConfig>>('/admin/config/obligate');
    return res.data.data!;
  },

  async patchObligateConfig(patch: { url?: string | null; apiKey?: string | null; enabled?: boolean }): Promise<ObligateConfig> {
    const res = await apiClient.put<ApiResponse<ObligateConfig>>('/admin/config/obligate', patch);
    return res.data.data!;
  },

  // ── Editable file extensions (file explorer inline editor) ──────────────

  async getEditableExtensions(): Promise<{ extensions: string[]; defaults: string[] }> {
    const res = await apiClient.get<ApiResponse<{ extensions: string[]; defaults: string[] }>>('/admin/config/editable-extensions');
    return res.data.data ?? { extensions: [], defaults: [] };
  },

  async setEditableExtensions(extensions: string[]): Promise<string[]> {
    const res = await apiClient.put<ApiResponse<{ extensions: string[] }>>('/admin/config/editable-extensions', { extensions });
    return res.data.data?.extensions ?? [];
  },
};
