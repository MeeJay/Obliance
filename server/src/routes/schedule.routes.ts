import { Router } from 'express';
import { db } from '../db';
import { requireRole } from '../middleware/rbac';

const router = Router();

function rowToSchedule(row: any) {
  return {
    id: row.id,
    uuid: row.uuid,
    tenantId: row.tenant_id,
    scriptId: row.script_id,
    name: row.name,
    description: row.description,
    targetType: row.target_type,
    targetIds: typeof row.target_ids === 'string' ? JSON.parse(row.target_ids) : (row.target_ids ?? []),
    cronExpression: row.cron_expression,
    fireOnceAt: row.fire_once_at,
    timezone: row.timezone,
    parameterValues: typeof row.parameter_values === 'string' ? JSON.parse(row.parameter_values) : (row.parameter_values ?? {}),
    catchupEnabled: row.catchup_enabled,
    catchupMax: row.catchup_max,
    runConditions: typeof row.run_conditions === 'string' ? JSON.parse(row.run_conditions) : (row.run_conditions ?? []),
    enabled: row.enabled,
    lastRunAt: row.last_run_at,
    nextRunAt: row.next_run_at,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

router.get('/', async (req, res, next) => {
  try {
    const rows = await db('script_schedules')
      .where({ tenant_id: req.tenantId! })
      .orderBy('name');
    res.json({ data: rows.map(rowToSchedule) });
  } catch (err) { next(err); }
});

router.post('/', requireRole('admin'), async (req, res, next) => {
  try {
    // Compute next_run_at: for one-time = fire_once_at, for cron = fire_once_at or now + interval
    const nextRunAt = req.body.fireOnceAt
      ? new Date(req.body.fireOnceAt)
      : (req.body.cronExpression ? new Date() : null);

    const [row] = await db('script_schedules').insert({
      tenant_id: req.tenantId!,
      script_id: req.body.scriptId,
      name: req.body.name, description: req.body.description,
      target_type: req.body.targetType || 'device',
      target_ids: JSON.stringify(req.body.targetIds || []),
      cron_expression: req.body.cronExpression,
      fire_once_at: req.body.fireOnceAt,
      next_run_at: nextRunAt,
      timezone: req.body.timezone || 'UTC',
      parameter_values: JSON.stringify(req.body.parameterValues || {}),
      catchup_enabled: req.body.catchupEnabled !== false,
      catchup_max: req.body.catchupMax || 3,
      run_conditions: JSON.stringify(req.body.runConditions || []),
      enabled: req.body.enabled !== false,
      created_by: req.session.userId,
    }).returning('*');
    res.status(201).json({ data: rowToSchedule(row) });
  } catch (err) { next(err); }
});

router.patch('/:id', requireRole('admin'), async (req, res, next) => {
  try {
    const updates: any = { updated_at: new Date() };
    if (req.body.name !== undefined) updates.name = req.body.name;
    if (req.body.enabled !== undefined) updates.enabled = req.body.enabled;
    if (req.body.cronExpression !== undefined) updates.cron_expression = req.body.cronExpression;
    if (req.body.catchupEnabled !== undefined) updates.catchup_enabled = req.body.catchupEnabled;
    if (req.body.targetType !== undefined) updates.target_type = req.body.targetType;
    if (req.body.targetIds !== undefined) updates.target_ids = JSON.stringify(req.body.targetIds);
    if (req.body.scriptId !== undefined) updates.script_id = req.body.scriptId;
    if (req.body.description !== undefined) updates.description = req.body.description;
    if (req.body.fireOnceAt !== undefined) {
      updates.fire_once_at = req.body.fireOnceAt;
      if (req.body.fireOnceAt) updates.next_run_at = new Date(req.body.fireOnceAt);
    }
    if (req.body.timezone !== undefined) updates.timezone = req.body.timezone;
    await db('script_schedules').where({ id: req.params.id, tenant_id: req.tenantId! }).update(updates);
    const row = await db('script_schedules').where({ id: req.params.id }).first();
    res.json({ data: rowToSchedule(row) });
  } catch (err) { next(err); }
});

// GET /api/schedules/for-device/:deviceId — all schedules that apply to a device
router.get('/for-device/:deviceId', async (req, res, next) => {
  try {
    const deviceId = parseInt(req.params.deviceId);
    const device = await db('devices').where({ id: deviceId, tenant_id: req.tenantId! }).first();
    if (!device) return res.status(404).json({ error: 'Device not found' });

    // Get all ancestor group IDs for this device's group
    let ancestorGroupIds: number[] = [];
    if (device.group_id) {
      const ancestors = await db('device_group_closure')
        .where({ descendant_id: device.group_id })
        .pluck('ancestor_id');
      ancestorGroupIds = [...new Set([device.group_id, ...ancestors])];
    }

    // Find schedules: targetType=all OR (targetType=group AND targetIds overlaps with ancestors) OR (targetType=device AND targetIds includes deviceId)
    const allSchedules = await db('script_schedules').where({ tenant_id: req.tenantId! }).orderBy('name');
    const matching = allSchedules.filter((s: any) => {
      if (s.target_type === 'all') return true;
      const ids: number[] = typeof s.target_ids === 'string' ? JSON.parse(s.target_ids || '[]') : (s.target_ids || []);
      if (s.target_type === 'group') return ids.some((id: number) => ancestorGroupIds.includes(id));
      if (s.target_type === 'device') return ids.includes(deviceId);
      return false;
    });

    res.json({ data: matching.map(rowToSchedule) });
  } catch (err) { next(err); }
});

router.delete('/:id', requireRole('admin'), async (req, res, next) => {
  try {
    await db('script_schedules').where({ id: req.params.id, tenant_id: req.tenantId! }).delete();
    res.status(204).send();
  } catch (err) { next(err); }
});

export default router;
