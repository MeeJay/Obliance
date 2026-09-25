import type { Server as SocketIOServer } from 'socket.io';
import { db } from '../db';
import { SocketEvents } from '@obliance/shared';


let _io: SocketIOServer | null = null;

export function setLiveAlertIO(io: SocketIOServer): void {
  _io = io;
}

// The DB column is `alert_severity` ENUM ('info','warning','critical')
// — the previous typing claimed 'down' / 'up' which would have
// triggered a Postgres enum-cast error if anything ever inserted them.
// 'critical' is used for outages and crit-threshold alerts; 'warning'
// for warn-threshold; 'info' for benign recoveries / reminders.
export type LiveAlertSeverity = 'info' | 'warning' | 'critical';

export interface LiveAlertRow {
  id: number;
  tenantId: number;
  tenantName?: string;
  severity: LiveAlertSeverity;
  title: string;
  message: string;
  navigateTo: string | null;
  stableKey: string | null;
  // ISO timestamp when the user marked it read, or null when unread.
  // MUST be `readAt` (not `read`) to match the shared LiveAlert contract
  // the client reads — the client checks `!alert.readAt`. A previous
  // `read: boolean` field meant `readAt` was always undefined client-side,
  // so every alert came back unread on every reload.
  readAt: string | null;
  createdAt: string; // ISO
}

function rowToAlert(row: Record<string, unknown>): LiveAlertRow {
  return {
    id: row.id as number,
    tenantId: row.tenant_id as number,
    tenantName: row.tenant_name as string | undefined,
    severity: row.severity as LiveAlertRow['severity'],
    title: row.title as string,
    message: row.message as string,
    navigateTo: row.navigate_to as string | null,
    stableKey: row.stable_key as string | null,
    readAt: row.read_at ? new Date(row.read_at as string | Date).toISOString() : null,
    createdAt: (row.created_at as Date).toISOString(),
  };
}

export const liveAlertService = {
  /**
   * Add a new live alert. If stableKey is provided, the insert is skipped when
   * an unread alert with the same (tenant_id, stable_key) already exists.
   * Returns the inserted row, or null if dedup skipped it.
   * After insert, emits NOTIFICATION_NEW via Socket.io.
   */
  async add(
    tenantId: number,
    opts: {
      severity: LiveAlertSeverity;
      title: string;
      message: string;
      navigateTo?: string | null;
      stableKey?: string | null;
    },
  ): Promise<LiveAlertRow | null> {
    // Dedup: skip if an unread alert with the same stable_key already exists for this tenant
    if (opts.stableKey) {
      const existing = await db('live_alerts')
        .where({ tenant_id: tenantId, stable_key: opts.stableKey })
        .whereNull('read_at')
        .first();
      if (existing) return null;
    }

    const [row] = await db('live_alerts')
      .insert({
        tenant_id: tenantId,
        severity: opts.severity,
        title: opts.title,
        message: opts.message,
        navigate_to: opts.navigateTo ?? null,
        stable_key: opts.stableKey ?? null,
      })
      .returning('*');

    // Keep only the newest 200 alerts per tenant (trim oldest)
    await db.raw(
      `DELETE FROM live_alerts WHERE tenant_id = ? AND id NOT IN (
         SELECT id FROM live_alerts WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 200
       )`,
      [tenantId, tenantId],
    );

    const alert = rowToAlert(row);

    // Attach tenant name for socket payload
    const tenantRow = await db('tenants').where({ id: tenantId }).select('name').first() as { name: string } | undefined;
    const enriched: LiveAlertRow = { ...alert, tenantName: tenantRow?.name ?? '' };

    // Emit to all users subscribed to this tenant's notifications
    if (_io) {
      _io.to(`tenant:${tenantId}:notifications`).emit(SocketEvents.NOTIFICATION_NEW, enriched);
    }

    return enriched;
  },

  /** Fetch all alerts for a single tenant (newest first). */
  async getForTenant(tenantId: number, limit = 100): Promise<LiveAlertRow[]> {
    const rows = await db('live_alerts')
      .where({ tenant_id: tenantId })
      .orderBy('created_at', 'desc')
      .limit(limit);
    return rows.map(rowToAlert);
  },

  /**
   * Fetch alerts for all of the given tenants, enriched with tenant name.
   * Used for the multi-tenant notification panel.
   */
  async getForTenants(tenantIds: number[], limit = 200): Promise<LiveAlertRow[]> {
    if (tenantIds.length === 0) return [];
    const rows = await db('live_alerts')
      .join('tenants', 'live_alerts.tenant_id', 'tenants.id')
      .whereIn('live_alerts.tenant_id', tenantIds)
      .orderBy('live_alerts.created_at', 'desc')
      .limit(limit)
      .select('live_alerts.*', 'tenants.name as tenant_name');
    return rows.map(rowToAlert);
  },

  async markRead(id: number, tenantId: number): Promise<void> {
    await db('live_alerts').where({ id, tenant_id: tenantId }).update({ read_at: new Date() });
  },

  /**
   * Mark as read the unread metric-threshold alerts
   * (`stable_key = device:{id}:metric:warning|critical`) of the given
   * devices, so they leave the web bell and the mobile "À traiter" inbox.
   * Used by the silent alert re-baseline when muting a metric brings a
   * device's alertable level back to ok. Device ids are global, so this is
   * deliberately NOT tenant-scoped: after a tenant transfer the device's
   * alerts still sit in the SOURCE tenant and must leave that inbox too.
   * Internal callers only (never with ids taken from a request). Open web
   * clients of each affected tenant are told through NOTIFICATION_READ (the
   * mobile app re-reads the list on its own refresh). Returns the ids
   * marked read.
   */
  async markDeviceMetricAlertsRead(deviceIds: number[]): Promise<number[]> {
    if (deviceIds.length === 0) return [];
    const keys = deviceIds.flatMap((id) => [`device:${id}:metric:warning`, `device:${id}:metric:critical`]);
    const readAt = new Date();
    const rows = await db('live_alerts')
      .whereIn('stable_key', keys)
      .whereNull('read_at')
      .update({ read_at: readAt })
      .returning(['id', 'tenant_id']) as Array<{ id: number; tenant_id: number }>;
    const byTenant = new Map<number, number[]>();
    for (const r of rows) {
      const list = byTenant.get(r.tenant_id) ?? [];
      list.push(r.id);
      byTenant.set(r.tenant_id, list);
    }
    if (_io) {
      for (const [tenantId, ids] of byTenant) {
        _io.to(`tenant:${tenantId}:notifications`).emit(SocketEvents.NOTIFICATION_READ, {
          tenantId, ids, readAt: readAt.toISOString(),
        });
      }
    }
    return rows.map((r) => r.id);
  },

  async markAllRead(tenantId: number): Promise<void> {
    await db('live_alerts')
      .where({ tenant_id: tenantId })
      .whereNull('read_at')
      .update({ read_at: new Date() });
  },

  async deleteAlert(id: number): Promise<void> {
    await db('live_alerts').where({ id }).delete();
  },

  async clearAll(tenantId: number): Promise<void> {
    await db('live_alerts').where({ tenant_id: tenantId }).delete();
  },

  /** Periodic cleanup: remove alerts older than daysOld. */
  async cleanup(daysOld = 30): Promise<void> {
    await db('live_alerts')
      .where('created_at', '<', new Date(Date.now() - daysOld * 86_400_000))
      .delete();
  },
};
