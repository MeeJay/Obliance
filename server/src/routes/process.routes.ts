import { Router } from 'express';
import { requireDeviceWriteParam } from '../middleware/rbac';
import { commandService } from '../services/command.service';

const router = Router();

// Kill a process on a device (requires device write permission)
router.post('/:deviceId/kill', requireDeviceWriteParam('deviceId'), async (req, res, next) => {
  try {
    const deviceId = Number(req.params.deviceId);
    const { pid, name } = req.body;
    if (!pid || typeof pid !== 'number') {
      return res.status(400).json({ error: 'pid is required (number)' });
    }
    const cmd = await commandService.enqueue({
      deviceId,
      tenantId: req.tenantId!,
      type: 'kill_process',
      payload: { pid, name: name ?? '' },
      priority: 'high',
      expiresInSeconds: 30,
      createdBy: (req as any).user?.id ?? null,
    });
    res.json({ data: cmd });
  } catch (err) { next(err); }
});

export default router;
