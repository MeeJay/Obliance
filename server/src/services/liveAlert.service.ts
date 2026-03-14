import type { Server as SocketIOServer } from 'socket.io';
import { db } from '../db';


let _io: SocketIOServer | null = null;

export function setLiveAlertIO(io: SocketIOServer): void {
  _io = io;
}

export interface LiveAlertRow {
  id: number;
  tenantId: number;
  tenantName?: string;
  severity: 'down' | 'up' | 'warning' | 'info';
  title: string;
  message: string;
  navigateTo: string | null;
  stableKey: string | null;
  read: boolean;
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
    read: row.read_at !== null,
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
      severity: 'down' | 'up' | 'warning' | 'info';
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
      _io.to(`tenant:${tenantId}:notifications`).emit('notification:new', enriched);
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
