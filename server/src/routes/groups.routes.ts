import { Router } from 'express';
import { groupsController } from '../controllers/groups.controller';
import { requireAuth } from '../middleware/auth';
import { requireTenantCapability, requireGroupWrite, requireCanCreate } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import { isMasterTenant } from '@obliance/shared';
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
// Resolved threshold cascade for a group, with the origin (layer + name)
// of every value. `?scope=parent` leaves the group's own values out: what
// the group inherits (group editor: placeholders + greyed alerts switch).
// Without it: what a device of the group inherits. Uses the GROUP's tenant
// layer (master god view editing a child tenant's group). Same read gate
// as GET /groups/:id — group names of the ancestor chain are returned.
router.get('/:id/thresholds-resolved', async (req, res, next) => {
  try {
    const groupId = parseInt(req.params.id, 10);
    if (!Number.isFinite(groupId)) return res.status(400).json({ success: false, error: 'Invalid group id' });
    const { groupService } = await import('../services/group.service');
    const group = await groupService.getById(groupId);
    if (!group || (!isMasterTenant(req.tenantId!) && group.tenantId !== req.tenantId)) {
      return res.status(404).json({ success: false, error: 'Group not found' });
    }
    if (req.session.role !== 'admin') {
      const { permissionService } = await import('../services/permission.service');
      const canRead = await permissionService.canReadGroup(req.session.userId!, groupId, false);
      if (!canRead) return res.status(403).json({ success: false, error: 'Access denied' });
    }
    const { thresholdService } = await import('../services/threshold.service');
    const resolved = await thresholdService.resolveForGroup(groupId, { includeSelf: req.query.scope !== 'parent' });
    if (!resolved) return res.status(404).json({ success: false, error: 'Group not found' });
    res.json({ success: true, data: resolved });
  } catch (err) { next(err); }
});


// Write routes (permission-based: admin OR team RW)
router.post('/', requireCanCreate(), validate(createGroupSchema), groupsController.create);
router.put('/:id', requireGroupWrite(), validate(updateGroupSchema), groupsController.update);
router.post('/reorder', requireTenantCapability('groups.manage'), groupsController.reorder);
router.post('/:id/move', requireGroupWrite(), validate(moveGroupSchema), groupsController.move);
router.delete('/:id', requireGroupWrite(), groupsController.delete);

router.patch('/:id/agent-config', requireTenantCapability('groups.manage'), groupsController.updateAgentGroupConfig);

export default router;
