import { Router } from 'express';
import { smtpServerController } from '../controllers/smtpServer.controller';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';

const router = Router();

router.use(requireAuth, requireRole('admin'));

router.get('/', smtpServerController.list);
router.post('/', smtpServerController.create);
router.put('/:id', smtpServerController.update);
router.delete('/:id', smtpServerController.delete);
router.post('/:id/test', smtpServerController.test);

export default router;
