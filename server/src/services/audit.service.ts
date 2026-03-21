import { db } from '../db';

export interface AuditLogEntry {
  tenantId: number;
  userId?: number;
  deviceId?: number;
  action: string;
  resourceType?: string;
  resourcePath?: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
}

export const auditService = {
  async log(entry: AuditLogEntry): Promise<void> {
    await db('audit_logs').insert({
      tenant_id: entry.tenantId,
      user_id: entry.userId ?? null,
      device_id: entry.deviceId ?? null,
      action: entry.action,
      resource_type: entry.resourceType ?? null,
      resource_path: entry.resourcePath ?? null,
      details: entry.details ? JSON.stringify(entry.details) : null,
      ip_address: entry.ipAddress ?? null,
    });
  },

  async getByDevice(deviceId: number, tenantId: number, limit = 50): Promise<any[]> {
    return db('audit_logs')
      .where({ device_id: deviceId, tenant_id: tenantId })
      .orderBy('created_at', 'desc')
      .limit(limit);
  },
};
