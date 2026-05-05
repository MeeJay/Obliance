import { db } from '../db';
import type { MetricThresholds, MetricThreshold } from '@obliance/shared';
import { SYSTEM_DEFAULT_THRESHOLDS } from '@obliance/shared';

// Lot D.2 — Threshold cascade resolver.
//
// Three layers, the lower one wins for any field it sets:
//   1. system default            (SYSTEM_DEFAULT_THRESHOLDS in shared)
//   2. group.thresholds          (set on the device's group)
//   3. device.thresholds_override (set on the device itself)
//
// Each metric (disk / cpu / ram) has independent { warn, crit } slots, and
// each slot is resolved separately — so a device can override only the
// `crit` of `disk` and inherit everything else, including its own group's
// custom `warn`.
//
// Walk-up note: if the group is nested under a parent that also defines
// thresholds, we DON'T currently inherit from ancestors — only the device's
// direct group. Adding ancestor inheritance is straightforward (closure
// table walk) but the product spec keeps it flat for now.

interface ResolverInput {
  groupThresholds?: MetricThresholds | null;
  deviceOverride?: MetricThresholds | null;
}

export const thresholdService = {
  /**
   * Merge the cascade for a single metric kind. Returns a fully-populated
   * { warn, crit } pair so callers never have to deal with undefined.
   */
  resolveMetric(metric: keyof typeof SYSTEM_DEFAULT_THRESHOLDS, input: ResolverInput): Required<MetricThreshold> {
    const sys = SYSTEM_DEFAULT_THRESHOLDS[metric];
    const grp = (input.groupThresholds ?? {})[metric] ?? {};
    const dev = (input.deviceOverride  ?? {})[metric] ?? {};
    return {
      warn: dev.warn ?? grp.warn ?? sys.warn,
      crit: dev.crit ?? grp.crit ?? sys.crit,
    };
  },

  /**
   * Resolve the full thresholds object for a device. Looks up the group's
   * thresholds and the device's override in two queries; for fleet-wide
   * dashboards (e.g. saturated-disks scan) prefer `resolveMany` which uses
   * a single grouped query.
   */
  async resolveForDevice(deviceId: number): Promise<Record<keyof typeof SYSTEM_DEFAULT_THRESHOLDS, Required<MetricThreshold>>> {
    const row = await db('devices as d')
      .leftJoin('device_groups as g', 'g.id', 'd.group_id')
      .where('d.id', deviceId)
      .select('d.thresholds_override as device_override', 'g.thresholds as group_thresholds')
      .first() as { device_override: MetricThresholds | string | null; group_thresholds: MetricThresholds | string | null } | undefined;
    return this._merge(parseJson(row?.device_override), parseJson(row?.group_thresholds));
  },

  /**
   * Bulk-resolve thresholds for many devices in one query. Used by the
   * dashboard saturated-disks card so we don't issue N queries on a fleet
   * scan. Returns a Map keyed by deviceId.
   */
  async resolveMany(deviceIds: number[]): Promise<Map<number, Record<keyof typeof SYSTEM_DEFAULT_THRESHOLDS, Required<MetricThreshold>>>> {
    const out = new Map<number, Record<keyof typeof SYSTEM_DEFAULT_THRESHOLDS, Required<MetricThreshold>>>();
    if (deviceIds.length === 0) return out;
    const rows = await db('devices as d')
      .leftJoin('device_groups as g', 'g.id', 'd.group_id')
      .whereIn('d.id', deviceIds)
      .select('d.id', 'd.thresholds_override as device_override', 'g.thresholds as group_thresholds') as Array<{
        id: number;
        device_override: MetricThresholds | string | null;
        group_thresholds: MetricThresholds | string | null;
      }>;
    for (const r of rows) {
      out.set(r.id, this._merge(parseJson(r.device_override), parseJson(r.group_thresholds)));
    }
    return out;
  },

  _merge(deviceOverride: MetricThresholds | null, groupThresholds: MetricThresholds | null): Record<keyof typeof SYSTEM_DEFAULT_THRESHOLDS, Required<MetricThreshold>> {
    const input = { groupThresholds, deviceOverride };
    return {
      disk: this.resolveMetric('disk', input),
      cpu:  this.resolveMetric('cpu',  input),
      ram:  this.resolveMetric('ram',  input),
    };
  },
};

function parseJson(value: unknown): MetricThresholds | null {
  if (value == null) return null;
  if (typeof value === 'string') {
    try { return JSON.parse(value) as MetricThresholds; } catch { return null; }
  }
  return value as MetricThresholds;
}
