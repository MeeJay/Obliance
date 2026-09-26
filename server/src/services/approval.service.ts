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

export type ApprovalRequestType = 'batch_command' | 'device_uninstall' | 'setting_change';

export interface BatchCommandPayload {
  action: string;              // 'reboot' | 'shutdown' | 'restart_agent' | ...
  deviceIds: number[];
  params?: Record<string, any>;
}

/** tenant.manage_users requests (users.controller.ts). */
export interface UserActionPayload {
  action: string;              // 'user_2fa_reset' | 'user_tenants_set' | ...
  userId: number;
  assignments?: unknown;
}

export interface DeviceUninstallPayload {
  deviceId: number;
}

// Generic setting flip — used today for the scenario / schedule
// `bypass_privacy_mode` toggle. Targets a row by (entityType, entityId)
// in the requester's tenant and overwrites a single column when the
// second admin approves. Keep the field list narrow on the executor
// side so an attacker can't repurpose approvals to flip unrelated rows.
export interface SettingChangePayload {
  entityType: 'scenario' | 'schedule';
  entityId: number;
  field: 'bypassPrivacyMode';
  value: boolean;
}

export interface PendingApproval {
  id: number;
  tenantId: number;
  requestedBy: number;
  requestedByName?: string | null;
  requestType: ApprovalRequestType;
  description: string;
  payload: BatchCommandPayload | DeviceUninstallPayload | SettingChangePayload;
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
    payload: BatchCommandPayload | DeviceUninstallPayload | SettingChangePayload;
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

    // Conditional on 'pending': two approvers (or a double click) racing on
    // the same request execute it once.
    const claimed = await db('pending_approvals').where({ id: row.id, status: 'pending' }).update({
      status: 'approved',
      reviewed_by: params.reviewerId,
      reviewed_at: new Date(),
      review_reason: params.reason ?? null,
    });
    if (!claimed) throw Object.assign(new Error('Already handled'), { status: 409 });

    // Execute the underlying action.
    try {
      const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
      if (row.request_type === 'batch_command') {
        await this._executeBatch(row.tenant_id, row.requested_by, payload as BatchCommandPayload);
      } else if (row.request_type === 'device_uninstall') {
        await this._executeUninstall(row.tenant_id, row.requested_by, payload as DeviceUninstallPayload);
      } else if (row.request_type === 'setting_change') {
        await this._executeSettingChange(row.tenant_id, payload as SettingChangePayload);
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
    // Manual script run (POST /api/scripts/:id/execute): the bare `run_script`
    // command below would carry only {scriptId, parameterValues} — the agent
    // needs the script content, interpreter and timeout, and the run must
    // appear as a script execution. Go through the same path as the direct
    // (non-restricted) run, as the requester.
    const p = payload.params ?? {};
    const isManualScriptRun = payload.action === 'run_script' && p.scriptId != null && (
      p.source === 'script_execute'
      // Requests filed before the marker existed: script id + parameter
      // values and no inline content (a raw command approval carries content).
      || (p.source === undefined && p.parameterValues !== undefined && p.content === undefined)
    );
    if (isManualScriptRun) {
      await this._executeManualScript(tenantId, userId, payload);
      return;
    }
    // User-management requests (tenant.manage_users envelope) carry a
    // userId, no deviceIds.
    if (typeof payload.action === 'string' && (payload.action.startsWith('user_') || payload.action.startsWith('profile_'))) {
      await this._executeUserAction(tenantId, userId, payload as unknown as UserActionPayload);
      return;
    }
    if (!Array.isArray(payload.deviceIds)) {
      throw new Error(`approval action '${String(payload.action)}' has no device list — nothing to execute`);
    }
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

  /**
   * Approved user-management request, executed AS THE REQUESTER: the P1
   * scope (services/userScope.service.ts) is re-checked now, since rights
   * may have changed while the request waited.
   *  - user_2fa_reset   : second factors removed, code lock and IP trusts lifted
   *  - user_tenants_set : tenant memberships (same resolution as the route)
   * Other user actions (create / update / delete / password reset / profile
   * update) cannot be executed from an approval: they fail with a clear
   * error and the request stays 'approved'. A password reset never reaches
   * this point (the route asks a step-up instead: a password must never sit
   * in a payload).
   */
  async _executeUserAction(tenantId: number, requesterId: number, payload: UserActionPayload): Promise<void> {
    const requester = await db('users').where({ id: requesterId }).first('role', 'is_active') as { role: string; is_active: boolean } | undefined;
    if (!requester?.is_active) throw new Error('requester is no longer active');
    const actor = { userId: requesterId, isPlatformAdmin: requester.role === 'admin', tenantId };
    if (!actor.isPlatformAdmin) {
      const { permissionService } = await import('./permission.service');
      if (!(await permissionService.userHasTenantCapability(requesterId, tenantId, 'users.manage'))) {
        throw new Error('requester no longer holds users.manage in this tenant');
      }
    }
    const targetId = Number(payload.userId);
    if (!Number.isInteger(targetId) || targetId <= 0) throw new Error('user approval without a valid userId');
    if (targetId === requesterId) throw new Error('a user-management request cannot target its requester');
    const { userScope, resetSecondFactors } = await import('./userScope.service');

    switch (payload.action) {
      case 'user_2fa_reset': {
        const target = await userScope.assertManageableTarget(actor, targetId);
        if (!(await resetSecondFactors(targetId))) throw new Error('user not found');
        await auditService.log({
          tenantId, userId: requesterId, action: 'user.2fa_reset',
          resourceType: 'user', resourcePath: String(targetId),
          details: { username: target.username, viaApproval: true },
        }).catch(() => {});
        return;
      }
      case 'user_tenants_set': {
        const target = await userScope.assertManageableTarget(actor, targetId);
        if (target.foreign_source === 'obligate') throw new Error('SSO user tenant access is managed from Obligate');
        const assignments = await userScope.resolveTenantAssignments(actor, targetId, payload.assignments);
        const { userService } = await import('./user.service');
        await userService.setUserTenantAssignments(targetId, assignments);
        await auditService.log({
          tenantId, userId: requesterId, action: 'user.tenants_changed',
          resourceType: 'user', resourcePath: String(targetId),
          details: { username: target.username, assignments, viaApproval: true },
        }).catch(() => {});
        return;
      }
      default:
        throw new Error(`approval action '${payload.action}' cannot be executed automatically — redo it once the restriction allows it`);
    }
  },

  async _executeManualScript(tenantId: number, userId: number, payload: BatchCommandPayload): Promise<void> {
    const scriptId = Number(payload.params?.scriptId);
    if (!Number.isInteger(scriptId) || scriptId <= 0) throw new Error('run_script approval without a valid scriptId');
    const parameterValues = (payload.params?.parameterValues && typeof payload.params.parameterValues === 'object')
      ? payload.params.parameterValues as Record<string, unknown>
      : {};
    let deviceIds = (payload.deviceIds ?? []).map(Number).filter((n) => Number.isInteger(n) && n > 0);
    deviceIds = await db('devices').where({ tenant_id: tenantId }).whereIn('id', deviceIds).pluck('id');
    // Rights may have changed while the request waited for its approver: the
    // requester still needs `execute` on each device (admins are unrestricted).
    const requester = await db('users').where({ id: userId }).first('role', 'is_active') as { role: string; is_active: boolean } | undefined;
    if (!requester?.is_active) throw new Error('requester is no longer active');
    if (requester.role !== 'admin') {
      const { permissionService } = await import('./permission.service');
      const lacking = new Set(await permissionService.devicesLackingCapability(userId, deviceIds, 'execute'));
      if (lacking.size) {
        logger.warn({ scriptId, lacking: [...lacking] }, 'approved script run: requester lost execute on some devices — skipped');
        deviceIds = deviceIds.filter((id) => !lacking.has(id));
      }
    }
    if (!deviceIds.length) throw new Error('approved script run: no device left to run on');
    // The approver reviewed THIS content: refuse if the script changed since.
    if (typeof payload.params?.contentSha256 === 'string') {
      const script = await db('scripts').where({ id: scriptId }).first('content') as { content: string | null } | undefined;
      const { createHash } = await import('crypto');
      const now = createHash('sha256').update(String(script?.content ?? '')).digest('hex');
      if (now !== payload.params.contentSha256) {
        throw new Error('approved script run refused: the script was modified after the request');
      }
    }
    const { scheduleService } = await import('./schedule.service');
    await scheduleService.executeNow(scriptId, deviceIds, tenantId, parameterValues, userId);
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

  /** Apply a single approved setting flip. Strict allowlist on
   *  (entityType, field) so an attacker who plants a malformed approval
   *  payload can't repurpose this to write arbitrary columns. */
  async _executeSettingChange(tenantId: number, payload: SettingChangePayload): Promise<void> {
    if (payload.field !== 'bypassPrivacyMode' || typeof payload.value !== 'boolean') {
      logger.warn({ payload }, 'setting_change approval: unsupported field — ignored');
      return;
    }
    const table = payload.entityType === 'scenario' ? 'scenarios'
                : payload.entityType === 'schedule' ? 'script_schedules'
                : null;
    if (!table) {
      logger.warn({ payload }, 'setting_change approval: unknown entityType — ignored');
      return;
    }
    await db(table)
      .where({ id: payload.entityId, tenant_id: tenantId })
      .update({ bypass_privacy_mode: payload.value, updated_at: new Date() });
  },
};
