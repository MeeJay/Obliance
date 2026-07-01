import { Router } from 'express';
import { db } from '../db';
import { logger } from '../utils/logger';
import { requireTenantCapability } from '../middleware/rbac';
import { isMasterTenant } from '@obliance/shared';

const router = Router();

function rowToSchedule(row: any) {
  return {
    id: row.id,
    uuid: row.uuid,
    tenantId: row.tenant_id,
    targetTenantIds: Array.isArray(row.target_tenant_ids) ? row.target_tenant_ids : null,
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
    assertPass: row.assert_pass ?? false,
    enabled: row.enabled,
    timeoutSeconds: row.timeout_seconds ?? null,
    skipIfInFlight: row.skip_if_in_flight !== false,
    notifyOnce: row.notify_once ?? false,
    bypassPrivacyMode: row.bypass_privacy_mode ?? false,
    notificationChannels: typeof row.notification_channels === 'string'
      ? JSON.parse(row.notification_channels)
      : (row.notification_channels ?? []),
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
    const isMaster = isMasterTenant(req.tenantId!);
    const q = db('script_schedules as ss')
      .leftJoin('users as uc', 'uc.id', 'ss.created_by')
      .leftJoin('users as uu', 'uu.id', 'ss.updated_by')
      .select(
        'ss.*',
        db.raw("COALESCE(uc.display_name, uc.username) as created_by_name"),
        db.raw("COALESCE(uu.display_name, uu.username) as updated_by_name"),
      )
      .orderBy('ss.name');
    // Master sees every schedule across the install; non-master tenants
    // see their own + any schedule fan-outed to them via target_tenant_ids.
    if (!isMaster) {
      q.where(function() {
        this.where('ss.tenant_id', req.tenantId!)
          .orWhereRaw('? = ANY(ss.target_tenant_ids)', [req.tenantId!]);
      });
    }
    const rows = await q;

    // Resolve the number of approved devices each schedule will actually run
    // on, so the UI can warn on "2 groups → 0 devices" mistakes.
    const resolveCount = async (row: any): Promise<number> => {
      const targetIds: number[] = typeof row.target_ids === 'string'
        ? JSON.parse(row.target_ids || '[]')
        : (row.target_ids || []);
      if (row.target_type === 'all') {
        const r = await db('devices')
          .where({ tenant_id: row.tenant_id, approval_status: 'approved' })
          .whereIn('status', ['online', 'warning', 'critical'])
          .count('id as c')
          .first();
        return Number((r as any)?.c ?? 0);
      }
      if (row.target_type === 'device') {
        if (!targetIds.length) return 0;
        const r = await db('devices')
          .where({ tenant_id: row.tenant_id, approval_status: 'approved' })
          .whereIn('id', targetIds)
          .whereIn('status', ['online', 'warning', 'critical'])
          .count('id as c')
          .first();
        return Number((r as any)?.c ?? 0);
      }
      if (row.target_type === 'group') {
        if (!targetIds.length) return 0;
        const descendants = await db('device_group_closure')
          .whereIn('ancestor_id', targetIds)
          .pluck('descendant_id');
        const allGroupIds = Array.from(new Set([...targetIds, ...descendants]));
        const r = await db('devices')
          .where({ tenant_id: row.tenant_id, approval_status: 'approved' })
          .whereIn('group_id', allGroupIds)
          .whereIn('status', ['online', 'warning', 'critical'])
          .count('id as c')
          .first();
        return Number((r as any)?.c ?? 0);
      }
      return 0;
    };

    const items = await Promise.all(rows.map(async (row: any) => ({
      ...rowToSchedule(row),
      createdByName: row.created_by_name ?? null,
      updatedByName: row.updated_by_name ?? null,
      resolvedDeviceCount: await resolveCount(row),
    })));
    res.json({ data: items });
  } catch (err) { next(err); }
});

router.post('/', requireTenantCapability('scripts.manage'), async (req, res, next) => {
  try {
    // Compute next_run_at: for one-time = fire_once_at, for cron = parse
    // the expression to get the actual next fire time.
    let nextRunAt: Date | null = null;
    if (req.body.fireOnceAt) {
      nextRunAt = new Date(req.body.fireOnceAt);
    } else if (req.body.cronExpression) {
      try {
        const { default: cronParser } = await import('cron-parser');
        const it = cronParser.parseExpression(req.body.cronExpression, {
          currentDate: new Date(),
          tz: req.body.timezone || undefined,
        });
        nextRunAt = it.next().toDate();
      } catch {
        nextRunAt = new Date();
      }
    }

    // Master-only fan-out: sanitise targetTenantIds. Non-master callers'
    // value is dropped — a child-tenant admin cannot create a schedule
    // visible to other tenants.
    const fanOut = isMasterTenant(req.tenantId!) && Array.isArray(req.body.targetTenantIds) && req.body.targetTenantIds.length > 0
      ? (req.body.targetTenantIds as unknown[]).map(Number).filter(Number.isFinite)
      : null;

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
      assert_pass: req.body.assertPass ?? false,
      notify_once: req.body.notifyOnce ?? false,
      bypass_privacy_mode: req.body.bypassPrivacyMode === true,
      notification_channels: JSON.stringify(req.body.notificationChannels ?? []),
      timeout_seconds: req.body.timeoutSeconds ?? null,
      skip_if_in_flight: req.body.skipIfInFlight !== false,
      on_failure_scenario_id: req.body.onFailureScenarioId ?? null,
      target_tenant_ids: fanOut,
      enabled: req.body.enabled !== false,
      created_by: req.session.userId,
    }).returning('*');
    try {
      const { auditService } = await import('../services/audit.service');
      await auditService.logReq(req, 'schedule.created', {
        resourceType: 'schedule', resourcePath: String(row.id),
        details: { name: row.name, scriptId: row.script_id, cronExpression: row.cron_expression },
      });
    } catch {}
    res.status(201).json({ data: rowToSchedule(row) });
  } catch (err) {
    logger.error({ err, body: req.body }, 'schedule create failed');
    next(err);
  }
});

router.patch('/:id', requireTenantCapability('scripts.manage'), async (req, res, next) => {
  try {
    // Restriction gate on the false→true bypass-privacy transition. Same
    // pattern as scenario PUT: only fires on the rising edge, queues a
    // setting_change approval when restricted, and strips the flip from
    // the update so the rest of the form still saves.
    if (req.body && req.body.bypassPrivacyMode === true) {
      const current = await db('script_schedules').where({ id: req.params.id, tenant_id: req.tenantId! })
        .first('bypass_privacy_mode', 'name');
      if (current && !current.bypass_privacy_mode) {
        const { applyRestriction } = await import('../services/restriction.service');
        const approved = await applyRestriction(res, {
          req,
          actionKey: 'schedule.bypass_privacy_mode',
          approvalRequestType: 'setting_change',
          approvalDescription: `Enable privacy-mode bypass on schedule "${current.name}"`,
          approvalPayload: { entityType: 'schedule', entityId: Number(req.params.id), field: 'bypassPrivacyMode', value: true },
        });
        if (!approved) return;
      }
    }

    const updates: any = { updated_at: new Date(), updated_by: req.session.userId };
    if (req.body.name !== undefined) updates.name = req.body.name;
    if (req.body.enabled !== undefined) updates.enabled = req.body.enabled;
    if (req.body.cronExpression !== undefined) updates.cron_expression = req.body.cronExpression;
    if (req.body.catchupEnabled !== undefined) updates.catchup_enabled = req.body.catchupEnabled;
    if (req.body.assertPass !== undefined) updates.assert_pass = req.body.assertPass;
    if (req.body.notifyOnce !== undefined) updates.notify_once = req.body.notifyOnce;
    if (req.body.bypassPrivacyMode !== undefined) updates.bypass_privacy_mode = req.body.bypassPrivacyMode === true;
    if (req.body.targetType !== undefined) updates.target_type = req.body.targetType;
    if (req.body.targetIds !== undefined) updates.target_ids = JSON.stringify(req.body.targetIds);
    if (req.body.scriptId !== undefined) updates.script_id = req.body.scriptId;
    if (req.body.description !== undefined) updates.description = req.body.description;
    if (req.body.fireOnceAt !== undefined) {
      updates.fire_once_at = req.body.fireOnceAt;
      if (req.body.fireOnceAt) updates.next_run_at = new Date(req.body.fireOnceAt);
    }
    if (req.body.timezone !== undefined) updates.timezone = req.body.timezone;
    if (req.body.notificationChannels !== undefined) updates.notification_channels = JSON.stringify(req.body.notificationChannels);
    if (req.body.timeoutSeconds !== undefined) updates.timeout_seconds = req.body.timeoutSeconds;
    if (req.body.skipIfInFlight !== undefined) updates.skip_if_in_flight = req.body.skipIfInFlight;
    if (req.body.onFailureScenarioId !== undefined) updates.on_failure_scenario_id = req.body.onFailureScenarioId;
    // Fan-out edits gated to master only — a child-tenant admin
    // cannot promote a local schedule to fan-out.
    if (req.body.targetTenantIds !== undefined && isMasterTenant(req.tenantId!)) {
      const arr = Array.isArray(req.body.targetTenantIds)
        ? (req.body.targetTenantIds as unknown[]).map(Number).filter(Number.isFinite)
        : [];
      updates.target_tenant_ids = arr.length > 0 ? arr : null;
    }

    // If the cron expression changed, recompute next_run_at immediately
    // so the UI and the tick loop both see the new schedule without waiting
    // for the next tick to overwrite the (now-stale) value.
    if (req.body.cronExpression !== undefined && req.body.cronExpression) {
      try {
        const { default: cronParser } = await import('cron-parser');
        const tz = req.body.timezone || (await db('script_schedules').where({ id: req.params.id }).first())?.timezone || undefined;
        const it = cronParser.parseExpression(req.body.cronExpression, { currentDate: new Date(), tz });
        updates.next_run_at = it.next().toDate();
      } catch {}
    }

    await db('script_schedules').where({ id: req.params.id, tenant_id: req.tenantId! }).update(updates);
    const row = await db('script_schedules').where({ id: req.params.id }).first();
    try {
      const { auditService } = await import('../services/audit.service');
      const action = req.body.enabled === true ? 'schedule.enabled'
                   : req.body.enabled === false ? 'schedule.disabled'
                   : 'schedule.updated';
      await auditService.logReq(req, action, {
        resourceType: 'schedule', resourcePath: String(req.params.id),
        details: { name: row?.name, changes: Object.keys(updates) },
      });
    } catch {}
    res.json({ data: rowToSchedule(row) });
  } catch (err) {
    logger.error({ err, id: req.params.id, body: req.body }, 'schedule update failed');
    next(err);
  }
});

// GET /api/schedules/:id/history — last N batches for a schedule, grouped.
// Each batch contains all per-device executions with stdout/stderr.
router.get('/:id/history', async (req, res, next) => {
  try {
    const scheduleId = parseInt(req.params.id);
    const batchLimit = Math.min(50, parseInt((req.query.limit as string) || '10'));
    const sched = await db('script_schedules').where({ id: scheduleId, tenant_id: req.tenantId! }).first();
    if (!sched) return res.status(404).json({ error: 'Not found' });

    // Step 1: find the N most recent distinct batch_ids (or individual exec
    // ids for entries without a batch). Both sides of COALESCE must share a
    // type — batch_id is UUID, id is integer, so we cast both to text.
    const batchRows = await db('script_executions')
      .where({ schedule_id: scheduleId })
      .select(db.raw('COALESCE(batch_id::text, id::text) as batch_key'))
      .select(db.raw('MAX(triggered_at) as triggered_at'))
      .groupBy(db.raw('COALESCE(batch_id::text, id::text)'))
      .orderBy('triggered_at', 'desc')
      .limit(batchLimit);

    if (batchRows.length === 0) {
      return res.json({ data: [] });
    }

    const batchKeys = batchRows.map((b: any) => String(b.batch_key));

    // Split keys by shape so Postgres doesn't choke trying to cast a numeric
    // row-id string into a UUID (batch_id's column type). UUIDs → batch_id
    // lookup; everything else → standalone execution id lookup.
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const uuidKeys = batchKeys.filter((k: string) => uuidRe.test(k));
    const idKeys = batchKeys
      .filter((k: string) => !uuidRe.test(k))
      .map((k: string) => parseInt(k, 10))
      .filter((n: number) => Number.isFinite(n));

    // Step 2: fetch all executions belonging to those batches.
    const rows = await db('script_executions as se')
      .leftJoin('devices as d', 'd.id', 'se.device_id')
      .where({ 'se.schedule_id': scheduleId })
      .where(function () {
        // Always open the boolean group — either side may be empty but at
        // least one must exist because batchKeys.length > 0 above.
        if (uuidKeys.length) this.whereIn('se.batch_id', uuidKeys);
        else this.whereRaw('1 = 0'); // no uuid hits — fall back to id branch
        if (idKeys.length) this.orWhereIn('se.id', idKeys);
      })
      .select(
        'se.id', 'se.status', 'se.exit_code', 'se.stdout', 'se.stderr',
        'se.triggered_at', 'se.started_at', 'se.finished_at',
        'se.triggered_by', 'se.batch_id', 'se.device_id',
        'd.hostname as device_hostname',
        'd.display_name as device_display_name',
        'd.os_type as device_os_type',
      )
      .orderBy('se.triggered_at', 'desc');

    // Step 3: group into batches.
    const batchMap = new Map<string, any[]>();
    for (const r of rows) {
      const key = r.batch_id || String(r.id);
      if (!batchMap.has(key)) batchMap.set(key, []);
      batchMap.get(key)!.push(r);
    }

    const mapExec = (r: any) => ({
      id: r.id,
      status: r.status,
      exitCode: r.exit_code,
      stdout: r.stdout ? String(r.stdout).slice(0, 4000) : null,
      stderr: r.stderr ? String(r.stderr).slice(0, 4000) : null,
      triggeredAt: r.triggered_at,
      startedAt: r.started_at,
      finishedAt: r.finished_at,
      deviceId: r.device_id,
      deviceName: r.device_display_name || r.device_hostname || `#${r.device_id}`,
      deviceOsType: r.device_os_type,
    });

    // Preserve batch order from step 1
    const data = batchKeys.map((key: string) => {
      const items = (batchMap.get(key) || []).map(mapExec);
      const ok = items.filter((i: any) => i.status === 'success').length;
      const fail = items.filter((i: any) => i.status === 'failure' || i.status === 'timeout').length;
      const pending = items.filter((i: any) => ['pending', 'sent', 'running'].includes(i.status)).length;
      return {
        batchId: key,
        triggeredAt: items[0]?.triggeredAt,
        triggeredBy: (batchMap.get(key) || [])[0]?.triggered_by,
        total: items.length,
        ok,
        fail,
        pending,
        items,
      };
    }).filter((b: any) => b.items.length > 0);

    res.json({ data });
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

router.delete('/:id', requireTenantCapability('scripts.manage'), async (req, res, next) => {
  try {
    const existing = await db('script_schedules').where({ id: req.params.id, tenant_id: req.tenantId! }).first();
    await db('script_schedules').where({ id: req.params.id, tenant_id: req.tenantId! }).delete();
    try {
      const { auditService } = await import('../services/audit.service');
      await auditService.logReq(req, 'schedule.deleted', {
        resourceType: 'schedule', resourcePath: String(req.params.id),
        details: { name: existing?.name },
      });
    } catch {}
    res.status(204).send();
  } catch (err) { next(err); }
});

export default router;
