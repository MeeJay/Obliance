import { Router } from 'express';
import { inventoryService } from '../services/inventory.service';

const router = Router();

router.get('/device/:deviceId/hardware', async (req, res, next) => {
  try {
    const hw = await inventoryService.getHardware(parseInt(req.params.deviceId));
    if (!hw) return res.status(404).json({ error: 'No hardware inventory' });
    res.json(hw);
  } catch (err) { next(err); }
});

router.get('/device/:deviceId/software', async (req, res, next) => {
  try {
    const sw = await inventoryService.getSoftware(
      parseInt(req.params.deviceId), req.query.search as string
    );
    res.json(sw);
  } catch (err) { next(err); }
});

router.post('/device/:deviceId/scan', async (req, res, next) => {
  try {
    const cmd = await inventoryService.triggerScan(
      parseInt(req.params.deviceId), req.tenantId!, req.session.userId!
    );
    res.json(cmd);
  } catch (err) { next(err); }
});

export default router;
