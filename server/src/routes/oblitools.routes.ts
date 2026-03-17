/**
 * ObliTools manifest endpoint.
 * GET /api/oblitools/manifest   (requires session auth)
 */

import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { requireAuth } from '../middleware/auth';
import { appConfigService } from '../services/appConfig.service';

const router = Router();

const SELF = { name: 'Obliance', color: '#8b5cf6' };

const LINKED: Record<string, { name: string; color: string }> = {
  obliview:  { name: 'Obliview',  color: '#6366f1' },
  obliguard: { name: 'Obliguard', color: '#f97316' },
  oblimap:   { name: 'Oblimap',   color: '#10b981' },
};

router.get('/manifest', requireAuth, async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const [ov, og, om] = await Promise.all([
      appConfigService.getObliviewRaw(),
      appConfigService.getObliguardRaw(),
      appConfigService.getOblimapRaw(),
    ]);

    type LinkedApp = { name: string; url: string; color: string };
    const linkedApps: LinkedApp[] = [];
    if (ov?.url) linkedApps.push({ ...LINKED.obliview,  url: ov.url });
    if (og?.url) linkedApps.push({ ...LINKED.obliguard, url: og.url });
    if (om?.url) linkedApps.push({ ...LINKED.oblimap,   url: om.url });

    res.json({
      success: true,
      data: {
        ...SELF,
        ssoPath: '/api/sso/generate-token',
        linkedApps,
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
