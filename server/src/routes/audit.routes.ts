import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { auditService } from '../services/audit.service';
import { isMasterTenant } from '@obliance/shared';

const router = Router();

// Admins only — audit log reveals user actions across the tenant.
router.use(requireAuth, requireRole('admin'));

// GET /api/audit-log?action=user.&userId=...&since=...&until=...&limit=100&offset=0
router.get('/', async (req, res, next) => {
  try {
    const parseDate = (v: any): Date | undefined => {
      if (!v || typeof v !== 'string') return undefined;
      const d = new Date(v);
      return isNaN(d.getTime()) ? undefined : d;
    };
    const { items, total } = await auditService.list({
      tenantId: req.tenantId!,
      action: (req.query.action as string) || undefined,
      userId: req.query.userId ? parseInt(req.query.userId as string) : undefined,
      deviceId: req.query.deviceId ? parseInt(req.query.deviceId as string) : undefined,
      resourceType: (req.query.resourceType as string) || undefined,
      search: (req.query.search as string) || undefined,
      since: parseDate(req.query.since),
      until: parseDate(req.query.until),
      limit: req.query.limit ? parseInt(req.query.limit as string) : 100,
      offset: req.query.offset ? parseInt(req.query.offset as string) : 0,
      // Master-only narrow filter — service drops it for non-master.
      filterTenantId: req.query.filterTenantId ? parseInt(req.query.filterTenantId as string) : undefined,
    });
    res.json({ data: { items, total } });
  } catch (err) { next(err); }
});

// GET /api/audit-log/distinct-actions — for filter dropdown in UI
router.get('/distinct-actions', async (req, res, next) => {
  try {
    const { db } = await import('../db');
    const isMaster = isMasterTenant(req.tenantId!);
    const q = db('audit_logs').distinct('action').orderBy('action', 'asc');
    if (!isMaster) {
      q.where({ tenant_id: req.tenantId! });
    } else if (req.query.filterTenantId) {
      // Master narrowed to one tenant via the chip filter — limit the
      // distinct-actions list to actions that actually appear in that
      // tenant's logs, otherwise the dropdown surfaces actions the
      // user can't drill into without clearing the filter.
      q.where({ tenant_id: parseInt(String(req.query.filterTenantId), 10) });
    }
    const rows = await q;
    res.json({ data: rows.map((r: any) => r.action) });
  } catch (err) { next(err); }
});

// DELETE /api/audit-log — clear all audit entries for this tenant.
// Defaults to `restricted` (second-admin approval) because destroying
// accountability records should never be a one-click action. An admin
// can bump it to `sensitive` from the matrix for extra friction.
router.delete('/', async (req, res, next) => {
  try {
    const { applyRestriction } = await import('../services/restriction.service');
    const approved = await applyRestriction(res, {
      req,
      actionKey: 'audit.clear',
      approvalRequestType: 'batch_command',
      approvalDescription: 'Clear the audit log for this tenant',
      approvalPayload: { action: 'audit_clear', tenantId: req.tenantId! },
    });
    if (!approved) return;

    const { db } = await import('../db');
    const { auditService } = await import('../services/audit.service');
    const deleted = await db('audit_logs').where({ tenant_id: req.tenantId! }).delete();

    // Leave a single "cleared" line so investigators see WHO wiped the log
    // and WHEN — the point of audit trails is that the very act of
    // tampering leaves a mark.
    await auditService.logReq(req, 'audit.cleared', {
      resourceType: 'audit_log',
      resourcePath: 'tenant',
      details: { entriesDeleted: deleted },
    });

    res.json({ data: { deleted } });
  } catch (err) { next(err); }
});

export default router;
