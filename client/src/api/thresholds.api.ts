import apiClient from './client';
import type { MetricThresholds, ResolvedThresholds } from '@obliance/shared';

export type { ResolvedThresholds } from '@obliance/shared';

interface ApiResponse<T> { data?: T; error?: string; }

// Resolved thresholds = the cascade output for a given layer (every
// metric carries a fully-populated { warn, crit, notify } plus the origin
// — layer + name — of each value, and the per-mount override map). The
// editors of the lower layers pass it as `inheritedFrom`: placeholders for
// warn / crit, greyed "Alerts" switch + "Inherited from …" for notify.
//
// `?scope=parent` variants return what the edited layer INHERITS (its own
// values left out), so a saved value is never echoed back as "inherited".

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
  /** Effective values of the current tenant. `scope: 'parent'` = what the
   *  tenant layer inherits (global + system) — tenant thresholds tab. */
  async getTenantResolved(opts: { scope?: 'parent' } = {}): Promise<ResolvedThresholds> {
    const res = await apiClient.get<ApiResponse<ResolvedThresholds>>('/tenants/current/thresholds-resolved', {
      params: opts.scope ? { scope: opts.scope } : undefined,
    });
    return res.data.data!;
  },

  // ── Group resolved (read-only) ──
  /** `scope: 'parent'` = what the group inherits (tenant + ancestor
   *  groups), for the group editor. Without it: what its devices inherit. */
  async getGroupResolved(groupId: number, opts: { scope?: 'parent' } = {}): Promise<ResolvedThresholds> {
    const res = await apiClient.get<ApiResponse<ResolvedThresholds>>(`/groups/${groupId}/thresholds-resolved`, {
      params: opts.scope ? { scope: opts.scope } : undefined,
    });
    return res.data.data!;
  },

  // ── Device resolved (read-only) ──
  /** `scope: 'parent'` = what the device inherits if its own override is
   *  cleared (group chain, or tenant when ungrouped) — device editor. */
  async getDeviceResolved(deviceId: number, opts: { scope?: 'parent' } = {}): Promise<ResolvedThresholds> {
    const res = await apiClient.get<ApiResponse<ResolvedThresholds>>(`/devices/${deviceId}/thresholds-resolved`, {
      params: opts.scope ? { scope: opts.scope } : undefined,
    });
    return res.data.data!;
  },
};
