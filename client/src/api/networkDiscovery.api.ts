import apiClient from './client';
import type { DiscoveredDevice } from '@obliance/shared';

interface ApiResponse<T> { data?: T; error?: string; }

export const networkDiscoveryApi = {
  async list(params?: {
    isManaged?: boolean; deviceType?: string; subnet?: string;
    page?: number; limit?: number;
  }): Promise<{ items: DiscoveredDevice[]; total: number }> {
    const res = await apiClient.get<ApiResponse<{ items: DiscoveredDevice[]; total: number }>>('/network-discovery', { params });
    return res.data.data ?? { items: [], total: 0 };
  },
  async getStats(): Promise<{ total: number; managed: number; unmanaged: number; byType: Record<string, number> }> {
    const res = await apiClient.get<ApiResponse<{ total: number; managed: number; unmanaged: number; byType: Record<string, number> }>>('/network-discovery/stats');
    return res.data.data ?? { total: 0, managed: 0, unmanaged: 0, byType: {} };
  },
  async remove(id: number): Promise<void> {
    await apiClient.delete(`/network-discovery/${id}`);
  },
};
