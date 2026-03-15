import { Router } from 'express';
import { appConfigController } from '../controllers/appConfig.controller';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { appConfigService } from '../services/appConfig.service';

const router = Router();

// GET is available to all authenticated users (needed for profile page to check allow_2fa)
router.get('/', requireAuth, appConfigController.getAll);

// Agent global defaults — admin only (specific routes BEFORE the /:key wildcard)
router.get('/agent-global', requireAuth, requireRole('admin'), appConfigController.getAgentGlobal);
router.patch('/agent-global', requireAuth, requireRole('admin'), appConfigController.patchAgentGlobal);

// ── SSO integration configs (specific routes BEFORE the /:key wildcard) ──────

// Obliview integration config
router.get('/obliview', requireAuth, requireRole('admin'), async (req, res, next) => {
  try { res.json({ success: true, data: await appConfigService.getObliviewConfig() }); } catch (e) { next(e); }
});
router.put('/obliview', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const { url, apiKey } = req.body as { url?: string | null; apiKey?: string | null };
    const data = await appConfigService.patchObliviewConfig({ url, apiKey });
    res.json({ success: true, data });
  } catch (e) { next(e); }
});

// Obliguard integration config
router.get('/obliguard', requireAuth, requireRole('admin'), async (req, res, next) => {
  try { res.json({ success: true, data: await appConfigService.getObliguardConfig() }); } catch (e) { next(e); }
});
router.put('/obliguard', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const { url, apiKey } = req.body as { url?: string | null; apiKey?: string | null };
    const data = await appConfigService.patchObliguardConfig({ url, apiKey });
    res.json({ success: true, data });
  } catch (e) { next(e); }
});

// Oblimap integration config
router.get('/oblimap', requireAuth, requireRole('admin'), async (req, res, next) => {
  try { res.json({ success: true, data: await appConfigService.getOblimapConfig() }); } catch (e) { next(e); }
});
router.put('/oblimap', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const { url, apiKey } = req.body as { url?: string | null; apiKey?: string | null };
    const data = await appConfigService.patchOblimapConfig({ url, apiKey });
    res.json({ success: true, data });
  } catch (e) { next(e); }
});

// ── Generic key/value setter (LAST — wildcard must not shadow specific routes above) ──
router.put('/:key', requireAuth, requireRole('admin'), appConfigController.set);

export default router;
