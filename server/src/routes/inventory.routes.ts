import { Router, Request, Response, NextFunction } from 'express';
import { inventoryService } from '../services/inventory.service';
import { permissionService } from '../services/permission.service';
import { AppError } from '../middleware/errorHandler';

const router = Router();

// All inventory routes require read access to the device
router.param('deviceId', async (req: Request, _res: Response, next: NextFunction, val: string) => {
  if (req.session?.role === 'admin') return next();
  const deviceId = parseInt(val, 10);
  if (isNaN(deviceId)) return next();
  const canRead = await permissionService.canReadDevice(req.session.userId!, deviceId, false);
  if (!canRead) return next(new AppError(403, 'Insufficient permissions'));
  next();
});

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
