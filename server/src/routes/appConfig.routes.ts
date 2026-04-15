import { Router } from 'express';
import { appConfigController } from '../controllers/appConfig.controller';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';

const router = Router();

// GET is available to all authenticated users (needed for profile page to check allow_2fa)
router.get('/', requireAuth, appConfigController.getAll);

// Specific named routes MUST come before /:key (otherwise /:key captures them first)

// Agent global defaults — admin only
router.get('/agent-global', requireAuth, requireRole('admin'), appConfigController.getAgentGlobal);
router.patch('/agent-global', requireAuth, requireRole('admin'), appConfigController.patchAgentGlobal);

// Obligate SSO gateway config — admin only
router.get('/obligate', requireAuth, requireRole('admin'), appConfigController.getObligateConfig);
router.put('/obligate', requireAuth, requireRole('admin'), appConfigController.setObligateConfig);

// File explorer editable extensions — read by all auth'd users (needed
// by the file explorer UI), write admin only. Cross-tenant global setting.
router.get('/editable-extensions', requireAuth, appConfigController.getEditableExtensions);
router.put('/editable-extensions', requireAuth, requireRole('admin'), appConfigController.setEditableExtensions);

// Generic key setter — must be LAST among PUT routes
router.put('/:key', requireAuth, requireRole('admin'), appConfigController.set);

export default router;
