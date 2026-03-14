import type { Request, Response, NextFunction } from 'express';
import { liveAlertService } from '../services/liveAlert.service';
import { db } from '../db';

/** GET /api/live-alerts — current tenant */
export async function getAlerts(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const alerts = await liveAlertService.getForTenant(req.tenantId, 100);
    res.json(alerts);
  } catch (err) { next(err); }
}

/**
 * GET /api/live-alerts/all — all tenants accessible by this user.
 * Returns { alerts, tenants } where alerts are enriched with tenantName.
 */
export async function getAllTenantAlerts(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenants = await db('user_tenants')
      .join('tenants', 'user_tenants.tenant_id', 'tenants.id')
      .where('user_tenants.user_id', req.session.userId!)
      .select('tenants.id', 'tenants.name') as { id: number; name: string }[];

    const tenantIds = tenants.map((t) => t.id);
    const alerts = await liveAlertService.getForTenants(tenantIds, 200);
    res.json({ alerts, tenants });
  } catch (err) { next(err); }
}

/** PATCH /api/live-alerts/:id/read — mark one alert as read (cross-tenant) */
export async function markRead(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = parseInt(req.params.id, 10);
    // Verify the alert belongs to a tenant the user can access
    const userTenantIds = await db('user_tenants')
      .where('user_id', req.session.userId!)
      .pluck('tenant_id') as number[];

    const alert = await db('live_alerts')
      .where({ id })
      .whereIn('tenant_id', userTenantIds)
      .first() as { id: number; tenant_id: number } | undefined;
    if (!alert) { res.status(404).json({ error: 'Alert not found' }); return; }

    await liveAlertService.markRead(id, alert.tenant_id);
    res.json({ ok: true });
  } catch (err) { next(err); }
}

/** POST /api/live-alerts/read-all — mark all as read for current tenant */
export async function markAllRead(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await liveAlertService.markAllRead(req.tenantId);
    res.json({ ok: true });
  } catch (err) { next(err); }
}

/** DELETE /api/live-alerts/:id — delete one alert (cross-tenant) */
export async function deleteAlert(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = parseInt(req.params.id, 10);
    const userTenantIds = await db('user_tenants')
      .where('user_id', req.session.userId!)
      .pluck('tenant_id') as number[];

    const alert = await db('live_alerts')
      .where({ id })
      .whereIn('tenant_id', userTenantIds)
      .first() as { id: number } | undefined;
    if (!alert) { res.status(404).json({ error: 'Alert not found' }); return; }

    await liveAlertService.deleteAlert(id);
    res.json({ ok: true });
  } catch (err) { next(err); }
}

/** DELETE /api/live-alerts — clear all for current tenant */
export async function clearAll(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await liveAlertService.clearAll(req.tenantId);
    res.json({ ok: true });
  } catch (err) { next(err); }
}
