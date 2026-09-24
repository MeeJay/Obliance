import { db } from '../../db';
import { permissionService } from '../permission.service';
import { restrictionService } from '../restriction.service';
import { privacyGateService } from '../privacyGate.service';
import { bastionGate } from './bastionGate.service';
import type { BastionUser } from './maisonShell';

// Authorization for a jump — mirrors EXACTLY the gates of the web path
// (POST /api/remote/sessions): write access, the `remote` team capability,
// the legacy-agent refusal, and the `remote.session_start` action
// restriction. Without this, the bastion would be a way around an approval
// or 2FA requirement that a tenant configured for remote sessions.

export type JumpDecision = { ok: true; tenantId: number } | { ok: false; reason: string };

export async function authorizeJump(u: BastionUser, deviceId: number): Promise<JumpDecision> {
  const dev = await db('devices')
    .where({ id: deviceId })
    .first('id', 'tenant_id', 'approval_status', 'agent_flavor', 'privacy_mode_enabled');
  if (!dev) return { ok: false, reason: 'Machine not found.' };
  if (dev.approval_status !== 'approved') return { ok: false, reason: 'This machine is not approved.' };

  const perm = await permissionService.getDevicePermission(u.userId, dev.id, u.isAdmin);
  if (perm !== 'rw') return { ok: false, reason: 'Access denied: you do not have write access to this machine.' };

  if (!u.isAdmin && !(await permissionService.canUseCapability(u.userId, dev.id, false, 'remote'))) {
    return { ok: false, reason: 'Remote access is not permitted for your team.' };
  }

  if (dev.agent_flavor === 'legacy') {
    return { ok: false, reason: 'Remote shells are not supported by the legacy agent. Upgrade the agent first.' };
  }

  // Privacy mode: the agent refuses tunnels unless the user holds an unlock.
  // Refuse up front instead of hanging until the connect timeout.
  if (dev.privacy_mode_enabled && !privacyGateService.get(u.userId, dev.id, 'remote')) {
    return { ok: false, reason: 'This machine is in privacy mode. Unlock it from the Obliance web UI first.' };
  }

  const level = await restrictionService.getLevelFor({
    tenantId: dev.tenant_id, actionKey: 'remote.session_start', deviceIds: [dev.id],
  });

  if (level === 'restricted') {
    // Approval workflows need the web UI (request, wait, approver decision).
    return { ok: false, reason: 'Remote sessions on this machine require an approval. Start it from the Obliance web UI.' };
  }

  if (level === 'sensitive') {
    // Same rule as the web path: TOTP must be enrolled, and a 2FA proof must
    // exist for this origin — here the SSH-button grant only (never web trust).
    const user = await db('users').where({ id: u.userId }).first('totp_enabled', 'totp_secret', 'foreign_source', 'foreign_id');
    const has2fa = !!(user && ((user.totp_enabled && user.totp_secret) || (user.foreign_source === 'obligate' && user.foreign_id)));
    if (!has2fa) return { ok: false, reason: 'Remote sessions on this machine require 2FA. Enable TOTP on your Obliance profile.' };
    if (!(await bastionGate.hasFreshSecondFactor(u.userId, u.sourceIp))) {
      return { ok: false, reason: 'Remote sessions on this machine require 2FA. Authorize this IP with the "SSH" button in Obliance, then retry.' };
    }
  }

  return { ok: true, tenantId: dev.tenant_id };
}
