import { db } from '../db';
import type { Request } from 'express';
import { isMasterTenant } from '@obliance/shared';

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

export interface AuditLogRow {
  id: number;
  tenantId: number;
  /** Tenant display name. Always populated (the join is unconditional);
   *  the UI consumes it on master view to render a per-row tenant chip
   *  + tenant filter dropdown. */
  tenantName: string | null;
  userId: number | null;
  username: string | null;
  deviceId: number | null;
  deviceName: string | null;
  action: string;
  resourceType: string | null;
  resourcePath: string | null;
  details: Record<string, unknown> | null;
  ipAddress: string | null;
  createdAt: string;
}

function rowToAudit(r: any): AuditLogRow {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    tenantName: r.tenant_name ?? null,
    userId: r.user_id,
    username: r.username ?? null,
    deviceId: r.device_id,
    deviceName: r.device_name ?? null,
    action: r.action,
    resourceType: r.resource_type,
    resourcePath: r.resource_path,
    details: typeof r.details === 'string' ? JSON.parse(r.details) : r.details,
    ipAddress: r.ip_address,
    createdAt: r.created_at,
  };
}

function clientIpFromReq(req: Request | undefined): string | undefined {
  if (!req) return undefined;
  // Trust the standard forwarded-for header chain, fall back to socket address.
  const fwd = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim();
  return fwd || req.socket?.remoteAddress || undefined;
}

export const auditService = {
  /** Write a raw audit entry. Never throws — logging must not break the
   *  request that's trying to be audited. */
  async log(entry: AuditLogEntry): Promise<void> {
    try {
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
    } catch {
      // Audit logging must never break the calling request. Any failure here
      // (table missing during migration, JSON too large, etc.) is swallowed.
    }
  },

  /** Convenience helper for route handlers — pulls tenantId/userId/ip from req. */
  async logReq(
    req: Request,
    action: string,
    extras: Partial<Omit<AuditLogEntry, 'action' | 'tenantId' | 'userId' | 'ipAddress'>> = {},
  ): Promise<void> {
    const tenantId = (req as any).tenantId as number | undefined;
    const userId = (req.session as any)?.userId as number | undefined;
    if (!tenantId) return; // can't audit without a tenant scope
    await this.log({
      tenantId,
      userId,
      action,
      ipAddress: clientIpFromReq(req),
      ...extras,
    });
  },

  async getByDevice(deviceId: number, tenantId: number, limit = 50): Promise<AuditLogRow[]> {
    const rows = await db('audit_logs as al')
      .leftJoin('users as u', 'u.id', 'al.user_id')
      .leftJoin('devices as d', 'd.id', 'al.device_id')
      .where({ 'al.device_id': deviceId, 'al.tenant_id': tenantId })
      .select(
        'al.*',
        'u.username',
        db.raw('COALESCE(d.display_name, d.hostname) as device_name'),
      )
      .orderBy('al.created_at', 'desc')
      .limit(limit);
    return rows.map(rowToAudit);
  },

  /** Tenant-wide list with filters + pagination. */
  async list(params: {
    tenantId: number;
    action?: string;          // exact or prefix match (e.g. "user." matches all user actions)
    userId?: number;
    deviceId?: number;
    resourceType?: string;
    search?: string;          // match against resource_path or details text
    since?: Date;
    until?: Date;
    limit?: number;
    offset?: number;
    /** Master-only narrow filter — pick one tenant within the god
     *  view. Silently dropped for non-master callers (they're already
     *  scoped to their own tenant; allowing this would let them peek
     *  at other tenants' logs by ID). */
    filterTenantId?: number;
  }): Promise<{ items: AuditLogRow[]; total: number }> {
    const page = Math.max(0, params.offset ?? 0);
    const limit = Math.min(500, Math.max(1, params.limit ?? 100));

    // Master tenant gets the cross-tenant audit feed (essential for a
    // platform admin investigating an incident across customers).
    const isMaster = isMasterTenant(params.tenantId);
    const base = db('audit_logs as al')
      .leftJoin('users as u', 'u.id', 'al.user_id')
      .leftJoin('devices as d', 'd.id', 'al.device_id')
      // Always join `tenants` so master rows carry a tenant name column;
      // child tenants get the join too but ignore it.
      .leftJoin('tenants as ten', 'ten.id', 'al.tenant_id');
    if (!isMaster) base.where({ 'al.tenant_id': params.tenantId });
    // Narrow filter — master only (non-master is already scoped above).
    if (isMaster && Number.isFinite(params.filterTenantId)) {
      base.where('al.tenant_id', params.filterTenantId);
    }

    if (params.action) {
      if (params.action.endsWith('.')) {
        base.where('al.action', 'like', `${params.action}%`);
      } else {
        base.where('al.action', params.action);
      }
    }
    if (params.userId) base.where('al.user_id', params.userId);
    if (params.deviceId) base.where('al.device_id', params.deviceId);
    if (params.resourceType) base.where('al.resource_type', params.resourceType);
    if (params.since) base.where('al.created_at', '>=', params.since);
    if (params.until) base.where('al.created_at', '<=', params.until);
    if (params.search) {
      const q = `%${params.search}%`;
      base.where((b) => {
        b.where('al.resource_path', 'like', q)
         .orWhereRaw('details::text ILIKE ?', [q])
         .orWhere('u.username', 'like', q);
      });
    }

    const countRes = await base.clone().count<{ c: string }[]>({ c: 'al.id' });
    const total = parseInt((countRes[0] as any)?.c || '0', 10);

    const rows = await base
      .select(
        'al.*',
        'u.username',
        db.raw('COALESCE(d.display_name, d.hostname) as device_name'),
        'ten.name as tenant_name',
      )
      .orderBy('al.created_at', 'desc')
      .limit(limit)
      .offset(page);

    return { items: rows.map(rowToAudit), total };
  },
};
