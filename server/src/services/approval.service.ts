import { db } from '../db';
import { logger } from '../utils/logger';
import { getIO } from '../socket';
import { commandService } from './command.service';
import { auditService } from './audit.service';
import { isMasterTenant } from '@obliance/shared';

// Two-step approval service — creates pending requests, handles approve/deny,
// and dispatches the actual commands once approved. Designed so the existing
// handlers (batch, uninstall) only need a thin wrapper: they either execute
// directly (tenant hasn't enabled 2-step) OR create a pending_approvals row
// and return that row's id/status to the UI.
//
// Safety:
//   - Requester cannot approve their own request.
//   - Requests expire after EXPIRY_MINUTES (default 30).
//   - Executions are idempotent: once 'executed', a second approval attempt
//     is rejected.

const EXPIRY_MINUTES = 30;

export type ApprovalRequestType = 'batch_command' | 'device_uninstall';

export interface BatchCommandPayload {
  action: string;              // 'reboot' | 'shutdown' | 'restart_agent' | ...
  deviceIds: number[];
  params?: Record<string, any>;
}

export interface DeviceUninstallPayload {
  deviceId: number;
}

export interface PendingApproval {
  id: number;
  tenantId: number;
  requestedBy: number;
  requestedByName?: string | null;
  requestType: ApprovalRequestType;
  description: string;
  payload: BatchCommandPayload | DeviceUninstallPayload;
  status: 'pending' | 'approved' | 'denied' | 'executed' | 'expired' | 'cancelled';
  reviewedBy: number | null;
  reviewedByName?: string | null;
  reviewedAt: string | null;
  reviewReason: string | null;
  createdAt: string;
  expiresAt: string;
  executedAt: string | null;
}

function rowToApproval(r: any): PendingApproval {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    requestedBy: r.requested_by,
    requestedByName: r.requested_by_name ?? null,
    requestType: r.request_type,
    description: r.description,
    payload: typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload,
    status: r.status,
    reviewedBy: r.reviewed_by,
    reviewedByName: r.reviewed_by_name ?? null,
    reviewedAt: r.reviewed_at,
    reviewReason: r.review_reason,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    executedAt: r.executed_at,
  };
}

export const approvalService = {
  /** Is 2-step approval required for this tenant? */
  async requiresApproval(tenantId: number): Promise<boolean> {
    const row = await db('tenants').where({ id: tenantId }).first('two_step_approval');
    return !!row?.two_step_approval;
  },

  /** Create a pending approval and notify admins. */
  async create(params: {
    tenantId: number;
    userId: number;
    requestType: ApprovalRequestType;
    description: string;
    payload: BatchCommandPayload | DeviceUninstallPayload;
  }): Promise<PendingApproval> {
    const expiresAt = new Date(Date.now() + EXPIRY_MINUTES * 60 * 1000);
    const [row] = await db('pending_approvals').insert({
      tenant_id: params.tenantId,
      requested_by: params.userId,
      request_type: params.requestType,
      description: params.description,
      payload: JSON.stringify(params.payload),
      status: 'pending',
      expires_at: expiresAt,
    }).returning('*');

    // Audit trail
    await auditService.log({
      tenantId: params.tenantId,
      userId: params.userId,
      action: 'approval.requested',
      resourceType: 'approval',
      resourcePath: String(row.id),
      details: { requestType: params.requestType, description: params.description },
    }).catch(() => {});

    // Live push to all admins in the tenant so a red badge appears immediately.
    try { getIO().to(`tenant:${params.tenantId}`).emit('APPROVAL_CREATED', rowToApproval(row)); } catch {}

    return rowToApproval(row);
  },

  /** List pending approvals for a tenant (optionally all statuses).
   *  Master tenant gets the cross-tenant feed — useful for the
   *  platform admin to spot stuck approvals across customer accounts. */
  async list(tenantId: number, opts: { includeResolved?: boolean; limit?: number } = {}): Promise<PendingApproval[]> {
    const isMaster = isMasterTenant(tenantId);
    const q = db('pending_approvals as pa')
      .leftJoin('users as u1', 'u1.id', 'pa.requested_by')
      .leftJoin('users as u2', 'u2.id', 'pa.reviewed_by')
      .select(
        'pa.*',
        'u1.username as requested_by_name',
        'u2.username as reviewed_by_name',
      )
      .orderBy('pa.created_at', 'desc');
    if (!isMaster) q.where({ 'pa.tenant_id': tenantId });
    if (!opts.includeResolved) q.where('pa.status', 'pending');
    if (opts.limit) q.limit(opts.limit);
    const rows = await q;
    return rows.map(rowToApproval);
  },

  /** Approve and execute. Blocks self-approval. */
  async approve(params: { tenantId: number; approvalId: number; reviewerId: number; reason?: string }): Promise<PendingApproval> {
    const row = await db('pending_approvals').where({ id: params.approvalId, tenant_id: params.tenantId }).first();
    if (!row) throw Object.assign(new Error('Not found'), { status: 404 });
    if (row.status !== 'pending') throw Object.assign(new Error(`Already ${row.status}`), { status: 409 });
    if (new Date(row.expires_at).getTime() < Date.now()) {
      await db('pending_approvals').where({ id: row.id }).update({ status: 'expired' });
      throw Object.assign(new Error('Expired'), { status: 410 });
    }
    if (row.requested_by === params.reviewerId) {
      throw Object.assign(new Error('Cannot approve your own request'), { status: 403 });
    }

    await db('pending_approvals').where({ id: row.id }).update({
      status: 'approved',
      reviewed_by: params.reviewerId,
      reviewed_at: new Date(),
      review_reason: params.reason ?? null,
    });

    // Execute the underlying action.
    try {
      const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
      if (row.request_type === 'batch_command') {
        await this._executeBatch(row.tenant_id, row.requested_by, payload as BatchCommandPayload);
      } else if (row.request_type === 'device_uninstall') {
        await this._executeUninstall(row.tenant_id, row.requested_by, payload as DeviceUninstallPayload);
      }
      await db('pending_approvals').where({ id: row.id }).update({ status: 'executed', executed_at: new Date() });
    } catch (err) {
      logger.error({ err, approvalId: row.id }, 'approval execution failed');
      // Leave as 'approved' — the admin can retry via a manual dispatch.
    }

    await auditService.log({
      tenantId: row.tenant_id,
      userId: params.reviewerId,
      action: 'approval.approved',
      resourceType: 'approval',
      resourcePath: String(row.id),
      details: { reason: params.reason },
    }).catch(() => {});

    const fresh = await db('pending_approvals').where({ id: row.id }).first();
    try { getIO().to(`tenant:${row.tenant_id}`).emit('APPROVAL_UPDATED', rowToApproval(fresh)); } catch {}
    return rowToApproval(fresh);
  },

  /** Deny — no execution. */
  async deny(params: { tenantId: number; approvalId: number; reviewerId: number; reason?: string }): Promise<PendingApproval> {
    const row = await db('pending_approvals').where({ id: params.approvalId, tenant_id: params.tenantId }).first();
    if (!row) throw Object.assign(new Error('Not found'), { status: 404 });
    if (row.status !== 'pending') throw Object.assign(new Error(`Already ${row.status}`), { status: 409 });
    if (row.requested_by === params.reviewerId) {
      throw Object.assign(new Error('Cannot deny your own request'), { status: 403 });
    }
    await db('pending_approvals').where({ id: row.id }).update({
      status: 'denied',
      reviewed_by: params.reviewerId,
      reviewed_at: new Date(),
      review_reason: params.reason ?? null,
    });
    await auditService.log({
      tenantId: row.tenant_id,
      userId: params.reviewerId,
      action: 'approval.denied',
      resourceType: 'approval',
      resourcePath: String(row.id),
      details: { reason: params.reason },
    }).catch(() => {});
    const fresh = await db('pending_approvals').where({ id: row.id }).first();
    try { getIO().to(`tenant:${row.tenant_id}`).emit('APPROVAL_UPDATED', rowToApproval(fresh)); } catch {}
    return rowToApproval(fresh);
  },

  /** Requester cancels their own pending approval (no review needed). */
  async cancel(params: { tenantId: number; approvalId: number; userId: number }): Promise<PendingApproval> {
    const row = await db('pending_approvals').where({ id: params.approvalId, tenant_id: params.tenantId }).first();
    if (!row) throw Object.assign(new Error('Not found'), { status: 404 });
    if (row.status !== 'pending') throw Object.assign(new Error(`Already ${row.status}`), { status: 409 });
    if (row.requested_by !== params.userId) {
      throw Object.assign(new Error('Only the requester can cancel'), { status: 403 });
    }
    await db('pending_approvals').where({ id: row.id }).update({ status: 'cancelled', reviewed_at: new Date() });
    const fresh = await db('pending_approvals').where({ id: row.id }).first();
    try { getIO().to(`tenant:${row.tenant_id}`).emit('APPROVAL_UPDATED', rowToApproval(fresh)); } catch {}
    return rowToApproval(fresh);
  },

  /** Expire stale pending approvals — called periodically by a sweeper. */
  async sweepExpired(): Promise<void> {
    const now = new Date();
    const affected = await db('pending_approvals')
      .where('status', 'pending')
      .andWhere('expires_at', '<', now)
      .update({ status: 'expired' });
    if (affected > 0) logger.info({ count: affected }, 'expired pending approvals');
  },

  // ── Private executors ────────────────────────────────────────────────────

  async _executeBatch(tenantId: number, userId: number, payload: BatchCommandPayload): Promise<void> {
    for (const deviceId of payload.deviceIds) {
      try {
        await commandService.enqueue({
          deviceId,
          tenantId,
          type: payload.action as any,
          payload: payload.params ?? {},
          priority: 'high',
          createdBy: userId,
        });
      } catch (err) {
        logger.error({ err, deviceId }, 'batch approval execution: enqueue failed');
      }
    }
  },

  async _executeUninstall(tenantId: number, userId: number, payload: DeviceUninstallPayload): Promise<void> {
    await db('devices').where({ id: payload.deviceId, tenant_id: tenantId }).update({
      status: 'pending_uninstall',
      uninstall_at: new Date(),
    });
    await commandService.enqueue({
      deviceId: payload.deviceId,
      tenantId,
      type: 'uninstall_agent' as any,
      payload: {},
      priority: 'urgent',
      createdBy: userId,
    });
  },
};
