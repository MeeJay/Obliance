import path from 'path';
import fs from 'fs';
import { Server as SocketIOServer } from 'socket.io';
import { db } from '../db';
import { logger } from '../utils/logger';
import { SocketEvents, isMasterTenant } from '@obliance/shared';
import type { Device, DeviceMetrics, AgentPushRequest, AgentPushResponse, CommandAck } from '@obliance/shared';
import { appConfigService } from './appConfig.service';
import { settingsService } from './settings.service';
import { SETTINGS_KEYS } from '@obliance/shared';
import { obligateService } from './obligate.service';

// ── Agent version cache (re-read from disk every 5 min) ──────────────────────
let _cachedVersion: string | null = null;
let _cachedVersionAt = 0;

function getAgentVersion(): string {
  const now = Date.now();
  if (_cachedVersion && now - _cachedVersionAt < 5 * 60 * 1000) {
    return _cachedVersion;
  }
  // 1. agent/VERSION plain-text file (source of truth, present in dev + prod)
  try {
    const vp = path.resolve(__dirname, '../../../../agent/VERSION');
    const v = fs.readFileSync(vp, 'utf-8').trim();
    if (v) { _cachedVersion = v; _cachedVersionAt = now; return v; }
  } catch { /* fall through */ }
  // 2. Compiled dist artefact — version-agent.json
  try {
    const jp = path.resolve(__dirname, '../../../../agent/dist/version-agent.json');
    const raw = JSON.parse(fs.readFileSync(jp, 'utf-8')) as { version: string };
    if (raw.version) { _cachedVersion = raw.version; _cachedVersionAt = now; return raw.version; }
  } catch { /* fall through */ }
  return '';
}

class DeviceService {
  private io: SocketIOServer | null = null;

  setIO(io: SocketIOServer) { this.io = io; }

  // ─── Row mapper ────────────────────────────────────────────────────────────
  rowToDevice(row: any): Device {
    return {
      id: row.id,
      uuid: row.uuid,
      tenantId: row.tenant_id,
      // Surfaces only when the row was joined with `tenants` (master/god
      // view queries do this so the UI can group devices by tenant).
      tenantName: row.tenant_name ?? null,
      groupId: row.group_id,
      apiKeyId: row.api_key_id,
      hostname: row.hostname,
      displayName: row.display_name,
      description: row.description,
      ipLocal: row.ip_local,
      ipPublic: row.ip_public,
      macAddress: row.mac_address,
      osType: row.os_type,
      osName: row.os_name,
      osVersion: row.os_version,
      osBuild: row.os_build,
      osArch: row.os_arch,
      cpuModel: row.cpu_model,
      cpuCores: row.cpu_cores,
      ramTotalGb: row.ram_total_gb,
      agentVersion: row.agent_version,
      status: row.status,
      approvalStatus: row.approval_status,
      approvedBy: row.approved_by,
      approvedAt: row.approved_at,
      lastSeenAt: row.last_seen_at,
      lastPushAt: row.last_push_at,
      pushIntervalSeconds: row.push_interval_seconds,
      scanIntervalSeconds: row.scan_interval_seconds ?? null,
      overrideGroupSettings: row.override_group_settings,
      maxMissedPushes: row.max_missed_pushes,
      complianceRemediationEnabled: row.compliance_remediation_enabled ?? true,
      privacyModeEnabled: row.privacy_mode_enabled ?? false,
      privacyPasswordSet: row.privacy_password_set ?? false,
      privacyPasswordSetAt: row.privacy_password_set_at ?? null,
      airgapEnabled: row.airgap_enabled ?? false,
      airgapEnabledAt: row.airgap_enabled_at ?? null,
      watchdogRestartCount: row.watchdog_restart_count ?? 0,
      watchdogLastRestartAt: row.watchdog_last_restart_at ?? null,
      agentFlavor: (row.agent_flavor ?? 'modern') as 'modern' | 'legacy',
      lastLoggedInUser: row.last_logged_in_user ?? null,
      lastRebootAt: row.last_reboot_at ?? null,
      rebootPending: row.reboot_pending ?? false,
      timezone: row.timezone ?? null,
      tags: row.tags || [],
      customFields: row.custom_fields || {},
      thresholdsOverride: row.thresholds_override
        ? (typeof row.thresholds_override === 'string' ? JSON.parse(row.thresholds_override) : row.thresholds_override)
        : {},
      metricAlertsEnabled: typeof row.metric_alerts_enabled === 'boolean' ? row.metric_alerts_enabled : null,
      displayConfig: row.display_config || {},
      sensorDisplayNames: row.sensor_display_names || {},
      notificationTypes: row.notification_types || {},
      latestMetrics: row.latest_metrics || {},
      geoLat: row.geo_lat ? parseFloat(row.geo_lat) : null,
      geoLng: row.geo_lng ? parseFloat(row.geo_lng) : null,
      geoCity: row.geo_city ?? null,
      geoCountry: row.geo_country ?? null,
      geoRegion: row.geo_region ?? null,
      purchaseDate: row.purchase_date ?? null,
      warrantyExpiry: row.warranty_expiry ?? null,
      warrantyVendor: row.warranty_vendor ?? null,
      warrantyStatus: row.warranty_status ?? 'unknown',
      expectedLifetimeYears: row.expected_lifetime_years ?? null,
      lifecycleStatus: row.lifecycle_status ?? 'unknown',
      scheduleAlert: row.schedule_alert ? (typeof row.schedule_alert === 'string' ? JSON.parse(row.schedule_alert) : row.schedule_alert) : null,
      uninstallAt: row.uninstall_at ? new Date(row.uninstall_at).toISOString() : null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  // ─── CRUD ─────────────────────────────────────────────────────────────────
  async getDevices(tenantId: number, filters?: {
    groupId?: number; includeSubgroups?: boolean; status?: string; approvalStatus?: string;
    search?: string; osType?: string; page?: number; pageSize?: number;
    sortBy?: string; sortOrder?: 'asc' | 'desc';
    /** When true, only return devices with NULL group_id (the "Ungrouped"
     *  pseudo-group in the sidebar). Takes precedence over groupId. */
    ungrouped?: boolean;
    /** Dashboard hero "Injoignables 72h" → /devices?stale=72. Filter rows
     *  whose last_seen_at is older than the threshold (in hours). */
    staleHours?: number;
    /** Dashboard hero "MAJ en attente" → /devices?pendingUpdates=1. Filter
     *  to only devices with at least one device_updates row in 'available'. */
    pendingUpdates?: boolean;
    /** Lot C 3-tier OS filter: marketing name (e.g. "Microsoft Windows 10
     *  IoT Enterprise LTSC 2021") — exact match. Sub-filter under osType. */
    osName?: string;
    /** Lot C 3-tier OS filter: build / version string (e.g. "10.0.19044.7184").
     *  Exact match. Sub-filter under osName. */
    osVersion?: string;
    /** Restrict to devices carrying ANY of these tags (OR semantics).
     *  Empty/missing means no filter. Tags are matched against the
     *  JSONB array stored on `devices.tags`. */
    tags?: string[];
    /** Master-only: narrow the god-view to a subset of tenants. Sent
     *  by the DeviceTable tenant chips so the master admin can focus
     *  on one customer without losing the cross-tenant view they're
     *  attached to. Ignored when the caller isn't on master. */
    tenantIds?: number[];
  }): Promise<{ items: Device[]; total: number; page: number; pageSize: number }> {
    const page = Math.max(1, filters?.page ?? 1);
    // Cap is intentionally high to support the sidebar which needs to render
    // the entire approved fleet in one request. Callers that paginate the
    // UI (DeviceTable) still use reasonable page sizes from the UI controls.
    const pageSize = Math.min(10000, Math.max(1, filters?.pageSize ?? 100));

    // Master tenant gets the god view: drop the tenant_id filter and
    // join `tenants` so each row carries a `tenant_name` for the UI to
    // group/sort by. Every other tenant stays strictly scoped.
    const isMaster = isMasterTenant(tenantId);
    let q = db('devices')
      .leftJoin('device_groups', 'devices.group_id', 'device_groups.id')
      .leftJoin('tenants', 'devices.tenant_id', 'tenants.id');
    if (!isMaster) q = q.where({ 'devices.tenant_id': tenantId });
    // Master-only narrow filter: subset of tenants. Silently dropped
    // for non-master callers so a crafted query can't widen scope.
    if (isMaster && Array.isArray(filters?.tenantIds) && filters!.tenantIds!.length > 0) {
      q = q.whereIn('devices.tenant_id', filters!.tenantIds!.map(Number).filter(Number.isFinite));
    }
    // Never show pending_uninstall devices in normal listings
    q = q.whereNot({ 'devices.status': 'pending_uninstall' });
    if (filters?.ungrouped) {
      // "Ungrouped" pseudo-filter — devices without any group. Takes
      // precedence over groupId so an accidental ungrouped=true+groupId
      // combination stays predictable.
      q = q.whereNull('devices.group_id');
    } else if (filters?.groupId) {
      if (filters.includeSubgroups) {
        // Include devices from all descendant groups via closure table
        const descendants = await db('device_group_closure')
          .where('ancestor_id', filters.groupId)
          .select('descendant_id');
        const allGroupIds = [filters.groupId, ...descendants.map((d: any) => d.descendant_id)];
        q = q.whereIn('devices.group_id', allGroupIds);
      } else {
        q = q.where({ 'devices.group_id': filters.groupId });
      }
    }
    if (filters?.status) q = q.where({ 'devices.status': filters.status });
    if (filters?.osType) q = q.where({ 'devices.os_type': filters.osType });
    if (filters?.osName) q = q.where({ 'devices.os_name': filters.osName });
    if (filters?.osVersion) q = q.where({ 'devices.os_version': filters.osVersion });
    if (filters?.approvalStatus === 'suspended') {
      q = q.where({ 'devices.status': 'suspended' });
    } else if (filters?.approvalStatus) {
      q = q.where({ 'devices.approval_status': filters.approvalStatus });
    }
    if (typeof filters?.staleHours === 'number' && filters.staleHours > 0) {
      const cutoff = new Date(Date.now() - filters.staleHours * 60 * 60 * 1000);
      q = q.where('devices.last_seen_at', '<', cutoff);
    }
    if (filters?.pendingUpdates) {
      // In god view there's no single tenant_id to filter device_updates
      // by — match on status alone and let the device-side filter rope
      // in the right rows. Still safe because the join above already
      // determined which devices are visible.
      const updatesSubQ = db('device_updates').where({ status: 'available' }).distinct('device_id');
      if (!isMaster) updatesSubQ.where({ tenant_id: tenantId });
      q = q.whereIn('devices.id', updatesSubQ);
    }
    // Tags filter — `tags` is a JSONB array of strings on the
    // devices table. The Postgres `?|` operator returns true when
    // the JSONB value contains ANY of the given keys, which is the
    // OR-semantics we want for the chip-style filter ("show devices
    // with any of these tags"). The `?|` operator collides with
    // knex's own `?` parameter placeholder, so we escape it as
    // `\\?|`. The text[] cast lets us pass a JS array directly.
    if (Array.isArray(filters?.tags) && filters!.tags.length > 0) {
      q = q.whereRaw('devices.tags \\?| ?::text[]', [filters!.tags]);
    }
    if (filters?.search) q = q.where(function() {
      const pat = `%${filters.search}%`;
      // devices.uuid is the PG `uuid` type — ILIKE refuses to match it
      // directly, so cast to text. devices.tags is a JSONB array, also
      // cast to text so a substring match across all tag values works.
      // Other columns are varchar / text — plain ILIKE is fine.
      this.whereILike('devices.hostname', pat)
          .orWhereILike('devices.display_name', pat)
          .orWhereILike('devices.ip_local', pat)
          .orWhereILike('devices.ip_public', pat)
          .orWhereILike('devices.mac_address', pat)
          .orWhereILike('devices.last_logged_in_user', pat)
          .orWhereILike('devices.os_name', pat)
          .orWhereILike('devices.os_version', pat)
          .orWhereILike('devices.agent_version', pat)
          .orWhereILike('devices.geo_city', pat)
          .orWhereILike('devices.geo_country', pat)
          .orWhereILike('devices.description', pat)
          .orWhereRaw('devices.uuid::text ILIKE ?', [pat])
          .orWhereRaw('devices.tags::text ILIKE ?', [pat]);
    });

    const countResult = await q.clone().count('devices.id as count').first();
    const total = Number(countResult?.count ?? 0);

    // Sortable columns. "cpu" / "ram" / "disk" dig into the latest_metrics
    // JSONB blob to sort by the most recent sample percentage. NULL metrics
    // are pushed to the end so online devices bubble up first.
    //
    // Empty/missing sortBy falls back to the device's enrolment order
    // (devices.id ASC), which is "the order they were added" — the user
    // expects this default rather than alpha-sort by hostname when no
    // explicit sort column is selected.
    const SORT_MAP: Record<string, string> = {
      name: 'devices.hostname', status: 'devices.status', os: 'devices.os_type',
      lastSeen: 'devices.last_seen_at', version: 'devices.agent_version', group: 'device_groups.name',
    };
    const sortDir = filters?.sortOrder === 'desc' ? 'desc' : 'asc';
    const nullsOrder = sortDir === 'desc' ? 'NULLS LAST' : 'NULLS LAST';

    const metricSortExpr: Record<string, string> = {
      cpu:  `NULLIF(latest_metrics->'cpu'->>'percent','')::float`,
      ram:  `NULLIF(latest_metrics->'memory'->>'percent','')::float`,
      disk: `NULLIF(latest_metrics->'disks'->0->>'percent','')::float`,
    };

    let qOrdered = q;
    const wantsMetric = filters?.sortBy && metricSortExpr[filters.sortBy];
    if (wantsMetric) {
      qOrdered = qOrdered.orderByRaw(`${metricSortExpr[filters!.sortBy!]} ${sortDir} ${nullsOrder}`);
    } else if (filters?.sortBy && SORT_MAP[filters.sortBy]) {
      qOrdered = qOrdered.orderBy(SORT_MAP[filters.sortBy], sortDir);
    } else {
      // No explicit sort → enrolment order (devices.id ASC).
      qOrdered = qOrdered.orderBy('devices.id', 'asc');
    }

    const rows = await qOrdered
      .select('devices.*', 'device_groups.name as group_name', 'tenants.name as tenant_name')
      .limit(pageSize).offset((page - 1) * pageSize);

    const items = rows.map((row: any) => {
      const device = this.rowToDevice(row);
      (device as any).groupName = row.group_name ?? null;
      return device;
    });

    // Attach custom metrics in a single batch query (avoids N+1).
    await this._attachCustomMetrics(items, isMaster ? null : tenantId);

    return { items, total, page, pageSize };
  }

  /** Batch-load custom metrics for a list of devices and attach them in-place.
   *  Pass `null` for tenantId in master/god-view contexts where the device
   *  set spans tenants and the query must walk every device_custom_metrics
   *  row regardless of its tenant. */
  private async _attachCustomMetrics(devices: Device[], tenantId: number | null): Promise<void> {
    if (devices.length === 0) return;
    const ids = devices.map((d) => d.id);
    const q = db('device_custom_metrics').whereIn('device_id', ids);
    if (tenantId != null) q.where({ tenant_id: tenantId });
    const rows = await q.select('device_id', 'schedule_id', 'name', 'value', 'unit', 'status');
    const byDevice = new Map<number, any[]>();
    for (const r of rows) {
      const list = byDevice.get(r.device_id) ?? [];
      list.push({
        scheduleId: r.schedule_id,
        name: r.name,
        value: r.value,
        unit: r.unit,
        status: r.status,
      });
      byDevice.set(r.device_id, list);
    }
    for (const d of devices) {
      (d as any).customMetrics = byDevice.get(d.id) ?? [];
    }
  }

  /** Legacy non-paginated list — used by sidebar and internal calls. */
  async getDevicesList(tenantId: number, filters?: { groupId?: number; status?: string; approvalStatus?: string; search?: string }): Promise<Device[]> {
    const result = await this.getDevices(tenantId, { ...filters, page: 1, pageSize: 10000 });
    return result.items;
  }

  /**
   * Export-oriented query: same filter semantics as getDevices but no
   * pagination cap, returns every matching row. Used by the /export endpoint
   * to emit a full CSV/XLSX/PDF regardless of how many pages the UI is on.
   */
  async exportDevices(tenantId: number, filters?: {
    groupId?: number; includeSubgroups?: boolean; status?: string; approvalStatus?: string;
    search?: string; osType?: string; sortBy?: string; sortOrder?: 'asc' | 'desc';
    ungrouped?: boolean;
  }): Promise<Device[]> {
    let q = db('devices')
      .leftJoin('device_groups', 'devices.group_id', 'device_groups.id')
      .where({ 'devices.tenant_id': tenantId });
    q = q.whereNot({ 'devices.status': 'pending_uninstall' });
    if (filters?.ungrouped) {
      q = q.whereNull('devices.group_id');
    } else if (filters?.groupId) {
      if (filters.includeSubgroups) {
        const descendants = await db('device_group_closure')
          .where('ancestor_id', filters.groupId)
          .select('descendant_id');
        const allGroupIds = [filters.groupId, ...descendants.map((d: any) => d.descendant_id)];
        q = q.whereIn('devices.group_id', allGroupIds);
      } else {
        q = q.where({ 'devices.group_id': filters.groupId });
      }
    }
    if (filters?.status) q = q.where({ 'devices.status': filters.status });
    if (filters?.osType) q = q.where({ 'devices.os_type': filters.osType });
    if (filters?.approvalStatus === 'suspended') {
      q = q.where({ 'devices.status': 'suspended' });
    } else if (filters?.approvalStatus) {
      q = q.where({ 'devices.approval_status': filters.approvalStatus });
    }
    if (filters?.search) q = q.where(function() {
      const pat = `%${filters.search}%`;
      // devices.uuid is the PG `uuid` type — ILIKE refuses to match it
      // directly, so cast to text. devices.tags is a JSONB array, also
      // cast to text so a substring match across all tag values works.
      // Other columns are varchar / text — plain ILIKE is fine.
      this.whereILike('devices.hostname', pat)
          .orWhereILike('devices.display_name', pat)
          .orWhereILike('devices.ip_local', pat)
          .orWhereILike('devices.ip_public', pat)
          .orWhereILike('devices.mac_address', pat)
          .orWhereILike('devices.last_logged_in_user', pat)
          .orWhereILike('devices.os_name', pat)
          .orWhereILike('devices.os_version', pat)
          .orWhereILike('devices.agent_version', pat)
          .orWhereILike('devices.geo_city', pat)
          .orWhereILike('devices.geo_country', pat)
          .orWhereILike('devices.description', pat)
          .orWhereRaw('devices.uuid::text ILIKE ?', [pat])
          .orWhereRaw('devices.tags::text ILIKE ?', [pat]);
    });

    const SORT_MAP: Record<string, string> = {
      name: 'devices.hostname', status: 'devices.status', os: 'devices.os_type',
      lastSeen: 'devices.last_seen_at', version: 'devices.agent_version', group: 'device_groups.name',
    };
    const sortDir = filters?.sortOrder === 'desc' ? 'desc' : 'asc';
    // Same default as getDevices: empty/missing sortBy → enrolment order.
    const sortCol = (filters?.sortBy && SORT_MAP[filters.sortBy]) ? SORT_MAP[filters.sortBy] : 'devices.id';
    const exportDir = (filters?.sortBy && SORT_MAP[filters.sortBy]) ? sortDir : 'asc';

    const rows = await q
      .select('devices.*', 'device_groups.name as group_name')
      .orderBy(sortCol, exportDir);

    const items = rows.map((row: any) => {
      const device = this.rowToDevice(row);
      (device as any).groupName = row.group_name ?? null;
      return device;
    });
    await this._attachCustomMetrics(items, tenantId);
    return items;
  }

  async getDeviceById(id: number, tenantId: number): Promise<Device | null> {
    // Master tenant sees any device regardless of its owning tenant; child
    // tenants stay strictly scoped. We always join `tenants` so the row
    // carries `tenant_name` for the UI in both modes.
    const isMaster = isMasterTenant(tenantId);
    const q = db('devices')
      .leftJoin('tenants', 'devices.tenant_id', 'tenants.id')
      .where('devices.id', id)
      .select('devices.*', 'tenants.name as tenant_name');
    if (!isMaster) q.where('devices.tenant_id', tenantId);
    const row = await q.first();
    if (!row) return null;
    const device = this.rowToDevice(row);
    await this._attachCustomMetrics([device], isMaster ? null : tenantId);
    return device;
  }

  async getDeviceByUuid(uuid: string, tenantId: number): Promise<Device | null> {
    const isMaster = isMasterTenant(tenantId);
    const q = db('devices').where({ uuid });
    if (!isMaster) q.where({ tenant_id: tenantId });
    const row = await q.first();
    return row ? this.rowToDevice(row) : null;
  }

  async updateDevice(id: number, tenantId: number, data: Partial<{
    displayName: string;
    description: string;
    groupId: number | null;
    tags: string[];
    customFields: Record<string, string>;
    displayConfig: any;
    sensorDisplayNames: any;
    notificationTypes: any;
    pushIntervalSeconds: number | null;
    scanIntervalSeconds: number | null;
    overrideGroupSettings: boolean;
    maxMissedPushes: number;
    complianceRemediationEnabled: boolean;
    purchaseDate: string | null;
    warrantyExpiry: string | null;
    warrantyVendor: string | null;
    warrantyStatus: string | null;
    expectedLifetimeYears: number | null;
    lifecycleStatus: string | null;
    /** Lot D.2 — per-device override of metric thresholds. Empty object
     *  resets the override and falls back to group/system defaults. */
    thresholdsOverride: import('@obliance/shared').MetricThresholds;
    /** Tri-state metric alert toggle. `null` inherits from the group. */
    metricAlertsEnabled: boolean | null;
  }>) {
    const updates: any = { updated_at: new Date() };
    if (data.displayName !== undefined) updates.display_name = data.displayName;
    if (data.description !== undefined) updates.description = data.description;
    if (data.groupId !== undefined) updates.group_id = data.groupId;
    if (data.tags !== undefined) updates.tags = JSON.stringify(data.tags);
    if (data.customFields !== undefined) updates.custom_fields = JSON.stringify(data.customFields);
    if (data.displayConfig !== undefined) updates.display_config = JSON.stringify(data.displayConfig);
    if (data.sensorDisplayNames !== undefined) updates.sensor_display_names = JSON.stringify(data.sensorDisplayNames);
    if (data.notificationTypes !== undefined) updates.notification_types = JSON.stringify(data.notificationTypes);
    if (data.pushIntervalSeconds !== undefined) updates.push_interval_seconds = data.pushIntervalSeconds;
    if (data.scanIntervalSeconds !== undefined) updates.scan_interval_seconds = data.scanIntervalSeconds;
    if (data.overrideGroupSettings !== undefined) updates.override_group_settings = data.overrideGroupSettings;
    if (data.maxMissedPushes !== undefined) updates.max_missed_pushes = data.maxMissedPushes;
    if (data.complianceRemediationEnabled !== undefined) updates.compliance_remediation_enabled = data.complianceRemediationEnabled;
    if (data.purchaseDate !== undefined) updates.purchase_date = data.purchaseDate;
    if (data.warrantyExpiry !== undefined) updates.warranty_expiry = data.warrantyExpiry;
    if (data.warrantyVendor !== undefined) updates.warranty_vendor = data.warrantyVendor;
    if (data.warrantyStatus !== undefined) updates.warranty_status = data.warrantyStatus;
    if (data.expectedLifetimeYears !== undefined) updates.expected_lifetime_years = data.expectedLifetimeYears;
    if (data.lifecycleStatus !== undefined) updates.lifecycle_status = data.lifecycleStatus;
    if (data.thresholdsOverride !== undefined) updates.thresholds_override = JSON.stringify(data.thresholdsOverride);
    if (data.metricAlertsEnabled !== undefined) updates.metric_alerts_enabled = data.metricAlertsEnabled;

    await db('devices').where({ id, tenant_id: tenantId }).update(updates);
    const updated = await this.getDeviceById(id, tenantId);
    if (updated && this.io) {
      this.io.to(`tenant:${tenantId}`).emit(SocketEvents.DEVICE_UPDATED, updated);
    }
    return updated;
  }

  async approveDevice(id: number, tenantId: number, approvedBy: number) {
    // Check if the device's API key has a default group
    const deviceRow = await db('devices').where({ id, tenant_id: tenantId }).first();
    let groupId = deviceRow?.group_id;
    if (!groupId && deviceRow?.api_key_id) {
      const keyRow = await db('agent_api_keys').where({ id: deviceRow.api_key_id }).first();
      if (keyRow?.default_group_id) groupId = keyRow.default_group_id;
    }

    await db('devices').where({ id, tenant_id: tenantId }).update({
      approval_status: 'approved',
      status: 'offline',
      approved_by: approvedBy,
      approved_at: new Date(),
      group_id: groupId ?? null,
      updated_at: new Date(),
    });
    const device = await this.getDeviceById(id, tenantId);
    if (device && this.io) {
      this.io.to(`tenant:${tenantId}`).emit(SocketEvents.DEVICE_APPROVED, device);
    }
    return device;
  }

  async refuseDevice(id: number, tenantId: number) {
    await db('devices').where({ id, tenant_id: tenantId }).update({
      approval_status: 'refused',
      status: 'suspended',
      updated_at: new Date(),
    });
    return this.getDeviceById(id, tenantId);
  }

  async suspendDevice(id: number, tenantId: number) {
    await db('devices').where({ id, tenant_id: tenantId }).update({
      status: 'suspended',
      updated_at: new Date(),
    });
    return this.getDeviceById(id, tenantId);
  }

  async unsuspendDevice(id: number, tenantId: number) {
    await db('devices').where({ id, tenant_id: tenantId }).update({
      status: 'offline',
      updated_at: new Date(),
    });
    return this.getDeviceById(id, tenantId);
  }

  // ─── Uninstall flow ────────────────────────────────────────────────────────
  async initiateUninstall(id: number, tenantId: number) {
    const uninstallAt = new Date(Date.now() + 10 * 60 * 1000);
    await db('devices').where({ id, tenant_id: tenantId }).update({
      status: 'pending_uninstall',
      uninstall_at: uninstallAt,
      updated_at: new Date(),
    });
    const device = await this.getDeviceById(id, tenantId);
    if (device && this.io) {
      // Emit to admin rooms — regular tenant room won't display it anyway (it's hidden)
      this.io.to(`tenant:${tenantId}`).emit(SocketEvents.DEVICE_UPDATED, device);
    }
    return device;
  }

  async cancelUninstall(id: number, tenantId: number) {
    await db('devices').where({ id, tenant_id: tenantId, status: 'pending_uninstall' }).update({
      status: 'offline',
      uninstall_at: null,
      updated_at: new Date(),
    });
    const device = await this.getDeviceById(id, tenantId);
    if (device && this.io) {
      this.io.to(`tenant:${tenantId}`).emit(SocketEvents.DEVICE_UPDATED, device);
    }
    return device;
  }

  // Called every 30s — revert expired pending_uninstall devices back to offline
  async expireUninstalls() {
    const rows = await db('devices')
      .where({ status: 'pending_uninstall' })
      .where('uninstall_at', '<=', new Date())
      .returning(['id', 'tenant_id'])
      .update({
        status: 'offline',
        uninstall_at: null,
        updated_at: new Date(),
      });
    for (const row of (Array.isArray(rows) ? rows : [])) {
      const device = await this.getDeviceById(row.id, row.tenant_id);
      if (device && this.io) {
        this.io.to(`tenant:${row.tenant_id}`).emit(SocketEvents.DEVICE_UPDATED, device);
        logger.info({ deviceId: row.id }, 'Uninstall expired — device restored to offline');
      }
    }
  }

  /**
   * Immediately purge all data tied to a specific device id.
   * Called before hard-deleting the device so no orphaned rows remain,
   * even if the DB-level CASCADE constraint is missing on old instances.
   */
  private async purgeDeviceData(id: number) {
    const tables = [
      'device_updates',
      'command_queue',
      'script_executions',
      'remote_sessions',
      'compliance_results',
      'config_snapshots',
    ];
    for (const table of tables) {
      try {
        await db(table).where({ device_id: id }).delete();
      } catch { /* table may not exist on old schema versions */ }
    }
    // Polymorphic references
    try { await db('update_policies').where({ target_type: 'device', target_id: id }).delete(); } catch { /* ignore */ }
    try { await db('reports').where({ scope_type: 'device', scope_id: id }).delete(); } catch { /* ignore */ }
  }

  async deleteDevice(id: number, tenantId: number) {
    await this.purgeDeviceData(id);
    await db('devices').where({ id, tenant_id: tenantId }).delete();
    if (this.io) {
      this.io.to(`tenant:${tenantId}`).emit(SocketEvents.DEVICE_DELETED, { id });
    }
  }

  /**
   * Self-healing: delete orphaned records that reference devices no longer
   * in the platform. Runs periodically so the DB stays consistent even if
   * a CASCADE constraint was missing or a polymorphic reference (target_id /
   * scope_id) has no FK at the DB level.
   */
  async cleanOrphans() {
    // FK tables (should cascade, but purge any stragglers)
    const fkTables = [
      'device_updates',
      'command_queue',
      'script_executions',
      'remote_sessions',
      'compliance_results',
      'config_snapshots',
    ];

    let total = 0;
    for (const table of fkTables) {
      try {
        const n = await db.raw(`
          DELETE FROM "${table}"
          WHERE device_id IS NOT NULL
            AND device_id NOT IN (SELECT id FROM devices)
        `);
        const count = n?.rowCount ?? 0;
        if (count > 0) {
          total += count;
          logger.warn({ table, count }, 'cleanOrphans: deleted orphaned rows');
        }
      } catch {
        // table might not exist yet (fresh install before migration)
      }
    }

    // Polymorphic references (no DB FK — must be cleaned in code)
    try {
      const b = await db.raw(`
        DELETE FROM update_policies
        WHERE target_type = 'device'
          AND target_id IS NOT NULL
          AND target_id NOT IN (SELECT id FROM devices)
      `);
      total += b?.rowCount ?? 0;
    } catch { /* ignore */ }

    try {
      const c = await db.raw(`
        DELETE FROM reports
        WHERE scope_type = 'device'
          AND scope_id IS NOT NULL
          AND scope_id NOT IN (SELECT id FROM devices)
      `);
      total += c?.rowCount ?? 0;
    } catch { /* ignore */ }

    if (total > 0) {
      logger.warn({ total }, 'cleanOrphans: self-healing complete');
    }
  }

  async bulkApprove(ids: number[], tenantId: number, approvedBy: number) {
    // Approve each device individually so default group from API key is assigned
    for (const id of ids) {
      await this.approveDevice(id, tenantId, approvedBy);
    }
  }

  async bulkDelete(ids: number[], tenantId: number) {
    await Promise.all(ids.map(id => this.purgeDeviceData(id)));
    await db('devices').whereIn('id', ids).where({ tenant_id: tenantId }).delete();
  }

  // ─── Agent registration ───────────────────────────────────────────────────
  async registerDevice(data: {
    uuid: string;
    hostname: string;
    osType: string;
    osName?: string;
    osVersion?: string;
    osBuild?: string;
    osArch?: string;
    cpuModel?: string;
    cpuCores?: number;
    ramTotalGb?: number;
    ipLocal?: string;
    ipPublic?: string;
    macAddress?: string;
    agentVersion?: string;
    agentFlavor?: 'modern' | 'legacy';
    apiKeyId: number;
    tenantId: number;
  }) {
    // Check auto-approve setting
    const autoApprove = await this.getAutoApproveSetting(data.tenantId);
    const approvalStatus = autoApprove ? 'approved' : 'pending';
    const status = autoApprove ? 'offline' : 'pending';

    const existing = await db('devices').where({ uuid: data.uuid, tenant_id: data.tenantId }).first();

    if (existing) {
      // Update existing device info
      await db('devices').where({ uuid: data.uuid, tenant_id: data.tenantId }).update({
        hostname: data.hostname,
        os_type: data.osType,
        os_name: data.osName,
        os_version: data.osVersion,
        os_build: data.osBuild,
        os_arch: data.osArch,
        cpu_model: data.cpuModel,
        cpu_cores: data.cpuCores,
        ram_total_gb: data.ramTotalGb,
        ip_local: data.ipLocal,
        ip_public: data.ipPublic,
        mac_address: data.macAddress,
        agent_version: data.agentVersion,
        updated_at: new Date(),
      });
      return { deviceId: existing.id, isNew: false };
    }

    const [row] = await db('devices').insert({
      uuid: data.uuid,
      tenant_id: data.tenantId,
      api_key_id: data.apiKeyId,
      hostname: data.hostname,
      os_type: data.osType || 'other',
      os_name: data.osName,
      os_version: data.osVersion,
      os_build: data.osBuild,
      os_arch: data.osArch,
      cpu_model: data.cpuModel,
      cpu_cores: data.cpuCores,
      ram_total_gb: data.ramTotalGb,
      ip_local: data.ipLocal,
      ip_public: data.ipPublic,
      mac_address: data.macAddress,
      agent_version: data.agentVersion,
      agent_flavor: data.agentFlavor ?? 'modern',
      approval_status: approvalStatus,
      status,
    }).returning('*');

    if (this.io) {
      this.io.to(`tenant:${data.tenantId}:admin`).emit(SocketEvents.DEVICE_UPDATED, this.rowToDevice(row));
    }

    // Register device UUID with Obligate for cross-app linking (non-blocking)
    obligateService.registerDeviceLink(data.uuid, `/devices/${row.id}`).catch(() => {});

    return { deviceId: row.id, isNew: true };
  }

  // ─── Push handling ────────────────────────────────────────────────────────
  async handlePush(deviceId: number, tenantId: number, push: AgentPushRequest): Promise<AgentPushResponse> {
    const now = new Date();

    // Capture previous status + version to detect transitions
    const prev = await db('devices').where({ id: deviceId })
      .select('status', 'agent_version', 'privacy_mode_enabled', 'airgap_enabled', 'last_offline_at', 'tenant_id', 'group_id', 'last_metric_status', 'metric_alerts_enabled')
      .first();
    const prevStatus = prev?.status as string | undefined;
    const prevOfflineAt = prev?.last_offline_at ? new Date(prev.last_offline_at) : null;
    const prevMetricStatus = (prev?.last_metric_status ?? null) as 'ok' | 'warning' | 'critical' | null;
    const prevPrivacy = !!prev?.privacy_mode_enabled;
    const prevAirgap = !!prev?.airgap_enabled;

    // Update last seen, metrics, agent version — but never override pending_uninstall status
    await db('devices').where({ id: deviceId }).update({
      last_seen_at: now,
      last_push_at: now,
      latest_metrics: JSON.stringify(push.metrics),
      agent_version: push.agentVersion || db.raw('agent_version'),
      updated_at: now,
    });
    // ── Status resolution (single authority) ──────────────────────────────
    // Push handling used to FORCE status='online' first, then let the
    // threshold check flip it back. That created two problems:
    //   (a) any user-triggered push (the manual refresh button, which
    //       fires `live_metrics push_now`) momentarily shunted a
    //       genuine 'critical' device to 'online' for as long as a
    //       single snapshot didn't breach — and the UI gating treats
    //       only literal 'online' as "remote control allowed", so
    //       admins lost SSH/Reach/PowerShell on a critical box exactly
    //       when they wanted to investigate.
    //   (b) it caused a brief 'online' flicker on every push for
    //       sustained-warning/critical devices.
    // The threshold result is now the SOLE source of truth. We compute
    // the target status once and apply it once, preserving 'pending',
    // 'pending_uninstall' and 'suspended' which carry admin intent.
    //
    // Cascade enable flag: device > group > default(true). NULL means
    // "inherit from parent layer". Group's null also means "use the
    // system default" (true).
    let alertsEnabled = true;
    if (typeof prev?.metric_alerts_enabled === 'boolean') {
      alertsEnabled = prev.metric_alerts_enabled;
    } else if (prev?.group_id) {
      const grp = await db('device_groups').where({ id: prev.group_id }).select('metric_alerts_enabled').first() as { metric_alerts_enabled: boolean | null } | undefined;
      if (typeof grp?.metric_alerts_enabled === 'boolean') alertsEnabled = grp.metric_alerts_enabled;
    }

    let metricStatus: 'ok' | 'warning' | 'critical' = 'ok';
    let breaches: Array<{ metric: 'cpu' | 'memory' | 'disk'; level: 'warning' | 'critical'; percent: number; mount?: string }> = [];
    let thresholds: any = null;
    try {
      if (alertsEnabled && push.metrics) {
        const { thresholdService } = await import('./threshold.service');
        thresholds = await thresholdService.resolveForDevice(deviceId);
        const r = thresholdService.computeMetricStatus(push.metrics as any, thresholds);
        metricStatus = r.status;
        breaches = r.breaches as any;
      }
    } catch (thresholdErr) {
      logger.error(thresholdErr, 'metric-threshold evaluation failed');
    }

    // Map metric severity → reachable status. A device that's pushing IS
    // reachable by definition; the only question is whether to label it
    // online / warning / critical based on the freshest threshold check.
    const reachableTarget: 'online' | 'warning' | 'critical' =
      metricStatus === 'critical' ? 'critical'
      : (metricStatus === 'warning' ? 'warning' : 'online');

    // Resolve final status. Protected states carry admin intent and we
    // never silently override them; everything else follows the threshold.
    const PROTECTED = new Set(['pending', 'pending_uninstall', 'suspended']);
    const updatingCompleted = prevStatus === 'updating' || prevStatus === 'update_error';
    const targetStatus = PROTECTED.has(prevStatus ?? '') ? (prevStatus as string) : reachableTarget;
    const statusChanged = !!prevStatus && prevStatus !== targetStatus;

    const statusUpdate: Record<string, unknown> = {};
    if (statusChanged) statusUpdate.status = targetStatus;
    if (updatingCompleted) statusUpdate.update_started_at = null;
    if (Object.keys(statusUpdate).length > 0) {
      await db('devices')
        .where({ id: deviceId })
        .whereNot({ status: 'pending_uninstall' })
        .update(statusUpdate);
    }

    // Persist the latest metric status separately from device status so
    // notifications + scenario triggers fire on metric-state transitions
    // (ok→warning, warning→critical, …→ok) regardless of the device
    // status (which may legitimately stay protected as 'suspended' etc).
    if (prevMetricStatus !== metricStatus) {
      await db('devices').where({ id: deviceId }).update({ last_metric_status: metricStatus });
      const becameBad = metricStatus !== 'ok' && (prevMetricStatus == null || prevMetricStatus === 'ok' || (prevMetricStatus === 'warning' && metricStatus === 'critical'));
      const recovered = metricStatus === 'ok' && prevMetricStatus !== 'ok' && prevMetricStatus != null;
      if ((becameBad || recovered) && thresholds) {
        try {
          const { notificationService } = await import('./notification.service');
          const dev = await db('devices').where({ id: deviceId }).select('hostname', 'display_name').first() as { hostname: string; display_name: string | null } | undefined;
          const name = dev?.display_name || dev?.hostname || `#${deviceId}`;
          const violations = breaches.map((b) => {
            const pct = Math.round(b.percent);
            const t = thresholds[b.metric];
            const limit = b.level === 'critical' ? t.crit : t.warn;
            const where = b.metric === 'disk' && b.mount ? ` on ${b.mount}` : '';
            return `${b.metric.toUpperCase()}${where}: ${pct}% (≥ ${limit}%)`;
          });
          await notificationService.sendForAgent(
            deviceId, name,
            recovered ? 'up' : 'alert',
            prevMetricStatus ?? 'ok',
            violations,
            metricStatus === 'critical' ? 'alert' : (metricStatus === 'warning' ? 'alert' : 'up'),
          );
        } catch (notifyErr) {
          logger.error(notifyErr, 'metric-threshold notification failed');
        }

        // Scenario trigger — only on transitions INTO warning/critical.
        // Recoveries don't fire (admins don't usually automate "all good").
        if (becameBad) {
          try {
            const { scenarioService } = await import('./scenario.service');
            const triggerType = metricStatus === 'critical' ? 'metric_critical' : 'metric_warning';
            await scenarioService.fireTrigger(triggerType, deviceId, tenantId, { metricBreaches: breaches } as any);
          } catch (triggerErr) {
            logger.error(triggerErr, 'metric-threshold scenario trigger failed');
          }
        }
      }
    }

    // metric_custom triggers fire on EVERY push that satisfies the
    // node's comparator+threshold (not just transitions). Spam is
    // controlled per trigger node via `cooldownSeconds`. We pass the
    // raw metrics so the trigger filter can evaluate cpu/memory/disk
    // values against the configured threshold.
    if (push.metrics) {
      try {
        const { scenarioService } = await import('./scenario.service');
        await scenarioService.fireTrigger('metric_custom', deviceId, tenantId, { metrics: push.metrics as any } as any);
      } catch (triggerErr) {
        logger.error(triggerErr, 'metric-custom scenario trigger failed');
      }
    }

    // Watchdog: if the agent reports that it was restarted by the watchdog
    // since the last push, increment the running total and store the latest
    // timestamp. A rising counter in a short window indicates an unstable
    // agent/host that should be investigated.
    const wdCount = Number(push.watchdogRestartCount ?? 0);
    if (wdCount > 0) {
      const lastAt = push.watchdogLastRestartAt ? new Date(push.watchdogLastRestartAt) : now;
      await db('devices').where({ id: deviceId }).update({
        watchdog_restart_count: db.raw('watchdog_restart_count + ?', [wdCount]),
        watchdog_last_restart_at: lastAt,
      });
    }

    // Emit real-time metrics update
    if (this.io) {
      this.io.to(`tenant:${tenantId}`).emit(SocketEvents.DEVICE_METRICS_PUSHED, {
        deviceId,
        metrics: push.metrics,
      });
      // Notify UI of any status change (offline→online, updating→online,
      // online→warning, warning→critical, critical→online, …). The
      // threshold-resolver above is the single source of truth — we just
      // forward whatever it produced.
      if (statusChanged) {
        this.io.to(`tenant:${tenantId}`).emit(SocketEvents.DEVICE_UPDATED, { deviceId, status: targetStatus });
      }

      // Agent-back-online trigger: only fire when prevStatus was
      // 'offline' AND the outage lasted long enough to clear the
      // per-trigger-node debounce. fireTrigger does the per-node
      // duration check (each trigger node carries its own
      // `offlineDelaySeconds` config). We pass the duration in
      // seconds so the dispatcher can drop flaps.
      if (prevStatus === 'offline' && prevOfflineAt) {
        const offlineSeconds = Math.round((now.getTime() - prevOfflineAt.getTime()) / 1000);
        // Lazy import — scenario.service depends on us indirectly
        // via the agent push pipeline.
        import('./scenario.service').then(({ scenarioService }) => {
          scenarioService.fireTrigger('agent_back_online', deviceId, tenantId, {
            offlineSeconds,
          } as any).catch((err: unknown) => {
            logger.error({ err, deviceId, offlineSeconds }, 'Failed to fire agent_back_online trigger');
          });
        }).catch(() => { /* import error — non-fatal */ });
      }
      // Clear last_offline_at now that the device is back online so
      // subsequent transitions get a clean slate.
      if (prevStatus === 'offline') {
        db('devices').where({ id: deviceId }).update({ last_offline_at: null }).catch(() => { /* swallow */ });
      }

      // Notify UI when privacy mode or airgap mode toggles via agent push
      // (triggered by local tray, agent console, or by a remote command that
      // the agent has just applied). Without this, the device detail page
      // would show the stale state until the user manually refreshes.
      const newPrivacy = typeof (push as any).privacyMode === 'boolean' ? (push as any).privacyMode : prevPrivacy;
      const newAirgap = typeof (push as any).airgapMode === 'boolean' ? (push as any).airgapMode : prevAirgap;
      if (newPrivacy !== prevPrivacy) {
        this.io.to(`tenant:${tenantId}`).emit(SocketEvents.DEVICE_UPDATED, {
          deviceId, privacyModeEnabled: newPrivacy,
        });
      }
      if (newAirgap !== prevAirgap) {
        this.io.to(`tenant:${tenantId}`).emit(SocketEvents.DEVICE_UPDATED, {
          deviceId, airgapEnabled: newAirgap,
        });
      }
    }

    // Get device config (resolve group settings)
    const config = await this.resolveDeviceConfig(deviceId, tenantId);

    // Determine nextPollIn
    const pendingCommandCount = await db('command_queue')
      .where({ device_id: deviceId, status: 'pending' })
      .count('id as count')
      .first()
      .then(r => parseInt(String((r as any)?.count ?? 0)));

    // Check if there's a waiting remote session
    const hasRemoteSession = await db('remote_sessions')
      .where({ device_id: deviceId, status: 'waiting' })
      .first()
      .then(r => !!r);

    let nextPollIn = config.pushIntervalSeconds;
    if (hasRemoteSession) nextPollIn = 3;
    else if (pendingCommandCount > 0) nextPollIn = config.fastPollInterval;

    // Fetch pending commands to send
    const pendingCommands = await db('command_queue')
      .where({ device_id: deviceId, status: 'pending' })
      .orderBy([{ column: 'priority', order: 'desc' }, { column: 'created_at', order: 'asc' }])
      .limit(5); // Send max 5 commands per push

    // Mark them as sent
    if (pendingCommands.length > 0) {
      await db('command_queue')
        .whereIn('id', pendingCommands.map(c => c.id))
        .update({ status: 'sent', sent_at: now, updated_at: now });
    }

    const latestVersion = getAgentVersion();

    return {
      config: {
        pushIntervalSeconds: config.pushIntervalSeconds,
        scanIntervalSeconds: config.scanIntervalSeconds,  // always send (0 = disabled)
        taskRetrieveDelaySeconds: config.taskRetrieveDelaySeconds,
        displayConfig: config.displayConfig,
        sensorDisplayNames: config.sensorDisplayNames,
        notificationTypes: config.notificationTypes,
        remediationEnabled: config.remediationEnabled,
      },
      commands: pendingCommands.map(c => ({
        id: c.id,
        type: c.type,
        payload: c.payload,
        priority: c.priority,
      })),
      nextPollIn,
      ...(latestVersion ? { latestVersion } : {}),
    };
  }

  private async resolveDeviceConfig(deviceId: number, tenantId: number) {
    const device = await db('devices').where({ id: deviceId }).first();
    let pushIntervalSeconds = 60;
    let fastPollInterval = 5;

    const globalCfg = await appConfigService.getAgentGlobal();
    let groupConfig: any = {};
    if (device.group_id) {
      const group = await db('device_groups').where({ id: device.group_id }).first();
      groupConfig = group?.group_config || {};
    }

    // Push interval: Device > Group > Global default (60)
    if (device.override_group_settings || !device.group_id) {
      pushIntervalSeconds = device.push_interval_seconds || 60;
    } else {
      pushIntervalSeconds = device.push_interval_seconds || groupConfig.pushIntervalSeconds || 60;
    }

    // Scan interval: Device > Group > Settings cascade > AgentGlobalConfig > default (3600)
    let scanIntervalSeconds: number;
    if (device.scan_interval_seconds != null) {
      scanIntervalSeconds = device.scan_interval_seconds;
    } else if (groupConfig.scanIntervalSeconds != null) {
      scanIntervalSeconds = groupConfig.scanIntervalSeconds;
    } else {
      // Fall back to the settings cascade system (global/group/device)
      try {
        const resolved = await settingsService.resolveForDevice(tenantId, deviceId, device.group_id);
        const scanSetting = resolved[SETTINGS_KEYS.SCAN_INTERVAL as keyof typeof resolved];
        scanIntervalSeconds = typeof scanSetting?.value === 'number' ? scanSetting.value : (globalCfg.scanIntervalSeconds ?? 3600);
      } catch {
        scanIntervalSeconds = globalCfg.scanIntervalSeconds ?? 3600;
      }
    }

    // Get fast poll, task retrieve delay from app_config
    const [fastPollConfig, taskDelayConfig] = await Promise.all([
      db('app_config').where({ key: 'fast_poll_interval' }).first(),
      db('app_config').where({ key: 'task_retrieve_delay_seconds' }).first(),
    ]);
    if (fastPollConfig?.value) fastPollInterval = parseInt(fastPollConfig.value);
    const taskRetrieveDelaySeconds = taskDelayConfig?.value ? parseInt(taskDelayConfig.value) : 10;

    return {
      pushIntervalSeconds,
      fastPollInterval,
      taskRetrieveDelaySeconds,
      scanIntervalSeconds,
      displayConfig: device.display_config || {},
      sensorDisplayNames: device.sensor_display_names || {},
      notificationTypes: device.notification_types || {},
      remediationEnabled: device.compliance_remediation_enabled ?? true,
    };
  }

  private async getAutoApproveSetting(tenantId: number): Promise<boolean> {
    const setting = await db('settings')
      .where({ tenant_id: tenantId, scope: 'global', key: 'autoApproveDevices' })
      .first();
    if (setting) return setting.value === true || setting.value === 'true' || setting.value === 1;
    const appConfig = await db('app_config').where({ key: 'agent_auto_approve' }).first();
    return appConfig?.value === 'true';
  }

  // ─── Live metrics request ────────────────────────────────────────────────
  // Sends a `live_metrics` command over the agent WS so the device
  // either fires an immediate push (`push_now`, hooked to the manual
  // refresh button) or enters fast-push mode for `windowSec` seconds
  // (`live`, used while the device detail page is open). Returns true
  // when the command was actually pushed onto a live agent channel —
  // false when the agent is offline (the front-end then knows it
  // can't expect fresh data).
  async requestLiveMetrics(deviceId: number, tenantId: number, mode: 'push_now' | 'live', windowSec?: number): Promise<boolean> {
    const device = await db('devices').where({ id: deviceId, tenant_id: tenantId }).first();
    if (!device) return false;
    const { agentHub } = await import('./agentHub.service');
    const { randomUUID } = await import('crypto');
    return agentHub.push(deviceId, {
      type: 'command',
      id: randomUUID(),
      commandType: 'live_metrics',
      payload: { mode, windowSec },
    });
  }

  // ─── Offline detection ────────────────────────────────────────────────────
  async checkOfflineDevices() {
    try {
      // Lazy import to avoid a circular module load — agentHub depends on
      // device.service.ts indirectly via deviceService.handlePush().
      const { agentHub } = await import('./agentHub.service');

      // Find online devices that haven't pushed in too long
      const devices = await db('devices')
        .where({ status: 'online', approval_status: 'approved' })
        .whereNotNull('last_push_at');

      const now = new Date();
      for (const device of devices) {
        const pushInterval = device.push_interval_seconds || 60;
        const maxMissed = device.max_missed_pushes || 3;
        const threshold = new Date(now.getTime() - (pushInterval * maxMissed * 1000));

        if (new Date(device.last_push_at) < threshold) {
          // The HTTP push is stale, but if the agent's WS command channel
          // is still connected the device IS reachable (admins can run
          // commands, browse files, etc.) — flipping it offline would lie
          // to the dashboard. Refresh last_seen_at so the "5m ago" pill
          // stays accurate and skip the offline transition.
          if (agentHub.isConnected(device.id)) {
            await db('devices').where({ id: device.id }).update({
              last_seen_at: now,
              updated_at: now,
            });
            continue;
          }

          await db('devices').where({ id: device.id }).update({
            status: 'offline',
            // Record the moment this device went offline so the
            // 'agent_back_online' trigger can compute the outage
            // duration on the next push and decide whether the gap
            // qualifies as a real outage vs a transient flap.
            last_offline_at: now,
            updated_at: now,
          });

          if (this.io) {
            this.io.to(`tenant:${device.tenant_id}`).emit(SocketEvents.DEVICE_OFFLINE, {
              deviceId: device.id,
              hostname: device.hostname,
            });
          }

          logger.info({ deviceId: device.id, hostname: device.hostname }, 'Device went offline');
        }
      }

      // Transition 'updating' devices to 'update_error' after 10 min
      const UPDATE_TIMEOUT_MS = 10 * 60 * 1000;
      const updatingDevices = await db('devices')
        .where({ status: 'updating' })
        .whereNotNull('update_started_at');

      for (const device of updatingDevices) {
        const elapsed = Date.now() - new Date(device.update_started_at).getTime();
        if (elapsed > UPDATE_TIMEOUT_MS) {
          await db('devices').where({ id: device.id }).update({
            status: 'update_error',
            update_started_at: null,
            updated_at: new Date(),
          });

          if (this.io) {
            this.io.to(`tenant:${device.tenant_id}`).emit(SocketEvents.DEVICE_UPDATED, {
              deviceId: device.id,
              status: 'update_error',
            });
          }

          logger.warn({ deviceId: device.id, hostname: device.hostname }, 'Device update timed out — marked update_error');
        }
      }
    } catch (err) {
      logger.error(err, 'Error in offline detection job');
    }
  }

  // ─── Inventory pruning ────────────────────────────────────────────────────
  async pruneInventory() {
    try {
      const cfg = await db('app_config').where({ key: 'inventory_retention_days' }).first();
      const days = parseInt(cfg?.value || '90');
      const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      // Keep only latest hardware snapshot per device
      // Delete old software scans
      await db('device_inventory_software')
        .where('scanned_at', '<', cutoff)
        .delete();

      logger.info({ days }, 'Inventory pruning complete');
    } catch (err) {
      logger.error(err, 'Error in inventory pruning job');
    }
  }

  // ─── OS facets (Lot C 3-tier filter) ──────────────────────────────────────
  // Returns the (osType, osName, osVersion) triplets present in the tenant's
  // approved fleet, with a count of matching devices for each. The client
  // uses these to populate the cascading filter dropdowns and to hide
  // options that no longer have any devices behind them.
  async getOsFacets(tenantId: number): Promise<Array<{
    osType: string; osName: string | null; osVersion: string | null; count: number;
  }>> {
    const isMaster = isMasterTenant(tenantId);
    const q = db('devices')
      .where({ approval_status: 'approved' })
      .whereNot({ status: 'pending_uninstall' })
      .select('os_type', 'os_name', 'os_version')
      .count<{ os_type: string; os_name: string | null; os_version: string | null; count: string | number }[]>('* as count')
      .groupBy('os_type', 'os_name', 'os_version')
      .orderBy('os_type', 'asc')
      .orderBy('os_name', 'asc')
      .orderBy('os_version', 'asc');
    if (!isMaster) q.where({ tenant_id: tenantId });
    const rows = await q;
    return rows.map((r) => ({
      osType: r.os_type,
      osName: r.os_name,
      osVersion: r.os_version,
      count: typeof r.count === 'number' ? r.count : parseInt(r.count, 10),
    }));
  }

  // ─── Tag facets ──────────────────────────────────────────────────────────
  // Distinct tag list for the tenant with per-tag device counts. Used by
  // the /devices filter popover so admins pick from existing tags
  // (typo-free) and see which ones are actually populated.
  //
  // `tags` is a JSONB array on devices — `jsonb_array_elements_text`
  // unnests it so we can group by individual tag. The query skips
  // pending_uninstall to avoid surfacing stale data.
  async getTagFacets(tenantId: number): Promise<Array<{ tag: string; count: number }>> {
    const isMaster = isMasterTenant(tenantId);
    const where = isMaster
      ? `d.approval_status = 'approved' AND d.status <> 'pending_uninstall'`
      : `d.tenant_id = ? AND d.approval_status = 'approved' AND d.status <> 'pending_uninstall'`;
    const rows = await db.raw(
      `SELECT t.tag::text AS tag, COUNT(*)::int AS count
         FROM devices d, jsonb_array_elements_text(COALESCE(d.tags, '[]'::jsonb)) AS t(tag)
        WHERE ${where}
        GROUP BY t.tag
        ORDER BY count DESC, tag ASC`,
      isMaster ? [] : [tenantId],
    ) as { rows: Array<{ tag: string; count: number }> };
    return rows.rows.map((r) => ({ tag: r.tag, count: Number(r.count) }));
  }

  // ─── Fleet summary ────────────────────────────────────────────────────────
  async getFleetSummary(tenantId: number) {
    const isMaster = isMasterTenant(tenantId);
    const statusQ = db('devices').select(db.raw('status, count(*) as count')).groupBy('status');
    if (!isMaster) statusQ.where({ tenant_id: tenantId });
    const rows = await statusQ;

    const counts: Record<string, number> = {};
    for (const r of rows) counts[r.status] = parseInt(r.count);

    const updatesQ = db('device_updates').where({ status: 'available' }).countDistinct('device_id as count');
    if (!isMaster) updatesQ.where({ tenant_id: tenantId });
    const pendingUpdates = await updatesQ.first().then(r => parseInt(String((r as any)?.count ?? 0)));

    // Agent version stats
    const latestVersion = getAgentVersion();
    const versionQ = db('devices')
      .whereNotNull('agent_version')
      .select(db.raw("CASE WHEN agent_version = ? THEN 'uptodate' ELSE 'outdated' END as vstat, count(*) as count", [latestVersion]))
      .groupBy('vstat');
    if (!isMaster) versionQ.where({ tenant_id: tenantId });
    const versionRows = await versionQ;
    const vCounts: Record<string, number> = {};
    for (const r of versionRows) vCounts[r.vstat] = parseInt(r.count);

    // OS breakdown — total per OS family + online count per OS family. The
    // dashboard renders both: a donut (totals) AND a per-OS connectivity bar
    // (online vs offline) using osConnectivity below.
    const osQ = db('devices')
      .select(db.raw("os_type, status = 'online' as is_online, count(*) as count"))
      .groupBy('os_type', db.raw("status = 'online'"));
    if (!isMaster) osQ.where({ tenant_id: tenantId });
    const osRows = await osQ;
    const osByType = { windows: 0, macos: 0, linux: 0, other: 0 };
    const osConnectivity: Record<string, { online: number; total: number }> = {
      windows: { online: 0, total: 0 },
      macos:   { online: 0, total: 0 },
      linux:   { online: 0, total: 0 },
      other:   { online: 0, total: 0 },
    };
    for (const r of osRows) {
      const key = r.os_type as keyof typeof osByType;
      const c = parseInt(r.count);
      osByType[key] = (osByType[key] || 0) + c;
      if (osConnectivity[key]) {
        osConnectivity[key].total += c;
        if (r.is_online) osConnectivity[key].online += c;
      }
    }

    // Active remote sessions
    const remoteQ = db('remote_sessions')
      .whereIn('status', ['waiting', 'connecting', 'active'])
      .count('id as count');
    if (!isMaster) remoteQ.where({ tenant_id: tenantId });
    const activeRemoteSessions = await remoteQ.first().then(r => parseInt(String((r as any)?.count ?? 0)));

    // Upcoming schedules (next 24h)
    const now = new Date();
    const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const upcomingQ = db('script_schedules')
      .where({ enabled: true })
      .where('next_run_at', '>', now)
      .where('next_run_at', '<=', in24h)
      .count('id as count');
    if (!isMaster) upcomingQ.where({ tenant_id: tenantId });
    const upcomingSchedules = await upcomingQ.first().then(r => parseInt(String((r as any)?.count ?? 0)));

    // Stale devices (no contact in 72h)
    const staleThreshold = new Date(now.getTime() - 72 * 60 * 60 * 1000);
    const staleQ = db('devices')
      .whereNotIn('status', ['pending', 'suspended', 'pending_uninstall'])
      .where('last_seen_at', '<', staleThreshold)
      .count('id as count');
    if (!isMaster) staleQ.where({ tenant_id: tenantId });
    const staleDevices = await staleQ.first().then(r => parseInt(String((r as any)?.count ?? 0)));

    // Total reflects the active managed fleet — devices the user can act on
    // today. pending (waiting for admin approval), suspended (admin-disabled),
    // and pending_uninstall (being removed) are admin/lifecycle states tracked
    // separately by the mini-stats and supervision pages, NOT part of the
    // daily-ops fleet. Excluding them keeps the breakdown cards (online +
    // offline + warning + critical + ...) summing to the displayed Total.
    const adminOnlyStatuses = new Set(['pending', 'suspended', 'pending_uninstall']);
    const total = Object.entries(counts)
      .filter(([s]) => !adminOnlyStatuses.has(s))
      .reduce((sum, [, c]) => sum + c, 0);

    // ── Deltas vs yesterday + week ago ─────────────────────────────────────
    // Read the two most recent snapshots so the dashboard can show
    // ↑/↓ comparisons. Missing snapshot → delta = null (UI hides it).
    const yesterdaySnap = await db('fleet_daily_snapshot')
      .where({ tenant_id: tenantId })
      .where('day', '<', new Date().toISOString().slice(0, 10))
      .orderBy('day', 'desc')
      .first();
    const weekAgoSnap = await db('fleet_daily_snapshot')
      .where({ tenant_id: tenantId })
      .where('day', '<=', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10))
      .orderBy('day', 'desc')
      .first();

    const deltas = {
      onlineVsYesterday:        yesterdaySnap ? (counts.online   || 0) - yesterdaySnap.online           : null,
      offlineVsYesterday:       yesterdaySnap ? (counts.offline  || 0) - yesterdaySnap.offline          : null,
      pendingUpdatesVsWeek:     weekAgoSnap   ? pendingUpdates           - weekAgoSnap.pending_updates  : null,
      staleVsYesterday:         yesterdaySnap ? staleDevices             - yesterdaySnap.stale_72h      : null,
      totalVsYesterday:         yesterdaySnap ? total                    - yesterdaySnap.total          : null,
    };

    return {
      total,
      online: counts.online || 0,
      offline: counts.offline || 0,
      warning: counts.warning || 0,
      critical: counts.critical || 0,
      pending: counts.pending || 0,
      suspended: counts.suspended || 0,
      pendingUpdates,
      complianceScore: null,
      agentUpToDate: vCounts.uptodate || 0,
      agentOutdated: vCounts.outdated || 0,
      latestAgentVersion: latestVersion,
      osByType,
      osConnectivity,
      activeRemoteSessions,
      upcomingSchedules,
      staleDevices,
      deltas,
    };
  }

  // ─── Fleet timeseries ─────────────────────────────────────────────────────
  // Returns {date, total, online, offline, pendingUpdates, stale72} for the
  // last N days. The current day is always synthesized from live state — the
  // nightly snapshot job is for historic comparison only.
  async getFleetTimeseries(tenantId: number, days: number) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const cutoff = new Date(today.getTime() - (days - 1) * 24 * 60 * 60 * 1000);

    // Master tenant gets the cross-tenant aggregate: each (day) row is
    // the sum of all tenant-scoped snapshots for that day. Other tenants
    // stay strictly scoped.
    const isMaster = isMasterTenant(tenantId);
    let rows: any[];
    if (isMaster) {
      rows = await db('fleet_daily_snapshot')
        .where('day', '>=', cutoff.toISOString().slice(0, 10))
        .groupBy('day')
        .orderBy('day', 'asc')
        .select(
          'day',
          db.raw('SUM(total)::int as total'),
          db.raw('SUM(online)::int as online'),
          db.raw('SUM(offline)::int as offline'),
          db.raw('SUM(pending_updates)::int as "pendingUpdates"'),
          db.raw('SUM(stale_72h)::int as stale72'),
        );
    } else {
      rows = await db('fleet_daily_snapshot')
        .where({ tenant_id: tenantId })
        .where('day', '>=', cutoff.toISOString().slice(0, 10))
        .orderBy('day', 'asc')
        .select('day', 'total', 'online', 'offline', 'pending_updates as pendingUpdates', 'stale_72h as stale72');
    }

    // Synthesise the live "today" point from current state so the chart
    // always ends on the current value, regardless of whether the nightly
    // snapshot job has run.
    const live = await this.getFleetSummary(tenantId);
    const todayStr = today.toISOString().slice(0, 10);
    const todayRow = {
      day: todayStr,
      total: live.total,
      online: live.online,
      offline: live.offline,
      pendingUpdates: live.pendingUpdates,
      stale72: live.staleDevices,
    };
    const filtered = rows.filter((r: any) => String(r.day).slice(0, 10) !== todayStr);
    return [...filtered.map((r: any) => ({ ...r, day: String(r.day).slice(0, 10) })), todayRow];
  }

  // ─── Agent version distribution ──────────────────────────────────────────
  // Top N most-common agent versions in the tenant fleet. Sorted desc so the
  // dashboard can show "X devices on v4.5.34, Y on v4.5.33, …".
  async getAgentVersionDistribution(tenantId: number) {
    const isMaster = isMasterTenant(tenantId);
    const q = db('devices')
      .where({ approval_status: 'approved' })
      .whereNot({ status: 'pending_uninstall' })
      .whereNotNull('agent_version')
      .select('agent_version')
      .count('* as count')
      .groupBy('agent_version')
      .orderBy('count', 'desc')
      .limit(8);
    if (!isMaster) q.where({ tenant_id: tenantId });
    const rows = await q;

    const latest = getAgentVersion();
    return rows.map((r: any) => ({
      version: r.agent_version as string,
      count: parseInt(String(r.count)),
      isLatest: r.agent_version === latest,
    }));
  }

  // ─── Disk saturation ─────────────────────────────────────────────────────
  // Walks each device's `latest_metrics.disks[]` and surfaces those where
  // any disk's used_percent crosses the threshold. Heavy-ish (full table
  // scan + JSON parse) — fine at fleet sizes <10k, paginate if it grows.
  // Lot D.2: each device's saturation threshold is resolved through
  // device.thresholds_override → group.thresholds → SYSTEM_DEFAULT, so a
  // 10 TB server can keep a 90 % warn while a kiosk still alarms at 85 %.
  // The legacy `threshold` query param is now a "minimum visible" floor —
  // any per-device threshold below it is bumped up. Default 0 = pure
  // resolved-threshold mode.
  async getDiskSaturation(tenantId: number, minThresholdFloor: number) {
    const isMaster = isMasterTenant(tenantId);
    const q = db('devices')
      .where({ approval_status: 'approved' })
      .whereNot({ status: 'pending_uninstall' })
      .whereNotNull('latest_metrics')
      .select('id', 'hostname', 'display_name', 'latest_metrics');
    if (!isMaster) q.where({ tenant_id: tenantId });
    const rows = await q as Array<{
      id: number; hostname: string; display_name: string | null; latest_metrics: unknown;
    }>;

    if (rows.length === 0) {
      return { count: 0, threshold: minThresholdFloor, top: [] };
    }

    const { thresholdService, isExcludedDisk } = await import('./threshold.service');
    const thresholdMap = await thresholdService.resolveMany(rows.map(r => r.id));

    const saturated: { deviceId: number; hostname: string; displayName: string | null; pct: number; mountpoint: string; warn: number }[] = [];

    for (const r of rows) {
      try {
        const m = typeof r.latest_metrics === 'string' ? JSON.parse(r.latest_metrics) : r.latest_metrics;
        const resolved = thresholdMap.get(r.id);
        const baseWarn = Math.max(resolved?.disk.warn ?? 85, minThresholdFloor);
        const disks = (m?.disks ?? []) as { mount?: string; percent?: number; fstype?: string; removable?: boolean }[];
        for (const d of disks) {
          // Skip USB sticks, optical media and other removable mounts —
          // a 100% full ISO is normal and a saturated USB key would
          // pollute the dashboard "disque saturé" card forever.
          if (isExcludedDisk(d)) continue;
          // Per-mount threshold override — if the admin set a tighter
          // (or looser) value for this specific mount on this device
          // / its group, we evaluate against that one rather than the
          // generic disk warn. We still floor with `minThresholdFloor`
          // so the dashboard's "minimum visible" knob keeps working.
          const perMount = d.mount && resolved?.diskByMount[d.mount] ? resolved.diskByMount[d.mount].warn : null;
          const warn = Math.max(perMount ?? baseWarn, minThresholdFloor);
          const pct = typeof d.percent === 'number' ? d.percent : 0;
          if (pct >= warn) {
            saturated.push({
              deviceId: r.id,
              hostname: r.hostname,
              displayName: r.display_name,
              pct: Math.round(pct),
              mountpoint: d.mount ?? '/',
              warn,
            });
            break; // Only count each device once even if multiple disks saturate
          }
        }
      } catch { /* corrupt JSON — skip */ }
    }

    saturated.sort((a, b) => b.pct - a.pct);
    return {
      count: saturated.length,
      threshold: minThresholdFloor,
      top: saturated.slice(0, 5),
    };
  }

  // ─── Hourly snapshot job ─────────────────────────────────────────────────
  // Called once per hour by the cron in index.ts. Writes one row per tenant
  // in fleet_hourly_snapshot, used by the dashboard "Activité du parc" 24h
  // view. Retention is 7 days — older rows are pruned in the same job so
  // the table stays small (~168 rows per tenant max).
  async snapshotFleetHourly() {
    try {
      // Round to the current hour boundary so onConflict-merge keeps a
      // single row per hour even across multiple boots / clock skew.
      const now = new Date();
      now.setMinutes(0, 0, 0);
      const tenants = await db('tenants').select('id');
      for (const t of tenants) {
        const summary = await this.getFleetSummary(t.id);
        await db('fleet_hourly_snapshot')
          .insert({
            tenant_id: t.id,
            hour: now,
            total: summary.total,
            online: summary.online,
            offline: summary.offline,
            warning: summary.warning,
            critical: summary.critical,
            pending_updates: summary.pendingUpdates,
            stale_72h: summary.staleDevices,
            active_remote_sessions: summary.activeRemoteSessions,
          })
          .onConflict(['tenant_id', 'hour'])
          .merge();
      }
      // Retention sweep: keep 7 days of hourly history. The daily table
      // covers anything beyond that.
      const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      await db('fleet_hourly_snapshot').where('hour', '<', cutoff).del();
      logger.info({ tenants: tenants.length }, 'Fleet hourly snapshot complete');
    } catch (err) {
      logger.error(err, 'Fleet hourly snapshot failed');
    }
  }

  // Returns up to N most-recent hourly points for the dashboard 24h view.
  // The current hour is always synthesised from live state so the chart
  // ends on "now" regardless of the cron cadence, mirroring the daily flow.
  async getFleetHourlySeries(tenantId: number, hours: number) {
    const cap = Math.min(168, Math.max(2, hours));
    const cutoff = new Date(Date.now() - cap * 60 * 60 * 1000);
    const isMaster = isMasterTenant(tenantId);
    let rows: Array<{
      hour: Date | string; total: number; online: number; offline: number; pendingUpdates: number; stale72: number;
    }>;
    if (isMaster) {
      // Cross-tenant aggregate: SUM each metric per hour bucket.
      rows = await db('fleet_hourly_snapshot')
        .where('hour', '>=', cutoff)
        .groupBy('hour')
        .orderBy('hour', 'asc')
        .select(
          'hour',
          db.raw('SUM(total)::int as total'),
          db.raw('SUM(online)::int as online'),
          db.raw('SUM(offline)::int as offline'),
          db.raw('SUM(pending_updates)::int as "pendingUpdates"'),
          db.raw('SUM(stale_72h)::int as stale72'),
        ) as any;
    } else {
      rows = await db('fleet_hourly_snapshot')
        .where({ tenant_id: tenantId })
        .where('hour', '>=', cutoff)
        .orderBy('hour', 'asc')
        .select('hour', 'total', 'online', 'offline', 'pending_updates as pendingUpdates', 'stale_72h as stale72') as any;
    }

    const live = await this.getFleetSummary(tenantId);
    const nowHour = new Date();
    nowHour.setMinutes(0, 0, 0);
    const liveRow = {
      hour: nowHour.toISOString(),
      total: live.total,
      online: live.online,
      offline: live.offline,
      pendingUpdates: live.pendingUpdates,
      stale72: live.staleDevices,
    };
    const filtered = rows
      .map((r) => ({ ...r, hour: typeof r.hour === 'string' ? r.hour : r.hour.toISOString() }))
      .filter((r) => r.hour !== liveRow.hour);
    return [...filtered, liveRow];
  }

  // ─── Daily snapshot job ──────────────────────────────────────────────────
  // Called once a day by the cron in index.ts. Writes one row per tenant in
  // fleet_daily_snapshot, used by the dashboard for week-over-week deltas
  // and for the "Activité du parc" timeseries chart.
  async snapshotFleetDaily() {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const tenants = await db('tenants').select('id');
      for (const t of tenants) {
        const summary = await this.getFleetSummary(t.id);
        await db('fleet_daily_snapshot')
          .insert({
            tenant_id: t.id,
            day: today,
            total: summary.total,
            online: summary.online,
            offline: summary.offline,
            warning: summary.warning,
            critical: summary.critical,
            pending_updates: summary.pendingUpdates,
            stale_72h: summary.staleDevices,
            active_remote_sessions: summary.activeRemoteSessions,
          })
          .onConflict(['tenant_id', 'day'])
          .merge();
      }
      logger.info({ tenants: tenants.length }, 'Fleet daily snapshot complete');
    } catch (err) {
      logger.error(err, 'Fleet daily snapshot failed');
    }
  }
}

export const deviceService = new DeviceService();
export { getAgentVersion };
