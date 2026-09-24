import type { Request } from 'express';
import { db } from '../../db';
import { twoFactorService } from '../twoFactor.service';

// Fresh-TOTP step-up for the two bastion-sensitive profile actions:
//   - registering an SSH key (it grants a root-capable shell path), and
//   - the header "SSH" button (authorizing an IP for the bastion).
//
// Unlike a "sensitive" restriction, the trusted-IP shortcut is deliberately
// NOT honored: both actions must be backed by a code typed now. The 401
// `twoFactorRequired` shape is the one the client interceptor already
// handles (it prompts, then replays the request with `twoFactorCode`).

export type StepUpResult = { ok: true } | { ok: false; status: number; body: Record<string, unknown> };

export async function requireFreshTotp(req: Request, action: string): Promise<StepUpResult> {
  const userId = (req.session as any)?.userId as number | undefined;
  if (!userId) return { ok: false, status: 401, body: { error: 'Unauthenticated' } };

  const user = await db('users').where({ id: userId }).first('totp_enabled', 'totp_secret', 'foreign_source', 'foreign_id');
  const hasLocalTotp = !!(user?.totp_enabled && user?.totp_secret);
  const isObligateSso = user?.foreign_source === 'obligate' && !!user?.foreign_id;
  if (!hasLocalTotp && !isObligateSso) {
    return { ok: false, status: 403, body: { error: 'Enable TOTP 2FA on your profile before using SSH bastion features.' } };
  }

  const code = String(req.body?.twoFactorCode || '').trim();
  if (!code) {
    const { clientIp } = await import('../tfaTrust.service');
    return { ok: false, status: 401, body: { error: 'twoFactorCode required', twoFactorRequired: true, action, currentIp: clientIp(req) } };
  }

  let valid = false;
  if (hasLocalTotp) {
    valid = twoFactorService.verifyTotp(user.totp_secret, code);
  } else {
    const { obligateService } = await import('../obligate.service');
    valid = await obligateService.verifyTotp(user.foreign_id, code);
  }
  return valid ? { ok: true } : { ok: false, status: 401, body: { error: 'Invalid 2FA code' } };
}
