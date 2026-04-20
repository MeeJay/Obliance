import { db } from '../db';
import type { Request, Response } from 'express';
import { twoFactorService } from './twoFactor.service';
import { approvalService, type ApprovalRequestType } from './approval.service';

// ── Restriction model ───────────────────────────────────────────────────────
//
// Per-tenant JSONB map, each entry is either:
//
//   // Shorthand (applies to every device):
//   "command.reboot": "restricted"
//
//   // Full form with scope:
//   "command.uninstall_agent": {
//     "level": "sensitive",
//     "scope": { "mode": "exclude", "deviceIds": [42], "groupIds": [7] }
//   }
//
// Scope modes:
//   - "all"      (default) — the restriction applies to every device.
//   - "include"  — applies ONLY to the listed devices / groups (+ descendants).
//   - "exclude"  — applies to every device EXCEPT the listed ones / their groups.
//
// Enforcement:
//   - For single-device actions, we evaluate scope against that device.
//   - For batch actions, if ANY device in the batch falls in scope, the whole
//     batch is gated (keeps the UX obvious: "some of these need approval").

export type RestrictionLevel = 'none' | 'restricted' | 'sensitive';
export type ScopeMode = 'all' | 'include' | 'exclude';

export interface RestrictionScope {
  mode: ScopeMode;
  deviceIds?: number[];
  groupIds?: number[];
}

export interface RestrictionEntry {
  level: RestrictionLevel;
  scope: RestrictionScope;
}

export type RestrictionMap = Record<string, RestrictionEntry>;

// Canonical list of actions that can be restricted. The UI renders this list
// plus any extra keys that exist in the tenant's map (forward-compat).
export const RESTRICTABLE_ACTIONS: { key: string; label: string; category: string }[] = [
  { key: 'command.reboot',               label: 'Reboot a device',          category: 'Power' },
  { key: 'command.shutdown',             label: 'Shutdown a device',        category: 'Power' },
  { key: 'command.sleep',                label: 'Sleep a device',           category: 'Power' },
  { key: 'command.restart_agent',        label: 'Restart agent',            category: 'Power' },
  { key: 'command.uninstall_agent',      label: 'Uninstall agent',          category: 'Power' },
  { key: 'command.enable_airgap',        label: 'Enable airgap',            category: 'Isolation' },
  { key: 'command.disable_airgap',       label: 'Disable airgap',           category: 'Isolation' },
  { key: 'command.enable_privacy_mode',  label: 'Enable privacy mode',      category: 'Isolation' },
  { key: 'command.disable_privacy_mode', label: 'Disable privacy mode',     category: 'Isolation' },
  { key: 'device.delete',                label: 'Delete device (record)',   category: 'Device' },
  { key: 'device.bulk_group_change',     label: 'Bulk change group',        category: 'Device' },
  { key: 'device.transfer_tenant',       label: 'Transfer device to another tenant', category: 'Device' },
  { key: 'software.remediate_install',   label: 'Install software (manual)', category: 'Software' },
  { key: 'software.remediate_uninstall', label: 'Uninstall software (manual)', category: 'Software' },
];

function normalizeEntry(raw: any): RestrictionEntry | null {
  if (raw === 'restricted' || raw === 'sensitive') {
    return { level: raw, scope: { mode: 'all' } };
  }
  if (raw && typeof raw === 'object' && (raw.level === 'restricted' || raw.level === 'sensitive')) {
    const scope: RestrictionScope = {
      mode: raw.scope?.mode === 'include' || raw.scope?.mode === 'exclude' ? raw.scope.mode : 'all',
      deviceIds: Array.isArray(raw.scope?.deviceIds) ? raw.scope.deviceIds.map(Number).filter(Number.isFinite) : undefined,
      groupIds:  Array.isArray(raw.scope?.groupIds)  ? raw.scope.groupIds.map(Number).filter(Number.isFinite)  : undefined,
    };
    return { level: raw.level, scope };
  }
  return null;
}

/**
 * Decide whether a restriction with `scope` applies to a given device.
 * Resolves group membership via the device_group_closure so sub-groups of
 * a scoped parent are matched too.
 */
async function scopeAppliesToDevice(scope: RestrictionScope, deviceId: number, tenantId: number): Promise<boolean> {
  if (scope.mode === 'all') return true;
  const dev = await db('devices').where({ id: deviceId, tenant_id: tenantId }).first('id', 'group_id');
  if (!dev) return scope.mode === 'include' ? false : true;

  const deviceMatches = (scope.deviceIds ?? []).includes(dev.id);
  let groupMatches = false;
  if (scope.groupIds?.length && dev.group_id != null) {
    // Device matches scope.groupIds if its group_id is one of them, or is a
    // descendant (closure table: ancestor_id → descendant_id).
    const row = await db('device_group_closure')
      .whereIn('ancestor_id', scope.groupIds)
      .andWhere('descendant_id', dev.group_id)
      .first('descendant_id');
    groupMatches = !!row;
  }

  const inScope = deviceMatches || groupMatches;
  return scope.mode === 'include' ? inScope : !inScope;
}

export const restrictionService = {
  async getMap(tenantId: number): Promise<RestrictionMap> {
    const row = await db('tenants').where({ id: tenantId }).first('action_restrictions');
    if (!row) return {};
    const raw = typeof row.action_restrictions === 'string'
      ? JSON.parse(row.action_restrictions || '{}')
      : (row.action_restrictions || {});
    const out: RestrictionMap = {};
    for (const [k, v] of Object.entries(raw)) {
      const norm = normalizeEntry(v);
      if (norm) out[k] = norm;
    }
    return out;
  },

  async setMap(tenantId: number, next: RestrictionMap): Promise<void> {
    const clean: RestrictionMap = {};
    for (const [k, v] of Object.entries(next)) {
      const norm = normalizeEntry(v);
      if (norm) clean[k] = norm;
    }
    await db('tenants').where({ id: tenantId }).update({
      action_restrictions: JSON.stringify(clean),
      updated_at: new Date(),
    });
  },

  /**
   * Returns the effective level after scope evaluation. "none" when the
   * action is unrestricted OR when scope excludes the target devices.
   */
  async getLevelFor(params: {
    tenantId: number;
    actionKey: string;
    deviceIds?: number[];  // empty / undefined → treat as "applies to all"
  }): Promise<RestrictionLevel> {
    const map = await this.getMap(params.tenantId);
    const entry = map[params.actionKey];
    if (!entry) return 'none';

    if (entry.scope.mode === 'all' || !params.deviceIds?.length) return entry.level;

    // For batch ops, gate as soon as one device is in scope.
    for (const id of params.deviceIds) {
      if (await scopeAppliesToDevice(entry.scope, id, params.tenantId)) {
        return entry.level;
      }
    }
    return 'none';
  },

  /**
   * Main enforcement entry point — call from route handlers. Writes a 202
   * (pending approval) or 401/403 response when the action must be blocked
   * or gated; returns { ok: true } when the handler can proceed.
   */
  async enforce(params: {
    req: Request;
    actionKey: string;
    deviceIds?: number[];
    approvalRequestType?: ApprovalRequestType;
    approvalDescription?: string;
    approvalPayload?: Record<string, unknown>;
  }): Promise<
    | { ok: true }
    | { ok: false; status: number; body: any }
    | { ok: false; approval: any; status: 202 }
  > {
    const { req, actionKey } = params;
    const tenantId = (req as any).tenantId as number;
    const userId = (req.session as any).userId as number;

    const level = await this.getLevelFor({ tenantId, actionKey, deviceIds: params.deviceIds });
    if (level === 'none') return { ok: true };

    if (level === 'sensitive') {
      const user = await db('users').where({ id: userId }).first('totp_enabled', 'totp_secret', 'username');
      if (!user) return { ok: false, status: 401, body: { error: 'Unauthenticated' } };
      // Only TOTP is trusted for sensitive actions — email OTP would race the
      // network and is not guaranteed delivered before the command executes.
      if (!user.totp_enabled || !user.totp_secret) {
        return {
          ok: false, status: 403,
          body: { error: 'This action is marked sensitive — enable TOTP 2FA on your profile before you can use it.' },
        };
      }
      const code = (req.body?.twoFactorCode || '').trim();
      if (!code) {
        return {
          ok: false, status: 401,
          body: { error: 'twoFactorCode required', twoFactorRequired: true, action: actionKey },
        };
      }
      const valid = twoFactorService.verifyTotp(user.totp_secret, code);
      if (!valid) {
        return { ok: false, status: 401, body: { error: 'Invalid 2FA code' } };
      }
      return { ok: true };
    }

    if (level === 'restricted') {
      if (!params.approvalRequestType) {
        return {
          ok: false, status: 403,
          body: { error: 'This action is restricted but no approval path is configured.' },
        };
      }
      const approval = await approvalService.create({
        tenantId,
        userId,
        requestType: params.approvalRequestType,
        description: params.approvalDescription ?? actionKey,
        payload: (params.approvalPayload ?? {}) as any,
      });
      return { ok: false, status: 202, approval };
    }

    return { ok: true };
  },
};

/**
 * Convenience wrapper — call this from a route handler. If it returns
 * `false` the response has already been written, so the handler must
 * return immediately.
 */
export async function applyRestriction(
  res: Response,
  args: Parameters<typeof restrictionService.enforce>[0],
): Promise<boolean> {
  const outcome = await restrictionService.enforce(args);
  if (outcome.ok) return true;
  if ((outcome as any).approval) {
    res.status(202).json({ data: { approvalId: (outcome as any).approval.id, status: 'pending_approval' } });
  } else {
    res.status((outcome as any).status).json((outcome as any).body);
  }
  return false;
}
