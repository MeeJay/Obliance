import type { Request, Response, NextFunction } from 'express';
import { authService } from '../services/auth.service';
import { appConfigService } from '../services/appConfig.service';
import { twoFactorService } from '../services/twoFactor.service';
import { permissionService } from '../services/permission.service';
import { tenantService } from '../services/tenant.service';
import { AppError } from '../middleware/errorHandler';
import { config } from '../config';
import { obligateService } from '../services/obligate.service';
import { db } from '../db';
import type { LoginInput } from '../validators/auth.schema';

/** Helper: resolve & store the first accessible tenant in the session. */
async function setSessionTenant(req: Request, userId: number): Promise<void> {
  const tenant = await tenantService.getFirstTenantForUser(userId);
  req.session.currentTenantId = tenant?.id ?? 1;
}

export const authController = {
  async login(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { username, password } = req.body as LoginInput;
      const user = await authService.authenticate(username, password);

      if (!user) {
        throw new AppError(401, 'Invalid username or password');
      }

      const hasMfa = user.totpEnabled || user.emailOtpEnabled;

      if (hasMfa) {
        // Step 1: store pending MFA, don't create real session yet
        req.session.pendingMfaUserId = user.id;

        // If email OTP is enabled, auto-send a code
        if (user.emailOtpEnabled && user.email) {
          const cfg = await appConfigService.getAll();
          if (cfg.otp_smtp_server_id) {
            const code = twoFactorService.generateEmailOtp();
            req.session.pendingEmailOtp = { code, email: user.email, expires: Date.now() + 10 * 60 * 1000 };
            await twoFactorService.sendEmailOtp(Number(cfg.otp_smtp_server_id), user.email, code);
          }
        }

        res.json({
          success: true,
          data: {
            requires2fa: true,
            methods: { totp: user.totpEnabled ?? false, email: user.emailOtpEnabled ?? false },
          },
        });
        return;
      }

      // No 2FA — complete session immediately
      req.session.userId = user.id;
      req.session.username = user.username;
      req.session.role = user.role;
      await setSessionTenant(req, user.id);

      res.json({ success: true, data: { user } });
    } catch (err) {
      next(err);
    }
  },

  async logout(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      req.session.destroy((err) => {
        if (err) {
          next(new AppError(500, 'Failed to logout'));
          return;
        }
        res.clearCookie('connect.sid');
        res.json({ success: true, message: 'Logged out' });
      });
    } catch (err) {
      next(err);
    }
  },

  async me(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.session.userId!;

      // Sync preferences from Obligate for SSO users (throttled, non-blocking)
      const fRow = await db('users').where({ id: userId }).select('foreign_source', 'foreign_id').first() as
        { foreign_source: string | null; foreign_id: number | null } | undefined;
      if (fRow?.foreign_source === 'obligate' && fRow.foreign_id) {
        await obligateService.syncUserPreferences(userId, fRow.foreign_id).catch(() => {});
      }

      const user = await authService.getUserById(userId);
      if (!user) {
        throw new AppError(401, 'User not found');
      }

      // Repair missing currentTenantId (e.g. sessions from before Phase 13)
      if (!req.session.currentTenantId) {
        await setSessionTenant(req, user.id);
      }

      const isAdmin = user.role === 'admin';
      const permissions = await permissionService.getUserPermissions(user.id, isAdmin);

      // Check if force 2FA applies to this user
      let requires2faSetup = false;
      if (!config.disable2faForce) {
        const cfg = await appConfigService.getAll();
        if (cfg.force_2fa && !user.totpEnabled && !user.emailOtpEnabled) {
          requires2faSetup = true;
        }
      }

      res.json({
        success: true,
        data: { user, permissions, requires2faSetup, currentTenantId: req.session.currentTenantId },
      });
    } catch (err) {
      next(err);
    }
  },

  async permissions(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const isAdmin = req.session.role === 'admin';
      const permissions = await permissionService.getUserPermissions(req.session.userId!, isAdmin);
      res.json({ success: true, data: permissions });
    } catch (err) {
      next(err);
    }
  },
};
