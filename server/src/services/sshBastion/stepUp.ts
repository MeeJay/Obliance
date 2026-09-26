import type { Request } from 'express';
import { checkSecondFactor } from '../deviceKey/stepUpProof';

// Fresh-TOTP step-up for the two bastion-sensitive profile actions:
//   - registering an SSH key (it grants a root-capable shell path), and
//   - the header "SSH" button (authorizing an IP for the bastion).
//
// Unlike a "sensitive" restriction, the trusted-IP shortcut is deliberately
// NOT honored: both actions must be backed by a code typed now. The 401
// `twoFactorRequired` shape is the one the client interceptor already
// handles (it prompts, then replays the request with `twoFactorCode`).
//
// Verification itself is checkSecondFactor (services/deviceKey/stepUpProof.ts):
// same anti-replay ('stepup' mode) and failure caps as the envelope.
// allowDevice: a device key may add an SSH key, never authorize an IP (an
// operator CGNAT address) [D6] — the flag is ignored until the device-key lot.

export type StepUpResult =
  | { ok: true }
  | { ok: false; status: number; body: Record<string, unknown>; headers?: Record<string, string> };

export async function requireFreshTotp(req: Request, action: string): Promise<StepUpResult> {
  const outcome = await checkSecondFactor(req, {
    actionKey: action,
    allowTrustedIp: false,
    allowDevice: action === 'profile.ssh_key_add',
    noFactorError: 'Enable TOTP 2FA on your profile before using SSH bastion features.',
  });
  if (outcome.ok) return { ok: true };
  return { ok: false, status: outcome.status, body: outcome.body, headers: outcome.headers };
}
