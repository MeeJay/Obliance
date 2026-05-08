import { Router } from 'express';
import { groupsController } from '../controllers/groups.controller';
import { requireAuth } from '../middleware/auth';
import { requireRole, requireGroupWrite, requireCanCreate } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import {
  createGroupSchema,
  updateGroupSchema,
  moveGroupSchema,
} from '../validators/group.schema';

const router = Router();

// All routes require authentication
router.use(requireAuth);

// Read routes (visibility filtering in controller)
router.get('/', groupsController.list);
router.get('/tree', groupsController.tree);
router.get('/stats', groupsController.stats);
router.get('/:id', groupsController.getById);
// Resolved threshold cascade up to the group layer — used by
// DeviceDetailPage so the per-device override editor's placeholder
// shows what the device WOULD inherit if its override were cleared.
router.get('/:id/thresholds-resolved', async (req, res, next) => {
  try {
    const { thresholdService } = await import('../services/threshold.service');
    const groupId = parseInt(req.params.id, 10);
    if (!Number.isFinite(groupId)) return res.status(400).json({ success: false, error: 'Invalid group id' });
    const resolved = await thresholdService.resolveForGroup(groupId, req.tenantId!);
    res.json({ success: true, data: resolved });
  } catch (err) { next(err); }
});


// Write routes (permission-based: admin OR team RW)
router.post('/', requireCanCreate(), validate(createGroupSchema), groupsController.create);
router.put('/:id', requireGroupWrite(), validate(updateGroupSchema), groupsController.update);
router.post('/reorder', requireRole('admin'), groupsController.reorder);
router.post('/:id/move', requireGroupWrite(), validate(moveGroupSchema), groupsController.move);
router.delete('/:id', requireGroupWrite(), groupsController.delete);

router.patch('/:id/agent-config', requireRole('admin'), groupsController.updateAgentGroupConfig);

export default router;
