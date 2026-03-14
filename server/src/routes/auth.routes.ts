import { Router } from 'express';
import { authController } from '../controllers/auth.controller';
import { enrollmentController } from '../controllers/enrollment.controller';
import { passwordResetController } from '../controllers/passwordReset.controller';
import { requireAuth } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { authLimiter } from '../middleware/rateLimiter';
import { loginSchema } from '../validators/auth.schema';

const router = Router();

router.post('/login', authLimiter, validate(loginSchema), authController.login);
router.post('/logout', requireAuth, authController.logout);
router.get('/me', requireAuth, authController.me);
router.get('/permissions', requireAuth, authController.permissions);

// Enrollment (requires auth — user must be logged in)
router.post('/enrollment', requireAuth, enrollmentController.complete);

// Password reset (public)
router.post('/forgot-password', authLimiter, passwordResetController.forgot);
router.post('/reset-password/validate', passwordResetController.validate);
router.post('/reset-password', passwordResetController.reset);

export default router;
