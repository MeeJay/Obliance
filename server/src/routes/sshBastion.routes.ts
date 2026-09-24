import { Router } from 'express';
import { db } from '../db';
import { config } from '../config';
import { AppError } from '../middleware/errorHandler';
import { appConfigService } from '../services/appConfig.service';
import { bastionGate, isValidAllowEntry } from '../services/sshBastion/bastionGate.service';
import { getHostKeyInfo, isBastionRunning } from '../services/sshBastion/sshBastion.service';
import { bastionAudit } from '../services/sshBastion/bastionUtil';
import { clientIp } from '../services/tfaTrust.service';

// ─── SSH bastion administration ───────────────────────────────────────────────
// The bastion is a PLATFORM service (one port, not tenant-scoped), so this is
// mounted like /system: platform admins only (requireRole('admin') at mount).

const router = Router();

function adminAudit(req: any, action: string, details: Record<string, unknown>) {
  bastionAudit(action, { tenantId: req.tenantId, userId: req.session?.userId, ip: clientIp(req), details });
}

router.get('/status', async (_req, res, next) => {
  try {
    res.json({
      data: {
        enabled: config.sshBastion.enabled,
        running: isBastionRunning(),
        port: config.sshBastion.port,
        enforce: await bastionGate.isEnforce(),
        hostKey: getHostKeyInfo(),
      },
    });
  } catch (err) { next(err); }
});

router.put('/enforce', async (req, res, next) => {
  try {
    if (typeof req.body?.enforce !== 'boolean') return next(new AppError(400, 'enforce must be a boolean'));
    await appConfigService.set('ssh_bastion_enforce', req.body.enforce ? 'true' : 'false');
    bastionGate.invalidateEnforce();
    adminAudit(req, 'enforce_changed', { enforce: req.body.enforce });
    res.json({ data: { enforce: req.body.enforce } });
  } catch (err) { next(err); }
});

// ── Static IP allow-list ─────────────────────────────────────────────────────

router.get('/allowlist', async (_req, res, next) => {
  try {
    const rows = await db('ssh_bastion_ip_allowlist as a')
      .leftJoin('users as u', 'u.id', 'a.created_by')
      .select('a.id', 'a.cidr', 'a.label', 'a.created_by', 'a.created_at', 'u.username as created_by_name')
      .orderBy('a.created_at', 'desc');
    res.json({
      data: rows.map((r: any) => ({
        id: r.id, cidr: r.cidr, label: r.label, createdBy: r.created_by,
        createdByName: r.created_by_name ?? null, createdAt: r.created_at,
      })),
    });
  } catch (err) { next(err); }
});

router.post('/allowlist', async (req, res, next) => {
  try {
    const cidr = String(req.body?.cidr || '').trim();
    const label = req.body?.label ? String(req.body.label).slice(0, 120) : null;
    if (!isValidAllowEntry(cidr)) {
      return next(new AppError(400, 'Invalid entry: use an IPv4 address, an IPv4 CIDR (e.g. 10.0.0.0/24) or an IPv6 address'));
    }
    try {
      const [row] = await db('ssh_bastion_ip_allowlist')
        .insert({ cidr, label, created_by: (req.session as any).userId })
        .returning('*');
      bastionGate.invalidateAllowlist();
      adminAudit(req, 'allowlist_added', { cidr, label });
      res.status(201).json({ data: { id: row.id, cidr: row.cidr, label: row.label, createdBy: row.created_by, createdAt: row.created_at } });
    } catch (err: any) {
      if (err?.code === '23505') return next(new AppError(409, 'This entry is already in the allow-list'));
      throw err;
    }
  } catch (err) { next(err); }
});

router.delete('/allowlist/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const row = await db('ssh_bastion_ip_allowlist').where({ id }).first('cidr');
    if (!row) return next(new AppError(404, 'Entry not found'));
    await db('ssh_bastion_ip_allowlist').where({ id }).delete();
    bastionGate.invalidateAllowlist();
    adminAudit(req, 'allowlist_removed', { cidr: row.cidr });
    res.status(204).send();
  } catch (err) { next(err); }
});

// ── Bans ─────────────────────────────────────────────────────────────────────

router.get('/bans', async (_req, res, next) => {
  try {
    const rows = await db('ssh_bastion_bans')
      .where((q) => q.whereNull('expires_at').orWhere('expires_at', '>', new Date()))
      .orderBy('created_at', 'desc')
      .limit(500);
    res.json({
      data: rows.map((r: any) => ({
        ip: r.ip, reason: r.reason, expiresAt: r.expires_at, createdAt: r.created_at,
        obliguardPushedAt: r.obliguard_pushed_at, obliguardError: r.obliguard_error,
      })),
    });
  } catch (err) { next(err); }
});

router.delete('/bans/:ip', async (req, res, next) => {
  try {
    const ip = String(req.params.ip || '');
    const removed = await bastionGate.unban(ip);
    if (!removed) return next(new AppError(404, 'No active ban for this IP'));
    adminAudit(req, 'ip_unbanned', { ip });
    res.status(204).send();
  } catch (err) { next(err); }
});

export default router;
