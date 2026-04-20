import apiClient from './client';

interface ApiResponse<T> { data?: T; error?: string; }

export type RestrictionLevel = 'restricted' | 'sensitive';
export type ScopeMode = 'all' | 'include' | 'exclude';

export interface RestrictionScope {
  mode: ScopeMode;
  deviceIds?: number[];
  groupIds?: number[];
}

export interface RestrictionEntry {
  level: RestrictionLevel;
  scope: RestrictionScope;
}

export type RestrictionMap = Record<string, RestrictionEntry>;

export interface RestrictableAction {
  key: string;
  label: string;
  category: string;
}

export const restrictionApi = {
  async get(): Promise<{ map: RestrictionMap; actions: RestrictableAction[] }> {
    const res = await apiClient.get<ApiResponse<{ map: RestrictionMap; actions: RestrictableAction[] }>>('/restrictions');
    return res.data.data ?? { map: {}, actions: [] };
  },
  async setMap(map: RestrictionMap): Promise<{ map: RestrictionMap; actions: RestrictableAction[] }> {
    const res = await apiClient.put<ApiResponse<{ map: RestrictionMap; actions: RestrictableAction[] }>>('/restrictions', { map });
    return res.data.data ?? { map: {}, actions: [] };
  },
};
