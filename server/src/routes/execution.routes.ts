import { Router } from 'express';
import { db } from '../db';
import { permissionService } from '../services/permission.service';
import { AppError } from '../middleware/errorHandler';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const { deviceId, scheduleId, status } = req.query as any;
    let q = db('script_executions').where({ tenant_id: req.tenantId! });
    if (deviceId) q = q.where({ device_id: parseInt(deviceId) });
    if (scheduleId) q = q.where({ schedule_id: parseInt(scheduleId) });
    if (status) q = q.where({ status });

    // Filter by visible devices for non-admins
    if (req.session.role !== 'admin') {
      const visibleIds = await permissionService.getVisibleDeviceIds(req.session.userId!, false);
      if (Array.isArray(visibleIds)) {
        if (visibleIds.length === 0) return res.json([]);
        q = q.whereIn('device_id', visibleIds);
      }
    }

    const rows = await q.orderBy('triggered_at', 'desc').limit(200);
    res.json(rows);
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const row = await db('script_executions').where({ id: req.params.id, tenant_id: req.tenantId! }).first();
    if (!row) return res.status(404).json({ error: 'Execution not found' });

    // Permission check: user must have read access to the device
    if (req.session.role !== 'admin') {
      const canRead = await permissionService.canReadDevice(req.session.userId!, row.device_id, false);
      if (!canRead) throw new AppError(403, 'Insufficient permissions');
    }

    res.json(row);
  } catch (err) { next(err); }
});

router.post('/:id/cancel', async (req, res, next) => {
  try {
    await db('script_executions')
      .where({ id: req.params.id, tenant_id: req.tenantId!, status: 'pending' })
      .update({ status: 'cancelled', updated_at: new Date() });
    res.json({ success: true });
  } catch (err) { next(err); }
});

export default router;
