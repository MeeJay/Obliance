/**
 * ObliTools manifest endpoint.
 * Called by the ObliTools desktop app after login to discover:
 *   - This app's display name, color, and SSO token path
 *   - All configured linked apps via Obligate (for tab creation)
 *
 * GET /api/oblitools/manifest   (requires session auth)
 */

import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { requireAuth } from '../middleware/auth';
import { obligateService } from '../services/obligate.service';

const router = Router();

const SELF = { name: 'Obliance', color: '#8b5cf6' };

router.get('/manifest', requireAuth, async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Fetch linked apps from Obligate (replaces hardcoded obliview/obliguard/oblimap configs)
    const apps = await obligateService.getConnectedApps();

    type LinkedApp = { name: string; url: string; color: string };
    const linkedApps: LinkedApp[] = apps
      .filter(a => a.appType !== 'obliance')
      .map(a => ({ name: a.name, url: a.baseUrl, color: a.color ?? '#8b5cf6' }));

    res.json({
      success: true,
      data: {
        ...SELF,
        ssoPath: '/auth/sso-redirect',
        linkedApps,
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
