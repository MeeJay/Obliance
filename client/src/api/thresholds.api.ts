import apiClient from './client';
import type { MetricThresholds, MetricThreshold } from '@obliance/shared';

interface ApiResponse<T> { data?: T; error?: string; }

// Resolved thresholds = the cascade output for a given layer (every
// metric carries a fully-populated { warn, crit }, plus the per-mount
// override map). Same shape as the server's `ResolvedThresholds`. Used
// for placeholders in the editor on lower-layer pages.
export interface ResolvedThresholds {
  cpu: Required<MetricThreshold>;
  ram: Required<MetricThreshold>;
  disk: Required<MetricThreshold>;
  diskByMount: Record<string, Required<MetricThreshold>>;
}

// Cast the resolved-cascade response (every slot filled) into the
// shape ThresholdsEditor expects for `inheritedFrom` (partial slots).
// The editor reads only the warn/crit it needs; passing the resolved
// blob covers every metric.
export function resolvedToInherited(r: ResolvedThresholds): MetricThresholds {
  return {
    cpu: { warn: r.cpu.warn, crit: r.cpu.crit },
    ram: { warn: r.ram.warn, crit: r.ram.crit },
    disk: { warn: r.disk.warn, crit: r.disk.crit },
    diskByMount: r.diskByMount,
  };
}

export const thresholdsApi = {
  // ── Tenant-level default (cascade layer 3) ──────────────────────
  async getTenantThresholds(): Promise<MetricThresholds | null> {
    const res = await apiClient.get<ApiResponse<{ thresholds: MetricThresholds | null }>>('/tenants/current/thresholds');
    return res.data.data?.thresholds ?? null;
  },
  async setTenantThresholds(thresholds: MetricThresholds | null): Promise<MetricThresholds | null> {
    const res = await apiClient.put<ApiResponse<{ thresholds: MetricThresholds | null }>>('/tenants/current/thresholds', { thresholds });
    return res.data.data?.thresholds ?? null;
  },
  /** Effective values inherited at the tenant layer — feeds the
   *  group editor's `inheritedFrom` placeholder. */
  async getTenantResolved(): Promise<ResolvedThresholds> {
    const res = await apiClient.get<ApiResponse<ResolvedThresholds>>('/tenants/current/thresholds-resolved');
    return res.data.data!;
  },

  // ── Group resolved (read-only, for DeviceDetailPage placeholder) ──
  async getGroupResolved(groupId: number): Promise<ResolvedThresholds> {
    const res = await apiClient.get<ApiResponse<ResolvedThresholds>>(`/groups/${groupId}/thresholds-resolved`);
    return res.data.data!;
  },
};
