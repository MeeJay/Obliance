import { Router } from 'express';
import { twoFactorController } from '../controllers/twoFactor.controller';
import { requireAuth } from '../middleware/auth';
import { attachSessionTenant } from '../middleware/tenant';
import { mfaLimiter, mfaAccountLimiter } from '../middleware/rateLimiter';

const router = Router();

// Not under the tenant router: expose the session tenant as req.tenantId for
// the signed-in routes (audit, "Trust this IP" duration — P4). No-op for the
// pending sign-in routes below (no userId yet).
router.use(attachSessionTenant);

// Profile 2FA routes (requires auth)
router.get('/status', requireAuth, twoFactorController.status);
router.post('/totp/setup', requireAuth, twoFactorController.totpSetup);
router.post('/totp/enable', requireAuth, twoFactorController.totpEnable);
router.delete('/totp', requireAuth, twoFactorController.totpDisable);
router.post('/email/setup', requireAuth, twoFactorController.emailSetup);
router.post('/email/enable', requireAuth, twoFactorController.emailEnable);
router.delete('/email', requireAuth, twoFactorController.emailDisable);

// Auth 2FA routes (rate-limited, no requireAuth — session has pendingMfaUserId)
router.post('/verify', mfaLimiter, mfaAccountLimiter, twoFactorController.verify);
router.post('/resend-email', mfaLimiter, twoFactorController.resendEmail);

export default router;
