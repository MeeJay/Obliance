import { Router, type Request, type Response, type NextFunction } from 'express';
import { appConfigController } from '../controllers/appConfig.controller';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';

const router = Router();

// Middleware used on every WRITE to tenant settings. Consults the action
// restriction policy and either lets the request through, requires a
// fresh TOTP code, or routes it to a pending approval.
async function gateSettingsWrite(req: Request, res: Response, next: NextFunction) {
  try {
    const { applyRestriction } = await import('../services/restriction.service');
    const approved = await applyRestriction(res, {
      req,
      actionKey: 'tenant.manage_settings',
      approvalRequestType: 'batch_command',
      approvalDescription: `Update tenant settings (${req.method} ${req.path})`,
      approvalPayload: { action: 'settings_update', path: req.path, method: req.method },
    });
    if (!approved) return; // response already written by applyRestriction
    next();
  } catch (err) { next(err); }
}

// GET is available to all authenticated users (needed for profile page to check allow_2fa)
router.get('/', requireAuth, appConfigController.getAll);

// Specific named routes MUST come before /:key (otherwise /:key captures them first)

// Agent global defaults — admin only
router.get('/agent-global', requireAuth, requireRole('admin'), appConfigController.getAgentGlobal);
router.patch('/agent-global', requireAuth, requireRole('admin'), gateSettingsWrite, appConfigController.patchAgentGlobal);

// Obligate SSO gateway config — admin only
router.get('/obligate', requireAuth, requireRole('admin'), appConfigController.getObligateConfig);
router.put('/obligate', requireAuth, requireRole('admin'), gateSettingsWrite, appConfigController.setObligateConfig);

// File explorer editable extensions — read by all auth'd users (needed
// by the file explorer UI), write admin only. Cross-tenant global setting.
router.get('/editable-extensions', requireAuth, appConfigController.getEditableExtensions);
router.put('/editable-extensions', requireAuth, requireRole('admin'), gateSettingsWrite, appConfigController.setEditableExtensions);

// Generic key setter — must be LAST among PUT routes
router.put('/:key', requireAuth, requireRole('admin'), gateSettingsWrite, appConfigController.set);

export default router;
