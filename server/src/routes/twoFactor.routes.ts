import { Router } from 'express';
import { twoFactorController } from '../controllers/twoFactor.controller';
import { requireAuth } from '../middleware/auth';
import { mfaLimiter } from '../middleware/rateLimiter';

const router = Router();

// Profile 2FA routes (requires auth)
router.get('/status', requireAuth, twoFactorController.status);
router.post('/totp/setup', requireAuth, twoFactorController.totpSetup);
router.post('/totp/enable', requireAuth, twoFactorController.totpEnable);
router.delete('/totp', requireAuth, twoFactorController.totpDisable);
router.post('/email/setup', requireAuth, twoFactorController.emailSetup);
router.post('/email/enable', requireAuth, twoFactorController.emailEnable);
router.delete('/email', requireAuth, twoFactorController.emailDisable);

// Auth 2FA routes (rate-limited, no requireAuth — session has pendingMfaUserId)
router.post('/verify', mfaLimiter, twoFactorController.verify);
router.post('/resend-email', mfaLimiter, twoFactorController.resendEmail);

export default router;
