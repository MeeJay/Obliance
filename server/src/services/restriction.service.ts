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
  // File Explorer — listing is a low-risk read; upload/delete/rename are destructive.
  { key: 'command.list_directory',       label: 'Browse file explorer',     category: 'File Explorer' },
  { key: 'command.upload_file',          label: 'Upload a file to the device', category: 'File Explorer' },
  { key: 'command.download_file',        label: 'Download a file from the device', category: 'File Explorer' },
  { key: 'command.delete_file',          label: 'Delete a file on the device', category: 'File Explorer' },
  { key: 'command.rename_file',          label: 'Rename a file on the device', category: 'File Explorer' },
  { key: 'command.create_directory',     label: 'Create a directory on the device', category: 'File Explorer' },
  // Remote sessions (any protocol — SSH, CMD, PowerShell, ObliReach).
  { key: 'remote.session_start',         label: 'Start a remote session (SSH / CMD / PowerShell / ObliReach)', category: 'Remote' },
  // Services — start is low-risk, stop/restart impact the host.
  { key: 'command.start_service',        label: 'Start a service',          category: 'Services' },
  { key: 'command.stop_service',         label: 'Stop a service',           category: 'Services' },
  { key: 'command.restart_service',      label: 'Restart a service',        category: 'Services' },
  // Processes.
  { key: 'command.kill_process',         label: 'Kill a process',           category: 'Processes' },
  // Scripts — manual execution from the UI (schedules are un-gated).
  { key: 'script.execute_manual',        label: 'Manually execute a script', category: 'Scripts' },
  // Tenant config surfaces — editing these pages changes who can do what.
  // Defaults live in DEFAULT_RESTRICTIONS below; we don't auto-seed the
  // management ones so fresh installs without TOTP don't lock admins out.
  { key: 'tenant.manage_restrictions',   label: 'Edit the Restrictions matrix', category: 'Tenant config' },
  { key: 'tenant.manage_users',          label: 'Create / edit / delete users', category: 'Tenant config' },
  { key: 'tenant.manage_teams',          label: 'Create / edit / delete teams', category: 'Tenant config' },
  { key: 'tenant.manage_permissions',    label: 'Edit team permissions / members', category: 'Tenant config' },
  { key: 'tenant.manage_settings',       label: 'Edit tenant settings',       category: 'Tenant config' },
  { key: 'tenant.manage_profile',        label: 'Edit own profile (local users)', category: 'Tenant config' },
  { key: 'audit.clear',                  label: 'Clear the audit log',        category: 'Tenant config' },
];

/**
 * Recommended default levels for fresh tenants (and tenants that never
 * customised anything). Keys listed as 'none' are omitted from the stored
 * map so the UI shows them blank and the admin can opt in later.
 */
export const DEFAULT_RESTRICTIONS: Record<string, 'restricted' | 'sensitive'> = {
  'command.reboot':               'sensitive',
  'command.shutdown':             'sensitive',
  // sleep + restart_agent = none (not listed)
  'command.uninstall_agent':      'restricted',
  'command.enable_airgap':        'sensitive',
  'command.disable_airgap':       'restricted',
  // enable_privacy_mode = none
  'command.disable_privacy_mode': 'sensitive',
  'device.delete':                'sensitive',
  'device.bulk_group_change':     'sensitive',
  'device.transfer_tenant':       'sensitive',
  'software.remediate_install':   'sensitive',
  'software.remediate_uninstall': 'sensitive',
  // Manual script execution defaults to sensitive — scripts can do anything
  // on the target host, so a fresh TOTP confirm is a sane default.
  'script.execute_manual':        'sensitive',
  // File explorer is gated at the menu-entry point (list_directory) only,
  // so a user enters a code ONCE when opening the explorer and then browses
  // / downloads / uploads freely without re-prompting. Individual
  // destructive operations stay None by default — admins can opt in per
  // action from the matrix if they want a double-gate.
  'command.list_directory':       'sensitive',
  // Clearing the audit log deletes accountability — always require a
  // second admin to approve. Doesn't need TOTP.
  'audit.clear':                  'restricted',
  // Remote sessions / services / processes / tenant-config management
  // (users/teams/permissions/settings/profile/restrictions-config) are
  // intentionally NOT defaulted — admins opt in from the matrix once they
  // have TOTP deployed across privileged accounts, otherwise a fresh
  // install could softlock itself.
};

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
      const user = await db('users')
        .where({ id: userId })
        .first('totp_enabled', 'totp_secret', 'username', 'foreign_source', 'foreign_id');
      if (!user) return { ok: false, status: 401, body: { error: 'Unauthenticated' } };

      const hasLocalTotp = !!(user.totp_enabled && user.totp_secret);
      const isObligateSso = user.foreign_source === 'obligate' && user.foreign_id;

      // Must have either local TOTP or Obligate SSO (which proxies to the
      // Obligate-side TOTP). Email OTP isn't trusted for sensitive actions —
      // too slow + network-dependent.
      if (!hasLocalTotp && !isObligateSso) {
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

      let valid = false;
      if (hasLocalTotp) {
        valid = twoFactorService.verifyTotp(user.totp_secret, code);
      } else if (isObligateSso) {
        // Delegate to Obligate (lazy import to avoid a circular dep —
        // obligate.service imports appConfigService which pulls db indirectly).
        const { obligateService } = await import('./obligate.service');
        valid = await obligateService.verifyTotp(user.foreign_id, code);
      }
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
