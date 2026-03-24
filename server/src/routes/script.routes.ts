import { Router } from 'express';
import { scriptService } from '../services/script.service';
import { scheduleService } from '../services/schedule.service';
import { requireRole } from '../middleware/rbac';
import { permissionService } from '../services/permission.service';
import { AppError } from '../middleware/errorHandler';
import { db } from '../db';

const router = Router();

// GET /api/scripts
router.get('/', async (req, res, next) => {
  try {
    const { platform, categoryId, search, scriptType, availableInReach } = req.query as any;
    const scripts = await scriptService.getScripts(req.tenantId!, {
      platform, categoryId: categoryId ? parseInt(categoryId) : undefined, search, scriptType,
      availableInReach: availableInReach === 'true',
    });
    res.json(scripts);
  } catch (err) { next(err); }
});

// GET /api/scripts/categories
router.get('/categories', async (req, res, next) => {
  try {
    const categories = await scriptService.getCategories(req.tenantId!);
    res.json(categories);
  } catch (err) { next(err); }
});

// GET /api/scripts/:id
router.get('/:id', async (req, res, next) => {
  try {
    const script = await scriptService.getScriptById(parseInt(req.params.id), req.tenantId!);
    if (!script) return res.status(404).json({ error: 'Script not found' });
    res.json(script);
  } catch (err) { next(err); }
});

// POST /api/scripts (admin only)
router.post('/', requireRole('admin'), async (req, res, next) => {
  try {
    const script = await scriptService.createScript(req.tenantId!, {
      ...req.body, createdBy: req.session.userId,
    });
    res.status(201).json(script);
  } catch (err) { next(err); }
});

// PUT/PATCH /api/scripts/:id (admin only)
router.put('/:id', requireRole('admin'), async (req, res, next) => {
  return handleScriptUpdate(req, res, next);
});
router.patch('/:id', requireRole('admin'), async (req, res, next) => {
  return handleScriptUpdate(req, res, next);
});
async function handleScriptUpdate(req: any, res: any, next: any) {
  try {
    const scriptId = parseInt(req.params.id);
    const existing = await scriptService.getScriptById(scriptId, req.tenantId!);
    if (!existing) return res.status(404).json({ error: 'Script not found' });

    if (existing.scriptType === 'system') {
      if (req.session.role !== 'admin') {
        return res.status(403).json({ error: 'Only admins can edit system scripts' });
      }
      const script = await scriptService.updateSystemScript(scriptId, {
        ...req.body, updatedBy: req.session.userId,
      });
      if (!script) return res.status(404).json({ error: 'Script not found' });
      return res.json(script);
    }

    const script = await scriptService.updateScript(scriptId, req.tenantId!, {
      ...req.body, updatedBy: req.session.userId,
    });
    if (!script) return res.status(404).json({ error: 'Script not found' });
    res.json(script);
  } catch (err) { next(err); }
}

// DELETE /api/scripts/:id (admin only)
router.delete('/:id', requireRole('admin'), async (req, res, next) => {
  try {
    await scriptService.deleteScript(parseInt(req.params.id), req.tenantId!);
    res.status(204).send();
  } catch (err) { next(err); }
});

// POST /api/scripts/:id/execute
router.post('/:id/execute', async (req, res, next) => {
  try {
    const { deviceIds: rawDeviceIds, targetType, targetIds, parameterValues } = req.body;

    // Resolve device IDs from targetType/targetIds or raw deviceIds
    let deviceIds: number[] = rawDeviceIds ?? [];

    if (targetType === 'all') {
      const devices = await db('devices').where({ tenant_id: req.tenantId!, approval_status: 'approved' })
        .whereIn('status', ['online', 'offline']).pluck('id');
      deviceIds = devices;
    } else if (targetType === 'group' && targetIds?.length) {
      const descendants = await db('device_group_closure')
        .whereIn('ancestor_id', targetIds)
        .pluck('descendant_id');
      const allGroupIds = [...new Set([...targetIds, ...descendants])];
      const devices = await db('devices')
        .where({ tenant_id: req.tenantId!, approval_status: 'approved' })
        .whereIn('status', ['online', 'offline'])
        .whereIn('group_id', allGroupIds)
        .pluck('id');
      deviceIds = devices;
    }

    if (!deviceIds.length) return res.status(400).json({ error: 'No target devices found' });

    // Permission check: user must have write access to all target devices
    if (req.session.role !== 'admin') {
      for (const did of deviceIds) {
        const canWrite = await permissionService.canWriteDevice(req.session.userId!, did, false);
        if (!canWrite) throw new AppError(403, 'Insufficient permissions');
      }
    }

    const executions = await scheduleService.executeNow(
      parseInt(req.params.id), deviceIds, req.tenantId!,
      parameterValues || {}, req.session.userId!
    );
    res.status(202).json({ data: executions });
  } catch (err) { next(err); }
});

export default router;
