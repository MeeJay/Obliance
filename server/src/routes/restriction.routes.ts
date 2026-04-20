import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { restrictionService, RESTRICTABLE_ACTIONS } from '../services/restriction.service';
import { auditService } from '../services/audit.service';

const router = Router();

router.use(requireAuth, requireRole('admin'));

// GET /api/restrictions — tenant's current action map + the canonical
// actions catalog so the UI can render unknown keys last.
router.get('/', async (req, res, next) => {
  try {
    const map = await restrictionService.getMap(req.tenantId!);
    res.json({ data: { map, actions: RESTRICTABLE_ACTIONS } });
  } catch (err) { next(err); }
});

// PUT /api/restrictions — replace the whole map (simpler than PATCH per key
// and matches how the UI edits a whole matrix form at once).
router.put('/', async (req, res, next) => {
  try {
    const incoming = req.body?.map ?? {};
    await restrictionService.setMap(req.tenantId!, incoming);
    await auditService.logReq(req, 'restrictions.updated', {
      resourceType: 'restrictions',
      resourcePath: 'tenant',
      details: { keys: Object.keys(incoming) },
    });
    const map = await restrictionService.getMap(req.tenantId!);
    res.json({ data: { map, actions: RESTRICTABLE_ACTIONS } });
  } catch (err) { next(err); }
});

export default router;
