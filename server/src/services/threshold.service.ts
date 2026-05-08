import { db } from '../db';
import type { MetricThresholds, MetricThreshold, GenericMetricKind } from '@obliance/shared';
import { SYSTEM_DEFAULT_THRESHOLDS } from '@obliance/shared';

// Lot D.2 + Lot D.3 — Threshold cascade resolver.
//
// Five layers; the lower one wins for any field it sets:
//   1. system default            (SYSTEM_DEFAULT_THRESHOLDS in shared)
//   2. global default            (app_config.metric_thresholds_global)
//   3. tenant default            (tenants.metric_thresholds_default)
//   4. group.thresholds          (set on the device's group)
//   5. device.thresholds_override (set on the device itself)
//
// Each metric (disk / cpu / ram) has independent { warn, crit } slots, and
// each slot is resolved separately — so a device can override only the
// `crit` of `disk` and inherit everything else, including its own
// tenant's custom `warn`.
//
// Walk-up note: if the group is nested under a parent that also defines
// thresholds, we DON'T currently inherit from ancestors — only the device's
// direct group. Adding ancestor inheritance is straightforward (closure
// table walk) but the product spec keeps it flat for now.
//
// Caching: the global + tenant layers are read on every push for every
// device, which would be N queries on a large fleet. We cache them in
// memory with a small TTL (60s) — admin edits are rare and the next
// minute of pushes still seeing the old value is acceptable. The
// /settings + /policies write endpoints call invalidateGlobal /
// invalidateTenant after a save so the change shows up immediately on
// the editing admin's view.

interface ResolverInput {
  globalThresholds?: MetricThresholds | null;
  tenantThresholds?: MetricThresholds | null;
  groupThresholds?: MetricThresholds | null;
  deviceOverride?: MetricThresholds | null;
}

const APP_CONFIG_KEY = 'metric_thresholds_global';
const CACHE_TTL_MS = 60_000;
let globalCache: { value: MetricThresholds | null; at: number } | null = null;
const tenantCache = new Map<number, { value: MetricThresholds | null; at: number }>();

async function loadGlobal(): Promise<MetricThresholds | null> {
  const now = Date.now();
  if (globalCache && now - globalCache.at < CACHE_TTL_MS) return globalCache.value;
  const row = await db('app_config').where({ key: APP_CONFIG_KEY }).first('value') as { value: string } | undefined;
  const parsed = parseJson(row?.value ?? null);
  globalCache = { value: parsed, at: now };
  return parsed;
}

async function loadTenant(tenantId: number): Promise<MetricThresholds | null> {
  const now = Date.now();
  const cached = tenantCache.get(tenantId);
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.value;
  const row = await db('tenants').where({ id: tenantId }).first('metric_thresholds_default') as { metric_thresholds_default: MetricThresholds | string | null } | undefined;
  const parsed = parseJson(row?.metric_thresholds_default ?? null);
  tenantCache.set(tenantId, { value: parsed, at: now });
  return parsed;
}

export function invalidateGlobalThresholdCache(): void { globalCache = null; }
export function invalidateTenantThresholdCache(tenantId: number): void { tenantCache.delete(tenantId); }

/**
 * Resolved thresholds for a single device — every metric carries a
 * fully-populated { warn, crit }. `diskByMount` is the per-mount-point
 * override map (tighter / looser thresholds on a specific drive); the
 * default `disk` slot still applies to mounts not listed.
 */
export interface ResolvedThresholds {
  cpu:  Required<MetricThreshold>;
  ram:  Required<MetricThreshold>;
  disk: Required<MetricThreshold>;
  diskByMount: Record<string, Required<MetricThreshold>>;
}

export const thresholdService = {
  /**
   * Merge the cascade for a single metric kind. Returns a fully-populated
   * { warn, crit } pair so callers never have to deal with undefined.
   */
  resolveMetric(metric: GenericMetricKind, input: ResolverInput): Required<MetricThreshold> {
    const sys = SYSTEM_DEFAULT_THRESHOLDS[metric];
    const glb = ((input.globalThresholds ?? {})[metric] ?? {}) as MetricThreshold;
    const ten = ((input.tenantThresholds ?? {})[metric] ?? {}) as MetricThreshold;
    const grp = ((input.groupThresholds  ?? {})[metric] ?? {}) as MetricThreshold;
    const dev = ((input.deviceOverride   ?? {})[metric] ?? {}) as MetricThreshold;
    return {
      warn: dev.warn ?? grp.warn ?? ten.warn ?? glb.warn ?? sys.warn,
      crit: dev.crit ?? grp.crit ?? ten.crit ?? glb.crit ?? sys.crit,
    };
  },

  /**
   * Resolve the full thresholds object for a device. Reads every layer
   * of the cascade — global + tenant defaults are pulled from cached
   * accessors so the per-push cost stays at one device-row query.
   */
  async resolveForDevice(deviceId: number): Promise<ResolvedThresholds> {
    const row = await db('devices as d')
      .leftJoin('device_groups as g', 'g.id', 'd.group_id')
      .where('d.id', deviceId)
      .select(
        'd.tenant_id',
        'd.thresholds_override as device_override',
        'g.thresholds as group_thresholds',
      )
      .first() as { tenant_id: number; device_override: MetricThresholds | string | null; group_thresholds: MetricThresholds | string | null } | undefined;
    if (!row) return this._merge({});
    const [glb, ten] = await Promise.all([loadGlobal(), loadTenant(row.tenant_id)]);
    return this._merge({
      globalThresholds: glb,
      tenantThresholds: ten,
      groupThresholds: parseJson(row.group_thresholds),
      deviceOverride: parseJson(row.device_override),
    });
  },

  /**
   * Bulk-resolve thresholds for many devices in one query. Used by the
   * dashboard saturated-disks card so we don't issue N queries on a fleet
   * scan. Returns a Map keyed by deviceId.
   */
  async resolveMany(deviceIds: number[]): Promise<Map<number, ResolvedThresholds>> {
    const out = new Map<number, ResolvedThresholds>();
    if (deviceIds.length === 0) return out;
    const rows = await db('devices as d')
      .leftJoin('device_groups as g', 'g.id', 'd.group_id')
      .whereIn('d.id', deviceIds)
      .select('d.id', 'd.tenant_id', 'd.thresholds_override as device_override', 'g.thresholds as group_thresholds') as Array<{
        id: number;
        tenant_id: number;
        device_override: MetricThresholds | string | null;
        group_thresholds: MetricThresholds | string | null;
      }>;
    const glb = await loadGlobal();
    // Pre-fetch tenant defaults in one go so resolveMany stays O(1) DB
    // hits regardless of how many tenants the input set spans.
    const tenantIds = [...new Set(rows.map((r) => r.tenant_id))];
    const tenantMap = new Map<number, MetricThresholds | null>();
    await Promise.all(tenantIds.map(async (tid) => {
      tenantMap.set(tid, await loadTenant(tid));
    }));
    for (const r of rows) {
      out.set(r.id, this._merge({
        globalThresholds: glb,
        tenantThresholds: tenantMap.get(r.tenant_id) ?? null,
        groupThresholds: parseJson(r.group_thresholds),
        deviceOverride: parseJson(r.device_override),
      }));
    }
    return out;
  },

  /**
   * Resolve the cascade up to (but not including) the group layer — the
   * effective default a fresh group inherits if it sets nothing of its
   * own. Used by `GroupEditPage` so its `inheritedFrom` placeholder
   * shows the tenant's defaults rather than the system fallback.
   */
  async resolveForTenant(tenantId: number): Promise<ResolvedThresholds> {
    const [glb, ten] = await Promise.all([loadGlobal(), loadTenant(tenantId)]);
    return this._merge({ globalThresholds: glb, tenantThresholds: ten });
  },

  /**
   * Resolve the cascade up to (but not including) the device layer — the
   * effective default a device inherits if it sets no override of its
   * own. Used by `DeviceDetailPage` so its `inheritedFrom` placeholder
   * shows the group's resolved defaults (which themselves include the
   * tenant + global cascade).
   */
  async resolveForGroup(groupId: number, tenantId: number): Promise<ResolvedThresholds> {
    const row = await db('device_groups').where({ id: groupId }).first('thresholds') as { thresholds: MetricThresholds | string | null } | undefined;
    const [glb, ten] = await Promise.all([loadGlobal(), loadTenant(tenantId)]);
    return this._merge({
      globalThresholds: glb,
      tenantThresholds: ten,
      groupThresholds: parseJson(row?.thresholds ?? null),
    });
  },

  _merge(input: ResolverInput): ResolvedThresholds {
    // Merge per-mount disk overrides — innermost layer wins per key.
    const byMount: Record<string, Required<MetricThreshold>> = {};
    const baseDisk = this.resolveMetric('disk', input);
    const merged: Record<string, MetricThreshold> = {
      ...(input.globalThresholds?.diskByMount ?? {}),
      ...(input.tenantThresholds?.diskByMount ?? {}),
      ...(input.groupThresholds?.diskByMount ?? {}),
      ...(input.deviceOverride?.diskByMount ?? {}),
    };
    for (const [mount, t] of Object.entries(merged)) {
      byMount[mount] = { warn: t.warn ?? baseDisk.warn, crit: t.crit ?? baseDisk.crit };
    }
    return {
      disk: baseDisk,
      cpu:  this.resolveMetric('cpu',  input),
      ram:  this.resolveMetric('ram',  input),
      diskByMount: byMount,
    };
  },

  /**
   * Compute the worst metric severity for a single push. Iterates cpu /
   * ram / max disk percent, compares to the resolved thresholds, returns
   * 'critical' if any metric is at-or-above its crit slot, else 'warning'
   * if at-or-above warn, else 'ok'. Disk severity is taken from the
   * fullest filesystem reported in the push so a single saturated drive
   * pulls the device into warning even if the others are quiet.
   *
   * Also returns the breach details (which metric, at what %, against
   * which threshold) for the notification body.
   */
  computeMetricStatus(
    metrics: { cpu?: { percent?: number | null }; memory?: { percent?: number | null }; disks?: Array<{ mount?: string; percent?: number | null; fstype?: string; removable?: boolean }> } | null | undefined,
    thresholds: ResolvedThresholds,
  ): { status: 'ok' | 'warning' | 'critical'; breaches: Array<{ metric: 'cpu' | 'ram' | 'disk'; percent: number; level: 'warning' | 'critical'; mount?: string }> } {
    const breaches: Array<{ metric: 'cpu' | 'ram' | 'disk'; percent: number; level: 'warning' | 'critical'; mount?: string }> = [];
    if (!metrics) return { status: 'ok', breaches };

    const evalAgainst = (metric: 'cpu' | 'ram' | 'disk', pct: number | null | undefined, t: Required<MetricThreshold>, mount?: string) => {
      if (pct == null || !Number.isFinite(pct)) return;
      if (pct >= t.crit)      breaches.push({ metric, percent: pct, level: 'critical', mount });
      else if (pct >= t.warn) breaches.push({ metric, percent: pct, level: 'warning', mount });
    };
    evalAgainst('cpu', metrics.cpu?.percent ?? null, thresholds.cpu);
    evalAgainst('ram', metrics.memory?.percent ?? null, thresholds.ram);
    if (Array.isArray(metrics.disks) && metrics.disks.length > 0) {
      // Per-mount: every disk is evaluated against its specific
      // override (or the default disk threshold when no override is
      // set). Each saturated mount produces its own breach so the
      // notification body and the trigger filter both know which
      // drive crossed. Removable / optical disks are skipped — a 100%
      // full ISO is normal, and a USB key shouldn't trigger fleet-wide
      // alerts the way a system disk does.
      for (const d of metrics.disks) {
        if (isExcludedDisk(d)) continue;
        const mount = d.mount;
        const pct = typeof d.percent === 'number' ? d.percent : null;
        const t = (mount && thresholds.diskByMount[mount]) ? thresholds.diskByMount[mount] : thresholds.disk;
        evalAgainst('disk', pct, t, mount);
      }
    }

    let status: 'ok' | 'warning' | 'critical' = 'ok';
    for (const b of breaches) {
      if (b.level === 'critical') { status = 'critical'; break; }
      if (b.level === 'warning')  status = 'warning';
    }
    return { status, breaches };
  },
};

/**
 * Decide whether a disk should be skipped by every threshold pipeline
 * (notifications, status flip, dashboard saturated card, scenario
 * triggers). Three signals:
 *
 *   1. Agent-reported `removable` flag (Windows GetDriveType, Linux
 *      /sys/block/*\/removable, macOS DiskArbitration). Most reliable
 *      when present.
 *   2. Filesystem type — iso9660 / udf / cdfs are optical media, full
 *      by nature.
 *   3. Mount-path heuristic — covers older agents that don't yet
 *      populate `removable`/`fstype`. Conservative: only matches paths
 *      that are unambiguously external (`/media/<user>/`, `/mnt/`,
 *      `/run/media/`, macOS `/Volumes/*` except boot, Windows mounts
 *      without a stable letter aren't filterable here — they need
 *      the agent flag).
 *
 * The whole helper is exported so the dashboard's saturated-disks
 * scan reuses the same logic.
 */
export function isExcludedDisk(d: { mount?: string; fstype?: string; removable?: boolean }): boolean {
  if (d.removable === true) return true;
  const fs = (d.fstype ?? '').toLowerCase();
  if (fs === 'iso9660' || fs === 'udf' || fs === 'cdfs') return true;
  const mount = d.mount ?? '';
  // Linux convention — mount points under /media or /mnt are usually
  // user-mounted external drives. We exclude /run/media/ for the same
  // reason (systemd's auto-mount path).
  if (/^\/(media|mnt|run\/media)(\/|$)/.test(mount)) return true;
  // macOS mounts every external volume under /Volumes; the boot disk
  // is the special "Macintosh HD" or the user-renamed equivalent
  // attached at /. We can't tell from path alone whether a /Volumes/*
  // entry is the boot volume or a USB key, so we exclude all of them
  // for safety. The boot disk itself shows up at `/`.
  if (/^\/Volumes\//.test(mount)) return true;
  return false;
}

function parseJson(value: unknown): MetricThresholds | null {
  if (value == null) return null;
  if (typeof value === 'string') {
    try { return JSON.parse(value) as MetricThresholds; } catch { return null; }
  }
  return value as MetricThresholds;
}
