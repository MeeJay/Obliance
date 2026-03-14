import apiClient from './client';
import type { SettingScope, SettingKey } from '@obliance/shared';

interface ApiResponse<T> { data?: T; error?: string; }

/** A single resolved setting value with its inheritance source info */
export interface ResolvedSettingValue {
  value: number | boolean;
  source: 'default' | 'global' | 'group' | 'device';
  sourceName: string;
  sourceId: number | null;
}

/** Map of setting key to resolved (inherited) value */
export type ResolvedSettings = Record<string, ResolvedSettingValue>;

interface ResolvedWithOverrides {
  resolved: ResolvedSettings;
  overrides: Record<string, number>;
}

export const settingsApi = {
  async getGlobalResolved(): Promise<ResolvedWithOverrides> {
    const res = await apiClient.get<ApiResponse<ResolvedWithOverrides>>('/settings/global/resolved');
    return res.data.data!;
  },

  async getGroupResolved(groupId: number): Promise<ResolvedWithOverrides> {
    const res = await apiClient.get<ApiResponse<ResolvedWithOverrides>>(`/settings/group/${groupId}/resolved`);
    return res.data.data!;
  },

  async getDeviceResolved(deviceId: number): Promise<ResolvedWithOverrides> {
    const res = await apiClient.get<ApiResponse<ResolvedWithOverrides>>(`/settings/device/${deviceId}/resolved`);
    return res.data.data!;
  },

  async set(scope: SettingScope, scopeId: string, key: SettingKey, value: number): Promise<void> {
    await apiClient.put(`/settings/${scope}/${scopeId}`, { key, value });
  },

  async setBulk(
    scope: SettingScope,
    scopeId: string,
    overrides: Array<{ key: SettingKey; value: number }>,
  ): Promise<void> {
    await apiClient.put(`/settings/${scope}/${scopeId}/bulk`, { overrides });
  },

  async remove(scope: SettingScope, scopeId: string, key: SettingKey): Promise<void> {
    await apiClient.delete(`/settings/${scope}/${scopeId}/${key}`);
  },
};
