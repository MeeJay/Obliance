import { Router } from 'express';
import { inventoryService } from '../services/inventory.service';

const router = Router();

router.get('/:deviceId/hardware', async (req, res, next) => {
  try {
    const hw = await inventoryService.getHardware(parseInt(req.params.deviceId));
    if (!hw) return res.status(404).json({ error: 'No hardware inventory' });
    res.json({ data: hw });
  } catch (err) { next(err); }
});

router.get('/:deviceId/software', async (req, res, next) => {
  try {
    const items = await inventoryService.getSoftware(
      parseInt(req.params.deviceId), req.query.search as string
    );
    res.json({ data: { items, total: items.length } });
  } catch (err) { next(err); }
});

router.post('/:deviceId/scan', async (req, res, next) => {
  try {
    const cmd = await inventoryService.triggerScan(
      parseInt(req.params.deviceId), req.tenantId!, req.session.userId!
    );
    res.json({ data: cmd });
  } catch (err) { next(err); }
});

export default router;
