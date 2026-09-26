import * as OTPAuth from 'otpauth';
import QRCode from 'qrcode';
import nodemailer from 'nodemailer';
import { smtpServerService } from './smtpServer.service';
import { config } from '../config';
import { logger } from '../utils/logger';

/** TOTP period (s) and accepted drift, in steps, for local checks [D11]. */
export const TOTP_PERIOD_S = 30;
export const TOTP_WINDOW = 1;

export const twoFactorService = {
  // ── TOTP ──────────────────────────────────────────────────────────────────

  generateTotpSecret(username: string): { secret: string; uri: string } {
    const secret = new OTPAuth.Secret({ size: 20 });
    const totp = new OTPAuth.TOTP({
      issuer: config.appName,
      label: username,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret,
    });
    return {
      secret: secret.base32,
      uri: totp.toString(),
    };
  },

  async generateTotpQr(uri: string): Promise<string> {
    return QRCode.toDataURL(uri);
  },

  /**
   * Verifies a TOTP code and returns the ABSOLUTE time step it matched
   * (floor(unix / 30) + drift), or null. The step feeds the anti-replay
   * guard (acceptTotpStep in services/deviceKey/stepUpProof.ts): a caller
   * that only checks `!== null` accepts a replayed code.
   * Window ±1 step (±30 s) for every local check [D11].
   */
  verifyTotpStep(secret: string, code: string, window: number = TOTP_WINDOW, nowMs: number = Date.now()): number | null {
    const token = String(code ?? '').trim();
    if (!/^\d{6}$/.test(token)) return null;
    try {
      const totp = new OTPAuth.TOTP({
        issuer: config.appName,
        algorithm: 'SHA1',
        digits: 6,
        period: TOTP_PERIOD_S,
        secret: OTPAuth.Secret.fromBase32(secret.trim()),
      });
      const delta = totp.validate({ token, timestamp: nowMs, window });
      if (delta === null) return null;
      return Math.floor(nowMs / 1000 / TOTP_PERIOD_S) + delta;
    } catch (err) {
      logger.warn({ err }, 'TOTP verification threw an exception (secret may be malformed)');
      return null;
    }
  },

  /**
   * Drift diagnostic [D11]. For a code REFUSED at ±1 step only: returns the
   * offset (±2 steps) when it matches at ±2 — the phone's or the server's
   * clock is 31–60 s off, which the ±60 s window used to hide. Never makes a
   * code valid; the callers log and audit it (auth.totp_drift).
   */
  totpDriftSteps(secret: string, code: string, nowMs: number = Date.now()): number | null {
    const token = String(code ?? '').trim();
    if (!/^\d{6}$/.test(token)) return null;
    try {
      const totp = new OTPAuth.TOTP({
        issuer: config.appName,
        algorithm: 'SHA1',
        digits: 6,
        period: TOTP_PERIOD_S,
        secret: OTPAuth.Secret.fromBase32(secret.trim()),
      });
      const delta = totp.validate({ token, timestamp: nowMs, window: TOTP_WINDOW + 1 });
      return delta !== null && Math.abs(delta) > TOTP_WINDOW ? delta : null;
    } catch {
      return null;
    }
  },

  // ── Email OTP ──────────────────────────────────────────────────────────────

  generateEmailOtp(): string {
    return String(Math.floor(100000 + Math.random() * 900000));
  },

  async sendEmailOtp(smtpServerId: number, toEmail: string, code: string): Promise<void> {
    const server = await smtpServerService.getById(smtpServerId);
    if (!server) throw new Error('SMTP server not configured for OTP');

    const transport = nodemailer.createTransport({
      host: server.host,
      port: server.port,
      secure: server.secure,
      auth: { user: server.username, pass: server.password },
    });

    await transport.sendMail({
      from: server.from_address,
      to: toEmail,
      subject: `${config.appName} — Your login code`,
      text: `Your login verification code is: ${code}\n\nThis code expires in 10 minutes.`,
      html: `
        <h2>${config.appName} — Login verification</h2>
        <p>Your verification code is:</p>
        <h1 style="letter-spacing:8px;font-family:monospace">${code}</h1>
        <p style="color:#888;font-size:12px">This code expires in 10 minutes. If you did not request this, ignore this email.</p>
      `,
    });

    logger.info(`Email OTP sent to ${toEmail}`);
  },

  /** Security notice (second factor added / removed) [D13]. English, like
   *  the OTP mails; static text only (no code, secret or address). */
  async sendSecurityNotice(smtpServerId: number, toEmail: string, subject: string, lines: string[]): Promise<void> {
    const server = await smtpServerService.getById(smtpServerId);
    if (!server) throw new Error('SMTP server not configured for OTP');
    const transport = nodemailer.createTransport({
      host: server.host,
      port: server.port,
      secure: server.secure,
      auth: { user: server.username, pass: server.password },
    });
    const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
    await transport.sendMail({
      from: server.from_address,
      to: toEmail,
      subject: `${config.appName} — ${subject}`,
      text: lines.join('\n\n'),
      html: `<h2>${esc(config.appName)} — ${esc(subject)}</h2>${lines.map((l) => `<p>${esc(l)}</p>`).join('')}`,
    });
    logger.info({ subject }, 'Security notice sent');
  },

  /** Security notice [D13]: several wrong step-up codes in 24 h. English,
   *  like the OTP mails. Carries no code, IP list or secret. */
  async sendStepUpFailureNotice(smtpServerId: number, toEmail: string, failures: number): Promise<void> {
    const server = await smtpServerService.getById(smtpServerId);
    if (!server) throw new Error('SMTP server not configured for OTP');

    const transport = nodemailer.createTransport({
      host: server.host,
      port: server.port,
      secure: server.secure,
      auth: { user: server.username, pass: server.password },
    });

    const n = Math.max(0, Math.floor(Number(failures) || 0));
    await transport.sendMail({
      from: server.from_address,
      to: toEmail,
      subject: `${config.appName} — Wrong verification codes on your account`,
      text: `Several wrong verification codes were entered on your account (${n} in 24 h).\n\nIf this was not you, change your password and review your trusted IPs in your profile. After 30 wrong codes in 24 hours, code entry is blocked until you sign in again.`,
      html: `
        <h2>${config.appName} — Wrong verification codes</h2>
        <p>Several wrong verification codes were entered on your account (<strong>${n}</strong> in 24 h).</p>
        <p style="color:#888;font-size:12px">If this was not you, change your password and review your trusted IPs in your profile. After 30 wrong codes in 24 hours, code entry is blocked until you sign in again.</p>
      `,
    });

    logger.info({ failures: n }, 'Step-up failure notice sent');
  },
};
