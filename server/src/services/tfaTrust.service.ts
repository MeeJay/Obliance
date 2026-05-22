import { db } from '../db';
import type { Request } from 'express';

// Fallback window when no tenant setting is available (matches the
// historical 24h default). The effective duration is configurable per
// tenant via the `tfaTrustHours` general setting; 0 disables IP trust.
const DEFAULT_TRUST_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h

export function clientIp(req: Request): string {
  const fwd = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim();
  const raw = fwd || req.socket?.remoteAddress || '';
  // IPv6-mapped IPv4 — normalise so a user hitting us over v4 + v6 on the
  // same machine doesn't get two separate trust entries.
  return raw.replace(/^::ffff:/i, '').trim();
}

export const tfaTrustService = {
  /** Is this (user, ip) currently trusted? Falls back to false on DB error. */
  async isTrusted(userId: number, ip: string): Promise<boolean> {
    if (!userId || !ip) return false;
    try {
      const row = await db('tfa_trusted_sessions')
        .where({ user_id: userId, ip_address: ip })
        .andWhere('trusted_until', '>', new Date())
        .first('trusted_until');
      return !!row;
    } catch {
      return false;
    }
  },

  /** Mark a (user, ip) pair as trusted for the tenant-configured window.
   *  `tenantId` resolves the `tfaTrustHours` setting; 0 hours = trust
   *  disabled (no row written, so the user is always re-prompted). */
  async grant(userId: number, ip: string, tenantId?: number): Promise<void> {
    if (!userId || !ip) return;
    let windowMs = DEFAULT_TRUST_WINDOW_MS;
    if (tenantId) {
      try {
        const { settingsService } = await import('./settings.service');
        const { SETTINGS_KEYS } = await import('@obliance/shared');
        const hours = await settingsService.getGlobalNumber(tenantId, SETTINGS_KEYS.TFA_TRUST_HOURS);
        if (hours <= 0) return; // IP trust disabled — never grant.
        windowMs = hours * 60 * 60 * 1000;
      } catch { /* fall back to default window */ }
    }
    const until = new Date(Date.now() + windowMs);
    try {
      await db('tfa_trusted_sessions')
        .insert({ user_id: userId, ip_address: ip, trusted_until: until })
        .onConflict(['user_id', 'ip_address'])
        .merge({ trusted_until: until });
    } catch { /* ignore — we'll just re-prompt on the next action */ }
  },

  /** Revoke every trust entry for a user (used when they disable TOTP, get
   *  password-reset, or click "Log out everywhere"). */
  async revokeAllForUser(userId: number): Promise<void> {
    try { await db('tfa_trusted_sessions').where({ user_id: userId }).delete(); } catch {}
  },

  /** Revoke one trust entry (the current IP, e.g. "forget this device"). */
  async revokeForUserIp(userId: number, ip: string): Promise<void> {
    try { await db('tfa_trusted_sessions').where({ user_id: userId, ip_address: ip }).delete(); } catch {}
  },

  /** List current trusted IPs for a user — used by the profile UI. */
  async listForUser(userId: number): Promise<{ ip: string; trustedUntil: string; createdAt: string }[]> {
    try {
      const rows = await db('tfa_trusted_sessions')
        .where({ user_id: userId })
        .andWhere('trusted_until', '>', new Date())
        .select('ip_address', 'trusted_until', 'created_at')
        .orderBy('trusted_until', 'desc');
      return rows.map((r: any) => ({
        ip: r.ip_address,
        trustedUntil: r.trusted_until,
        createdAt: r.created_at,
      }));
    } catch { return []; }
  },

  /** Periodic sweeper — called from the cron tick in index.ts. */
  async sweepExpired(): Promise<number> {
    try {
      return await db('tfa_trusted_sessions').where('trusted_until', '<', new Date()).delete();
    } catch { return 0; }
  },
};
