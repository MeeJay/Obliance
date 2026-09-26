import { regenerateSession } from '../utils/session';
import type { Request, Response, NextFunction } from 'express';
import { db } from '../db';
import { twoFactorService } from '../services/twoFactor.service';
import { appConfigService } from '../services/appConfig.service';
import { authService } from '../services/auth.service';
import { tenantService } from '../services/tenant.service';
import { AppError } from '../middleware/errorHandler';
import {
  checkSecondFactor, checkPasswordStepUp, sendStepUpFailure, acceptTotpStep, rebindTotpStepSession,
  clearCodeThrottle, hashSessionId, reportTotpDrift, type StepUpOpts, type StepUpOutcome,
} from '../services/deviceKey/stepUpProof';

// Extend session type for 2FA state
declare module 'express-session' {
  interface SessionData {
    pendingMfaUserId?: number;
    pendingTotpSecret?: string;
    pendingTotpExpiresAt?: number;
    /** The pending setup replaces a live TOTP (its step-up was passed). */
    pendingTotpReplaces?: boolean;
    pendingEmailOtp?: { codeHash: string; email: string; expires: number };
    pendingEmailOtpSetup?: { codeHash: string; email: string; expires: number };
  }
}

// P2: managing the TOTP of an account that already has a second factor
// needs a CURRENT code of that factor — a strict step (never seen before, not
// even the sign-in code), no trusted-IP shortcut, never a device key.
const TOTP_MANAGE: StepUpOpts = {
  actionKey: 'profile.totp_manage',
  allowTrustedIp: false,
  allowDevice: false,
  requireNewStep: true,
  noFactorError: 'No second factor to verify.',
};

/**
 * Proof for adding, replacing or removing a second factor (TOTP, e-mail
 * codes). With a code to give (local TOTP, or the Obligate account of an SSO
 * user): a CURRENT code (TOTP_MANAGE). Without (first enrolment, e-mail codes
 * only): the CURRENT PASSWORD (stepUpPassword) -- a stolen session cookie
 * alone can neither plant a factor the attacker controls nor remove the
 * user's. Wrong codes and passwords count in the same caps (section 6.8).
 */
async function checkFactorManagement(req: Request, actionKey: string): Promise<StepUpOutcome> {
  const row = await db('users').where({ id: req.session.userId! })
    .first('totp_enabled', 'totp_secret', 'foreign_source', 'foreign_id') as {
      totp_enabled: boolean; totp_secret: string | null; foreign_source: string | null; foreign_id: number | null;
    } | undefined;
  const hasLocalTotp = !!(row?.totp_enabled && row?.totp_secret);
  const isObligateSso = row?.foreign_source === 'obligate' && !!row?.foreign_id;
  if (hasLocalTotp || isObligateSso) return checkSecondFactor(req, { ...TOTP_MANAGE, actionKey });
  return checkPasswordStepUp(req, { actionKey });
}

/** [D13]-style notice to the account's address when a second factor is
 *  added or removed (best effort, only if the OTP SMTP server is set). */
function notifyFactorChange(userId: number, subject: string, lines: string[]): void {
  void (async () => {
    try {
      const row = await db('users').where({ id: userId }).first('email') as { email: string | null } | undefined;
      if (!row?.email) return;
      const cfg = await appConfigService.getAll();
      if (!cfg.otp_smtp_server_id) return;
      await twoFactorService.sendSecurityNotice(Number(cfg.otp_smtp_server_id), row.email, subject, lines);
    } catch { /* a notice never breaks the change */ }
  })();
}

const NOT_YOU = 'If this was not you, change your password now and ask an administrator to reset your two-factor authentication.';

async function auditSelf(req: Request, action: string, details?: Record<string, unknown>): Promise<void> {
  try {
    const userId = req.session.userId!;
    const tenantId = (req as any).tenantId ?? req.session.currentTenantId ?? 1;
    const { auditService } = await import('../services/audit.service');
    const { clientIp } = await import('../utils/clientIp');
    await auditService.log({
      tenantId, userId, action, resourceType: 'user', resourcePath: String(userId),
      details, ipAddress: clientIp(req) || undefined,
    });
  } catch { /* never breaks the request */ }
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
      const row = await db('users')
        .where({ id: req.session.userId! })
        .first('username', 'totp_enabled', 'totp_secret', 'foreign_source', 'foreign_id') as {
          username: string; totp_enabled: boolean; totp_secret: string | null;
          foreign_source: string | null; foreign_id: number | null;
        } | undefined;
      if (!row) throw new AppError(401, 'User not found');
      const hasLocalTotp = !!(row.totp_enabled && row.totp_secret);
      // P2: replacing a live TOTP (or adding a local one on top of the
      // Obligate factor) needs a current code of the existing factor; a
      // first enrolment needs the current password.
      const step = await checkFactorManagement(req, 'profile.totp_manage');
      if (!step.ok) { sendStepUpFailure(res, step); return; }
      const { secret, uri } = twoFactorService.generateTotpSecret(row.username);
      const qrDataUrl = await twoFactorService.generateTotpQr(uri);
      // Bound the pending secret with a TTL — stale enrolment flows
      // shouldn't leave a usable TOTP secret sitting in the session
      // store indefinitely (session hijack mitigation). 10 min is the
      // same window we use for email OTP — long enough for a real
      // user to scan + paste, short enough to invalidate forgotten
      // browser tabs.
      req.session.pendingTotpSecret = secret;
      req.session.pendingTotpExpiresAt = Date.now() + 10 * 60 * 1000;
      req.session.pendingTotpReplaces = hasLocalTotp;
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
        delete req.session.pendingTotpReplaces;
        throw new AppError(400, 'TOTP setup expired. Call /setup again.');
      }
      const step = twoFactorService.verifyTotpStep(secret, String(code ?? ''));
      if (step === null) {
        throw new AppError(400, 'Invalid code');
      }
      // A setup started while no TOTP was live proved the password, not a
      // code: it must not overwrite a TOTP enabled in the meantime (e.g.
      // from another session) -- that would replace a live factor without
      // its code. The condition is IN the update (two enables racing on a
      // pool: one wins, the other gets 409).
      // Records the step of the new secret (P3): the enabling code can never
      // serve a strict use later (enrolment, TOTP management).
      const sh = hashSessionId(req.sessionID);
      const upd = db('users').where({ id: req.session.userId });
      if (!req.session.pendingTotpReplaces) {
        upd.where((q) => q.where('totp_enabled', false).orWhereNull('totp_enabled').orWhereNull('totp_secret'));
      }
      const updated = await upd.update({
        totp_secret: secret,
        totp_enabled: true,
        totp_last_session: db.raw('CASE WHEN totp_last_step IS NULL OR totp_last_step < ? THEN ? ELSE totp_last_session END', [step, sh]),
        totp_last_step: db.raw('GREATEST(COALESCE(totp_last_step, ?), ?)', [step, step]),
      });
      if (!updated) {
        delete req.session.pendingTotpSecret;
        delete req.session.pendingTotpExpiresAt;
        delete req.session.pendingTotpReplaces;
        throw new AppError(409, 'Two-factor authentication was enabled in the meantime. Start the setup again.');
      }
      const replaced = !!req.session.pendingTotpReplaces;
      delete req.session.pendingTotpSecret;
      delete req.session.pendingTotpExpiresAt;
      delete req.session.pendingTotpReplaces;
      await auditSelf(req, replaced ? 'user.totp_replaced' : 'user.totp_enabled');
      notifyFactorChange(req.session.userId!, replaced ? 'Authenticator app replaced' : 'Authenticator app added', [
        replaced
          ? 'The authenticator app (TOTP) used for two-factor authentication on your account was replaced.'
          : 'An authenticator app (TOTP) was added for two-factor authentication on your account.',
        NOT_YOU,
      ]);
      res.json({ success: true });
    } catch (err) { next(err); }
  },

  async totpDisable(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const row = await db('users').where({ id: req.session.userId }).first('totp_enabled', 'totp_secret');
      // P2: removing a live TOTP needs a current code of it.
      const hadTotp = !!(row?.totp_enabled && row?.totp_secret);
      if (hadTotp) {
        const step = await checkFactorManagement(req, 'profile.totp_manage');
        if (!step.ok) { sendStepUpFailure(res, step); return; }
      }
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
      if (hadTotp) {
        await auditSelf(req, 'user.totp_disabled');
        notifyFactorChange(req.session.userId!, 'Authenticator app removed', [
          'The authenticator app (TOTP) was removed from your account: two-factor authentication by authenticator app is off.',
          NOT_YOU,
        ]);
      }
      res.json({ success: true });
    } catch (err) { next(err); }
  },

  // Email OTP setup step 1: send a code to the account's PROFILE address.
  //
  // The address is the one of the profile (PUT /api/profile, under the
  // tenant.manage_profile envelope): this route never changes users.email,
  // so it can neither bypass that envelope nor move the password-reset
  // channel. Enabling e-mail codes adds a sign-in factor: the proof of
  // checkFactorManagement (current code, or current password) is required
  // before any code is sent.
  async emailSetup(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const row = await db('users').where({ id: req.session.userId! }).first('email') as { email: string | null } | undefined;
      const profileEmail = String(row?.email ?? '').trim();
      if (!profileEmail) throw new AppError(400, 'Set an e-mail address in your profile first.');
      const asked = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
      if (asked && asked.toLowerCase() !== profileEmail.toLowerCase()) {
        throw new AppError(400, 'Codes are sent to the e-mail address of your profile. Change it in your profile first.');
      }
      const cfg = await appConfigService.getAll();
      if (!cfg.otp_smtp_server_id) throw new AppError(400, 'No SMTP server configured for OTP. Ask your administrator.');
      const step = await checkFactorManagement(req, 'profile.email_otp_manage');
      if (!step.ok) { sendStepUpFailure(res, step); return; }
      const code = twoFactorService.generateEmailOtp();
      // SECURITY: store ONLY a SHA-256 hash of the OTP in session; the
      // raw code travels via email and never sits in the session
      // store. A leaked session dump can't pre-empt the user typing it
      // in. `crypto.timingSafeEqual` on the hashes at verify time.
      const { createHash } = await import('crypto');
      const codeHash = createHash('sha256').update(String(code)).digest('hex');
      req.session.pendingEmailOtpSetup = { codeHash, email: profileEmail, expires: Date.now() + 10 * 60 * 1000 };
      await twoFactorService.sendEmailOtp(Number(cfg.otp_smtp_server_id), profileEmail, code);
      res.json({ success: true, message: `Code sent to ${profileEmail}` });
    } catch (err) { next(err); }
  },

  // Email OTP setup step 2: verify the mailed code and enable e-mail codes
  // (on the profile address, which is NOT written here).
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
      // Only if the profile address is still the one the code went to.
      const updated = await db('users')
        .where({ id: req.session.userId })
        .whereRaw('lower(trim(email)) = ?', [pending.email.toLowerCase()])
        .update({ email_otp_enabled: true });
      delete req.session.pendingEmailOtpSetup;
      if (!updated) throw new AppError(409, 'Your e-mail address changed during the setup. Start again.');
      await auditSelf(req, 'user.email_otp_enabled');
      notifyFactorChange(req.session.userId!, 'E-mail codes enabled', [
        'Sign-in codes by e-mail were enabled on your account, sent to this address.',
        NOT_YOU,
      ]);
      res.json({ success: true });
    } catch (err) { next(err); }
  },

  async emailDisable(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const row = await db('users').where({ id: req.session.userId }).first('email_otp_enabled') as { email_otp_enabled: boolean } | undefined;
      // Removing a sign-in factor needs the same proof as adding one.
      if (row?.email_otp_enabled) {
        const step = await checkFactorManagement(req, 'profile.email_otp_manage');
        if (!step.ok) { sendStepUpFailure(res, step); return; }
      }
      await db('users').where({ id: req.session.userId }).update({ email_otp_enabled: false });
      if (row?.email_otp_enabled) {
        await auditSelf(req, 'user.email_otp_disabled');
        notifyFactorChange(req.session.userId!, 'E-mail codes disabled', [
          'Sign-in codes by e-mail were disabled on your account.',
          NOT_YOU,
        ]);
      }
      res.json({ success: true });
    } catch (err) { next(err); }
  },

  // ── Auth endpoints (after step-1 login, session has pendingMfaUserId) ─────

  async verify(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { code, method } = req.body;
      const userId = req.session.pendingMfaUserId;
      if (!userId) throw new AppError(400, 'No pending 2FA session');

      // is_active: a deactivation between the password and the code step
      // must not complete the sign-in.
      const row = await db('users')
        .where({ id: userId, is_active: true })
        .first('id', 'username', 'role', 'totp_secret', 'totp_enabled', 'email_otp_enabled', 'email', 'foreign_source');

      if (!row) throw new AppError(400, 'User not found');
      // SSO account (og_) signing in with a local password: only its LOCAL
      // TOTP completes the sign-in, never an e-mail code (see authController.login).
      const ssoAccount = row.foreign_source === 'obligate';

      let valid = false;
      // TOTP sign-in: strict anti-replay (P3). The step is claimed against
      // the pre-login session, then re-pointed at the regenerated one below.
      let totpStep: number | null = null;
      const preLoginHash = hashSessionId(req.sessionID);

      if (method === 'totp' && row.totp_enabled && row.totp_secret) {
        totpStep = twoFactorService.verifyTotpStep(row.totp_secret, String(code ?? ''));
        valid = totpStep !== null && await acceptTotpStep(row.id, totpStep, preLoginHash, 'strict');
        if (totpStep === null) await reportTotpDrift(req, row.id, row.totp_secret, String(code ?? ''), 'sign-in');
      } else if (method === 'email' && row.email_otp_enabled && !ssoAccount) {
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

      // Complete the session under a NEW id (session fixation): the pending
      // state is dropped with the old id.
      await regenerateSession(req);
      req.session.userId = row.id;
      req.session.username = row.username;
      req.session.role = row.role;
      delete req.session.pendingMfaUserId;
      delete req.session.pendingEmailOtp;

      // The sign-in code stays reusable for a step-up in THIS session only
      // (never for a strict use such as TOTP management).
      if (totpStep !== null) {
        await rebindTotpStepSession(row.id, totpStep, preLoginHash, hashSessionId(req.sessionID));
      }
      // A full sign-in lifts the step-up code lock (§6.8).
      await clearCodeThrottle(row.id);

      // Set tenant in session
      const firstTenant = await tenantService.getFirstTenantForUser(row.id);
      req.session.currentTenantId = firstTenant?.id ?? 1;

      await auditSelf(req, 'auth.login', { username: row.username, via: totpStep !== null ? 'password+totp' : 'password+email' });

      const user = await authService.getUserById(row.id);
      res.json({ success: true, data: { user } });
    } catch (err) { next(err); }
  },

  async resendEmail(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.session.pendingMfaUserId;
      if (!userId) throw new AppError(400, 'No pending 2FA session');

      const row = await db('users').where({ id: userId }).first('email', 'email_otp_enabled', 'foreign_source');
      // An SSO account signs in locally with its TOTP only: no e-mail code.
      if (!row || !row.email_otp_enabled || !row.email || row.foreign_source === 'obligate') {
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
