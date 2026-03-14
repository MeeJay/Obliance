import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { importExportController } from '../controllers/importExport.controller';

const router = Router();

// All import/export routes are admin-only
router.use(requireAuth);
router.use(requireRole('admin'));

router.get('/export', importExportController.exportData);
router.post('/import', importExportController.importData);

export default router;
