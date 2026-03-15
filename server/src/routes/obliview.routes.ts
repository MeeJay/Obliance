import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { requireAuth } from '../middleware/auth';
import { appConfigService } from '../services/appConfig.service';

const router = Router();

/**
 * GET /api/obliview/proxy-link?uuid={uuid}
 *
 * Called by Obliance's client (session auth) to look up a device in Obliview.
 * Server proxies the request using the stored API key.
 */
router.get('/proxy-link', requireAuth, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const cfg = await appConfigService.getObliviewRaw();
    if (!cfg?.url || !cfg.apiKey) {
      res.json({ success: true, data: { obliviewUrl: null } });
      return;
    }

    const { uuid } = req.query as { uuid?: string };
    if (!uuid) {
      res.status(400).json({ success: false, error: 'uuid is required' });
      return;
    }

    const base = cfg.url.replace(/\/$/, '');
    const lookupUrl = `${base}/api/obliance/link?uuid=${encodeURIComponent(uuid)}`;

    let fetchRes: Awaited<ReturnType<typeof fetch>>;
    try {
      fetchRes = await fetch(lookupUrl, {
        headers: { Authorization: `Bearer ${cfg.apiKey}` },
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      res.json({ success: true, data: { obliviewUrl: null } });
      return;
    }

    if (!fetchRes.ok) {
      res.json({ success: true, data: { obliviewUrl: null } });
      return;
    }

    const body = await fetchRes.json() as { success: boolean; data?: { path: string } };
    if (!body.success || !body.data?.path) {
      res.json({ success: true, data: { obliviewUrl: null } });
      return;
    }

    res.json({ success: true, data: { obliviewUrl: `${base}${body.data.path}` } });
  } catch (err) {
    next(err);
  }
});

export default router;
