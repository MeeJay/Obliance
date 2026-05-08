import type { Request, Response, NextFunction } from 'express';
import { db } from '../db';
import { twoFactorService } from '../services/twoFactor.service';
import { appConfigService } from '../services/appConfig.service';
import { authService } from '../services/auth.service';
import { tenantService } from '../services/tenant.service';
import { AppError } from '../middleware/errorHandler';

// Extend session type for 2FA state
declare module 'express-session' {
  interface SessionData {
    pendingMfaUserId?: number;
    pendingTotpSecret?: string;
    pendingTotpExpiresAt?: number;
    pendingEmailOtp?: { codeHash: string; email: string; expires: number };
    pendingEmailOtpSetup?: { codeHash: string; email: string; expires: number };
  }
}

export const twoFactorController = {
  // ── Profile endpoints (authenticated) ─────────────────────────────────────

  async status(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = await authService.getUserById(req.session.userId!);
      if (!user) throw new AppError(401, 'User not found');
      res.json({ success: true, data: {
        totpEnabled: user.totpEnabled ?? false,
        emailOtpEnabled: user.emailOtpEnabled ?? false,
        email: user.email ?? null,
      }});
    } catch (err) { next(err); }
  },

  // TOTP setup step 1: generate secret + QR (stored in session)
  async totpSetup(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = await authService.getUserById(req.session.userId!);
      if (!user) throw new AppError(401, 'User not found');
      const { secret, uri } = twoFactorService.generateTotpSecret(user.username);
      const qrDataUrl = await twoFactorService.generateTotpQr(uri);
      // Bound the pending secret with a TTL — stale enrolment flows
      // shouldn't leave a usable TOTP secret sitting in the session
      // store indefinitely (session hijack mitigation). 10 min is the
      // same window we use for email OTP — long enough for a real
      // user to scan + paste, short enough to invalidate forgotten
      // browser tabs.
      req.session.pendingTotpSecret = secret;
      req.session.pendingTotpExpiresAt = Date.now() + 10 * 60 * 1000;
      res.json({ success: true, data: { secret, qrDataUrl } });
    } catch (err) { next(err); }
  },

  // TOTP setup step 2: verify code, save secret and enable
  async totpEnable(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { code } = req.body;
      const secret = req.session.pendingTotpSecret;
      const expiresAt = req.session.pendingTotpExpiresAt ?? 0;
      if (!secret) throw new AppError(400, 'No pending TOTP setup. Call /setup first.');
      if (Date.now() > expiresAt) {
        delete req.session.pendingTotpSecret;
        delete req.session.pendingTotpExpiresAt;
        throw new AppError(400, 'TOTP setup expired. Call /setup again.');
      }
      if (!twoFactorService.verifyTotp(secret, String(code))) {
        throw new AppError(400, 'Invalid code');
      }
      await db('users').where({ id: req.session.userId }).update({
        totp_secret: secret,
        totp_enabled: true,
      });
      delete req.session.pendingTotpSecret;
      delete req.session.pendingTotpExpiresAt;
      res.json({ success: true });
    } catch (err) { next(err); }
  },

  async totpDisable(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      await db('users').where({ id: req.session.userId }).update({
        totp_secret: null,
        totp_enabled: false,
      });
      // When TOTP is disabled, any "trusted IP" entries the user accumulated
      // are now worthless — revoke them so the next sensitive action will
      // prompt again (and tell the user TOTP is gone).
      try {
        const { tfaTrustService } = await import('../services/tfaTrust.service');
        await tfaTrustService.revokeAllForUser(req.session.userId!);
      } catch {}
      res.json({ success: true });
    } catch (err) { next(err); }
  },

  // Email OTP setup step 1: send OTP to given email
  async emailSetup(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { email } = req.body;
      if (!email) throw new AppError(400, 'Missing email');
      const cfg = await appConfigService.getAll();
      if (!cfg.otp_smtp_server_id) throw new AppError(400, 'No SMTP server configured for OTP. Ask your administrator.');
      const code = twoFactorService.generateEmailOtp();
      // SECURITY: store ONLY a SHA-256 hash of the OTP in session; the
      // raw code travels via email and never sits in the session
      // store. A leaked session dump can't pre-empt the user typing it
      // in. `crypto.timingSafeEqual` on the hashes at verify time.
      const { createHash } = await import('crypto');
      const codeHash = createHash('sha256').update(String(code)).digest('hex');
      req.session.pendingEmailOtpSetup = { codeHash, email, expires: Date.now() + 10 * 60 * 1000 };
      await twoFactorService.sendEmailOtp(Number(cfg.otp_smtp_server_id), email, code);
      res.json({ success: true, message: `Code sent to ${email}` });
    } catch (err) { next(err); }
  },

  // Email OTP setup step 2: verify code, save email and enable
  async emailEnable(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { code } = req.body;
      const pending = req.session.pendingEmailOtpSetup;
      if (!pending) throw new AppError(400, 'No pending email OTP setup. Call /setup first.');
      if (Date.now() > pending.expires) throw new AppError(400, 'Code expired');
      const { createHash, timingSafeEqual } = await import('crypto');
      const submittedHash = createHash('sha256').update(String(code)).digest('hex');
      const a = Buffer.from(submittedHash, 'hex');
      const b = Buffer.from(pending.codeHash, 'hex');
      if (a.length !== b.length || !timingSafeEqual(a, b)) {
        throw new AppError(400, 'Invalid code');
      }
      await db('users').where({ id: req.session.userId }).update({
        email: pending.email,
        email_otp_enabled: true,
      });
      delete req.session.pendingEmailOtpSetup;
      res.json({ success: true });
    } catch (err) { next(err); }
  },

  async emailDisable(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      await db('users').where({ id: req.session.userId }).update({ email_otp_enabled: false });
      res.json({ success: true });
    } catch (err) { next(err); }
  },

  // ── Auth endpoints (after step-1 login, session has pendingMfaUserId) ─────

  async verify(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { code, method } = req.body;
      const userId = req.session.pendingMfaUserId;
      if (!userId) throw new AppError(400, 'No pending 2FA session');

      const row = await db('users')
        .where({ id: userId })
        .first('id', 'username', 'role', 'totp_secret', 'totp_enabled', 'email_otp_enabled', 'email');

      if (!row) throw new AppError(400, 'User not found');

      let valid = false;

      if (method === 'totp' && row.totp_enabled && row.totp_secret) {
        valid = twoFactorService.verifyTotp(row.totp_secret, String(code));
      } else if (method === 'email' && row.email_otp_enabled) {
        const pending = req.session.pendingEmailOtp;
        if (pending && Date.now() <= pending.expires) {
          const { createHash, timingSafeEqual } = await import('crypto');
          const submittedHash = createHash('sha256').update(String(code)).digest('hex');
          const a = Buffer.from(submittedHash, 'hex');
          const b = Buffer.from(pending.codeHash, 'hex');
          if (a.length === b.length && timingSafeEqual(a, b)) valid = true;
        }
      }

      if (!valid) throw new AppError(401, 'Invalid code');

      // Complete the session
      req.session.userId = row.id;
      req.session.username = row.username;
      req.session.role = row.role;
      delete req.session.pendingMfaUserId;
      delete req.session.pendingEmailOtp;

      // Set tenant in session
      const firstTenant = await tenantService.getFirstTenantForUser(row.id);
      req.session.currentTenantId = firstTenant?.id ?? 1;

      const user = await authService.getUserById(row.id);
      res.json({ success: true, data: { user } });
    } catch (err) { next(err); }
  },

  async resendEmail(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.session.pendingMfaUserId;
      if (!userId) throw new AppError(400, 'No pending 2FA session');

      const row = await db('users').where({ id: userId }).first('email', 'email_otp_enabled');
      if (!row || !row.email_otp_enabled || !row.email) {
        throw new AppError(400, 'Email OTP not configured for this user');
      }

      const cfg = await appConfigService.getAll();
      if (!cfg.otp_smtp_server_id) throw new AppError(400, 'No SMTP server configured for OTP');

      const code = twoFactorService.generateEmailOtp();
      const { createHash } = await import('crypto');
      const codeHash = createHash('sha256').update(String(code)).digest('hex');
      req.session.pendingEmailOtp = { codeHash, email: row.email, expires: Date.now() + 10 * 60 * 1000 };
      await twoFactorService.sendEmailOtp(Number(cfg.otp_smtp_server_id), row.email, code);
      res.json({ success: true, message: `Code sent to ${row.email}` });
    } catch (err) { next(err); }
  },
};
