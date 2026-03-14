import apiClient from './client';
import type { HardwareInventory, SoftwareEntry } from '@obliance/shared';

interface ApiResponse<T> { data?: T; error?: string; }

export const inventoryApi = {
  async getHardware(deviceId: number): Promise<HardwareInventory | null> {
    try {
      const res = await apiClient.get<ApiResponse<HardwareInventory>>(`/inventory/${deviceId}/hardware`);
      return res.data.data ?? null;
    } catch { return null; }
  },
  async getSoftware(deviceId: number, params?: { search?: string; page?: number; pageSize?: number }): Promise<{ items: SoftwareEntry[]; total: number }> {
    const res = await apiClient.get<ApiResponse<{ items: SoftwareEntry[]; total: number }>>(`/inventory/${deviceId}/software`, { params });
    return res.data.data ?? { items: [], total: 0 };
  },
  async triggerScan(deviceId: number): Promise<void> {
    await apiClient.post(`/inventory/${deviceId}/scan`);
  },
};
