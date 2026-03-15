import apiClient from './client';
import type { AppConfigData, DeviceNotificationTypes, SsoIntegrationConfig } from '@obliance/shared';

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

  async getObliviewConfig(): Promise<SsoIntegrationConfig> {
    const res = await apiClient.get<ApiResponse<SsoIntegrationConfig>>('/admin/config/obliview');
    return res.data.data!;
  },

  async patchObliviewConfig(patch: { url?: string | null; apiKey?: string | null }): Promise<SsoIntegrationConfig> {
    const res = await apiClient.put<ApiResponse<SsoIntegrationConfig>>('/admin/config/obliview', patch);
    return res.data.data!;
  },

  async getObliguardConfig(): Promise<SsoIntegrationConfig> {
    const res = await apiClient.get<ApiResponse<SsoIntegrationConfig>>('/admin/config/obliguard');
    return res.data.data!;
  },

  async patchObliguardConfig(patch: { url?: string | null; apiKey?: string | null }): Promise<SsoIntegrationConfig> {
    const res = await apiClient.put<ApiResponse<SsoIntegrationConfig>>('/admin/config/obliguard', patch);
    return res.data.data!;
  },

  async getOblimapConfig(): Promise<SsoIntegrationConfig> {
    const res = await apiClient.get<ApiResponse<SsoIntegrationConfig>>('/admin/config/oblimap');
    return res.data.data!;
  },

  async patchOblimapConfig(patch: { url?: string | null; apiKey?: string | null }): Promise<SsoIntegrationConfig> {
    const res = await apiClient.put<ApiResponse<SsoIntegrationConfig>>('/admin/config/oblimap', patch);
    return res.data.data!;
  },

  async proxyObliviewLink(uuid: string): Promise<string | null> {
    const res = await apiClient.get<ApiResponse<{ obliviewUrl: string | null }>>(`/obliview/proxy-link?uuid=${encodeURIComponent(uuid)}`);
    return res.data.data?.obliviewUrl ?? null;
  },

  async proxyObliguardLink(uuid: string): Promise<string | null> {
    const res = await apiClient.get<ApiResponse<{ obliguardUrl: string | null }>>(`/obliguard/proxy-link?uuid=${encodeURIComponent(uuid)}`);
    return res.data.data?.obliguardUrl ?? null;
  },

  async proxyOblimapLink(uuid: string): Promise<string | null> {
    const res = await apiClient.get<ApiResponse<{ oblimapUrl: string | null }>>(`/oblimap/proxy-link?uuid=${encodeURIComponent(uuid)}`);
    return res.data.data?.oblimapUrl ?? null;
  },
};
