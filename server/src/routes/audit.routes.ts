import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { auditService } from '../services/audit.service';

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
    });
    res.json({ data: { items, total } });
  } catch (err) { next(err); }
});

// GET /api/audit-log/distinct-actions — for filter dropdown in UI
router.get('/distinct-actions', async (req, res, next) => {
  try {
    const { db } = await import('../db');
    const rows = await db('audit_logs')
      .where({ tenant_id: req.tenantId! })
      .distinct('action')
      .orderBy('action', 'asc');
    res.json({ data: rows.map((r: any) => r.action) });
  } catch (err) { next(err); }
});

export default router;
