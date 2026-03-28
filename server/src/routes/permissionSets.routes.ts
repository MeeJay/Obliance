import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { permissionSetService } from '../services/permissionSet.service';
import { logger } from '../utils/logger';

const router = Router();

// All routes require authentication
router.use(requireAuth);

/** GET /api/permission-sets — list all permission sets */
router.get('/', async (_req: Request, res: Response) => {
  try {
    const sets = await permissionSetService.getAll();
    res.json({ success: true, data: sets });
  } catch (err) {
    logger.error(err, 'Failed to list permission sets');
    res.status(500).json({ success: false, error: 'Failed to list permission sets' });
  }
});

/** GET /api/permission-sets/capabilities — list available capabilities */
router.get('/capabilities', async (_req: Request, res: Response) => {
  try {
    const capabilities = permissionSetService.getAvailableCapabilities();
    res.json({ success: true, data: capabilities });
  } catch (err) {
    logger.error(err, 'Failed to list capabilities');
    res.status(500).json({ success: false, error: 'Failed to list capabilities' });
  }
});

/** POST /api/permission-sets — create a custom permission set (admin only) */
router.post('/', requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const { name, slug, capabilities } = req.body as { name?: string; slug?: string; capabilities?: string[] };
    if (!name || !slug || !capabilities) {
      res.status(400).json({ success: false, error: 'Missing required fields: name, slug, capabilities' });
      return;
    }
    const created = await permissionSetService.create({ name, slug, capabilities });
    res.status(201).json({ success: true, data: created });
  } catch (err: any) {
    if (err?.code === '23505') {
      res.status(409).json({ success: false, error: 'A permission set with this slug already exists' });
      return;
    }
    logger.error(err, 'Failed to create permission set');
    res.status(500).json({ success: false, error: 'Failed to create permission set' });
  }
});

/** PUT /api/permission-sets/:id — update a permission set (admin only) */
router.put('/:id', requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      res.status(400).json({ success: false, error: 'Invalid id' });
      return;
    }
    const { name, capabilities } = req.body as { name?: string; capabilities?: string[] };
    const updated = await permissionSetService.update(id, { name, capabilities });
    if (!updated) {
      res.status(404).json({ success: false, error: 'Permission set not found' });
      return;
    }
    res.json({ success: true, data: updated });
  } catch (err) {
    logger.error(err, 'Failed to update permission set');
    res.status(500).json({ success: false, error: 'Failed to update permission set' });
  }
});

/** DELETE /api/permission-sets/:id — delete a non-default permission set (admin only) */
router.delete('/:id', requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      res.status(400).json({ success: false, error: 'Invalid id' });
      return;
    }
    const result = await permissionSetService.delete(id);
    if (!result.success) {
      res.status(400).json({ success: false, error: result.error });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    logger.error(err, 'Failed to delete permission set');
    res.status(500).json({ success: false, error: 'Failed to delete permission set' });
  }
});

export default router;
