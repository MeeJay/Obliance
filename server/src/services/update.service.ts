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
      deviceName: row.device_name ?? null,
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
    let q = db('device_updates as du')
      .join('devices as d', 'd.id', 'du.device_id')
      .where({ 'du.tenant_id': tenantId })
      .select(
        'du.*',
        db.raw(`COALESCE(NULLIF(d.display_name, ''), d.hostname) AS device_name`),
      );
    if (filters?.status) q = q.where({ 'du.status': filters.status });
    if (filters?.severity) q = q.where({ 'du.severity': filters.severity });
    if (filters?.deviceId) q = q.where({ 'du.device_id': filters.deviceId });
    const rows = await q.orderBy('du.scanned_at', 'desc').limit(500);
    return rows.map(this.rowToUpdate.bind(this));
  }

  async upsertUpdates(deviceId: number, tenantId: number, updates: Array<{
    updateUid: string; title?: string; description?: string;
    severity?: string; category?: string; source?: string;
    status?: string; sizeBytes?: number; requiresReboot?: boolean;
  }>) {
    const now = new Date();
    const freshUids = new Set(updates.map(u => u.updateUid));

    // Remove stale updates that are no longer reported by the agent
    // (installed outside Obliance, or retracted by vendor).
    // Keep 'installed' and 'failed' as historical records.
    await db('device_updates')
      .where({ device_id: deviceId, tenant_id: tenantId })
      .whereIn('status', ['available', 'approved', 'pending_install', 'failed'])
      .whereNotIn('update_uid', [...freshUids])
      .delete();

    // Updates that were pending reboot but are no longer in the fresh scan
    // → the reboot happened, mark them as installed
    await db('device_updates')
      .where({ device_id: deviceId, tenant_id: tenantId, status: 'pending_reboot' })
      .whereNotIn('update_uid', [...freshUids])
      .update({ status: 'installed', updated_at: new Date() });

    for (const u of updates) {
      const initialStatus = u.status === 'pending_reboot' ? 'pending_reboot' : 'available';
      await db('device_updates')
        .insert({
          device_id: deviceId, tenant_id: tenantId,
          update_uid: u.updateUid, title: u.title, description: u.description,
          severity: u.severity || 'unknown', category: u.category,
          source: u.source || 'other', size_bytes: u.sizeBytes,
          requires_reboot: u.requiresReboot || false,
          status: initialStatus, scanned_at: now,
        })
        .onConflict(['device_id', 'update_uid'])
        .merge({
          title: u.title, description: u.description,
          severity: (u.severity && u.severity !== 'unknown')
            ? u.severity
            : db.raw('device_updates.severity'),
          scanned_at: now,
          updated_at: now,
          // Agent says pending_reboot → force that status regardless of current state
          // Otherwise: reset stale pending_install to available after 6h
          status: u.status === 'pending_reboot'
            ? db.raw("'pending_reboot'::update_status")
            : db.raw(
                `CASE
                  WHEN device_updates.status = 'pending_reboot'::update_status THEN 'available'::update_status
                  WHEN device_updates.status = 'pending_install'::update_status AND device_updates.updated_at < ? THEN 'available'::update_status
                  ELSE device_updates.status
                END`,
                [new Date(Date.now() - 6 * 60 * 60 * 1000)],
              ),
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

    // Enqueue ONE install_update command per update.
    // The agent handler reads payload.updateUid (singular) — one command per KB.
    for (const u of approved) {
      await commandService.enqueue({
        deviceId, tenantId, type: 'install_update',
        payload: { updateUid: u.update_uid, source: u.source || 'windows_update' },
        priority: 'normal',
        createdBy,
      });
    }

    return approved;
  }

  async retryUpdate(deviceId: number, updateId: number, tenantId: number, createdBy: number) {
    const update = await db('device_updates')
      .where({ id: updateId, device_id: deviceId, tenant_id: tenantId })
      .first();
    if (!update) throw new Error('Update not found');

    // Reset status to pending_install
    await db('device_updates').where({ id: updateId }).update({
      status: 'pending_install',
      updated_at: new Date(),
    });

    // Re-enqueue install command
    const cmd = await commandService.enqueue({
      deviceId, tenantId, type: 'install_update',
      payload: { updateUid: update.update_uid, source: update.source || 'windows_update' },
      priority: 'normal',
      createdBy,
    });

    return { updateId, status: 'pending_install', commandId: cmd.id };
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

  // ─── Aggregated view ──────────────────────────────────────────────────────

  /**
   * Returns updates grouped by title (update_uid + title), with device count
   * and severity. Only shows 'available' status by default.
   */
  async getAggregatedUpdates(tenantId: number, filters?: {
    severity?: string; source?: string; groupId?: number; status?: string;
    page?: number; pageSize?: number;
  }) {
    const status = filters?.status || 'available';
    const page = Math.max(1, filters?.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, filters?.pageSize ?? 50));

    let baseQ = db('device_updates as du')
      .join('devices as d', 'd.id', 'du.device_id')
      .where({ 'du.tenant_id': tenantId, 'du.status': status });

    if (filters?.severity) baseQ = baseQ.where({ 'du.severity': filters.severity });
    if (filters?.source) baseQ = baseQ.where({ 'du.source': filters.source });
    if (filters?.groupId) baseQ = baseQ.where({ 'd.group_id': filters.groupId });

    // Count total distinct titles
    const countResult = await baseQ.clone()
      .countDistinct('du.update_uid as count')
      .first();
    const total = Number(countResult?.count ?? 0);

    // Aggregated rows
    const rows = await baseQ.clone()
      .select(
        'du.update_uid',
        db.raw('MIN(du.title) as title'),
        db.raw('MIN(du.severity) as severity'),
        db.raw('MIN(du.category) as category'),
        db.raw('MIN(du.source) as source'),
        db.raw('MIN(du.size_bytes) as size_bytes'),
        db.raw('BOOL_OR(du.requires_reboot) as requires_reboot'),
        db.raw('COUNT(DISTINCT du.device_id)::int as device_count'),
      )
      .groupBy('du.update_uid')
      .orderByRaw(`
        CASE MIN(du.severity)
          WHEN 'critical' THEN 1
          WHEN 'important' THEN 2
          WHEN 'moderate' THEN 3
          WHEN 'optional' THEN 4
          ELSE 5
        END
      `)
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    const items = rows.map((r: any) => ({
      updateUid: r.update_uid,
      title: r.title,
      severity: r.severity,
      category: r.category,
      source: r.source,
      sizeBytes: r.size_bytes,
      requiresReboot: r.requires_reboot,
      deviceCount: r.device_count,
    }));

    return { items, total, page, pageSize };
  }

  /**
   * Returns the list of devices affected by a specific update title.
   */
  async getUpdateDevices(tenantId: number, updateUid: string, status = 'available') {
    const rows = await db('device_updates as du')
      .join('devices as d', 'd.id', 'du.device_id')
      .where({ 'du.tenant_id': tenantId, 'du.update_uid': updateUid, 'du.status': status })
      .select(
        'du.id', 'du.device_id', 'du.status',
        db.raw(`COALESCE(NULLIF(d.display_name, ''), d.hostname) AS device_name`),
        'd.group_id',
      )
      .orderBy('device_name');
    return rows.map((r: any) => ({
      id: r.id, deviceId: r.device_id, deviceName: r.device_name,
      groupId: r.group_id, status: r.status,
    }));
  }

  /**
   * Bulk approve all instances of an update title across devices.
   * Optionally scoped to a group.
   */
  async bulkApproveByTitle(tenantId: number, updateUid: string, approvedBy: number, groupId?: number) {
    let q = db('device_updates')
      .where({ tenant_id: tenantId, update_uid: updateUid, status: 'available' });

    if (groupId) {
      q = q.whereIn('device_id', db('devices').where({ group_id: groupId }).select('id'));
    }

    const count = await q.update({
      status: 'approved',
      approved_by: approvedBy,
      approved_at: new Date(),
      updated_at: new Date(),
    });
    return count;
  }

  /**
   * Bulk approve ALL available updates matching a severity across the tenant (or group).
   */
  async bulkApproveBySeverity(tenantId: number, severities: string[], approvedBy: number, groupId?: number) {
    let q = db('device_updates')
      .where({ tenant_id: tenantId, status: 'available' })
      .whereIn('severity', severities);

    if (groupId) {
      q = q.whereIn('device_id', db('devices').where({ group_id: groupId }).select('id'));
    }

    const count = await q.update({
      status: 'approved',
      approved_by: approvedBy,
      approved_at: new Date(),
      updated_at: new Date(),
    });
    return count;
  }

  /**
   * Auto-approve updates based on enabled policies.
   * Called after agent posts new scan results.
   */
  async applyAutoApprove(deviceId: number, tenantId: number) {
    const device = await db('devices').where({ id: deviceId }).first();
    if (!device) return;

    // Find all enabled policies that apply to this device
    const policies = await db('update_policies')
      .where({ tenant_id: tenantId, enabled: true })
      .where(function() {
        this.where({ target_type: 'all' })
          .orWhere(function() {
            this.where({ target_type: 'device', target_id: deviceId });
          })
          .orWhere(function() {
            if (device.group_id) {
              this.where({ target_type: 'group', target_id: device.group_id });
            }
          });
      });

    for (const policy of policies) {
      const severities: string[] = [];
      if (policy.auto_approve_critical) severities.push('critical');
      if (policy.auto_approve_security) severities.push('important');
      if (policy.auto_approve_optional) severities.push('moderate', 'optional');
      if (severities.length === 0) continue;

      // Excluded updates/categories
      const excludedUids: string[] = policy.excluded_update_ids ? JSON.parse(policy.excluded_update_ids) : [];
      const excludedCats: string[] = policy.excluded_categories ? JSON.parse(policy.excluded_categories) : [];

      let q = db('device_updates')
        .where({ device_id: deviceId, tenant_id: tenantId, status: 'available' })
        .whereIn('severity', severities);

      if (excludedUids.length > 0) q = q.whereNotIn('update_uid', excludedUids);
      if (excludedCats.length > 0) q = q.whereNotIn('category', excludedCats);

      await q.update({
        status: 'approved',
        approved_by: policy.created_by,
        approved_at: new Date(),
        updated_at: new Date(),
      });
    }
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
