import { Router } from 'express';
import { usersController } from '../controllers/users.controller';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import {
  createUserSchema,
  updateUserSchema,
  changePasswordSchema,
} from '../validators/user.schema';

const router = Router();

router.use(requireAuth);
router.use(requireRole('admin'));

router.get('/', usersController.list);
router.get('/:id', usersController.getById);
router.post('/', validate(createUserSchema), usersController.create);
router.put('/:id', validate(updateUserSchema), usersController.update);
router.put('/:id/password', validate(changePasswordSchema), usersController.changePassword);
router.delete('/:id', usersController.delete);

// Team membership listing
router.get('/:id/teams', usersController.getTeams);

// Tenant assignment management
router.get('/:id/tenants', usersController.getTenants);
router.put('/:id/tenants', usersController.setTenants);

export default router;
