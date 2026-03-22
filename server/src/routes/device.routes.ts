import { Router } from 'express';
import { deviceService } from '../services/device.service';
import { commandService } from '../services/command.service';
import { requireRole } from '../middleware/rbac';
import { db } from '../db';

const router = Router();

// ── Static / collection routes (must come before /:id routes) ─────────────────

// GET /api/devices
router.get('/', async (req, res, next) => {
  try {
    const { groupId, status, approvalStatus, search, osType, page, pageSize } = req.query as any;
    const result = await deviceService.getDevices(req.tenantId!, {
      groupId: groupId ? parseInt(groupId) : undefined,
      status, approvalStatus, search, osType,
      page: page ? parseInt(page) : undefined,
      pageSize: pageSize ? parseInt(pageSize) : undefined,
    });
    res.json({ data: result });
  } catch (err) { next(err); }
});

// GET /api/devices/summary
router.get('/summary', async (req, res, next) => {
  try {
    const summary = await deviceService.getFleetSummary(req.tenantId!);
    res.json({ data: summary });
  } catch (err) { next(err); }
});

// POST /api/devices/bulk/approve
router.post('/bulk/approve', requireRole('admin'), async (req, res, next) => {
  try {
    const { ids, deviceIds } = req.body;
    const list = ids ?? deviceIds ?? [];
    await deviceService.bulkApprove(list, req.tenantId!, req.session.userId!);
    res.json({ success: true, count: list.length });
  } catch (err) { next(err); }
});

// DELETE /api/devices/bulk/delete
router.delete('/bulk/delete', requireRole('admin'), async (req, res, next) => {
  try {
    const { ids, deviceIds } = req.body;
    const list = ids ?? deviceIds ?? [];
    await deviceService.bulkDelete(list, req.tenantId!);
    res.json({ success: true });
  } catch (err) { next(err); }
});

// POST /api/devices/batch — batch action by group or device IDs
router.post('/batch', requireRole('admin'), async (req, res, next) => {
  try {
    const { groupId, deviceIds, action } = req.body as {
      groupId?: number; deviceIds?: number[];
      action: 'restart_agent' | 'reboot' | 'shutdown' | 'scan_inventory' | 'scan_updates' | 'check_compliance';
    };
    if (!action) return res.status(400).json({ error: 'action required' });

    let ids: number[] = deviceIds ?? [];
    if (groupId && !deviceIds?.length) {
      const rows = await db('devices')
        .where({ tenant_id: req.tenantId!, group_id: groupId, approval_status: 'approved' })
        .whereNot({ status: 'suspended' })
        .select('id');
      ids = rows.map((r: any) => r.id);
    }
    if (!ids.length) return res.json({ data: { dispatched: 0 } });

    let dispatched = 0;
    for (const deviceId of ids) {
      await commandService.enqueue({
        deviceId,
        tenantId: req.tenantId!,
        type: action as any,
        priority: 'normal',
        createdBy: req.session.userId,
      });
      dispatched++;
    }
    res.json({ data: { dispatched } });
  } catch (err) { next(err); }
});

// ── Single-device routes (:id) ────────────────────────────────────────────────

// GET /api/devices/:id
router.get('/:id', async (req, res, next) => {
  try {
    const device = await deviceService.getDeviceById(parseInt(req.params.id), req.tenantId!);
    if (!device) return res.status(404).json({ error: 'Device not found' });
    res.json({ data: device });
  } catch (err) { next(err); }
});

// PATCH /api/devices/:id
router.patch('/:id', async (req, res, next) => {
  try {
    const device = await deviceService.updateDevice(parseInt(req.params.id), req.tenantId!, req.body);
    if (!device) return res.status(404).json({ error: 'Device not found' });
    res.json({ data: device });
  } catch (err) { next(err); }
});

// GET /api/devices/:id/services
router.get('/:id/services', async (req, res, next) => {
  try {
    const deviceId = parseInt(req.params.id);
    const device = await db('devices')
      .where({ id: deviceId, tenant_id: req.tenantId! })
      .select('latest_services')
      .first();
    if (!device) return res.status(404).json({ error: 'Device not found' });
    const services = device.latest_services ?? [];
    res.json({ data: services });
  } catch (err) { next(err); }
});

// POST /api/devices/:id/approve
router.post('/:id/approve', requireRole('admin'), async (req, res, next) => {
  try {
    const device = await deviceService.approveDevice(
      parseInt(req.params.id), req.tenantId!, req.session.userId!
    );
    res.json({ data: device });
  } catch (err) { next(err); }
});

// POST /api/devices/:id/refuse
router.post('/:id/refuse', requireRole('admin'), async (req, res, next) => {
  try {
    const device = await deviceService.refuseDevice(parseInt(req.params.id), req.tenantId!);
    res.json({ data: device });
  } catch (err) { next(err); }
});

// POST /api/devices/:id/suspend
router.post('/:id/suspend', requireRole('admin'), async (req, res, next) => {
  try {
    const device = await deviceService.suspendDevice(parseInt(req.params.id), req.tenantId!);
    if (!device) return res.status(404).json({ error: 'Device not found' });
    res.json({ data: device });
  } catch (err) { next(err); }
});

// POST /api/devices/:id/unsuspend
router.post('/:id/unsuspend', requireRole('admin'), async (req, res, next) => {
  try {
    const device = await deviceService.unsuspendDevice(parseInt(req.params.id), req.tenantId!);
    if (!device) return res.status(404).json({ error: 'Device not found' });
    res.json({ data: device });
  } catch (err) { next(err); }
});

// POST /api/devices/:id/privacy-mode/disable — send disable_privacy_mode command to agent
router.post('/:id/privacy-mode/disable', requireRole('admin'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    const device = await deviceService.getDeviceById(id, req.tenantId!);
    if (!device) return res.status(404).json({ error: 'Device not found' });
    const cmd = await commandService.enqueue({
      deviceId: id,
      tenantId: req.tenantId!,
      type: 'disable_privacy_mode',
      priority: 'high',
      expiresInSeconds: 300,
      createdBy: req.session.userId,
    });
    res.json({ data: cmd });
  } catch (err) { next(err); }
});

// POST /api/devices/:id/uninstall — mark as pending_uninstall + send uninstall command to agent
router.post('/:id/uninstall', requireRole('admin'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    const device = await deviceService.initiateUninstall(id, req.tenantId!);
    if (!device) return res.status(404).json({ error: 'Device not found' });
    // Fire-and-forget — best effort; if agent is offline it'll receive it when it reconnects
    commandService.enqueue({
      deviceId: id, tenantId: req.tenantId!,
      type: 'uninstall_agent', payload: {},
      priority: 'urgent', expiresInSeconds: 600,
      createdBy: req.session.userId,
    }).catch(() => { /* ignore enqueue errors */ });
    res.json({ data: device });
  } catch (err) { next(err); }
});

// POST /api/devices/:id/cancel-uninstall — abort a pending uninstall, restore to offline
router.post('/:id/cancel-uninstall', requireRole('admin'), async (req, res, next) => {
  try {
    const device = await deviceService.cancelUninstall(parseInt(req.params.id), req.tenantId!);
    if (!device) return res.status(404).json({ error: 'Device not found' });
    res.json({ data: device });
  } catch (err) { next(err); }
});

// DELETE /api/devices/:id
router.delete('/:id', requireRole('admin'), async (req, res, next) => {
  try {
    await deviceService.deleteDevice(parseInt(req.params.id), req.tenantId!);
    res.status(204).send();
  } catch (err) { next(err); }
});

export default router;
