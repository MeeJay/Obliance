import { Router } from 'express';
import { settingsController } from '../controllers/settings.controller';
import { requireAuth } from '../middleware/auth';
import { requireTenantCapability } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import { setSettingSchema, setSettingsBulkSchema } from '../validators/settings.schema';

const router = Router();

router.use(requireAuth);

// Read resolved settings (admin only for now)
router.get('/global/resolved', requireTenantCapability('settings'), settingsController.getGlobalResolved);
router.get('/group/:scopeId/resolved', requireTenantCapability('settings'), settingsController.getGroupResolved);
router.get('/device/:scopeId/resolved', requireTenantCapability('settings'), settingsController.getDeviceResolved);

// Write settings (admin only)
router.put('/:scope/:scopeId', requireTenantCapability('settings'), validate(setSettingSchema), settingsController.set);
router.put('/:scope/:scopeId/bulk', requireTenantCapability('settings'), validate(setSettingsBulkSchema), settingsController.setBulk);
router.delete('/:scope/:scopeId/:key', requireTenantCapability('settings'), settingsController.remove);

export default router;
