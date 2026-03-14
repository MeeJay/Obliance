import apiClient from './client';
import type {
  NotificationChannel,
  NotificationPluginMeta,
  NotificationBinding,
  ApiResponse,
  CreateNotificationChannelRequest,
  UpdateNotificationChannelRequest,
  OverrideMode,
} from '@obliance/shared';

export const notificationsApi = {
  // Plugins
  async getPlugins(): Promise<NotificationPluginMeta[]> {
    const res = await apiClient.get<ApiResponse<NotificationPluginMeta[]>>('/notifications/plugins');
    return res.data.data!;
  },

  // Channels
  async listChannels(): Promise<NotificationChannel[]> {
    const res = await apiClient.get<ApiResponse<NotificationChannel[]>>('/notifications/channels');
    return res.data.data!;
  },

  async getChannel(id: number): Promise<NotificationChannel> {
    const res = await apiClient.get<ApiResponse<NotificationChannel>>(`/notifications/channels/${id}`);
    return res.data.data!;
  },

  async createChannel(data: CreateNotificationChannelRequest): Promise<NotificationChannel> {
    const res = await apiClient.post<ApiResponse<NotificationChannel>>('/notifications/channels', data);
    return res.data.data!;
  },

  async updateChannel(id: number, data: UpdateNotificationChannelRequest): Promise<NotificationChannel> {
    const res = await apiClient.put<ApiResponse<NotificationChannel>>(`/notifications/channels/${id}`, data);
    return res.data.data!;
  },

  async deleteChannel(id: number): Promise<void> {
    await apiClient.delete(`/notifications/channels/${id}`);
  },

  async testChannel(id: number): Promise<void> {
    await apiClient.post(`/notifications/channels/${id}/test`);
  },

  async getChannelTenants(channelId: number): Promise<number[]> {
    const res = await apiClient.get<ApiResponse<number[]>>(`/notifications/channels/${channelId}/tenants`);
    return res.data.data!;
  },

  async setChannelTenants(channelId: number, tenantIds: number[]): Promise<void> {
    await apiClient.put(`/notifications/channels/${channelId}/tenants`, { tenantIds });
  },

  // Bindings
  async getBindings(scope: string, scopeId: number | null): Promise<NotificationBinding[]> {
    const res = await apiClient.get<ApiResponse<NotificationBinding[]>>('/notifications/bindings', {
      params: { scope, scopeId },
    });
    return res.data.data!;
  },

  async addBinding(channelId: number, scope: string, scopeId: number | null, overrideMode: OverrideMode = 'merge'): Promise<NotificationBinding> {
    const res = await apiClient.post<ApiResponse<NotificationBinding>>('/notifications/bindings', {
      channelId,
      scope,
      scopeId,
      overrideMode,
    });
    return res.data.data!;
  },

  async removeBinding(channelId: number, scope: string, scopeId: number | null): Promise<void> {
    await apiClient.delete('/notifications/bindings', {
      data: { channelId, scope, scopeId },
    });
  },

  async getResolvedBindings(
    scope: 'group' | 'monitor' | 'agent',
    scopeId: number,
  ): Promise<{
    channelId: number;
    channelName: string;
    channelType: string;
    source: 'global' | 'group' | 'monitor' | 'agent';
    sourceId: number | null;
    sourceName: string;
    isDirect: boolean;
    isExcluded: boolean;
  }[]> {
    const res = await apiClient.get('/notifications/bindings/resolved', {
      params: { scope, scopeId },
    });
    return res.data.data!;
  },
};
