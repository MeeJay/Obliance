import net from 'net';
import os from 'os';
import { db } from '../../db';
import { logger } from '../../utils/logger';
import { bastionAudit } from './bastionUtil';

// ─── Network gate + anti-bruteforce for the bastion port ─────────────────────
//
// An IP is allowed ONLY when it is:
//   1. in the static allow-list (ssh_bastion_ip_allowlist), or
//   2. authorized by the user through the header "SSH" button (fresh 2FA,
//      ssh_bastion_ip_grants, 24h).
// A web 2FA "trust this IP" (tfa_trusted_sessions) deliberately does NOT count:
// it is ticked casually on any sensitive web action, is invisible from the SSH
// UI, and silently opened the bastion (incident 2026-09-24).
//
// `enforce` (app_config ssh_bastion_enforce) makes the gate hard: a non-allowed
// IP is refused with "Your IP is not allowed" and banned on the 3rd attempt.
// Enforce is ON unless explicitly set to 'false' — the whitelist is the
// default posture of the bastion.
//
// Independently, connections that close WITHOUT authenticating are counted
// per IP over a sliding window; crossing the threshold bans the IP
// (scanners / bruteforce). Bans are persisted (ssh_bastion_bans) so they
// survive a restart; the Obliguard push lands in P6.

const IP_STRIKE_LIMIT = 3;                    // not-allowed attempts before ban
const FAILED_CONN_LIMIT = 10;                 // unauthenticated connections...
const FAILED_CONN_WINDOW_MS = 10 * 60_000;    // ...within this window -> ban
const BAN_MS = 24 * 60 * 60_000;              // ban duration
const GRANT_MS = 24 * 60 * 60_000;            // header SSH button authorization
const CACHE_MS = 15_000;

function normalizeIp(ip: string): string {
  let s = (ip || '').trim().toLowerCase();
  if (s.startsWith('::ffff:')) s = s.slice(7); // IPv4-mapped IPv6 -> IPv4
  return s;
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    // Strict dotted-quad (like inet_pton): no leading zeros, so an allow-list
    // entry such as "010.0.0.0/24" is rejected (fail closed) instead of being
    // silently read as decimal 10 when other tools would read it as octal 8.
    if (!/^(0|[1-9]\d{0,2})$/.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = ((n << 8) | v) >>> 0;
  }
  return n >>> 0;
}

// IPv4 CIDR / exact match. IPv6 entries are matched exactly (no v6 CIDR yet).
function cidrMatch(ip: string, entry: string): boolean {
  const a = normalizeIp(ip);
  if (!entry.includes('/')) return a === normalizeIp(entry);
  const [base, bitsStr] = entry.split('/');
  const bits = Number(bitsStr);
  const ipN = ipv4ToInt(a);
  const baseN = ipv4ToInt(normalizeIp(base));
  if (ipN === null || baseN === null || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipN & mask) === (baseN & mask);
}

// Admin input validation for an allow-list entry: exact IPv4 / IPv4 CIDR
// (strict dotted-quad, /0-32) or exact IPv6. Anything else is rejected.
export function isValidAllowEntry(raw: string): boolean {
  const s = String(raw || '').trim();
  if (!s) return false;
  if (s.includes('/')) {
    const [base, bits] = s.split('/');
    return ipv4ToInt(base) !== null && /^(\d|[12]\d|3[0-2])$/.test(bits);
  }
  if (ipv4ToInt(s) !== null) return true;
  return net.isIPv6(s);
}

// ── Infrastructure IPs (fail closed) ──────────────────────────────────────────
// A source IP that belongs to the server's OWN networks (loopback, the Docker
// bridge the container sits on, its gateway) is never a real client: it means
// the connection was relayed (docker-proxy for IPv6, an NPM/nginx stream, a
// NAT hairpin...). Every user behind that relay would share ONE IP, so an
// SSH-button grant or a web trust for it would open the bastion to all of
// them. Such IPs are therefore never allowed, and never banned (a ban would
// lock everybody out).
let infraNets: string[] = [];
let infraV6: string[] = [];
let infraAt = 0;
function refreshInfra(): void {
  if (Date.now() - infraAt < 60_000) return;
  const v4: string[] = ['127.0.0.0/8'];
  const v6: string[] = ['::1'];
  const ifaces = os.networkInterfaces();
  // Normal bridged container: every interface is Docker plumbing. In the HOST
  // network namespace (network_mode: host, recognizable by docker0), the real
  // LAN interfaces must NOT count — only the Docker bridges do.
  const hostNetns = 'docker0' in ifaces;
  for (const [name, addrs] of Object.entries(ifaces)) {
    if (hostNetns && !/^(docker\d*|br-|veth|cni|flannel|cali|vxlan)/.test(name)) continue;
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && a.cidr) v4.push(a.cidr);
      else if (a.family === 'IPv6') v6.push(normalizeIp(a.address.split('%')[0]));
    }
  }
  infraNets = v4;
  infraV6 = v6;
  infraAt = Date.now();
}
export function isInfraIp(raw: string | undefined): boolean {
  const ip = normalizeIp(raw || '');
  if (!ip) return true; // unknown source = fail closed
  refreshInfra();
  if (net.isIPv6(ip)) return infraV6.includes(ip) || ip.startsWith('fe80:');
  return infraNets.some((c) => cidrMatch(ip, c));
}

export type GateVia = 'allowlist' | 'ssh_button';
export interface GateDecision { allowed: boolean; enforce: boolean; via: GateVia | null; entry?: string; infra: boolean }

class BastionGateService {
  private allowlist: string[] = [];
  private allowlistAt = 0;
  private enforce = true;
  private enforceAt = 0;
  private bans = new Map<string, number>(); // ip -> expiry epoch ms (Infinity = permanent)
  private bansAt = 0;
  // Bans whose DB write failed: kept in memory until expiry so a DB hiccup
  // can't silently lift a ban at the next cache reload.
  private unpersisted = new Map<string, number>();
  private strikes = new Map<string, number>();
  private failedConns = new Map<string, number[]>();

  normalize(ip: string | undefined): string {
    return normalizeIp(ip || '');
  }

  // Admin changes take effect immediately instead of after the cache window.
  invalidateAllowlist(): void { this.allowlistAt = 0; }
  invalidateEnforce(): void { this.enforceAt = 0; }

  // Lift a ban (admin). Clears every counter so the IP starts clean.
  async unban(sourceIp: string): Promise<boolean> {
    const ip = normalizeIp(sourceIp);
    const wasBannedInMemory = this.bans.has(ip) || this.unpersisted.has(ip);
    this.bans.delete(ip);
    this.unpersisted.delete(ip);
    this.strikes.delete(ip);
    this.failedConns.delete(ip);
    const n = await db('ssh_bastion_bans').where({ ip }).delete();
    return n > 0 || wasBannedInMemory;
  }

  private async loadAllowlist(): Promise<string[]> {
    if (Date.now() - this.allowlistAt < CACHE_MS) return this.allowlist;
    try {
      const rows = await db('ssh_bastion_ip_allowlist').select('cidr');
      this.allowlist = rows.map((r: any) => String(r.cidr));
      this.allowlistAt = Date.now();
    } catch { /* keep last known */ }
    return this.allowlist;
  }

  private async loadBans(): Promise<void> {
    if (Date.now() - this.bansAt < CACHE_MS) return;
    try {
      const rows = await db('ssh_bastion_bans')
        .where((q) => q.whereNull('expires_at').orWhere('expires_at', '>', new Date()))
        .select('ip', 'expires_at');
      const next = new Map<string, number>();
      for (const r of rows) next.set(normalizeIp(r.ip), r.expires_at ? new Date(r.expires_at).getTime() : Infinity);
      const now = Date.now();
      for (const [ip, exp] of this.unpersisted) {
        if (exp > now) next.set(ip, exp); else this.unpersisted.delete(ip);
      }
      this.bans = next;
      this.bansAt = Date.now();
    } catch { /* keep last known */ }
  }

  async isEnforce(): Promise<boolean> {
    if (Date.now() - this.enforceAt < CACHE_MS) return this.enforce;
    try {
      const row = await db('app_config').where({ key: 'ssh_bastion_enforce' }).first();
      this.enforce = row?.value !== 'false'; // default ON
      this.enforceAt = Date.now();
    } catch { /* keep last known */ }
    return this.enforce;
  }

  async isBanned(sourceIp: string | undefined): Promise<boolean> {
    if (!sourceIp) return false;
    await this.loadBans();
    const exp = this.bans.get(normalizeIp(sourceIp));
    return exp !== undefined && exp > Date.now();
  }

  async ban(sourceIp: string | undefined, reason: string, durationMs: number | null = BAN_MS): Promise<void> {
    if (!sourceIp || isInfraIp(sourceIp)) return; // would lock out everyone behind the relay
    const ip = normalizeIp(sourceIp);
    const expiresAt = durationMs === null ? null : new Date(Date.now() + durationMs);
    const expMs = expiresAt ? expiresAt.getTime() : Infinity;
    this.bans.set(ip, expMs);
    try {
      await db('ssh_bastion_bans')
        .insert({ ip, reason, expires_at: expiresAt })
        .onConflict('ip')
        .merge({ reason, expires_at: expiresAt, created_at: new Date(), obliguard_pushed_at: null, obliguard_error: null });
      this.unpersisted.delete(ip);
    } catch (err) {
      this.unpersisted.set(ip, expMs);
      logger.error(err, '[ssh-bastion] failed to persist ban (kept in memory until expiry)');
    }
    logger.warn({ ip, reason }, '[ssh-bastion] IP banned');
    bastionAudit('ip_banned', { ip, details: { reason, expiresAt } });
    // P6: push to Obliguard's shared banlist (Obligate delegation JWT).
  }

  // An IP explicitly authorized by the SSH button counts for the gate AND as a
  // 2FA-trusted origin for jumps on machines whose remote sessions are marked
  // sensitive (the button itself required a fresh TOTP code).
  async hasGrant(userId: number, sourceIp: string | undefined): Promise<boolean> {
    if (!sourceIp) return false;
    try {
      const row = await db('ssh_bastion_ip_grants')
        .where({ user_id: userId, ip: normalizeIp(sourceIp) })
        .andWhere('expires_at', '>', new Date())
        .first('id');
      return !!row;
    } catch { return false; }
  }

  async grantIp(userId: number, sourceIp: string): Promise<Date> {
    if (isInfraIp(sourceIp)) throw new Error('INFRA_IP');
    const ip = normalizeIp(sourceIp);
    const expiresAt = new Date(Date.now() + GRANT_MS);
    await db('ssh_bastion_ip_grants')
      .insert({ user_id: userId, ip, expires_at: expiresAt })
      .onConflict(['user_id', 'ip'])
      .merge({ expires_at: expiresAt, created_at: new Date() });
    // An authorized IP starts clean.
    this.strikes.delete(ip);
    return expiresAt;
  }

  // 2FA-equivalent proof for this (user, ip): the SSH-button grant only.
  async hasFreshSecondFactor(userId: number, sourceIp: string | undefined): Promise<boolean> {
    if (!sourceIp || isInfraIp(sourceIp)) return false;
    return this.hasGrant(userId, sourceIp); // SSH-button grant only (fresh TOTP), never web trust
  }

  async evaluate(sourceIp: string | undefined, userId: number): Promise<GateDecision> {
    const enforce = await this.isEnforce();
    if (!sourceIp || isInfraIp(sourceIp)) return { allowed: false, enforce, via: null, infra: true };
    const ip = normalizeIp(sourceIp);
    const list = await this.loadAllowlist();
    const entry = list.find((c) => cidrMatch(ip, c));
    if (entry) return { allowed: true, enforce, via: 'allowlist', entry, infra: false };
    if (await this.hasGrant(userId, ip)) return { allowed: true, enforce, via: 'ssh_button', infra: false };
    return { allowed: false, enforce, via: null, infra: false };
  }

  // Refused not-allowed attempt (enforce mode). Returns true when banned.
  async strike(sourceIp: string | undefined): Promise<boolean> {
    if (!sourceIp || isInfraIp(sourceIp)) return false;
    const ip = normalizeIp(sourceIp);
    const n = (this.strikes.get(ip) || 0) + 1;
    if (n >= IP_STRIKE_LIMIT) {
      this.strikes.delete(ip);
      await this.ban(ip, 'ip_not_allowed');
      return true;
    }
    this.strikes.set(ip, n);
    return false;
  }

  clearStrikes(sourceIp: string | undefined): void {
    if (sourceIp) this.strikes.delete(normalizeIp(sourceIp));
  }

  // A connection that closed without ever authenticating (scanner, wrong
  // key, dropped handshake). Too many within the window -> ban.
  async recordFailedConnection(sourceIp: string | undefined): Promise<void> {
    if (!sourceIp || isInfraIp(sourceIp)) return;
    const ip = normalizeIp(sourceIp);
    const now = Date.now();
    // Bound memory under a wide scan: drop IPs whose window has fully expired.
    if (this.failedConns.size > 5000) {
      for (const [k, ts] of this.failedConns) {
        if (!ts.length || now - ts[ts.length - 1] >= FAILED_CONN_WINDOW_MS) this.failedConns.delete(k);
      }
      if (this.strikes.size > 5000) this.strikes.clear();
    }
    const recent = (this.failedConns.get(ip) || []).filter((t) => now - t < FAILED_CONN_WINDOW_MS);
    recent.push(now);
    if (recent.length >= FAILED_CONN_LIMIT) {
      this.failedConns.delete(ip);
      await this.ban(ip, 'bruteforce');
      return;
    }
    this.failedConns.set(ip, recent);
  }
}

export const bastionGate = new BastionGateService();
