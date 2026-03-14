import { Router } from 'express';
import { db } from '../db';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const rows = await db('script_schedules')
      .where({ tenant_id: req.tenantId! })
      .orderBy('name');
    res.json(rows);
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const [row] = await db('script_schedules').insert({
      tenant_id: req.tenantId!,
      script_id: req.body.scriptId,
      name: req.body.name, description: req.body.description,
      target_type: req.body.targetType || 'device',
      target_id: req.body.targetId,
      cron_expression: req.body.cronExpression,
      fire_once_at: req.body.fireOnceAt,
      timezone: req.body.timezone || 'UTC',
      parameter_values: JSON.stringify(req.body.parameterValues || {}),
      catchup_enabled: req.body.catchupEnabled !== false,
      catchup_max: req.body.catchupMax || 3,
      run_conditions: JSON.stringify(req.body.runConditions || []),
      enabled: req.body.enabled !== false,
      created_by: req.session.userId,
    }).returning('*');
    res.status(201).json(row);
  } catch (err) { next(err); }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const updates: any = { updated_at: new Date() };
    if (req.body.name !== undefined) updates.name = req.body.name;
    if (req.body.enabled !== undefined) updates.enabled = req.body.enabled;
    if (req.body.cronExpression !== undefined) updates.cron_expression = req.body.cronExpression;
    if (req.body.catchupEnabled !== undefined) updates.catchup_enabled = req.body.catchupEnabled;
    await db('script_schedules').where({ id: req.params.id, tenant_id: req.tenantId! }).update(updates);
    const row = await db('script_schedules').where({ id: req.params.id }).first();
    res.json(row);
  } catch (err) { next(err); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    await db('script_schedules').where({ id: req.params.id, tenant_id: req.tenantId! }).delete();
    res.status(204).send();
  } catch (err) { next(err); }
});

export default router;
