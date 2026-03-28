import path from 'path';
import fs from 'fs';
import { Server as SocketIOServer } from 'socket.io';
import { db } from '../db';
import { logger } from '../utils/logger';
import { SocketEvents } from '@obliance/shared';
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
      lastLoggedInUser: row.last_logged_in_user ?? null,
      lastRebootAt: row.last_reboot_at ?? null,
      rebootPending: row.reboot_pending ?? false,
      timezone: row.timezone ?? null,
      tags: row.tags || [],
      customFields: row.custom_fields || {},
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
  }): Promise<{ items: Device[]; total: number; page: number; pageSize: number }> {
    const page = Math.max(1, filters?.page ?? 1);
    const pageSize = Math.min(500, Math.max(1, filters?.pageSize ?? 100));

    let q = db('devices')
      .leftJoin('device_groups', 'devices.group_id', 'device_groups.id')
      .where({ 'devices.tenant_id': tenantId });
    // Never show pending_uninstall devices in normal listings
    q = q.whereNot({ 'devices.status': 'pending_uninstall' });
    if (filters?.groupId) {
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
    if (filters?.approvalStatus === 'suspended') {
      q = q.where({ 'devices.status': 'suspended' });
    } else if (filters?.approvalStatus) {
      q = q.where({ 'devices.approval_status': filters.approvalStatus });
    }
    if (filters?.search) q = q.where(function() {
      this.whereILike('devices.hostname', `%${filters.search}%`)
          .orWhereILike('devices.display_name', `%${filters.search}%`)
          .orWhereILike('devices.ip_local', `%${filters.search}%`)
          .orWhereILike('devices.ip_public', `%${filters.search}%`);
    });

    const countResult = await q.clone().count('devices.id as count').first();
    const total = Number(countResult?.count ?? 0);

    // Sortable columns
    const SORT_MAP: Record<string, string> = {
      name: 'devices.hostname', status: 'devices.status', os: 'devices.os_type',
      lastSeen: 'devices.last_seen_at', version: 'devices.agent_version', group: 'device_groups.name',
    };
    const sortCol = SORT_MAP[filters?.sortBy ?? ''] ?? 'devices.hostname';
    const sortDir = filters?.sortOrder === 'desc' ? 'desc' : 'asc';

    const rows = await q
      .select('devices.*', 'device_groups.name as group_name')
      .orderBy(sortCol, sortDir)
      .limit(pageSize).offset((page - 1) * pageSize);

    return {
      items: rows.map((row: any) => {
        const device = this.rowToDevice(row);
        (device as any).groupName = row.group_name ?? null;
        return device;
      }),
      total, page, pageSize,
    };
  }

  /** Legacy non-paginated list — used by sidebar and internal calls. */
  async getDevicesList(tenantId: number, filters?: { groupId?: number; status?: string; approvalStatus?: string; search?: string }): Promise<Device[]> {
    const result = await this.getDevices(tenantId, { ...filters, page: 1, pageSize: 10000 });
    return result.items;
  }

  async getDeviceById(id: number, tenantId: number): Promise<Device | null> {
    const row = await db('devices').where({ id, tenant_id: tenantId }).first();
    return row ? this.rowToDevice(row) : null;
  }

  async getDeviceByUuid(uuid: string, tenantId: number): Promise<Device | null> {
    const row = await db('devices').where({ uuid, tenant_id: tenantId }).first();
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

    // Capture previous status to detect transitions (e.g. updating/update_error → online)
    const prev = await db('devices').where({ id: deviceId }).select('status').first();
    const prevStatus = prev?.status as string | undefined;

    // Update last seen, metrics, agent version — but never override pending_uninstall status
    await db('devices').where({ id: deviceId }).update({
      last_seen_at: now,
      last_push_at: now,
      latest_metrics: JSON.stringify(push.metrics),
      agent_version: push.agentVersion || db.raw('agent_version'),
      updated_at: now,
    });
    await db('devices')
      .where({ id: deviceId })
      .whereNot({ status: 'pending_uninstall' })
      .update({ status: 'online', update_started_at: null });

    // Emit real-time metrics update
    if (this.io) {
      this.io.to(`tenant:${tenantId}`).emit(SocketEvents.DEVICE_METRICS_PUSHED, {
        deviceId,
        metrics: push.metrics,
      });
      // Notify UI of status change (e.g. update_error → online, offline → online)
      if (prevStatus && prevStatus !== 'online' && prevStatus !== 'pending_uninstall') {
        this.io.to(`tenant:${tenantId}`).emit(SocketEvents.DEVICE_UPDATED, { deviceId, status: 'online' });
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

  // ─── Offline detection ────────────────────────────────────────────────────
  async checkOfflineDevices() {
    try {
      // Find online devices that haven't pushed in too long
      const devices = await db('devices')
        .where({ status: 'online', approval_status: 'approved' })
        .whereNotNull('last_push_at');

      for (const device of devices) {
        const pushInterval = device.push_interval_seconds || 60;
        const maxMissed = device.max_missed_pushes || 3;
        const threshold = new Date(Date.now() - (pushInterval * maxMissed * 1000));

        if (new Date(device.last_push_at) < threshold) {
          await db('devices').where({ id: device.id }).update({
            status: 'offline',
            updated_at: new Date(),
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

  // ─── Fleet summary ────────────────────────────────────────────────────────
  async getFleetSummary(tenantId: number) {
    const rows = await db('devices')
      .where({ tenant_id: tenantId })
      .select(db.raw('status, count(*) as count'))
      .groupBy('status');

    const counts: Record<string, number> = {};
    for (const r of rows) counts[r.status] = parseInt(r.count);

    const pendingUpdates = await db('device_updates')
      .where({ tenant_id: tenantId, status: 'available' })
      .countDistinct('device_id as count')
      .first()
      .then(r => parseInt(String((r as any)?.count ?? 0)));

    // Agent version stats
    const latestVersion = getAgentVersion();
    const versionRows = await db('devices')
      .where({ tenant_id: tenantId })
      .whereNotNull('agent_version')
      .select(db.raw("CASE WHEN agent_version = ? THEN 'uptodate' ELSE 'outdated' END as vstat, count(*) as count", [latestVersion]))
      .groupBy('vstat');
    const vCounts: Record<string, number> = {};
    for (const r of versionRows) vCounts[r.vstat] = parseInt(r.count);

    // OS breakdown
    const osRows = await db('devices')
      .where({ tenant_id: tenantId })
      .select(db.raw('os_type, count(*) as count'))
      .groupBy('os_type');
    const osByType = { windows: 0, macos: 0, linux: 0, other: 0 };
    for (const r of osRows) {
      const key = r.os_type as keyof typeof osByType;
      osByType[key] = (osByType[key] || 0) + parseInt(r.count);
    }

    // Active remote sessions
    const activeRemoteSessions = await db('remote_sessions')
      .where({ tenant_id: tenantId })
      .whereIn('status', ['waiting', 'connecting', 'active'])
      .count('id as count')
      .first()
      .then(r => parseInt(String((r as any)?.count ?? 0)));

    // Upcoming schedules (next 24h)
    const now = new Date();
    const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const upcomingSchedules = await db('script_schedules')
      .where({ tenant_id: tenantId, enabled: true })
      .where('next_run_at', '>', now)
      .where('next_run_at', '<=', in24h)
      .count('id as count')
      .first()
      .then(r => parseInt(String((r as any)?.count ?? 0)));

    // Stale devices (no contact in 72h)
    const staleThreshold = new Date(now.getTime() - 72 * 60 * 60 * 1000);
    const staleDevices = await db('devices')
      .where({ tenant_id: tenantId })
      .whereNotIn('status', ['pending', 'suspended', 'pending_uninstall'])
      .where('last_seen_at', '<', staleThreshold)
      .count('id as count')
      .first()
      .then(r => parseInt(String((r as any)?.count ?? 0)));

    return {
      total: Object.values(counts).reduce((a, b) => a + b, 0),
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
      activeRemoteSessions,
      upcomingSchedules,
      staleDevices,
    };
  }
}

export const deviceService = new DeviceService();
export { getAgentVersion };
