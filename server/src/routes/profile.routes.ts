import { Router, type Request, type Response, type NextFunction } from 'express';
import { requireAuth } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { profileController } from '../controllers/profile.controller';
import { updateProfileSchema, changePasswordSchema } from '../validators/profile.schema';
import { db } from '../db';

const router = Router();

// All routes require authentication (any role)
router.use(requireAuth);

// Gate profile writes — skip the 2FA step for SSO users (their identity
// is managed by the SSO provider and can't be mutated locally anyway).
// Local users changing their own profile / password hit the tenant's
// `tenant.manage_profile` policy.
async function gateProfileWrite(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req.session as any).userId as number | undefined;
    if (!userId) return next();
    const row = await db('users').where({ id: userId }).first('foreign_source');
    if (row?.foreign_source === 'obligate') return next(); // SSO user → no local gate
    const { applyRestriction } = await import('../services/restriction.service');
    const approved = await applyRestriction(res, {
      req,
      actionKey: 'tenant.manage_profile',
      approvalRequestType: 'batch_command',
      approvalDescription: `Update own profile (${req.method} ${req.path})`,
      approvalPayload: { action: 'profile_update', userId, path: req.path },
    });
    if (!approved) return;
    next();
  } catch (err) { next(err); }
}

router.get('/', profileController.get);
router.put('/', validate(updateProfileSchema), gateProfileWrite, profileController.update);
router.put('/password', validate(changePasswordSchema), gateProfileWrite, profileController.changePassword);
router.put('/avatar', gateProfileWrite, profileController.uploadAvatar);
router.delete('/avatar', gateProfileWrite, profileController.deleteAvatar);

// ── Trusted-IP TOTP sessions ─────────────────────────────────────────────
// The user can see which IPs currently skip the sensitive-action TOTP
// prompt, and revoke them. Listing is unauthenticated beyond the session;
// revocation just deletes — no step-up required because it's restrictive.

router.get('/trusted-ips', async (req, res, next) => {
  try {
    const userId = (req.session as any).userId as number;
    const { tfaTrustService } = await import('../services/tfaTrust.service');
    const items = await tfaTrustService.listForUser(userId);
    res.json({ data: items });
  } catch (err) { next(err); }
});

router.delete('/trusted-ips', async (req, res, next) => {
  try {
    const userId = (req.session as any).userId as number;
    const { tfaTrustService } = await import('../services/tfaTrust.service');
    await tfaTrustService.revokeAllForUser(userId);
    res.status(204).send();
  } catch (err) { next(err); }
});

router.delete('/trusted-ips/:ip', async (req, res, next) => {
  try {
    const userId = (req.session as any).userId as number;
    const { tfaTrustService } = await import('../services/tfaTrust.service');
    await tfaTrustService.revokeForUserIp(userId, req.params.ip);
    res.status(204).send();
  } catch (err) { next(err); }
});

// ── SSH bastion public keys ──────────────────────────────────────────────
// A user's registered SSH public keys (identity at the bastion door). Local
// Obliance-owned, settable by SSO users too.

router.get('/ssh-keys', async (req, res, next) => {
  try {
    const userId = (req.session as any).userId as number;
    const { userKeysService } = await import('../services/sshBastion/userKeys.service');
    res.json({ data: await userKeysService.list(userId) });
  } catch (err) { next(err); }
});

// Registering a key grants a root-capable shell path through the bastion, so
// it requires a FRESH 2FA code (no trusted-IP shortcut) and is audited. A
// stolen web session alone must not be enough to plant a persistent key.
router.post('/ssh-keys', async (req, res, next) => {
  try {
    const userId = (req.session as any).userId as number;
    const { requireFreshTotp } = await import('../services/sshBastion/stepUp');
    const step = await requireFreshTotp(req, 'profile.ssh_key_add');
    if (!step.ok) return res.status(step.status).json(step.body);

    const { userKeysService } = await import('../services/sshBastion/userKeys.service');
    const key = await userKeysService.add(userId, req.body?.name, req.body?.publicKey);
    const { bastionAudit } = await import('../services/sshBastion/bastionUtil');
    const { clientIp } = await import('../services/tfaTrust.service');
    bastionAudit('key_added', { tenantId: (req as any).tenantId, userId, ip: clientIp(req), details: { keyId: key.id, fingerprint: key.fingerprint, name: key.name } });
    res.status(201).json({ data: key });
  } catch (err: any) {
    if (/Invalid|Unsupported|mismatch|already registered/i.test(err?.message || '')) {
      const { AppError } = await import('../middleware/errorHandler');
      return next(new AppError(400, err.message));
    }
    next(err);
  }
});

// Removal is restrictive (it can only reduce access) -> no step-up, audited.
router.delete('/ssh-keys/:id', async (req, res, next) => {
  try {
    const userId = (req.session as any).userId as number;
    const id = parseInt(req.params.id, 10);
    const { userKeysService } = await import('../services/sshBastion/userKeys.service');
    const ok = await userKeysService.remove(userId, id);
    if (ok) {
      const { bastionAudit } = await import('../services/sshBastion/bastionUtil');
      const { clientIp } = await import('../services/tfaTrust.service');
      bastionAudit('key_removed', { tenantId: (req as any).tenantId, userId, ip: clientIp(req), details: { keyId: id } });
    }
    res.status(ok ? 204 : 404).send();
  } catch (err) { next(err); }
});

// Header "SSH" button: after a fresh 2FA code, authorize the caller's current
// IP to reach the bastion for 24h. Stored in ssh_bastion_ip_grants (NOT in
// tfa_trusted_sessions) so it never silences 2FA for sensitive web actions.
router.post('/ssh-authorize-ip', async (req, res, next) => {
  try {
    const userId = (req.session as any).userId as number;
    const { requireFreshTotp } = await import('../services/sshBastion/stepUp');
    const step = await requireFreshTotp(req, 'profile.ssh_authorize_ip');
    if (!step.ok) return res.status(step.status).json(step.body);

    const { clientIp } = await import('../services/tfaTrust.service');
    const ip = clientIp(req);
    if (!ip) {
      const { AppError } = await import('../middleware/errorHandler');
      return next(new AppError(400, 'Could not determine your IP address'));
    }
    const { bastionGate } = await import('../services/sshBastion/bastionGate.service');
    const expiresAt = await bastionGate.grantIp(userId, ip);
    const { bastionAudit } = await import('../services/sshBastion/bastionUtil');
    bastionAudit('ip_authorized', { tenantId: (req as any).tenantId, userId, ip, details: { expiresAt } });
    res.json({ data: { ip, expiresAt } });
  } catch (err) { next(err); }
});

export default router;
