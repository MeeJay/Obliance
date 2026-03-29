import { db } from '../db';
import { commandService } from './command.service';
import type { SoftwareComplianceList, SoftwareComplianceEntry, SoftwareComplianceResult, SoftwareComplianceEntryResult, KnownSoftwareApp } from '@obliance/shared';
import { SocketEvents } from '@obliance/shared';
import { getIO } from '../socket';

class SoftwareComplianceService {
  // ─── Row mappers ──────────────────────────────────────────────────────────
  rowToList(row: any, entries: any[] = []): SoftwareComplianceList {
    return {
      id: row.id, uuid: row.uuid, tenantId: row.tenant_id,
      name: row.name, description: row.description,
      listType: row.list_type,
      targetType: row.target_type,
      targetIds: Array.isArray(row.target_ids) ? row.target_ids : (typeof row.target_ids === 'string' ? JSON.parse(row.target_ids) : []),
      targetPlatform: row.target_platform || 'all',
      autoRemediate: row.auto_remediate,
      enabled: row.enabled,
      entries: entries.map(this.rowToEntry),
      createdBy: row.created_by, createdAt: row.created_at, updatedAt: row.updated_at,
    };
  }

  rowToEntry(row: any): SoftwareComplianceEntry {
    return {
      id: row.id, listId: row.list_id,
      name: row.name, matchType: row.match_type,
      publisher: row.publisher, minVersion: row.min_version,
      maxVersion: row.max_version, installSource: row.install_source,
      installId: row.install_id, installScript: row.install_script,
      msiUrl: row.msi_url ?? null, msiParams: row.msi_params ?? null,
      sortOrder: row.sort_order,
    };
  }

  rowToResult(row: any): SoftwareComplianceResult {
    return {
      id: row.id, deviceId: row.device_id,
      deviceName: row.device_name ?? null,
      listId: row.list_id, tenantId: row.tenant_id,
      results: row.results || [], complianceScore: parseFloat(row.compliance_score),
      checkedAt: row.checked_at, createdAt: row.created_at,
    };
  }

  // ─── Lists CRUD ───────────────────────────────────────────────────────────
  async getLists(tenantId: number): Promise<SoftwareComplianceList[]> {
    const rows = await db('software_compliance_lists').where({ tenant_id: tenantId });
    const listIds = rows.map((r: any) => r.id);
    const entries = listIds.length
      ? await db('software_compliance_entries').whereIn('list_id', listIds).orderBy('sort_order')
      : [];
    const entriesByList: Record<number, any[]> = {};
    for (const e of entries) {
      if (!entriesByList[e.list_id]) entriesByList[e.list_id] = [];
      entriesByList[e.list_id].push(e);
    }
    return rows.map((r: any) => this.rowToList(r, entriesByList[r.id] || []));
  }

  async getListById(id: number, tenantId: number): Promise<SoftwareComplianceList | null> {
    const row = await db('software_compliance_lists').where({ id, tenant_id: tenantId }).first();
    if (!row) return null;
    const entries = await db('software_compliance_entries').where({ list_id: id }).orderBy('sort_order');
    return this.rowToList(row, entries);
  }

  async createList(
    tenantId: number,
    data: {
      name: string; description?: string; listType: string; targetType: string;
      targetIds: number[]; targetPlatform: string; autoRemediate: boolean;
      entries: any[]; enabled?: boolean; createdBy?: number;
    },
  ): Promise<SoftwareComplianceList> {
    return db.transaction(async (trx) => {
      const [row] = await trx('software_compliance_lists').insert({
        tenant_id: tenantId, name: data.name, description: data.description,
        list_type: data.listType || 'blacklist',
        target_type: data.targetType || 'all',
        target_ids: JSON.stringify(data.targetIds || []),
        target_platform: data.targetPlatform || 'all',
        auto_remediate: data.autoRemediate ?? false,
        enabled: data.enabled !== false,
        created_by: data.createdBy,
      }).returning('*');

      const entries: any[] = [];
      if (data.entries?.length) {
        const entryRows = data.entries.map((e: any, i: number) => ({
          list_id: row.id, name: e.name,
          match_type: e.matchType || 'contains',
          publisher: e.publisher || null,
          min_version: e.minVersion || null,
          max_version: e.maxVersion || null,
          install_source: e.installSource || null,
          install_id: e.installId || null,
          install_script: e.installScript || null,
          msi_url: e.msiUrl || null,
          msi_params: e.msiParams || null,
          sort_order: e.sortOrder ?? i,
        }));
        const inserted = await trx('software_compliance_entries').insert(entryRows).returning('*');
        entries.push(...inserted);
      }

      return this.rowToList(row, entries);
    });
  }

  async updateList(
    id: number, tenantId: number,
    data: Partial<{
      name: string; description: string; listType: string; targetType: string;
      targetIds: number[]; targetPlatform: string; autoRemediate: boolean;
      enabled: boolean; entries: any[];
    }>,
  ): Promise<SoftwareComplianceList | null> {
    return db.transaction(async (trx) => {
      const updates: any = { updated_at: new Date() };
      if (data.name !== undefined) updates.name = data.name;
      if (data.description !== undefined) updates.description = data.description;
      if (data.listType !== undefined) updates.list_type = data.listType;
      if (data.targetType !== undefined) updates.target_type = data.targetType;
      if (data.targetIds !== undefined) updates.target_ids = JSON.stringify(data.targetIds);
      if (data.targetPlatform !== undefined) updates.target_platform = data.targetPlatform;
      if (data.autoRemediate !== undefined) updates.auto_remediate = data.autoRemediate;
      if (data.enabled !== undefined) updates.enabled = data.enabled;

      await trx('software_compliance_lists').where({ id, tenant_id: tenantId }).update(updates);

      if (data.entries !== undefined) {
        await trx('software_compliance_entries').where({ list_id: id }).delete();
        if (data.entries.length) {
          const entryRows = data.entries.map((e: any, i: number) => ({
            list_id: id, name: e.name,
            match_type: e.matchType || 'contains',
            publisher: e.publisher || null,
            min_version: e.minVersion || null,
            max_version: e.maxVersion || null,
            install_source: e.installSource || null,
            install_id: e.installId || null,
            install_script: e.installScript || null,
            msi_url: e.msiUrl || null,
            msi_params: e.msiParams || null,
            sort_order: e.sortOrder ?? i,
          }));
          await trx('software_compliance_entries').insert(entryRows);
        }
      }

      const row = await trx('software_compliance_lists').where({ id, tenant_id: tenantId }).first();
      if (!row) return null;
      const entries = await trx('software_compliance_entries').where({ list_id: id }).orderBy('sort_order');
      return this.rowToList(row, entries);
    });
  }

  async deleteList(id: number, tenantId: number): Promise<void> {
    await db('software_compliance_lists').where({ id, tenant_id: tenantId }).delete();
  }

  // ─── Results ──────────────────────────────────────────────────────────────
  async getLatestResults(deviceId: number, tenantId: number): Promise<SoftwareComplianceResult[]> {
    const rows = await db('software_compliance_results as sr')
      .leftJoin('software_compliance_lists as sl', 'sl.id', 'sr.list_id')
      .leftJoin('devices as d', 'd.id', 'sr.device_id')
      .where({ 'sr.device_id': deviceId, 'sr.tenant_id': tenantId })
      .orderBy('sr.checked_at', 'desc')
      .limit(50)
      .select(
        'sr.*',
        'sl.name as list_name',
        'sl.list_type as list_type',
        db.raw(`COALESCE(NULLIF(d.display_name, ''), d.hostname) AS device_name`),
      );
    return rows.map((row: any) => {
      const result = this.rowToResult(row);
      if (row.list_name) {
        result.list = { id: row.list_id, name: row.list_name, listType: row.list_type };
      }
      return result;
    });
  }

  async getAllResults(tenantId: number, page = 1, limit = 100, deviceId?: number): Promise<SoftwareComplianceResult[]> {
    const offset = (page - 1) * limit;
    let q = db('software_compliance_results as sr')
      .leftJoin('software_compliance_lists as sl', 'sl.id', 'sr.list_id')
      .leftJoin('devices as d', 'd.id', 'sr.device_id')
      .where({ 'sr.tenant_id': tenantId })
      .orderBy('sr.checked_at', 'desc')
      .limit(limit)
      .offset(offset)
      .select(
        'sr.*',
        'sl.name as list_name',
        'sl.list_type as list_type',
        db.raw(`COALESCE(NULLIF(d.display_name, ''), d.hostname) AS device_name`),
      );
    if (deviceId) q = q.where({ 'sr.device_id': deviceId });
    const rows = await q;
    return rows.map((row: any) => {
      const result = this.rowToResult(row);
      if (row.list_name) {
        result.list = { id: row.list_id, name: row.list_name, listType: row.list_type };
      }
      return result;
    });
  }

  async storeResults(
    deviceId: number,
    tenantId: number,
    listId: number,
    results: SoftwareComplianceEntryResult[],
    score: number,
  ): Promise<SoftwareComplianceResult> {
    const [row] = await db('software_compliance_results')
      .insert({
        device_id: deviceId,
        list_id: listId,
        tenant_id: tenantId,
        results: JSON.stringify(results),
        compliance_score: score,
        checked_at: new Date(),
      })
      .returning('*');

    // Hydrate list name for the socket event
    const list = await this.getListById(listId, tenantId);
    const result = this.rowToResult(row);
    if (list) {
      result.list = { id: list.id, name: list.name, listType: list.listType };
    }
    return result;
  }

  // ─── Triggering ───────────────────────────────────────────────────────────
  async triggerCheck(deviceId: number, listId: number, tenantId: number, createdBy: number) {
    const list = await this.getListById(listId, tenantId);
    if (!list) throw new Error('List not found');

    return commandService.enqueue({
      deviceId, tenantId, type: 'check_software_compliance',
      payload: { listId, listType: list.listType, entries: list.entries, autoRemediate: list.autoRemediate },
      priority: 'normal', expiresInSeconds: 600, createdBy,
    });
  }

  async triggerRemediation(
    deviceId: number, listId: number, entryIds: number[],
    tenantId: number, createdBy: number,
  ) {
    const list = await this.getListById(listId, tenantId);
    if (!list) throw new Error('List not found');

    const entriesToRemediate = list.entries.filter(e => entryIds.includes(e.id));
    if (entriesToRemediate.length === 0) throw new Error('No matching entries found');

    const cmdType = list.listType === 'whitelist' ? 'install_software' : 'uninstall_software';

    const cmds = await Promise.all(entriesToRemediate.map(entry =>
      commandService.enqueue({
        deviceId, tenantId, type: cmdType as any,
        payload: {
          listId, entryId: entry.id, entryName: entry.name,
          installSource: entry.installSource, installId: entry.installId,
          installScript: entry.installScript,
          msiUrl: entry.msiUrl, msiParams: entry.msiParams,
        },
        priority: 'low', expiresInSeconds: 300, createdBy,
      })
    ));
    return cmds;
  }

  // ─── Known apps ──────────────────────────────────────────────────────────
  async getKnownApps(tenantId: number, osType?: string): Promise<KnownSoftwareApp[]> {
    let q = db('device_inventory_software as s')
      .join('devices as d', 'd.id', 's.device_id')
      .where({ 'd.tenant_id': tenantId })
      .groupByRaw('LOWER(s.name), s.publisher, s.source')
      .select(
        db.raw('MIN(s.name) as name'),
        's.publisher',
        's.source',
        db.raw('MIN(s.package_id) as package_id'),
        db.raw('MIN(d.os_type) as os_type'),
        db.raw('COUNT(DISTINCT s.device_id) as device_count'),
        db.raw('MAX(s.version) as latest_version'),
      )
      .orderBy('device_count', 'desc')
      .orderBy('name', 'asc')
      .limit(500);

    if (osType) {
      q = q.where({ 'd.os_type': osType });
    }

    const rows = await q;
    return rows.map((r: any) => ({
      name: r.name,
      publisher: r.publisher ?? null,
      source: r.source,
      packageId: r.package_id ?? null,
      osType: r.os_type,
      deviceCount: parseInt(r.device_count, 10),
      latestVersion: r.latest_version ?? null,
    }));
  }

  // ─── Scheduled checks ────────────────────────────────────────────────────
  /**
   * Run software compliance checks for all enabled lists across all tenants.
   * Called periodically by index.ts (default every 6h).
   * Skips devices that were already checked within the interval.
   */
  async runScheduledChecks(intervalMs: number) {
    const lists = await db('software_compliance_lists').where({ enabled: true });
    const cutoff = new Date(Date.now() - intervalMs);

    for (const row of lists) {
      const list = this.rowToList(row);
      // Load entries for the list
      const entries = await db('software_compliance_entries').where({ list_id: row.id }).orderBy('sort_order');
      if (!entries.length) continue;

      // Resolve target devices — filter by platform
      let deviceQuery = db('devices')
        .where({ tenant_id: list.tenantId, approval_status: 'approved' })
        .whereIn('status', ['online', 'warning', 'critical']);

      if (list.targetPlatform && list.targetPlatform !== 'all') {
        deviceQuery = deviceQuery.where({ os_type: list.targetPlatform });
      }

      if (list.targetType === 'group' && list.targetIds.length > 0) {
        // Get all devices in these groups + descendants
        const descendants = await db('device_group_closure')
          .whereIn('ancestor_id', list.targetIds)
          .select('descendant_id');
        const allGroupIds = [...new Set([...list.targetIds, ...descendants.map((d: any) => d.descendant_id)])];
        deviceQuery = deviceQuery.whereIn('group_id', allGroupIds);
      }

      const devices = await deviceQuery.select('id');

      for (const device of devices) {
        // Skip if already checked recently
        const lastCheck = await db('software_compliance_results')
          .where({ device_id: device.id, list_id: list.id })
          .orderBy('checked_at', 'desc')
          .first();

        if (lastCheck && new Date(lastCheck.checked_at) > cutoff) continue;

        try {
          await commandService.enqueue({
            deviceId: device.id, tenantId: list.tenantId,
            type: 'check_software_compliance',
            payload: {
              listId: list.id, listType: list.listType,
              entries: entries.map(this.rowToEntry),
              autoRemediate: list.autoRemediate,
            },
            priority: 'low', expiresInSeconds: 600, createdBy: list.createdBy ?? 0,
          });
        } catch {
          // Device may be offline or queue full — skip silently
        }
      }
    }
  }
}

export const softwareComplianceService = new SoftwareComplianceService();
