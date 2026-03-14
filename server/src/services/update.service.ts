import { db } from '../db';
import { commandService } from './command.service';
import type { DeviceUpdate, UpdatePolicy } from '@obliance/shared';

class UpdateService {
  rowToUpdate(row: any): DeviceUpdate {
    return {
      id: row.id, deviceId: row.device_id, tenantId: row.tenant_id,
      updateUid: row.update_uid, title: row.title, description: row.description,
      severity: row.severity, category: row.category, source: row.source,
      sizeBytes: row.size_bytes, requiresReboot: row.requires_reboot,
      status: row.status, approvedBy: row.approved_by, approvedAt: row.approved_at,
      installedAt: row.installed_at, installError: row.install_error,
      scannedAt: row.scanned_at, createdAt: row.created_at, updatedAt: row.updated_at,
    };
  }

  rowToPolicy(row: any): UpdatePolicy {
    return {
      id: row.id, tenantId: row.tenant_id, name: row.name, description: row.description,
      targetType: row.target_type, targetId: row.target_id,
      autoApproveCritical: row.auto_approve_critical,
      autoApproveSecurity: row.auto_approve_security,
      autoApproveOptional: row.auto_approve_optional,
      approvalRequired: row.approval_required,
      installWindowStart: row.install_window_start,
      installWindowEnd: row.install_window_end,
      installWindowDays: row.install_window_days || [1,2,3,4,5],
      timezone: row.timezone,
      rebootBehavior: row.reboot_behavior,
      rebootDelayMinutes: row.reboot_delay_minutes,
      excludedUpdateIds: row.excluded_update_ids || [],
      excludedCategories: row.excluded_categories || [],
      enabled: row.enabled,
      createdBy: row.created_by,
      createdAt: row.created_at, updatedAt: row.updated_at,
    };
  }

  // ─── Updates ──────────────────────────────────────────────────────────────
  async getDeviceUpdates(deviceId: number, tenantId: number, filters?: { status?: string; severity?: string }) {
    let q = db('device_updates').where({ device_id: deviceId, tenant_id: tenantId });
    if (filters?.status) q = q.where({ status: filters.status });
    if (filters?.severity) q = q.where({ severity: filters.severity });
    const rows = await q.orderBy([{ column: 'severity', order: 'asc' }, { column: 'title' }]);
    return rows.map(this.rowToUpdate.bind(this));
  }

  async getTenantUpdates(tenantId: number, filters?: { status?: string; severity?: string; deviceId?: number }) {
    let q = db('device_updates').where({ tenant_id: tenantId });
    if (filters?.status) q = q.where({ status: filters.status });
    if (filters?.severity) q = q.where({ severity: filters.severity });
    if (filters?.deviceId) q = q.where({ device_id: filters.deviceId });
    const rows = await q.orderBy('scanned_at', 'desc').limit(500);
    return rows.map(this.rowToUpdate.bind(this));
  }

  async upsertUpdates(deviceId: number, tenantId: number, updates: Array<{
    updateUid: string; title?: string; description?: string;
    severity?: string; category?: string; source?: string;
    sizeBytes?: number; requiresReboot?: boolean;
  }>) {
    const now = new Date();
    for (const u of updates) {
      await db('device_updates')
        .insert({
          device_id: deviceId, tenant_id: tenantId,
          update_uid: u.updateUid, title: u.title, description: u.description,
          severity: u.severity || 'unknown', category: u.category,
          source: u.source || 'other', size_bytes: u.sizeBytes,
          requires_reboot: u.requiresReboot || false,
          status: 'available', scanned_at: now,
        })
        .onConflict(['device_id', 'update_uid'])
        .merge({
          title: u.title, description: u.description,
          severity: u.severity || 'unknown', scanned_at: now,
          updated_at: now,
        });
    }
  }

  async approveUpdate(updateId: number, tenantId: number, approvedBy: number) {
    await db('device_updates')
      .where({ id: updateId, tenant_id: tenantId })
      .update({ status: 'approved', approved_by: approvedBy, approved_at: new Date(), updated_at: new Date() });
  }

  async approveByDeviceAndSeverity(deviceId: number, tenantId: number, severities: string[], approvedBy: number) {
    await db('device_updates')
      .where({ device_id: deviceId, tenant_id: tenantId, status: 'available' })
      .whereIn('severity', severities)
      .update({ status: 'approved', approved_by: approvedBy, approved_at: new Date(), updated_at: new Date() });
  }

  async deployApprovedUpdates(deviceId: number, tenantId: number, createdBy: number) {
    const approved = await db('device_updates')
      .where({ device_id: deviceId, tenant_id: tenantId, status: 'approved' });

    if (!approved.length) return [];

    // Mark as pending_install
    await db('device_updates')
      .whereIn('id', approved.map((u: any) => u.id))
      .update({ status: 'pending_install', updated_at: new Date() });

    // Enqueue install command
    const cmd = await commandService.enqueue({
      deviceId, tenantId, type: 'install_update',
      payload: { updateIds: approved.map((u: any) => u.update_uid) },
      priority: 'normal',
      createdBy,
    });

    return approved;
  }

  async triggerUpdateScan(deviceId: number, tenantId: number, createdBy: number) {
    return commandService.enqueue({
      deviceId, tenantId, type: 'scan_updates',
      payload: {}, priority: 'normal',
      expiresInSeconds: 600, createdBy,
    });
  }

  // ─── Policies ─────────────────────────────────────────────────────────────
  async getPolicies(tenantId: number) {
    const rows = await db('update_policies').where({ tenant_id: tenantId });
    return rows.map(this.rowToPolicy.bind(this));
  }

  async createPolicy(tenantId: number, data: Partial<UpdatePolicy> & { name: string; createdBy?: number }) {
    const [row] = await db('update_policies').insert({
      tenant_id: tenantId, name: data.name, description: data.description,
      target_type: data.targetType || 'all', target_id: data.targetId,
      auto_approve_critical: data.autoApproveCritical || false,
      auto_approve_security: data.autoApproveSecurity || false,
      auto_approve_optional: data.autoApproveOptional || false,
      approval_required: data.approvalRequired !== false,
      install_window_start: data.installWindowStart || '22:00:00',
      install_window_end: data.installWindowEnd || '06:00:00',
      install_window_days: JSON.stringify(data.installWindowDays || [1,2,3,4,5]),
      timezone: data.timezone || 'UTC',
      reboot_behavior: data.rebootBehavior || 'ask',
      reboot_delay_minutes: data.rebootDelayMinutes || 30,
      excluded_update_ids: JSON.stringify(data.excludedUpdateIds || []),
      excluded_categories: JSON.stringify(data.excludedCategories || []),
      enabled: data.enabled !== false,
      created_by: data.createdBy,
    }).returning('*');
    return this.rowToPolicy(row);
  }

  async deletePolicy(id: number, tenantId: number) {
    await db('update_policies').where({ id, tenant_id: tenantId }).delete();
  }

  // Update statistics for tenant dashboard
  async getUpdateStats(tenantId: number) {
    const stats = await db('device_updates')
      .where({ tenant_id: tenantId })
      .select(db.raw('status, severity, count(*) as count'))
      .groupBy('status', 'severity');

    const result = { available: 0, critical: 0, important: 0, approved: 0, installed: 0, failed: 0 };
    for (const s of stats) {
      if (s.status === 'available') {
        result.available += parseInt(s.count);
        if (s.severity === 'critical') result.critical += parseInt(s.count);
        if (s.severity === 'important') result.important += parseInt(s.count);
      }
      if (s.status === 'approved') result.approved += parseInt(s.count);
      if (s.status === 'installed') result.installed += parseInt(s.count);
      if (s.status === 'failed') result.failed += parseInt(s.count);
    }
    return result;
  }
}

export const updateService = new UpdateService();
