import { Router } from 'express';
import { settingsController } from '../controllers/settings.controller';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import { setSettingSchema, setSettingsBulkSchema } from '../validators/settings.schema';

const router = Router();

router.use(requireAuth);

// Read resolved settings (admin only for now)
router.get('/global/resolved', requireRole('admin'), settingsController.getGlobalResolved);
router.get('/group/:scopeId/resolved', requireRole('admin'), settingsController.getGroupResolved);
router.get('/device/:scopeId/resolved', requireRole('admin'), settingsController.getDeviceResolved);

// Write settings (admin only)
router.put('/:scope/:scopeId', requireRole('admin'), validate(setSettingSchema), settingsController.set);
router.put('/:scope/:scopeId/bulk', requireRole('admin'), validate(setSettingsBulkSchema), settingsController.setBulk);
router.delete('/:scope/:scopeId/:key', requireRole('admin'), settingsController.remove);

export default router;
