import { Router } from 'express';
import { updateService } from '../services/update.service';
import { requireDeviceWriteParam } from '../middleware/rbac';
import { permissionService } from '../services/permission.service';
import { AppError } from '../middleware/errorHandler';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const { status, severity, deviceId } = req.query as any;

    // Permission check: if filtering by specific device, check read access
    if (deviceId && req.session.role !== 'admin') {
      const canRead = await permissionService.canReadDevice(req.session.userId!, parseInt(deviceId), false);
      if (!canRead) throw new AppError(403, 'Insufficient permissions');
    }

    const items = await updateService.getTenantUpdates(req.tenantId!, {
      status, severity, deviceId: deviceId ? parseInt(deviceId) : undefined,
    });

    // Filter by visible devices for non-admins when no specific device filter
    if (!deviceId && req.session.role !== 'admin') {
      const visibleIds = await permissionService.getVisibleDeviceIds(req.session.userId!, false);
      if (Array.isArray(visibleIds)) {
        const filtered = items.filter((item: any) => visibleIds.includes(item.device_id));
        return res.json({ data: { items: filtered, total: filtered.length } });
      }
    }

    res.json({ data: { items, total: items.length } });
  } catch (err) { next(err); }
});

router.get('/stats', async (req, res, next) => {
  try {
    const stats = await updateService.getUpdateStats(req.tenantId!);
    res.json({ data: stats });
  } catch (err) { next(err); }
});

router.get('/policies', async (req, res, next) => {
  try {
    const policies = await updateService.getPolicies(req.tenantId!);
    res.json({ data: policies });
  } catch (err) { next(err); }
});

router.post('/policies', async (req, res, next) => {
  try {
    const policy = await updateService.createPolicy(req.tenantId!, {
      ...req.body, createdBy: req.session.userId,
    });
    res.status(201).json({ data: policy });
  } catch (err) { next(err); }
});

router.delete('/policies/:id', async (req, res, next) => {
  try {
    await updateService.deletePolicy(parseInt(req.params.id), req.tenantId!);
    res.status(204).send();
  } catch (err) { next(err); }
});

router.post('/device/:deviceId/approve', requireDeviceWriteParam('deviceId'), async (req, res, next) => {
  try {
    const { updateId, severities } = req.body;
    if (updateId) {
      await updateService.approveUpdate(updateId, req.tenantId!, req.session.userId!);
    } else if (severities) {
      await updateService.approveByDeviceAndSeverity(
        parseInt(req.params.deviceId), req.tenantId!, severities, req.session.userId!
      );
    }
    res.json({ success: true });
  } catch (err) { next(err); }
});

router.post('/device/:deviceId/deploy', requireDeviceWriteParam('deviceId'), async (req, res, next) => {
  try {
    const updates = await updateService.deployApprovedUpdates(
      parseInt(req.params.deviceId), req.tenantId!, req.session.userId!
    );
    res.json({ dispatched: updates.length });
  } catch (err) { next(err); }
});

// Retry a failed/installed update — resets status to approved and re-enqueues install command
router.post('/device/:deviceId/retry/:updateId', requireDeviceWriteParam('deviceId'), async (req, res, next) => {
  try {
    const deviceId = parseInt(req.params.deviceId);
    const updateId = parseInt(req.params.updateId);
    const result = await updateService.retryUpdate(deviceId, updateId, req.tenantId!, req.session.userId!);
    res.json({ data: result });
  } catch (err) { next(err); }
});

router.post('/device/:deviceId/scan', requireDeviceWriteParam('deviceId'), async (req, res, next) => {
  try {
    const cmd = await updateService.triggerUpdateScan(
      parseInt(req.params.deviceId), req.tenantId!, req.session.userId!
    );
    res.json({ data: cmd });
  } catch (err) { next(err); }
});

// Alias matching client URL: POST /updates/scan/:deviceId
router.post('/scan/:deviceId', requireDeviceWriteParam('deviceId'), async (req, res, next) => {
  try {
    const cmd = await updateService.triggerUpdateScan(
      parseInt(req.params.deviceId), req.tenantId!, req.session.userId!
    );
    res.json({ data: cmd });
  } catch (err) { next(err); }
});

export default router;
