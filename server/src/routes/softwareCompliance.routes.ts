import { Router } from 'express';
import { softwareComplianceService } from '../services/softwareCompliance.service';
import { requireRole, requireDeviceWriteParam, requireDeviceRead } from '../middleware/rbac';
import { permissionService } from '../services/permission.service';
import { AppError } from '../middleware/errorHandler';

const router = Router();

// GET /software-compliance/known-apps?osType=windows
router.get('/known-apps', async (req, res, next) => {
  try {
    const osType = req.query.osType as string | undefined;
    const apps = await softwareComplianceService.getKnownApps(req.tenantId!, osType);
    res.json({ data: apps });
  } catch (err) { next(err); }
});

// GET /software-compliance/lists — all lists for tenant
router.get('/lists', async (req, res, next) => {
  try {
    const lists = await softwareComplianceService.getLists(req.tenantId!);
    res.json({ data: lists });
  } catch (err) { next(err); }
});

// POST /software-compliance/lists — create (admin)
router.post('/lists', requireRole('admin'), async (req, res, next) => {
  try {
    const list = await softwareComplianceService.createList(req.tenantId!, {
      ...req.body, createdBy: req.session.userId,
    });
    res.status(201).json({ data: list });
  } catch (err) { next(err); }
});

// PUT /software-compliance/lists/:id — update (admin)
router.put('/lists/:id', requireRole('admin'), async (req, res, next) => {
  try {
    const list = await softwareComplianceService.updateList(parseInt(req.params.id), req.tenantId!, req.body);
    res.json({ data: list });
  } catch (err) { next(err); }
});

// DELETE /software-compliance/lists/:id — delete (admin)
router.delete('/lists/:id', requireRole('admin'), async (req, res, next) => {
  try {
    await softwareComplianceService.deleteList(parseInt(req.params.id), req.tenantId!);
    res.status(204).send();
  } catch (err) { next(err); }
});

// GET /software-compliance/results — paginated results (?deviceId=&page=)
router.get('/results', async (req, res, next) => {
  try {
    const { deviceId, page } = req.query as any;
    if (deviceId) {
      // Permission check: user must have read access to the device
      if (req.session.role !== 'admin') {
        const canRead = await permissionService.canReadDevice(req.session.userId!, parseInt(deviceId), false);
        if (!canRead) throw new AppError(403, 'Insufficient permissions');
      }
      const items = await softwareComplianceService.getLatestResults(parseInt(deviceId), req.tenantId!);
      res.json({ data: { items, total: items.length } });
    } else {
      const items = await softwareComplianceService.getAllResults(req.tenantId!, page ? parseInt(page) : 1);
      // Filter by visible devices for non-admins
      if (req.session.role !== 'admin') {
        const visibleIds = await permissionService.getVisibleDeviceIds(req.session.userId!, false);
        if (Array.isArray(visibleIds)) {
          const filtered = items.filter((item: any) => visibleIds.includes(item.deviceId));
          return res.json({ data: { items: filtered, total: filtered.length } });
        }
      }
      res.json({ data: { items, total: items.length } });
    }
  } catch (err) { next(err); }
});

// GET /software-compliance/results/device/:deviceId — latest for device
router.get('/results/device/:deviceId', requireDeviceRead('deviceId'), async (req, res, next) => {
  try {
    const items = await softwareComplianceService.getLatestResults(parseInt(req.params.deviceId), req.tenantId!);
    res.json({ data: { items, total: items.length } });
  } catch (err) { next(err); }
});

// POST /software-compliance/check — trigger check { deviceId, listId? }
router.post('/check', async (req, res, next) => {
  try {
    const { deviceId, listId } = req.body;
    if (!deviceId) return res.status(400).json({ error: 'deviceId required' });

    // Permission check: user must have write access to the device
    if (req.session.role !== 'admin') {
      const canWrite = await permissionService.canWriteDevice(req.session.userId!, parseInt(deviceId), false);
      if (!canWrite) throw new AppError(403, 'Insufficient permissions');
    }

    if (listId) {
      const cmd = await softwareComplianceService.triggerCheck(
        parseInt(deviceId), parseInt(listId),
        req.tenantId!, req.session.userId!
      );
      res.json({ data: cmd });
    } else {
      // Check against all enabled lists for this device
      const lists = await softwareComplianceService.getLists(req.tenantId!);
      const enabled = lists.filter(l => l.enabled);
      const cmds = await Promise.all(
        enabled.map(l => softwareComplianceService.triggerCheck(
          parseInt(deviceId), l.id, req.tenantId!, req.session.userId!
        ))
      );
      res.json({ data: cmds });
    }
  } catch (err) { next(err); }
});

// POST /software-compliance/remediate — trigger remediation { deviceId, listId, entryIds }
router.post('/remediate', async (req, res, next) => {
  try {
    const { deviceId, listId, entryIds } = req.body;
    if (!deviceId || !listId || !entryIds?.length) {
      return res.status(400).json({ error: 'deviceId, listId, entryIds required' });
    }
    if (req.session.role !== 'admin') {
      const canWrite = await permissionService.canWriteDevice(req.session.userId!, parseInt(deviceId), false);
      if (!canWrite) throw new AppError(403, 'Insufficient permissions');
    }
    const cmds = await softwareComplianceService.triggerRemediation(
      parseInt(deviceId), parseInt(listId), entryIds,
      req.tenantId!, req.session.userId!
    );
    res.json({ data: cmds });
  } catch (err) { next(err); }
});

export default router;
