import { db } from '../db';
import type { MetricThresholds, ResolvedThresholds } from '@obliance/shared';
import {
  resolveCascade,
  computeMetricStatus,
  type CascadeLayer,
} from './thresholdCascade';

export { isExcludedDisk } from './thresholdCascade';
export type { ResolvedThresholds } from '@obliance/shared';

// Lot D.2 + Lot D.3 — Threshold cascade resolver (DB side).
//
// Layers, outermost → innermost; the innermost layer that sets a slot wins:
//   1. system default            (SYSTEM_DEFAULT_THRESHOLDS in shared)
//   2. global default            (app_config.metric_thresholds_global)
//   3. tenant default            (tenants.metric_thresholds_default)
//   (3b. ancestors of the device's group — `notify` switches ONLY)
//   4. group.thresholds          (set on the device's group)
//   5. device.thresholds_override (set on the device itself)
//
// Each metric (disk / cpu / ram) has independent { warn, crit, notify }
// slots, and each slot is resolved separately — so a device can override
// only the `crit` of `disk` and inherit everything else. The pure merge
// lives in `thresholdCascade.ts` (see the rules there, incl. diskByMount).
//
// Walk-up note: warn / crit still inherit from the device's DIRECT group
// only (historical, flat). The per-metric alerts switch (`notify`) walks
// every ancestor group, root → leaf, so a sub-group inherits its parent's
// switch unless it overrides it.
//
// Caching: the global + tenant layers and the group tree are read on every
// push for every device, which would be N queries on a large fleet. We
// cache them in memory with a small TTL (60s) — admin edits are rare. The
// write endpoints (settings, policies, group service) invalidate the
// caches right after a save.

const APP_CONFIG_KEY = 'metric_thresholds_global';
const CACHE_TTL_MS = 60_000;

interface TenantLayer { thresholds: MetricThresholds | null; name: string | null }
interface GroupNode {
  id: number;
  parentId: number | null;
  tenantId: number;
  name: string;
  thresholds: MetricThresholds | null;
}

let globalCache: { value: MetricThresholds | null; at: number } | null = null;
const tenantCache = new Map<number, { value: TenantLayer; at: number }>();
let groupIndexCache: { value: Map<number, GroupNode>; at: number } | null = null;
let groupIndexLoading: Promise<Map<number, GroupNode>> | null = null;
let groupIndexGen = 0;

async function loadGlobal(): Promise<MetricThresholds | null> {
  const now = Date.now();
  if (globalCache && now - globalCache.at < CACHE_TTL_MS) return globalCache.value;
  const row = await db('app_config').where({ key: APP_CONFIG_KEY }).first('value') as { value: string } | undefined;
  const parsed = parseJson(row?.value ?? null);
  globalCache = { value: parsed, at: now };
  return parsed;
}

async function loadTenant(tenantId: number): Promise<TenantLayer> {
  const now = Date.now();
  const cached = tenantCache.get(tenantId);
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.value;
  const row = await db('tenants').where({ id: tenantId }).first('metric_thresholds_default', 'name') as { metric_thresholds_default: MetricThresholds | string | null; name: string | null } | undefined;
  const value: TenantLayer = { thresholds: parseJson(row?.metric_thresholds_default ?? null), name: row?.name ?? null };
  tenantCache.set(tenantId, { value, at: now });
  return value;
}

/** Every group of the install (id → node), used to walk ancestors in
 *  memory. One small query per minute (or per group edit) instead of one
 *  closure query per push. */
async function loadGroupIndex(): Promise<Map<number, GroupNode>> {
  const now = Date.now();
  if (groupIndexCache && now - groupIndexCache.at < CACHE_TTL_MS) return groupIndexCache.value;
  if (groupIndexLoading) return groupIndexLoading;
  const gen = groupIndexGen;
  const loading = (async () => {
    const rows = await db('device_groups')
      .select('id', 'parent_id', 'tenant_id', 'name', 'thresholds') as Array<{
        id: number; parent_id: number | null; tenant_id: number; name: string;
        thresholds: MetricThresholds | string | null;
      }>;
    const map = new Map<number, GroupNode>();
    for (const r of rows) {
      map.set(r.id, {
        id: r.id,
        parentId: r.parent_id,
        tenantId: r.tenant_id,
        name: r.name,
        thresholds: parseJson(r.thresholds),
      });
    }
    // Don't cache a snapshot that an invalidation raced with.
    if (gen === groupIndexGen) groupIndexCache = { value: map, at: Date.now() };
    return map;
  })();
  groupIndexLoading = loading;
  try {
    return await loading;
  } finally {
    if (groupIndexLoading === loading) groupIndexLoading = null;
  }
}

/** Ancestors of `groupId`, root first, EXCLUDING the group itself. */
function ancestorsOf(index: Map<number, GroupNode>, groupId: number): GroupNode[] {
  const chain: GroupNode[] = [];
  const seen = new Set<number>([groupId]);
  let parentId = index.get(groupId)?.parentId ?? null;
  while (parentId != null && !seen.has(parentId) && chain.length < 64) {
    const node = index.get(parentId);
    if (!node) break;
    seen.add(node.id);
    chain.push(node);
    parentId = node.parentId;
  }
  return chain.reverse();
}

export function invalidateGlobalThresholdCache(): void { globalCache = null; }
export function invalidateTenantThresholdCache(tenantId: number): void { tenantCache.delete(tenantId); }
/** Call after any group create / update / move / delete. */
export function invalidateGroupThresholdCache(): void {
  groupIndexGen++;
  groupIndexCache = null;
  groupIndexLoading = null;
}

function buildLayers(opts: {
  global: MetricThresholds | null;
  tenant?: { id: number; layer: TenantLayer } | null;
  ancestors?: GroupNode[];
  group?: { id: number; name: string | null; thresholds: MetricThresholds | null } | null;
  device?: { id: number; name: string | null; thresholds: MetricThresholds | null } | null;
}): CascadeLayer[] {
  const layers: CascadeLayer[] = [
    { origin: { layer: 'global', id: null, name: null }, thresholds: opts.global, values: true },
  ];
  if (opts.tenant) {
    layers.push({ origin: { layer: 'tenant', id: opts.tenant.id, name: opts.tenant.layer.name }, thresholds: opts.tenant.layer.thresholds, values: true });
  }
  for (const a of opts.ancestors ?? []) {
    layers.push({ origin: { layer: 'group', id: a.id, name: a.name }, thresholds: a.thresholds, values: false });
  }
  if (opts.group) {
    layers.push({ origin: { layer: 'group', id: opts.group.id, name: opts.group.name }, thresholds: opts.group.thresholds, values: true });
  }
  if (opts.device) {
    layers.push({ origin: { layer: 'device', id: opts.device.id, name: opts.device.name }, thresholds: opts.device.thresholds, values: true });
  }
  return layers;
}

type DeviceThresholdRow = {
  id: number;
  tenant_id: number;
  group_id: number | null;
  hostname: string | null;
  display_name: string | null;
  device_override: MetricThresholds | string | null;
  group_thresholds: MetricThresholds | string | null;
  group_name: string | null;
};

export const thresholdService = {
  /**
   * Resolve the full thresholds object for a device (every layer, with the
   * origin of each value). Global + tenant + group tree come from cached
   * accessors so the per-push cost stays at one device-row query.
   * `includeDevice: false` stops above the device's own override — what the
   * device would inherit if its override were cleared (device editor).
   */
  async resolveForDevice(deviceId: number, opts: { includeDevice?: boolean } = {}): Promise<ResolvedThresholds> {
    const row = await db('devices as d')
      .leftJoin('device_groups as g', 'g.id', 'd.group_id')
      .where('d.id', deviceId)
      .select(
        'd.id',
        'd.tenant_id',
        'd.group_id',
        'd.hostname',
        'd.display_name',
        'd.thresholds_override as device_override',
        'g.thresholds as group_thresholds',
        'g.name as group_name',
      )
      .first() as DeviceThresholdRow | undefined;
    if (!row) return resolveCascade([]);
    const [glb, ten, index] = await Promise.all([loadGlobal(), loadTenant(row.tenant_id), loadGroupIndex()]);
    return resolveCascade(this._layersForDeviceRow(row, glb, ten, index, opts.includeDevice !== false));
  },

  /**
   * Bulk-resolve thresholds for many devices in one query. Used by the
   * dashboard saturated-disks card and the silent alert re-baseline so we don't
   * issue N queries on a fleet scan. Returns a Map keyed by deviceId.
   */
  async resolveMany(deviceIds: number[]): Promise<Map<number, ResolvedThresholds>> {
    const out = new Map<number, ResolvedThresholds>();
    if (deviceIds.length === 0) return out;
    const rows = await db('devices as d')
      .leftJoin('device_groups as g', 'g.id', 'd.group_id')
      .whereIn('d.id', deviceIds)
      .select(
        'd.id', 'd.tenant_id', 'd.group_id', 'd.hostname', 'd.display_name',
        'd.thresholds_override as device_override',
        'g.thresholds as group_thresholds',
        'g.name as group_name',
      ) as DeviceThresholdRow[];
    const [glb, index] = await Promise.all([loadGlobal(), loadGroupIndex()]);
    // Pre-fetch tenant defaults in one go so resolveMany stays O(1) DB
    // hits regardless of how many tenants the input set spans.
    const tenantMap = await loadTenants(rows.map((r) => r.tenant_id));
    for (const r of rows) {
      out.set(r.id, resolveCascade(this._layersForDeviceRow(r, glb, tenantMap.get(r.tenant_id)!, index, true)));
    }
    return out;
  },

  /** Global layer only (+ system) — what a tenant inherits (tenant editor). */
  async resolveGlobal(): Promise<ResolvedThresholds> {
    const glb = await loadGlobal();
    return resolveCascade(buildLayers({ global: glb }));
  },

  /**
   * Resolve the cascade up to (and including) the tenant layer — the
   * effective default a root group inherits if it sets nothing of its own.
   */
  async resolveForTenant(tenantId: number): Promise<ResolvedThresholds> {
    const [glb, ten] = await Promise.all([loadGlobal(), loadTenant(tenantId)]);
    return resolveCascade(buildLayers({ global: glb, tenant: { id: tenantId, layer: ten } }));
  },

  /**
   * Resolve the cascade for a group, using the GROUP's own tenant layer
   * (not the caller's — matters in the master god view). With
   * `includeSelf: false` the group's own values are left out: that is what
   * the group inherits (group editor: greyed switch + placeholders). With
   * `includeSelf: true` it is what a device of the group inherits.
   * Returns null when the group does not exist.
   */
  async resolveForGroup(groupId: number, opts: { includeSelf?: boolean } = {}): Promise<ResolvedThresholds | null> {
    const row = await db('device_groups').where({ id: groupId })
      .first('id', 'tenant_id', 'name', 'thresholds') as { id: number; tenant_id: number; name: string; thresholds: MetricThresholds | string | null } | undefined;
    if (!row) return null;
    const [glb, ten, index] = await Promise.all([loadGlobal(), loadTenant(row.tenant_id), loadGroupIndex()]);
    return resolveCascade(buildLayers({
      global: glb,
      tenant: { id: row.tenant_id, layer: ten },
      ancestors: ancestorsOf(index, row.id),
      group: opts.includeSelf === false ? null : { id: row.id, name: row.name, thresholds: parseJson(row.thresholds) },
    }));
  },

  _layersForDeviceRow(
    row: DeviceThresholdRow,
    glb: MetricThresholds | null,
    ten: TenantLayer,
    index: Map<number, GroupNode>,
    includeDevice: boolean,
  ): CascadeLayer[] {
    return buildLayers({
      global: glb,
      tenant: { id: row.tenant_id, layer: ten },
      ancestors: row.group_id != null ? ancestorsOf(index, row.group_id) : [],
      // Direct group read live from the joined row (not the cache), as before.
      group: row.group_id != null
        ? { id: row.group_id, name: row.group_name ?? index.get(row.group_id)?.name ?? null, thresholds: parseJson(row.group_thresholds) }
        : null,
      device: includeDevice
        ? { id: row.id, name: row.display_name || row.hostname || null, thresholds: parseJson(row.device_override) }
        : null,
    });
  },

  /**
   * Compute the worst metric severity for a single push (see
   * thresholdCascade.computeMetricStatus). The alerts switch (`notify`)
   * is NOT applied here — it only filters the notification paths.
   */
  computeMetricStatus,
};

async function loadTenants(tenantIds: number[]): Promise<Map<number, TenantLayer>> {
  const unique = [...new Set(tenantIds)];
  const map = new Map<number, TenantLayer>();
  await Promise.all(unique.map(async (tid) => { map.set(tid, await loadTenant(tid)); }));
  return map;
}

function parseJson(value: unknown): MetricThresholds | null {
  if (value == null) return null;
  if (typeof value === 'string') {
    if (value === '') return null;
    try { return JSON.parse(value) as MetricThresholds; } catch { return null; }
  }
  return value as MetricThresholds;
}
