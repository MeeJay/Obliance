import { Router } from 'express';
import { deviceService } from '../services/device.service';
import { requireRole } from '../middleware/rbac';

const router = Router();

// GET /api/devices
router.get('/', async (req, res, next) => {
  try {
    const { groupId, status, approvalStatus, search } = req.query as any;
    const devices = await deviceService.getDevices(req.tenantId!, {
      groupId: groupId ? parseInt(groupId) : undefined,
      status, approvalStatus, search,
    });
    res.json(devices);
  } catch (err) { next(err); }
});

// GET /api/devices/summary
router.get('/summary', async (req, res, next) => {
  try {
    const summary = await deviceService.getFleetSummary(req.tenantId!);
    res.json(summary);
  } catch (err) { next(err); }
});

// GET /api/devices/:id
router.get('/:id', async (req, res, next) => {
  try {
    const device = await deviceService.getDeviceById(parseInt(req.params.id), req.tenantId!);
    if (!device) return res.status(404).json({ error: 'Device not found' });
    res.json(device);
  } catch (err) { next(err); }
});

// PATCH /api/devices/:id
router.patch('/:id', async (req, res, next) => {
  try {
    const device = await deviceService.updateDevice(parseInt(req.params.id), req.tenantId!, req.body);
    if (!device) return res.status(404).json({ error: 'Device not found' });
    res.json(device);
  } catch (err) { next(err); }
});

// POST /api/devices/:id/approve
router.post('/:id/approve', requireRole('admin'), async (req, res, next) => {
  try {
    const device = await deviceService.approveDevice(
      parseInt(req.params.id), req.tenantId!, req.session.userId!
    );
    res.json(device);
  } catch (err) { next(err); }
});

// POST /api/devices/:id/refuse
router.post('/:id/refuse', requireRole('admin'), async (req, res, next) => {
  try {
    const device = await deviceService.refuseDevice(parseInt(req.params.id), req.tenantId!);
    res.json(device);
  } catch (err) { next(err); }
});

// POST /api/devices/:id/suspend
router.post('/:id/suspend', requireRole('admin'), async (req, res, next) => {
  try {
    const device = await deviceService.suspendDevice(parseInt(req.params.id), req.tenantId!);
    if (!device) return res.status(404).json({ error: 'Device not found' });
    res.json(device);
  } catch (err) { next(err); }
});

// POST /api/devices/:id/unsuspend
router.post('/:id/unsuspend', requireRole('admin'), async (req, res, next) => {
  try {
    const device = await deviceService.unsuspendDevice(parseInt(req.params.id), req.tenantId!);
    if (!device) return res.status(404).json({ error: 'Device not found' });
    res.json(device);
  } catch (err) { next(err); }
});

// DELETE /api/devices/:id
router.delete('/:id', requireRole('admin'), async (req, res, next) => {
  try {
    await deviceService.deleteDevice(parseInt(req.params.id), req.tenantId!);
    res.status(204).send();
  } catch (err) { next(err); }
});

// POST /api/devices/bulk/approve
router.post('/bulk/approve', requireRole('admin'), async (req, res, next) => {
  try {
    const { ids } = req.body;
    await deviceService.bulkApprove(ids, req.tenantId!, req.session.userId!);
    res.json({ success: true, count: ids.length });
  } catch (err) { next(err); }
});

// POST /api/devices/bulk/delete
router.delete('/bulk/delete', requireRole('admin'), async (req, res, next) => {
  try {
    const { ids } = req.body;
    await deviceService.bulkDelete(ids, req.tenantId!);
    res.json({ success: true });
  } catch (err) { next(err); }
});

export default router;
