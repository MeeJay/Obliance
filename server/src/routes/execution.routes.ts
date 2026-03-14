import { Router } from 'express';
import { db } from '../db';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const { deviceId, scheduleId, status } = req.query as any;
    let q = db('script_executions').where({ tenant_id: req.tenantId! });
    if (deviceId) q = q.where({ device_id: parseInt(deviceId) });
    if (scheduleId) q = q.where({ schedule_id: parseInt(scheduleId) });
    if (status) q = q.where({ status });
    const rows = await q.orderBy('triggered_at', 'desc').limit(200);
    res.json(rows);
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const row = await db('script_executions').where({ id: req.params.id, tenant_id: req.tenantId! }).first();
    if (!row) return res.status(404).json({ error: 'Execution not found' });
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
