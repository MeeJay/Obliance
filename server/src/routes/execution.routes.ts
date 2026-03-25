import { Router } from 'express';
import { db } from '../db';
import { permissionService } from '../services/permission.service';
import { AppError } from '../middleware/errorHandler';

const router = Router();

// GET /api/executions/batches — aggregated batch list for History tab
router.get('/batches', async (req, res, next) => {
  try {
    const { page = 1, pageSize = 50 } = req.query as any;
    const offset = (parseInt(page) - 1) * parseInt(pageSize);

    // Build visibility filter subquery for non-admins
    let visibleFilter: number[] | 'all' = 'all';
    if (req.session.role !== 'admin') {
      const ids = await permissionService.getVisibleDeviceIds(req.session.userId!, false);
      if (Array.isArray(ids)) {
        if (ids.length === 0) return res.json({ data: { items: [], total: 0 } });
        visibleFilter = ids;
      }
    }

    let baseQ = db('script_executions as se')
      .where('se.tenant_id', req.tenantId!)
      .whereNotNull('se.batch_id');

    if (visibleFilter !== 'all') {
      baseQ = baseQ.whereIn('se.device_id', visibleFilter);
    }

    const batches = await baseQ.clone()
      .select(
        'se.batch_id',
        'se.script_id',
        'se.schedule_id',
        'se.triggered_by',
        'se.triggered_by_user_id',
        db.raw('MIN(se.triggered_at) as triggered_at'),
        db.raw('COUNT(*)::int as total_count'),
        db.raw("COUNT(*) FILTER (WHERE se.status = 'success')::int as success_count"),
        db.raw("COUNT(*) FILTER (WHERE se.status IN ('failure', 'timeout'))::int as failure_count"),
        db.raw("COUNT(*) FILTER (WHERE se.status = 'pending')::int as pending_count"),
        db.raw("COUNT(*) FILTER (WHERE se.status IN ('running', 'sent'))::int as running_count"),
      )
      .groupBy('se.batch_id', 'se.script_id', 'se.schedule_id', 'se.triggered_by', 'se.triggered_by_user_id')
      .orderBy('triggered_at', 'desc')
      .offset(offset)
      .limit(parseInt(pageSize));

    // Enrich with script name, schedule name, user name
    const scriptIds = [...new Set(batches.map((b: any) => b.script_id))];
    const scheduleIds = [...new Set(batches.filter((b: any) => b.schedule_id).map((b: any) => b.schedule_id))];
    const userIds = [...new Set(batches.filter((b: any) => b.triggered_by_user_id).map((b: any) => b.triggered_by_user_id))];

    const [scripts, schedules, users] = await Promise.all([
      scriptIds.length ? db('scripts').whereIn('id', scriptIds).select('id', 'name') : [],
      scheduleIds.length ? db('script_schedules').whereIn('id', scheduleIds).select('id', 'name') : [],
      userIds.length ? db('users').whereIn('id', userIds).select('id', 'username', 'display_name') : [],
    ]);

    const scriptMap = new Map((scripts as any[]).map((s) => [s.id, s.name]));
    const scheduleMap = new Map((schedules as any[]).map((s) => [s.id, s.name]));
    const userMap = new Map((users as any[]).map((u) => [u.id, u.display_name || u.username]));

    const items = batches.map((b: any) => ({
      batchId: b.batch_id,
      scriptId: b.script_id,
      scriptName: scriptMap.get(b.script_id) ?? `Script #${b.script_id}`,
      scheduleId: b.schedule_id,
      scheduleName: b.schedule_id ? scheduleMap.get(b.schedule_id) ?? null : null,
      triggeredBy: b.triggered_by,
      triggeredByUsername: b.triggered_by_user_id ? userMap.get(b.triggered_by_user_id) ?? null : null,
      triggeredAt: b.triggered_at,
      totalCount: b.total_count,
      successCount: b.success_count,
      failureCount: b.failure_count,
      pendingCount: b.pending_count,
      runningCount: b.running_count,
    }));

    // Total count of distinct batches
    const [{ count: total }] = await baseQ.clone()
      .countDistinct('se.batch_id as count');

    res.json({ data: { items, total: parseInt(total as string) } });
  } catch (err) { next(err); }
});

// GET /api/executions/batches/:batchId — all executions in a batch with device info
router.get('/batches/:batchId', async (req, res, next) => {
  try {
    let q = db('script_executions as se')
      .where({ 'se.tenant_id': req.tenantId!, 'se.batch_id': req.params.batchId })
      .leftJoin('devices as d', 'se.device_id', 'd.id')
      .select(
        'se.id', 'se.device_id', 'se.status', 'se.exit_code',
        'se.stdout', 'se.stderr', 'se.triggered_at',
        'se.started_at', 'se.finished_at',
        'd.hostname', 'd.display_name', 'd.os_type',
      )
      .orderBy('d.hostname');

    if (req.session.role !== 'admin') {
      const visibleIds = await permissionService.getVisibleDeviceIds(req.session.userId!, false);
      if (Array.isArray(visibleIds)) {
        if (visibleIds.length === 0) return res.json({ data: [] });
        q = q.whereIn('se.device_id', visibleIds);
      }
    }

    const rows = await q;
    const items = rows.map((r: any) => ({
      id: r.id,
      deviceId: r.device_id,
      hostname: r.display_name || r.hostname,
      osType: r.os_type,
      status: r.status,
      exitCode: r.exit_code,
      stdout: r.stdout,
      stderr: r.stderr,
      triggeredAt: r.triggered_at,
      startedAt: r.started_at,
      finishedAt: r.finished_at,
    }));

    res.json({ data: items });
  } catch (err) { next(err); }
});

function rowToExecution(r: any) {
  const snapshot = typeof r.script_snapshot === 'string' ? JSON.parse(r.script_snapshot) : (r.script_snapshot ?? {});
  return {
    id: r.id,
    tenantId: r.tenant_id,
    scriptId: r.script_id,
    deviceId: r.device_id,
    scheduleId: r.schedule_id,
    batchId: r.batch_id,
    commandQueueId: r.command_queue_id,
    scriptSnapshot: snapshot,
    parameterValues: typeof r.parameter_values === 'string' ? JSON.parse(r.parameter_values) : (r.parameter_values ?? {}),
    status: r.status,
    triggeredBy: r.triggered_by,
    triggeredByUserId: r.triggered_by_user_id,
    triggeredAt: r.triggered_at,
    sentAt: r.sent_at,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    exitCode: r.exit_code,
    stdout: r.stdout,
    stderr: r.stderr,
    isCatchup: r.is_catchup,
    catchupForAt: r.catchup_for_at,
    createdAt: r.created_at,
  };
}

router.get('/', async (req, res, next) => {
  try {
    const { deviceId, scheduleId, status, pageSize } = req.query as any;
    let q = db('script_executions').where({ tenant_id: req.tenantId! });
    if (deviceId) q = q.where({ device_id: parseInt(deviceId) });
    if (scheduleId) q = q.where({ schedule_id: parseInt(scheduleId) });
    if (status) q = q.where({ status });

    // Filter by visible devices for non-admins
    if (req.session.role !== 'admin') {
      const visibleIds = await permissionService.getVisibleDeviceIds(req.session.userId!, false);
      if (Array.isArray(visibleIds)) {
        if (visibleIds.length === 0) return res.json({ data: { items: [], total: 0 } });
        q = q.whereIn('device_id', visibleIds);
      }
    }

    const limit = pageSize ? parseInt(pageSize) : 200;
    const rows = await q.orderBy('triggered_at', 'desc').limit(limit);
    res.json({ data: { items: rows.map(rowToExecution), total: rows.length } });
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const row = await db('script_executions').where({ id: req.params.id, tenant_id: req.tenantId! }).first();
    if (!row) return res.status(404).json({ error: 'Execution not found' });

    if (req.session.role !== 'admin') {
      const canRead = await permissionService.canReadDevice(req.session.userId!, row.device_id, false);
      if (!canRead) throw new AppError(403, 'Insufficient permissions');
    }

    res.json({ data: rowToExecution(row) });
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
