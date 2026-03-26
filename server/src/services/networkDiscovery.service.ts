import { db } from '../db';
import type { DiscoveredDevice } from '@obliance/shared';

function rowToDiscovered(row: any): DiscoveredDevice {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    discoveredByDeviceId: row.discovered_by_device_id,
    ip: row.ip,
    mac: row.mac ?? null,
    hostname: row.hostname ?? null,
    ports: Array.isArray(row.ports) ? row.ports : (typeof row.ports === 'string' ? JSON.parse(row.ports) : []),
    ouiVendor: row.oui_vendor ?? null,
    osGuess: row.os_guess ?? null,
    deviceType: row.device_type ?? 'unknown',
    isManaged: !!row.is_managed,
    managedDeviceId: row.managed_device_id ?? null,
    subnet: row.subnet ?? null,
    firstSeen: row.first_seen,
    lastSeen: row.last_seen,
  };
}

export const networkDiscoveryService = {
  /**
   * Upsert scan results from an agent into discovered_devices.
   * Cross-references the devices table to flag managed hosts.
   */
  async processScanResults(tenantId: number, agentDeviceId: number, results: any[]) {
    if (!Array.isArray(results) || results.length === 0) return;

    // Pre-load all managed devices for this tenant to cross-reference
    const managedDevices = await db('devices')
      .where({ tenant_id: tenantId })
      .whereIn('approval_status', ['approved', 'pending'])
      .select('id', 'ip_local', 'mac_address');

    const managedByIp = new Map<string, number>();
    const managedByMac = new Map<string, number>();
    for (const d of managedDevices) {
      if (d.ip_local) managedByIp.set(d.ip_local.toLowerCase(), d.id);
      if (d.mac_address) managedByMac.set(d.mac_address.toLowerCase(), d.id);
    }

    const now = new Date();

    for (const r of results) {
      if (!r.ip) continue;

      // Cross-reference: check if this host is already a managed device
      let managedDeviceId: number | null = null;
      if (r.mac && managedByMac.has(r.mac.toLowerCase())) {
        managedDeviceId = managedByMac.get(r.mac.toLowerCase())!;
      } else if (managedByIp.has(r.ip.toLowerCase())) {
        managedDeviceId = managedByIp.get(r.ip.toLowerCase())!;
      }
      const isManaged = managedDeviceId !== null;

      const row = {
        tenant_id: tenantId,
        discovered_by_device_id: agentDeviceId,
        ip: r.ip,
        mac: r.mac || null,
        hostname: r.hostname || null,
        ports: JSON.stringify(r.ports || []),
        oui_vendor: r.ouiVendor || null,
        os_guess: r.osGuess || null,
        device_type: r.deviceType || 'unknown',
        is_managed: isManaged,
        managed_device_id: managedDeviceId,
        subnet: r.subnet || null,
        last_seen: now,
        updated_at: now,
      };

      // Upsert: ON CONFLICT (tenant_id, ip, mac) update
      // Because mac can be null, we need a two-pass approach:
      // 1. Try to find existing by tenant_id + ip + mac
      // 2. Insert or update accordingly
      const existing = await db('discovered_devices')
        .where({ tenant_id: tenantId, ip: r.ip })
        .where(function () {
          if (r.mac) {
            this.where('mac', r.mac);
          } else {
            this.whereNull('mac');
          }
        })
        .first();

      if (existing) {
        await db('discovered_devices').where({ id: existing.id }).update(row);
      } else {
        await db('discovered_devices').insert({
          ...row,
          first_seen: now,
          created_at: now,
        });
      }
    }
  },

  /**
   * Paginated listing with optional filters.
   */
  async list(tenantId: number, filters?: {
    isManaged?: boolean;
    deviceType?: string;
    subnet?: string;
    page?: number;
    limit?: number;
  }): Promise<{ data: DiscoveredDevice[]; total: number }> {
    const page = filters?.page ?? 1;
    const limit = filters?.limit ?? 50;
    const offset = (page - 1) * limit;

    let query = db('discovered_devices as dd')
      .where('dd.tenant_id', tenantId);

    if (filters?.isManaged !== undefined) {
      query = query.where('dd.is_managed', filters.isManaged);
    }
    if (filters?.deviceType) {
      query = query.where('dd.device_type', filters.deviceType);
    }
    if (filters?.subnet) {
      query = query.where('dd.subnet', filters.subnet);
    }

    const countResult = await query.clone().count('dd.id as count').first();
    const total = parseInt(String(countResult?.count ?? 0), 10);

    const rows = await query
      .leftJoin('devices as d', 'dd.discovered_by_device_id', 'd.id')
      .select(
        'dd.*',
        'd.hostname as discoverer_hostname',
      )
      .orderBy('dd.last_seen', 'desc')
      .limit(limit)
      .offset(offset);

    return {
      data: rows.map(rowToDiscovered),
      total,
    };
  },

  /**
   * Aggregate stats: total, managed, unmanaged, by device_type.
   */
  async getStats(tenantId: number) {
    const rows = await db('discovered_devices')
      .where({ tenant_id: tenantId })
      .select('device_type', 'is_managed')
      .count('id as count')
      .groupBy('device_type', 'is_managed');

    let total = 0;
    let managed = 0;
    let unmanaged = 0;
    const byType: Record<string, number> = {};

    for (const r of rows) {
      const c = parseInt(String(r.count), 10);
      total += c;
      if (r.is_managed) managed += c; else unmanaged += c;
      byType[r.device_type] = (byType[r.device_type] || 0) + c;
    }

    return { total, managed, unmanaged, byType };
  },

  /**
   * Delete a single discovered device entry.
   */
  async remove(id: number, tenantId: number): Promise<boolean> {
    const deleted = await db('discovered_devices')
      .where({ id, tenant_id: tenantId })
      .del();
    return deleted > 0;
  },
};
