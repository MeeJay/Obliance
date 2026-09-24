import { MASTER_TENANT_ID } from '@obliance/shared';
import { auditService } from '../audit.service';

// Strip every terminal control sequence from a value before it is written to
// the user's terminal. Hostnames are reported by agents and tenant / folder
// names are user-editable — an embedded ESC sequence could otherwise rewrite
// the admin's screen or abuse terminal-emulator features. CSI sequences go
// first, then every remaining C0/C1 control char (including a bare ESC), so
// nothing left can be interpreted by the terminal.
export function clean(value: unknown, max = 128): string {
  return String(value ?? '')
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/[\x00-\x1f\x7f-\x9f]/g, '')
    .slice(0, max);
}

// Bastion audit trail. Platform-level events (login, refusal, ban) have no
// device tenant, so they land on the master tenant; device events use the
// device's tenant. auditService.log never throws.
export function bastionAudit(
  action: string,
  e: { tenantId?: number; userId?: number; deviceId?: number; ip?: string; details?: Record<string, unknown> } = {},
): void {
  void auditService.log({
    tenantId: e.tenantId ?? MASTER_TENANT_ID,
    userId: e.userId,
    deviceId: e.deviceId,
    action: `ssh_bastion.${action}`,
    resourceType: 'ssh_bastion',
    ipAddress: e.ip,
    details: e.details,
  });
}
