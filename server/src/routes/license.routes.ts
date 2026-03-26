import { Router } from 'express';
import { licenseService } from '../services/license.service';
import { requireDeviceRead, requireDeviceWriteParam } from '../middleware/rbac';

const router = Router();

// GET /licenses — tenant-wide listing
router.get('/', async (req, res, next) => {
  try {
    const items = await licenseService.listAll(req.tenantId!);
    res.json({ data: items });
  } catch (err) { next(err); }
});

// GET /licenses/device/:deviceId — per device
router.get('/device/:deviceId', requireDeviceRead('deviceId'), async (req, res, next) => {
  try {
    const items = await licenseService.listForDevice(parseInt(req.params.deviceId), req.tenantId!);
    res.json({ data: items });
  } catch (err) { next(err); }
});

// POST /licenses/device/:deviceId — create
router.post('/device/:deviceId', requireDeviceWriteParam('deviceId'), async (req, res, next) => {
  try {
    const license = await licenseService.create(parseInt(req.params.deviceId), req.tenantId!, req.body);
    res.status(201).json({ data: license });
  } catch (err) { next(err); }
});

// PATCH /licenses/:id — update (check tenant ownership inside)
router.patch('/:id', async (req, res, next) => {
  try {
    const license = await licenseService.update(parseInt(req.params.id), req.tenantId!, req.body);
    if (!license) return res.status(404).json({ error: 'License not found' });
    res.json({ data: license });
  } catch (err) { next(err); }
});

// DELETE /licenses/:id — delete (check tenant ownership inside)
router.delete('/:id', async (req, res, next) => {
  try {
    const deleted = await licenseService.delete(parseInt(req.params.id), req.tenantId!);
    if (!deleted) return res.status(404).json({ error: 'License not found' });
    res.status(204).send();
  } catch (err) { next(err); }
});

export default router;
