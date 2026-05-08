import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { tenantService } from '../services/tenant.service';
import { permissionService } from '../services/permission.service';
import { db } from '../db';
import { AppError } from '../middleware/errorHandler';

const router = Router();

// All tenant routes require auth
router.use(requireAuth);

// ── Locate a device across the user's tenants ─────────────────────────────
// GET /api/tenants/locate-device/:id
//
// Resolves which tenant a device belongs to, used when the user follows a
// shared deep-link (`/devices/123`) while connected to the wrong tenant.
// We deliberately collapse "device doesn't exist" and "user has no access"
// into the same 404 to avoid leaking the existence of devices the caller
// can't see.
//
// Returns: { deviceId, hostname, displayName, tenantId, tenantName,
//            tenantSlug, currentTenantId } on success.
router.get('/locate-device/:id', async (req, res, next) => {
  try {
    const deviceId = parseInt(req.params.id);
    if (!Number.isFinite(deviceId)) throw new AppError(400, 'Invalid device ID');

    const userId = req.session.userId!;
    const isPlatformAdmin = req.session.role === 'admin';

    const row = await db('devices')
      .leftJoin('tenants', 'devices.tenant_id', 'tenants.id')
      .where('devices.id', deviceId)
      .first(
        'devices.id as id',
        'devices.tenant_id as tenantId',
        'devices.hostname as hostname',
        'devices.display_name as displayName',
        'tenants.name as tenantName',
        'tenants.slug as tenantSlug',
      );

    if (!row) return res.status(404).json({ error: 'Device not found' });

    // Access gate: platform admins always pass; otherwise the user must
    // be a member of the device's tenant AND have device-read permission
    // through one of their teams. Mirrors the requireDeviceRead middleware
    // used by /api/devices/:id, so no privilege escalation here.
    let allowed = isPlatformAdmin;
    if (!allowed) {
      const hasTenantMembership = await tenantService.userHasAccess(userId, row.tenantId);
      if (hasTenantMembership) {
        allowed = await permissionService.canReadDevice(userId, deviceId, false);
      }
    }
    if (!allowed) return res.status(404).json({ error: 'Device not found' });

    res.json({
      data: {
        deviceId: row.id,
        hostname: row.hostname,
        displayName: row.displayName,
        tenantId: row.tenantId,
        tenantName: row.tenantName,
        tenantSlug: row.tenantSlug,
        currentTenantId: req.session.currentTenantId ?? null,
      },
    });
  } catch (err) { next(err); }
});

// ── Tenant switch ──────────────────────────────────────────────────────────
// POST /api/tenant/switch  { tenantId: number }
router.post('/switch', async (req, res, next) => {
  try {
    const { tenantId } = req.body as { tenantId: number };
    if (!tenantId || typeof tenantId !== 'number') {
      throw new AppError(400, 'tenantId is required');
    }

    const userId = req.session.userId!;

    // Platform admins can switch to any tenant; others only to their own
    if (req.session.role !== 'admin') {
      const hasAccess = await tenantService.userHasAccess(userId, tenantId);
      if (!hasAccess) throw new AppError(403, 'Access denied to this tenant');
    }

    req.session.currentTenantId = tenantId;
    res.json({ success: true, data: { currentTenantId: tenantId } });
  } catch (err) {
    next(err);
  }
});

// ── List tenants ───────────────────────────────────────────────────────────
// GET /api/tenants  (admin: all, user: their tenants with role)
router.get('/', async (req, res, next) => {
  try {
    const userId = req.session.userId!;
    const isAdmin = req.session.role === 'admin';

    if (isAdmin) {
      const tenants = await tenantService.getAll();
      res.json({ success: true, data: tenants });
    } else {
      const tenants = await tenantService.getTenantsForUser(userId);
      res.json({ success: true, data: tenants });
    }
  } catch (err) {
    next(err);
  }
});

// ── Create tenant (platform admin only) ───────────────────────────────────
router.post('/', async (req, res, next) => {
  try {
    if (req.session.role !== 'admin') throw new AppError(403, 'Admin only');
    const { name, slug } = req.body as { name: string; slug: string };
    if (!name || !slug) throw new AppError(400, 'name and slug are required');
    const tenant = await tenantService.create({ name, slug });
    res.status(201).json({ success: true, data: tenant });
  } catch (err) {
    next(err);
  }
});

// ── Get one tenant ─────────────────────────────────────────────────────────
router.get('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    const tenant = await tenantService.getById(id);
    if (!tenant) throw new AppError(404, 'Tenant not found');

    // Non-admins can only see their own tenants
    if (req.session.role !== 'admin') {
      const hasAccess = await tenantService.userHasAccess(req.session.userId!, id);
      if (!hasAccess) throw new AppError(403, 'Access denied');
    }

    res.json({ success: true, data: tenant });
  } catch (err) {
    next(err);
  }
});

// ── Update tenant (platform admin only) ───────────────────────────────────
router.put('/:id', async (req, res, next) => {
  try {
    if (req.session.role !== 'admin') throw new AppError(403, 'Admin only');
    const id = parseInt(req.params.id);
    const before = await tenantService.getById(id);
    const { name, slug, twoStepApproval } = req.body as { name?: string; slug?: string; twoStepApproval?: boolean };
    const tenant = await tenantService.update(id, { name, slug, twoStepApproval });
    if (!tenant) throw new AppError(404, 'Tenant not found');
    try {
      const { auditService } = await import('../services/audit.service');
      const changes: Record<string, unknown> = {};
      if (name !== undefined && name !== before?.name) changes.name = { from: before?.name, to: name };
      if (slug !== undefined && slug !== before?.slug) changes.slug = { from: before?.slug, to: slug };
      if (twoStepApproval !== undefined && twoStepApproval !== before?.twoStepApproval) {
        changes.twoStepApproval = { from: before?.twoStepApproval, to: twoStepApproval };
      }
      if (Object.keys(changes).length > 0) {
        await auditService.log({
          tenantId: id,
          userId: req.session.userId,
          action: 'tenant.settings_changed',
          resourceType: 'tenant',
          resourcePath: String(id),
          details: changes,
          ipAddress: (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim()
            || req.socket?.remoteAddress || undefined,
        });
      }
    } catch {}
    res.json({ success: true, data: tenant });
  } catch (err) {
    next(err);
  }
});

// ── Delete tenant (platform admin only, cannot delete tenant 1) ───────────
router.delete('/:id', async (req, res, next) => {
  try {
    if (req.session.role !== 'admin') throw new AppError(403, 'Admin only');
    const id = parseInt(req.params.id);
    if (id === 1) throw new AppError(400, 'Cannot delete the default tenant');
    await tenantService.delete(id);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ── Tenant members ─────────────────────────────────────────────────────────
// GET /api/tenants/:id/members
router.get('/:id/members', async (req, res, next) => {
  try {
    if (req.session.role !== 'admin') throw new AppError(403, 'Admin only');
    const tenantId = parseInt(req.params.id);
    const members = await tenantService.getMembers(tenantId);
    res.json({ success: true, data: members });
  } catch (err) {
    next(err);
  }
});

// POST /api/tenants/:id/members  { userId, role }
router.post('/:id/members', async (req, res, next) => {
  try {
    if (req.session.role !== 'admin') throw new AppError(403, 'Admin only');
    const tenantId = parseInt(req.params.id);
    const { userId, role } = req.body as { userId: number; role?: 'admin' | 'member' };
    if (!userId) throw new AppError(400, 'userId is required');
    await tenantService.addUser(tenantId, userId, role ?? 'member');
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// PUT /api/tenants/:id/members/:uid  { role }
router.put('/:id/members/:uid', async (req, res, next) => {
  try {
    if (req.session.role !== 'admin') throw new AppError(403, 'Admin only');
    const tenantId = parseInt(req.params.id);
    const userId = parseInt(req.params.uid);
    const { role } = req.body as { role: 'admin' | 'member' };
    if (!role) throw new AppError(400, 'role is required');
    await tenantService.updateUserRole(tenantId, userId, role);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/tenants/:id/members/:uid
router.delete('/:id/members/:uid', async (req, res, next) => {
  try {
    if (req.session.role !== 'admin') throw new AppError(403, 'Admin only');
    const tenantId = parseInt(req.params.id);
    const userId = parseInt(req.params.uid);
    await tenantService.removeUser(tenantId, userId);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ── Tenant metric-threshold default (cascade layer 3) ────────────────
// Scope: a tenant admin may edit only their own current tenant. The
// platform admin sitting on the master tenant may edit any tenant
// (their `currentTenantId` is the one being edited and the master
// god-view is implicit). We don't accept `:id` from the URL so a child
// tenant admin can't aim a payload at a sibling tenant — the row
// being edited is always `req.tenantId`.
router.get('/current/thresholds', async (req, res, next) => {
  try {
    const tenantId = req.tenantId!;
    const row = await db('tenants').where({ id: tenantId }).first('metric_thresholds_default') as { metric_thresholds_default: unknown } | undefined;
    let value: unknown = row?.metric_thresholds_default ?? null;
    if (typeof value === 'string') {
      try { value = JSON.parse(value); } catch { value = null; }
    }
    res.json({ success: true, data: { thresholds: value } });
  } catch (err) { next(err); }
});

router.put('/current/thresholds', async (req, res, next) => {
  try {
    if (req.session.role !== 'admin') throw new AppError(403, 'Admin only');
    const tenantId = req.tenantId!;
    const { metricThresholdsSchema } = await import('../validators/group.schema');
    const { thresholds } = req.body as { thresholds?: unknown };
    if (thresholds == null || (typeof thresholds === 'object' && Object.keys(thresholds as object).length === 0)) {
      await db('tenants').where({ id: tenantId }).update({ metric_thresholds_default: null });
      const { invalidateTenantThresholdCache } = await import('../services/threshold.service');
      invalidateTenantThresholdCache(tenantId);
      res.json({ success: true, data: { thresholds: null } });
      return;
    }
    const parsed = metricThresholdsSchema.safeParse(thresholds);
    if (!parsed.success) {
      const issues = parsed.error.errors.map((e) => `${e.path.join('.') || '<root>'}: ${e.message}`).join('; ');
      throw new AppError(400, `Invalid thresholds — ${issues}`);
    }
    await db('tenants').where({ id: tenantId }).update({ metric_thresholds_default: JSON.stringify(parsed.data) });
    const { invalidateTenantThresholdCache } = await import('../services/threshold.service');
    invalidateTenantThresholdCache(tenantId);
    res.json({ success: true, data: { thresholds: parsed.data } });
  } catch (err) { next(err); }
});

// ── Resolved tenant defaults (read-only) ────────────────────────────
// Used by the GroupEditPage so its `inheritedFrom` placeholder shows
// the effective values inherited at the tenant level. Mirrors what
// the threshold cascade resolves up to (but excluding) the group
// layer. Admin-only because it includes the global override.
router.get('/current/thresholds-resolved', async (req, res, next) => {
  try {
    const { thresholdService } = await import('../services/threshold.service');
    const resolved = await thresholdService.resolveForTenant(req.tenantId!);
    res.json({ success: true, data: resolved });
  } catch (err) { next(err); }
});

export default router;
