import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { maintenanceController } from '../controllers/maintenance.controller';

const router = Router();

router.use(requireAuth);
router.use(requireRole('admin'));

// Collection routes
router.get('/', maintenanceController.list);
router.post('/', maintenanceController.create);

// Specific named routes before generic /:id to avoid param conflicts
router.get('/effective/:type/:id', maintenanceController.getEffective);
router.post('/:id/disable', maintenanceController.disable);
router.delete('/:id/disable', maintenanceController.enable);

// Generic /:id routes last
router.get('/:id', maintenanceController.getById);
router.put('/:id', maintenanceController.update);
router.delete('/:id', maintenanceController.delete);

export default router;
