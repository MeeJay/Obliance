import path from 'path';
import fs from 'fs';
import { Server as SocketIOServer } from 'socket.io';
import { db } from '../db';
import { logger } from '../utils/logger';
import { SocketEvents } from '@obliance/shared';
import type { Device, DeviceMetrics, AgentPushRequest, AgentPushResponse, CommandAck } from '@obliance/shared';
import { appConfigService } from './appConfig.service';

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
    const vp = path.resolve(__dirname, '../../../agent/VERSION');
    const v = fs.readFileSync(vp, 'utf-8').trim();
    if (v) { _cachedVersion = v; _cachedVersionAt = now; return v; }
  } catch { /* fall through */ }
  // 2. Compiled dist artefact — version-agent.json
  try {
    const jp = path.resolve(__dirname, '../../../agent/dist/version-agent.json');
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
      overrideGroupSettings: row.override_group_settings,
      maxMissedPushes: row.max_missed_pushes,
      tags: row.tags || [],
      customFields: row.custom_fields || {},
      displayConfig: row.display_config || {},
      sensorDisplayNames: row.sensor_display_names || {},
      notificationTypes: row.notification_types || {},
      latestMetrics: row.latest_metrics || {},
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  // ─── CRUD ─────────────────────────────────────────────────────────────────
  async getDevices(tenantId: number, filters?: { groupId?: number; status?: string; approvalStatus?: string; search?: string }) {
    let q = db('devices').where({ tenant_id: tenantId });
    if (filters?.groupId) q = q.where({ group_id: filters.groupId });
    if (filters?.status) q = q.where({ status: filters.status });
    if (filters?.approvalStatus === 'suspended') {
      // "Suspended" filter = devices whose status is suspended (regardless of approvalStatus)
      q = q.where({ status: 'suspended' });
    } else if (filters?.approvalStatus) {
      q = q.where({ approval_status: filters.approvalStatus });
    }
    if (filters?.search) q = q.where(function() {
      this.whereILike('hostname', `%${filters.search}%`)
          .orWhereILike('display_name', `%${filters.search}%`);
    });
    const rows = await q.orderBy('hostname');
    return rows.map(this.rowToDevice.bind(this));
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
    overrideGroupSettings: boolean;
    maxMissedPushes: number;
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
    if (data.overrideGroupSettings !== undefined) updates.override_group_settings = data.overrideGroupSettings;
    if (data.maxMissedPushes !== undefined) updates.max_missed_pushes = data.maxMissedPushes;

    await db('devices').where({ id, tenant_id: tenantId }).update(updates);
    const updated = await this.getDeviceById(id, tenantId);
    if (updated && this.io) {
      this.io.to(`tenant:${tenantId}`).emit(SocketEvents.DEVICE_UPDATED, updated);
    }
    return updated;
  }

  async approveDevice(id: number, tenantId: number, approvedBy: number) {
    await db('devices').where({ id, tenant_id: tenantId }).update({
      approval_status: 'approved',
      status: 'offline',
      approved_by: approvedBy,
      approved_at: new Date(),
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

  async deleteDevice(id: number, tenantId: number) {
    await db('devices').where({ id, tenant_id: tenantId }).delete();
    if (this.io) {
      this.io.to(`tenant:${tenantId}`).emit(SocketEvents.DEVICE_DELETED, { id });
    }
  }

  async bulkApprove(ids: number[], tenantId: number, approvedBy: number) {
    await db('devices').whereIn('id', ids).where({ tenant_id: tenantId }).update({
      approval_status: 'approved',
      status: 'offline',
      approved_by: approvedBy,
      approved_at: new Date(),
      updated_at: new Date(),
    });
  }

  async bulkDelete(ids: number[], tenantId: number) {
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

    return { deviceId: row.id, isNew: true };
  }

  // ─── Push handling ────────────────────────────────────────────────────────
  async handlePush(deviceId: number, tenantId: number, push: AgentPushRequest): Promise<AgentPushResponse> {
    const now = new Date();

    // Update last seen, metrics, agent version
    await db('devices').where({ id: deviceId }).update({
      last_seen_at: now,
      last_push_at: now,
      status: 'online',
      latest_metrics: JSON.stringify(push.metrics),
      agent_version: push.agentVersion || db.raw('agent_version'),
      updated_at: now,
    });

    // Emit real-time metrics update
    if (this.io) {
      this.io.to(`tenant:${tenantId}`).emit(SocketEvents.DEVICE_METRICS_PUSHED, {
        deviceId,
        metrics: push.metrics,
      });
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
        ...(config.scanIntervalSeconds > 0 && { scanIntervalSeconds: config.scanIntervalSeconds }),
        displayConfig: config.displayConfig,
        sensorDisplayNames: config.sensorDisplayNames,
        notificationTypes: config.notificationTypes,
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

    if (device.override_group_settings || !device.group_id) {
      pushIntervalSeconds = device.push_interval_seconds || 60;
    } else if (device.group_id) {
      const group = await db('device_groups').where({ id: device.group_id }).first();
      const groupConfig = group?.group_config || {};
      pushIntervalSeconds = device.push_interval_seconds || groupConfig.pushIntervalSeconds || 60;
    }

    // Get fast poll and scan interval from app_config
    const fastPollConfig = await db('app_config').where({ key: 'fast_poll_interval' }).first();
    if (fastPollConfig?.value) fastPollInterval = parseInt(fastPollConfig.value);

    const globalCfg = await appConfigService.getAgentGlobal();
    const scanIntervalSeconds = globalCfg.scanIntervalSeconds ?? 0;

    return {
      pushIntervalSeconds,
      fastPollInterval,
      scanIntervalSeconds,
      displayConfig: device.display_config || {},
      sensorDisplayNames: device.sensor_display_names || {},
      notificationTypes: device.notification_types || {},
    };
  }

  private async getAutoApproveSetting(tenantId: number): Promise<boolean> {
    const setting = await db('settings')
      .where({ tenant_id: tenantId, scope: 'global', key: 'autoApproveDevices' })
      .first();
    if (setting) return setting.value === true || setting.value === 'true';
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
    };
  }
}

export const deviceService = new DeviceService();
