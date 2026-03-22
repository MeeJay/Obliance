import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { appConfigService } from '../services/appConfig.service';
import { db } from '../db';

const router = Router();

/**
 * GET /api/obliance/link?uuid={uuid}
 *
 * Called by other Obli* apps (server-side proxy) to look up a device
 * by its machine UUID and return the Obliance page path for that device.
 *
 * Auth: Bearer token — must match the Obligate API key.
 */
router.get('/link', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const auth = req.headers.authorization ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!token) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    // Accept the Obligate API key
    const raw = await appConfigService.getObligateRaw();
    if (!raw.apiKey || token !== raw.apiKey) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const { uuid } = req.query as { uuid?: string };
    if (!uuid) {
      res.status(400).json({ success: false, error: 'uuid is required' });
      return;
    }

    const device = await db('devices')
      .where({ uuid })
      .select('id')
      .first() as { id: number } | undefined;

    if (!device) {
      res.status(404).json({ success: false, error: 'Not found' });
      return;
    }

    res.json({ success: true, data: { path: `/devices/${device.id}` } });
  } catch (err) {
    next(err);
  }
});

export default router;
