import apiClient from './client';
import type { DeviceLicense } from '@obliance/shared';

interface ApiResponse<T> { data?: T; error?: string; }

export const licenseApi = {
  async listForDevice(deviceId: number): Promise<DeviceLicense[]> {
    const res = await apiClient.get<ApiResponse<DeviceLicense[]>>(`/licenses/device/${deviceId}`);
    return res.data.data ?? [];
  },
  async listAll(): Promise<(DeviceLicense & { deviceName?: string })[]> {
    const res = await apiClient.get<ApiResponse<(DeviceLicense & { deviceName?: string })[]>>('/licenses');
    return res.data.data ?? [];
  },
  async create(deviceId: number, data: Partial<DeviceLicense>): Promise<DeviceLicense> {
    const res = await apiClient.post<ApiResponse<DeviceLicense>>(`/licenses/device/${deviceId}`, data);
    return res.data.data!;
  },
  async update(id: number, data: Partial<DeviceLicense>): Promise<DeviceLicense> {
    const res = await apiClient.patch<ApiResponse<DeviceLicense>>(`/licenses/${id}`, data);
    return res.data.data!;
  },
  async remove(id: number): Promise<void> {
    await apiClient.delete(`/licenses/${id}`);
  },
};
