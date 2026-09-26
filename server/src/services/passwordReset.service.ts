import crypto from 'crypto';
import nodemailer from 'nodemailer';
import { db } from '../db';
import { hashPassword } from '../utils/crypto';
import { appConfigService } from './appConfig.service';
import { smtpServerService } from './smtpServer.service';
import { config } from '../config';
import { logger } from '../utils/logger';

const TOKEN_EXPIRY_MS = 60 * 60 * 1000; // 1 hour

/**
 * An SSO account (Obligate, og_) never gets a local password by e-mail: its
 * password lives in Obligate. A local one planted here would sign in and
 * survive an Obligate password / MFA change.
 */
const notSso = (q: any) => q.whereNull('users.foreign_source').orWhereNot('users.foreign_source', 'obligate');

export const passwordResetService = {
  /**
   * Generate a reset token, store its hash, send the email. Always resolves
   * (no enumeration): an unknown address and an SSO account get the same
   * answer, and nothing is stored or sent for them.
   */
  async requestReset(email: string): Promise<void> {
    const user = await db('users').where({ email }).where(notSso).orderBy('id').first();
    if (!user) {
      // Silently succeed to prevent email enumeration
      return;
    }

    // Invalidate any existing unused tokens for this user
    await db('password_reset_tokens')
      .where({ user_id: user.id })
      .whereNull('used_at')
      .delete();

    // Generate a secure random token
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_MS);

    await db('password_reset_tokens').insert({
      user_id: user.id,
      token_hash: tokenHash,
      expires_at: expiresAt,
    });

    // Send the reset email if SMTP is configured
    const cfg = await appConfigService.getAll();
    if (!cfg.otp_smtp_server_id) {
      logger.warn('Password reset requested but no SMTP server configured');
      return;
    }

    const smtp = await smtpServerService.getTransportConfig(Number(cfg.otp_smtp_server_id));
    if (!smtp) return;

    const resetUrl = `${config.appUrl}/reset-password?token=${rawToken}`;

    const transport = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth: { user: smtp.username, pass: smtp.password },
    });

    await transport.sendMail({
      from: smtp.fromAddress,
      to: email,
      subject: `${config.appName} — Reset your password`,
      text: `You requested a password reset for your ${config.appName} account.\n\nClick this link to reset your password (valid for 1 hour):\n${resetUrl}\n\nIf you did not request this, ignore this email.`,
      html: `
        <h2>${config.appName} — Password reset</h2>
        <p>You requested a password reset for your account.</p>
        <p style="margin:24px 0">
          <a href="${resetUrl}" style="background:#3b82f6;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600">
            Reset password
          </a>
        </p>
        <p style="color:#888;font-size:12px">This link expires in 1 hour. If you did not request this, ignore this email.</p>
      `,
    });

    logger.info(`Password reset email sent to ${email}`);
  },

  /** Validate a raw token. Returns the user_id if valid, null otherwise. */
  async validateToken(rawToken: string): Promise<number | null> {
    const row = await this.findUsableToken(rawToken);
    return row ? row.user_id : null;
  },

  /** A live token of a non-SSO account (a token issued to an SSO account
   *  before it was refused at the request is never honoured). */
  async findUsableToken(rawToken: string): Promise<{ id: number; user_id: number } | null> {
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const row = await db('password_reset_tokens')
      .join('users', 'users.id', 'password_reset_tokens.user_id')
      .where({ 'password_reset_tokens.token_hash': tokenHash })
      .whereNull('password_reset_tokens.used_at')
      .where('password_reset_tokens.expires_at', '>', new Date())
      .where(notSso)
      .first('password_reset_tokens.id', 'password_reset_tokens.user_id') as { id: number; user_id: number } | undefined;
    return row ?? null;
  },

  /** Consume a raw token and update the user's password. */
  async resetPassword(rawToken: string, newPassword: string): Promise<boolean> {
    const row = await this.findUsableToken(rawToken);
    if (!row) return false;

    const newHash = await hashPassword(newPassword);

    await db.transaction(async (trx) => {
      await trx('users').where({ id: row.user_id }).update({ password_hash: newHash, updated_at: new Date() });
      await trx('password_reset_tokens').where({ id: row.id }).update({ used_at: new Date() });
    });

    return true;
  },
};
