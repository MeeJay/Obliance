import { Router } from 'express';
import { db } from '../db';
import { updateService } from '../services/update.service';
import { requireDeviceWriteParam, requireRole } from '../middleware/rbac';
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

router.get('/compliance-report', async (req, res, next) => {
  try {
    const { groupId } = req.query as any;
    const report = await updateService.getPatchComplianceReport(
      req.tenantId!, groupId ? parseInt(groupId) : undefined
    );
    res.json({ data: report });
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

router.post('/policies', requireRole('admin'), async (req, res, next) => {
  try {
    const policy = await updateService.createPolicy(req.tenantId!, {
      ...req.body, createdBy: req.session.userId,
    });
    res.status(201).json({ data: policy });
  } catch (err) { next(err); }
});

router.patch('/policies/:id', requireRole('admin'), async (req, res, next) => {
  try {
    const policy = await updateService.updatePolicy(parseInt(req.params.id), req.tenantId!, req.body);
    res.json({ data: policy });
  } catch (err) { next(err); }
});

router.delete('/policies/:id', requireRole('admin'), async (req, res, next) => {
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

// POST /updates/bulk-retry — retry all failed updates for a given title across all devices
router.post('/bulk-retry', requireRole('admin'), async (req, res, next) => {
  try {
    const { updateUid } = req.body as { updateUid: string };
    if (!updateUid) return res.status(400).json({ error: 'updateUid required' });

    const failedUpdates = await db('device_updates')
      .where({ tenant_id: req.tenantId!, update_uid: updateUid, status: 'failed' });

    let retried = 0;
    for (const u of failedUpdates) {
      try {
        await updateService.retryUpdate(u.device_id, u.id, req.tenantId!, req.session.userId!);
        retried++;
      } catch { /* skip individual failures */ }
    }
    res.json({ data: { retried } });
  } catch (err) { next(err); }
});

// POST /updates/bulk-retry-titles — retry all failed updates for multiple titles
router.post('/bulk-retry-titles', requireRole('admin'), async (req, res, next) => {
  try {
    const { updateUids } = req.body as { updateUids: string[] };
    if (!updateUids?.length) return res.status(400).json({ error: 'updateUids required' });

    const failedUpdates = await db('device_updates')
      .where({ tenant_id: req.tenantId!, status: 'failed' })
      .whereIn('update_uid', updateUids);

    let retried = 0;
    for (const u of failedUpdates) {
      try {
        await updateService.retryUpdate(u.device_id, u.id, req.tenantId!, req.session.userId!);
        retried++;
      } catch { /* skip */ }
    }
    res.json({ data: { retried } });
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

// ── Aggregated view ──────────────────────────────────────────────────────────

// GET /updates/aggregated — grouped by title, with device counts
router.get('/aggregated', async (req, res, next) => {
  try {
    const { severity, source, groupId, status, page, pageSize } = req.query as any;
    const result = await updateService.getAggregatedUpdates(req.tenantId!, {
      severity, source,
      groupId: groupId ? parseInt(groupId) : undefined,
      status,
      page: page ? parseInt(page) : undefined,
      pageSize: pageSize ? parseInt(pageSize) : undefined,
    });
    res.json({ data: result });
  } catch (err) { next(err); }
});

// GET /updates/aggregated/:updateUid/devices — devices affected by a specific update
router.get('/aggregated/:updateUid/devices', async (req, res, next) => {
  try {
    const devices = await updateService.getUpdateDevices(req.tenantId!, req.params.updateUid);
    res.json({ data: devices });
  } catch (err) { next(err); }
});

// POST /updates/bulk-approve — approve all instances of an update title
router.post('/bulk-approve', requireRole('admin'), async (req, res, next) => {
  try {
    const { updateUid, groupId } = req.body as { updateUid: string; groupId?: number };
    if (!updateUid) return res.status(400).json({ error: 'updateUid required' });
    const count = await updateService.bulkApproveByTitle(
      req.tenantId!, updateUid, req.session.userId!, groupId,
    );
    res.json({ data: { approved: count } });
  } catch (err) { next(err); }
});

// POST /updates/bulk-approve-titles — approve multiple update titles at once
router.post('/bulk-approve-titles', requireRole('admin'), async (req, res, next) => {
  try {
    const { updateUids, groupId } = req.body as { updateUids: string[]; groupId?: number };
    if (!updateUids?.length) return res.status(400).json({ error: 'updateUids required' });
    let total = 0;
    for (const uid of updateUids) {
      total += await updateService.bulkApproveByTitle(req.tenantId!, uid, req.session.userId!, groupId);
    }
    res.json({ data: { approved: total } });
  } catch (err) { next(err); }
});

// POST /updates/bulk-deploy — deploy all approved updates across all affected devices
router.post('/bulk-deploy', requireRole('admin'), async (req, res, next) => {
  try {
    const deviceIds = await db('device_updates')
      .where({ tenant_id: req.tenantId!, status: 'approved' })
      .distinct('device_id')
      .pluck('device_id');

    let totalDispatched = 0;
    for (const deviceId of deviceIds) {
      const updates = await updateService.deployApprovedUpdates(deviceId, req.tenantId!, req.session.userId!);
      totalDispatched += updates.length;
    }
    res.json({ data: { dispatched: totalDispatched, devices: deviceIds.length } });
  } catch (err) { next(err); }
});

// POST /updates/bulk-approve-and-deploy — approve selected titles then deploy them
router.post('/bulk-approve-and-deploy', requireRole('admin'), async (req, res, next) => {
  try {
    const { updateUids, groupId } = req.body as { updateUids: string[]; groupId?: number };
    if (!updateUids?.length) return res.status(400).json({ error: 'updateUids required' });

    // Approve
    let approved = 0;
    for (const uid of updateUids) {
      approved += await updateService.bulkApproveByTitle(req.tenantId!, uid, req.session.userId!, groupId);
    }

    // Deploy on all devices that now have these approved updates
    const deviceIds = await db('device_updates')
      .where({ tenant_id: req.tenantId!, status: 'approved' })
      .whereIn('update_uid', updateUids)
      .distinct('device_id')
      .pluck('device_id');

    let dispatched = 0;
    for (const deviceId of deviceIds) {
      const updates = await updateService.deployApprovedUpdates(deviceId, req.tenantId!, req.session.userId!);
      dispatched += updates.length;
    }

    res.json({ data: { approved, dispatched, devices: deviceIds.length } });
  } catch (err) { next(err); }
});

// POST /updates/bulk-approve-severity — approve all updates of given severities
router.post('/bulk-approve-severity', requireRole('admin'), async (req, res, next) => {
  try {
    const { severities, groupId } = req.body as { severities: string[]; groupId?: number };
    if (!severities?.length) return res.status(400).json({ error: 'severities required' });
    const count = await updateService.bulkApproveBySeverity(
      req.tenantId!, severities, req.session.userId!, groupId,
    );
    res.json({ data: { approved: count } });
  } catch (err) { next(err); }
});

export default router;
