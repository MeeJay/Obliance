import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { tenantService } from '../services/tenant.service';
import { AppError } from '../middleware/errorHandler';

const router = Router();

// All tenant routes require auth
router.use(requireAuth);

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
    const { name, slug } = req.body as { name?: string; slug?: string };
    const tenant = await tenantService.update(id, { name, slug });
    if (!tenant) throw new AppError(404, 'Tenant not found');
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

export default router;
