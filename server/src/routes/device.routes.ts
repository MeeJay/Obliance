import { Router } from 'express';
import { deviceService } from '../services/device.service';
import { commandService } from '../services/command.service';
import { requireRole, requireDeviceRead, requireDeviceWrite } from '../middleware/rbac';
import { permissionService } from '../services/permission.service';
import { AppError } from '../middleware/errorHandler';
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

    // Filter by visible devices for non-admins
    if (req.session.role !== 'admin') {
      const visible = await permissionService.getVisibleDeviceIds(req.session.userId!, false);
      if (Array.isArray(visible)) {
        const visibleSet = new Set(visible);
        result.items = result.items.filter((d: any) => visibleSet.has(d.id));
        result.total = result.items.length;
      }
    }

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

// GET /api/devices/group-stats — stats per group for dashboard
router.get('/group-stats', async (req, res, next) => {
  try {
    const tenantId = req.tenantId!;

    // Device counts per group + status
    const deviceRows = await db('devices')
      .where({ tenant_id: tenantId, approval_status: 'approved' })
      .whereNot({ status: 'pending_uninstall' })
      .select('group_id', 'status')
      .count('* as count')
      .groupBy('group_id', 'status');

    // Compliance scores per group (latest per device)
    const complianceRows = await db.raw(`
      SELECT d.group_id,
             ROUND(AVG(cr.compliance_score)::numeric, 1) as avg_score,
             COUNT(DISTINCT cr.policy_id) as policy_count
      FROM compliance_results cr
      JOIN devices d ON d.id = cr.device_id
      WHERE d.tenant_id = ? AND d.approval_status = 'approved'
        AND cr.id IN (
          SELECT DISTINCT ON (device_id, policy_id) id
          FROM compliance_results
          WHERE tenant_id = ?
          ORDER BY device_id, policy_id, checked_at DESC
        )
      GROUP BY d.group_id
    `, [tenantId, tenantId]);

    // Pending updates per group
    const updateRows = await db.raw(`
      SELECT d.group_id, COUNT(DISTINCT du.device_id) as devices_with_updates
      FROM device_updates du
      JOIN devices d ON d.id = du.device_id
      WHERE d.tenant_id = ? AND du.status = 'available'
      GROUP BY d.group_id
    `, [tenantId]);

    // Group names
    const groups = await db('device_groups')
      .where({ tenant_id: tenantId })
      .select('id', 'name', 'parent_id');

    // Build stats map
    const statsMap = new Map<number | null, any>();

    const getOrCreate = (gid: number | null) => {
      if (!statsMap.has(gid)) {
        statsMap.set(gid, { groupId: gid, groupName: null, online: 0, offline: 0, warning: 0, critical: 0, total: 0, complianceScore: null, policyCount: 0, pendingUpdates: 0 });
      }
      return statsMap.get(gid)!;
    };

    for (const row of deviceRows) {
      const s = getOrCreate(Number(row.group_id));
      const count = parseInt(String(row.count));
      s.total += count;
      if (row.status === 'online') s.online += count;
      else if (row.status === 'offline') s.offline += count;
      else if (row.status === 'warning') s.warning += count;
      else if (row.status === 'critical') s.critical += count;
    }

    for (const row of (complianceRows.rows ?? complianceRows)) {
      const s = getOrCreate(row.group_id);
      s.complianceScore = parseFloat(row.avg_score);
      s.policyCount = parseInt(row.policy_count);
    }

    for (const row of (updateRows.rows ?? updateRows)) {
      const s = getOrCreate(row.group_id);
      s.pendingUpdates = parseInt(row.devices_with_updates);
    }

    // Set group names
    const groupMap = new Map(groups.map((g: any) => [g.id, g.name]));
    for (const [gid, stats] of statsMap) {
      stats.groupName = gid ? (groupMap.get(gid) ?? 'Unknown') : null;
    }

    res.json({ data: Array.from(statsMap.values()).sort((a: any, b: any) => b.total - a.total) });
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
router.get('/:id', requireDeviceRead(), async (req, res, next) => {
  try {
    const device = await deviceService.getDeviceById(parseInt(req.params.id), req.tenantId!);
    if (!device) return res.status(404).json({ error: 'Device not found' });
    res.json({ data: device });
  } catch (err) { next(err); }
});

// PATCH /api/devices/:id
router.patch('/:id', requireDeviceWrite(), async (req, res, next) => {
  try {
    const device = await deviceService.updateDevice(parseInt(req.params.id), req.tenantId!, req.body);
    if (!device) return res.status(404).json({ error: 'Device not found' });
    res.json({ data: device });
  } catch (err) { next(err); }
});

// GET /api/devices/:id/services
router.get('/:id/services', requireDeviceRead(), async (req, res, next) => {
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
