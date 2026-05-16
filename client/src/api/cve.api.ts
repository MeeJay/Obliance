import apiClient from './client';
import type { CveAggregated, CveAffectedDevice, CveStats, CveSourceStats, DeviceCve } from '@obliance/shared';

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
  /** Per-source stats — count, latest publication date, last sync time —
   *  for every CVE catalog the server knows about. Drives the selector
   *  in the CVE page so the admin can compare sources before picking
   *  which one to refresh. */
  async listSources(): Promise<CveSourceStats[]> {
    const res = await apiClient.get<ApiResponse<CveSourceStats[]>>('/cves/sources');
    return res.data.data ?? [];
  },
  /** Admin trigger: forces a sync. With `source` set, only that catalog
   *  is refreshed. Without, every registered source is synced in sequence
   *  (same routine the daily cron runs). */
  async sync(source?: string): Promise<{ fetched?: number; upserted?: number; failed?: number; sources?: Array<{ source: string; ok: boolean; fetched?: number; upserted?: number; failed?: number; error?: string }> }> {
    const url = source ? `/cves/sync?source=${encodeURIComponent(source)}` : '/cves/sync';
    const res = await apiClient.post<ApiResponse<any>>(url);
    return res.data.data ?? {};
  },
  async rescan(): Promise<{ devices: number; matches: number }> {
    const res = await apiClient.post<ApiResponse<{ devices: number; matches: number }>>('/cves/rescan');
    return res.data.data ?? { devices: 0, matches: 0 };
  },
};
