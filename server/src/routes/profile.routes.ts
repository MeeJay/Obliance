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

export default router;
