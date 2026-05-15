import apiClient from './client';
import type { CveAggregated, CveAffectedDevice, CveStats, DeviceCve } from '@obliance/shared';

interface ApiResponse<T> { data?: T; error?: string }

interface AggregatedResponse {
  items: CveAggregated[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CveListFilters {
  severity?: string;
  kevOnly?: boolean;
  search?: string;
  page?: number;
  pageSize?: number;
}

export const cveApi = {
  async listAggregated(filters?: CveListFilters): Promise<AggregatedResponse> {
    const res = await apiClient.get<ApiResponse<AggregatedResponse>>('/cves', { params: filters });
    return res.data.data ?? { items: [], total: 0, page: 1, pageSize: 50 };
  },
  async getStats(): Promise<CveStats> {
    const res = await apiClient.get<ApiResponse<CveStats>>('/cves/stats');
    return res.data.data ?? { totalCves: 0, affectedDevices: 0, kevCves: 0, criticalCves: 0 };
  },
  async listAffectedDevices(cveId: number): Promise<CveAffectedDevice[]> {
    const res = await apiClient.get<ApiResponse<CveAffectedDevice[]>>(`/cves/${cveId}/devices`);
    return res.data.data ?? [];
  },
  async listForDevice(deviceId: number): Promise<DeviceCve[]> {
    const res = await apiClient.get<ApiResponse<DeviceCve[]>>(`/cves/device/${deviceId}`);
    return res.data.data ?? [];
  },
  async dismiss(deviceCveId: number): Promise<void> {
    await apiClient.post(`/cves/device-cve/${deviceCveId}/dismiss`);
  },
  /** Admin trigger: forces a CISA KEV refresh (otherwise scheduled daily
   *  by the server cron). Heavy on the matcher when followed by rescan. */
  async sync(): Promise<{ fetched: number; upserted: number; failed: number }> {
    const res = await apiClient.post<ApiResponse<{ fetched: number; upserted: number; failed: number }>>('/cves/sync');
    return res.data.data ?? { fetched: 0, upserted: 0, failed: 0 };
  },
  async rescan(): Promise<{ devices: number; matches: number }> {
    const res = await apiClient.post<ApiResponse<{ devices: number; matches: number }>>('/cves/rescan');
    return res.data.data ?? { devices: 0, matches: 0 };
  },
};
