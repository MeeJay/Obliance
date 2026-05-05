import { db } from '../db';
import { logger } from '../utils/logger';
import { getIO } from '../socket';
import { SocketEvents } from '@obliance/shared';
import { commandService } from './command.service';
import type {
  Scenario,
  ScenarioStep,
  ScenarioRun,
  ScenarioStepRun,
  ScenarioTriggerType,
  ScenarioStatus,
  ScenarioRunStatus,
  ScenarioStepRunStatus,
} from '@obliance/shared';

// ── Row mappers ─────────────────────────────────────────────────────────────

function rowToScenario(row: any): Scenario {
  return {
    id: row.id,
    uuid: row.uuid,
    tenantId: row.tenant_id,
    name: row.name,
    description: row.description,
    triggerType: row.trigger_type,
    triggerConfig: typeof row.trigger_config === 'string' ? JSON.parse(row.trigger_config) : (row.trigger_config || {}),
    targetType: row.target_type,
    targetIds: typeof row.target_ids === 'string' ? JSON.parse(row.target_ids) : (row.target_ids || []),
    status: row.status,
    retryPolicy: typeof row.retry_policy === 'string' ? JSON.parse(row.retry_policy) : (row.retry_policy || { maxRetries: 0, retryDelaySeconds: 0 }),
    timeoutSeconds: row.timeout_seconds,
    notifyOnSuccess: row.notify_on_success,
    notifyOnFailure: row.notify_on_failure,
    notificationChannels: typeof row.notification_channels === 'string'
      ? JSON.parse(row.notification_channels)
      : (row.notification_channels || []),
    variables: typeof row.variables === 'string' ? JSON.parse(row.variables) : (row.variables || {}),
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToStep(row: any): ScenarioStep {
  const step: ScenarioStep = {
    id: row.id,
    scenarioId: row.scenario_id,
    sortOrder: row.sort_order,
    name: row.name,
    description: row.description,
    checkScriptId: row.check_script_id,
    resolveScriptId: row.resolve_script_id,
    timeoutSeconds: row.timeout_seconds,
    retryCount: row.retry_count,
    parameterOverrides: typeof row.parameter_overrides === 'string' ? JSON.parse(row.parameter_overrides) : (row.parameter_overrides || {}),
  };
  // Attach joined script info if present
  if (row.check_script_name !== undefined) {
    step.checkScript = row.check_script_id ? { id: row.check_script_id, name: row.check_script_name, platform: row.check_script_platform, runtime: row.check_script_runtime } : undefined;
  }
  if (row.resolve_script_name !== undefined) {
    step.resolveScript = row.resolve_script_id ? { id: row.resolve_script_id, name: row.resolve_script_name, platform: row.resolve_script_platform, runtime: row.resolve_script_runtime } : undefined;
  }
  return step;
}

function rowToRun(row: any): ScenarioRun {
  const run: ScenarioRun = {
    id: row.id,
    tenantId: row.tenant_id,
    scenarioId: row.scenario_id,
    deviceId: row.device_id,
    triggerType: row.trigger_type,
    triggerSource: row.trigger_source,
    status: row.status,
    currentStep: row.current_step,
    variables: typeof row.variables === 'string' ? JSON.parse(row.variables) : (row.variables || {}),
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    errorMessage: row.error_message,
    retryAttempt: row.retry_attempt,
    createdAt: row.created_at,
  };
  if (row.scenario_name !== undefined) {
    run.scenario = { id: row.scenario_id, name: row.scenario_name };
  }
  if (row.device_hostname !== undefined) {
    run.device = { id: row.device_id, hostname: row.device_hostname, displayName: row.device_display_name, osType: row.device_os_type };
  }
  return run;
}

function rowToStepRun(row: any): ScenarioStepRun {
  const sr: ScenarioStepRun = {
    id: row.id,
    runId: row.run_id,
    stepId: row.step_id,
    sortOrder: row.sort_order,
    status: row.status,
    checkExitCode: row.check_exit_code,
    checkStdout: row.check_stdout,
    checkStderr: row.check_stderr,
    checkStartedAt: row.check_started_at,
    checkFinishedAt: row.check_finished_at,
    resolveExitCode: row.resolve_exit_code,
    resolveStdout: row.resolve_stdout,
    resolveStderr: row.resolve_stderr,
    resolveStartedAt: row.resolve_started_at,
    resolveFinishedAt: row.resolve_finished_at,
    recheckExitCode: row.recheck_exit_code,
    recheckStdout: row.recheck_stdout,
    recheckStderr: row.recheck_stderr,
    recheckStartedAt: row.recheck_started_at,
    recheckFinishedAt: row.recheck_finished_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    retryAttempt: row.retry_attempt,
  };
  return sr;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function emitRunUpdate(tenantId: number, run: ScenarioRun) {
  try {
    const io = getIO();
    io.to(`tenant:${tenantId}`).emit(SocketEvents.SCENARIO_RUN_UPDATED, run);
  } catch {}
}

function emitStepUpdate(tenantId: number, stepRun: ScenarioStepRun) {
  try {
    const io = getIO();
    io.to(`tenant:${tenantId}`).emit(SocketEvents.SCENARIO_STEP_UPDATED, stepRun);
  } catch {}
}

// ── Service ─────────────────────────────────────────────────────────────────

export const scenarioService = {

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. CRUD
  // ═══════════════════════════════════════════════════════════════════════════

  async list(tenantId: number, filters?: { status?: ScenarioStatus; triggerType?: ScenarioTriggerType; page?: number; limit?: number }) {
    const limit = filters?.limit ?? 50;
    const page = filters?.page ?? 1;

    let baseQ = db('scenarios').where({ tenant_id: tenantId });
    if (filters?.status) baseQ = baseQ.where({ status: filters.status });
    if (filters?.triggerType) baseQ = baseQ.where({ trigger_type: filters.triggerType });

    const countResult = await baseQ.clone().count('id as count').first();
    const total = parseInt(String((countResult as any)?.count ?? 0));

    const rows = await baseQ.clone()
      .select(
        'scenarios.*',
        // v2 graphs no longer use the legacy `scenario_steps` table —
        // counting nodes (excluding passive trigger / terminator nodes)
        // gives admins a meaningful "size" badge that matches what
        // they see in the editor. Falls back to 0 cleanly for empty
        // scenarios and for v1-only scenarios that haven't been
        // migrated yet (those will still surface their step_count
        // through the next subquery).
        db.raw(`(
          SELECT COUNT(*) FROM scenario_nodes
          WHERE scenario_nodes.scenario_id = scenarios.id
            AND scenario_nodes.type NOT LIKE 'trigger_%'
            AND scenario_nodes.type NOT LIKE 'end_%'
        ) as node_count`),
        db.raw('(SELECT COUNT(*) FROM scenario_steps WHERE scenario_steps.scenario_id = scenarios.id) as step_count'),
      )
      .orderBy('scenarios.created_at', 'desc')
      .limit(limit)
      .offset((page - 1) * limit);

    // Aggregate the per-scenario trigger node counts in one round-trip
    // so the list view can badge "Schedule (2)" etc. without an N+1.
    // Returns rows like { scenario_id, type, count } where type is the
    // raw node type (e.g. 'trigger_schedule_cron').
    const triggerRows = await db('scenario_nodes')
      .whereIn('scenario_id', rows.map((r: any) => r.id))
      .whereLike('type', 'trigger_%')
      .select('scenario_id', 'type')
      .count<{ scenario_id: number; type: string; count: string | number }[]>('* as count')
      .groupBy('scenario_id', 'type');
    const triggerCountsByScenario = new Map<number, Record<string, number>>();
    for (const t of triggerRows) {
      const key = String(t.type).replace(/^trigger_/, '');
      const map = triggerCountsByScenario.get(t.scenario_id) ?? {};
      map[key] = (map[key] ?? 0) + (typeof t.count === 'number' ? t.count : parseInt(t.count, 10));
      triggerCountsByScenario.set(t.scenario_id, map);
    }

    // Active-run count per scenario — drives the "Stop" button and
    // the live spinner on the overview row when a graph is currently
    // executing on one or more devices.
    const activeRows = await db('scenario_runs')
      .whereIn('scenario_id', rows.map((r: any) => r.id))
      .whereIn('status', ['pending', 'running'])
      .select('scenario_id')
      .count<{ scenario_id: number; count: string | number }[]>('* as count')
      .groupBy('scenario_id');
    const activeRunsByScenario = new Map<number, number>();
    for (const a of activeRows) {
      activeRunsByScenario.set(a.scenario_id, typeof a.count === 'number' ? a.count : parseInt(a.count, 10));
    }

    return {
      items: rows.map((r: any) => {
        const nodeCount = parseInt(String(r.node_count ?? 0));
        const legacyStepCount = parseInt(String(r.step_count ?? 0));
        return {
          ...rowToScenario(r),
          // Prefer the v2 node count; fall back to v1 step count for
          // not-yet-migrated rows so they don't appear empty.
          stepCount: nodeCount > 0 ? nodeCount : legacyStepCount,
          nodeCount,
          triggerCounts: triggerCountsByScenario.get(r.id) ?? {},
          activeRunCount: activeRunsByScenario.get(r.id) ?? 0,
        };
      }),
      total,
    };
  },

  async getById(id: number, tenantId: number): Promise<(Scenario & { steps: ScenarioStep[] }) | null> {
    const row = await db('scenarios').where({ id, tenant_id: tenantId }).first();
    if (!row) return null;

    const stepRows = await db('scenario_steps')
      .where({ scenario_id: id })
      .select(
        'scenario_steps.*',
        'cs.name as check_script_name', 'cs.platform as check_script_platform', 'cs.runtime as check_script_runtime',
        'rs.name as resolve_script_name', 'rs.platform as resolve_script_platform', 'rs.runtime as resolve_script_runtime',
      )
      .leftJoin('scripts as cs', 'scenario_steps.check_script_id', 'cs.id')
      .leftJoin('scripts as rs', 'scenario_steps.resolve_script_id', 'rs.id')
      .orderBy('scenario_steps.sort_order', 'asc');

    const scenario = rowToScenario(row);
    return { ...scenario, steps: stepRows.map(rowToStep) };
  },

  async create(tenantId: number, data: {
    name: string;
    description?: string | null;
    triggerType: ScenarioTriggerType;
    triggerConfig?: Record<string, any>;
    targetType: string;
    targetIds: number[];
    status?: ScenarioStatus;
    retryPolicy?: { maxRetries: number; retryDelaySeconds: number };
    timeoutSeconds?: number;
    notifyOnSuccess?: boolean;
    notifyOnFailure?: boolean;
    variables?: Record<string, string>;
    steps: Array<{
      name: string;
      description?: string | null;
      checkScriptId?: number | null;
      resolveScriptId?: number | null;
      timeoutSeconds?: number;
      retryCount?: number;
      parameterOverrides?: Record<string, string>;
    }>;
  }, userId: number): Promise<Scenario> {
    return db.transaction(async (trx) => {
      const [row] = await trx('scenarios').insert({
        tenant_id: tenantId,
        name: data.name,
        description: data.description || null,
        trigger_type: data.triggerType,
        trigger_config: JSON.stringify(data.triggerConfig || {}),
        target_type: data.targetType,
        target_ids: JSON.stringify(data.targetIds),
        status: data.status || 'draft',
        retry_policy: JSON.stringify(data.retryPolicy || { maxRetries: 0, retryDelaySeconds: 0 }),
        timeout_seconds: data.timeoutSeconds ?? 3600,
        notify_on_success: data.notifyOnSuccess ?? false,
        notify_on_failure: data.notifyOnFailure ?? true,
        notification_channels: JSON.stringify((data as any).notificationChannels || []),
        variables: JSON.stringify(data.variables || {}),
        created_by: userId,
        updated_by: userId,
      }).returning('*');

      if (data.steps?.length) {
        const stepInserts = data.steps.map((s, idx) => ({
          scenario_id: row.id,
          sort_order: idx,
          name: s.name,
          description: s.description || null,
          check_script_id: s.checkScriptId || null,
          resolve_script_id: s.resolveScriptId || null,
          timeout_seconds: s.timeoutSeconds ?? 300,
          retry_count: s.retryCount ?? 0,
          parameter_overrides: JSON.stringify(s.parameterOverrides || {}),
        }));
        await trx('scenario_steps').insert(stepInserts);
      }

      return rowToScenario(row);
    });
  },

  async update(id: number, tenantId: number, data: {
    name?: string;
    description?: string | null;
    triggerType?: ScenarioTriggerType;
    triggerConfig?: Record<string, any>;
    targetType?: string;
    targetIds?: number[];
    status?: ScenarioStatus;
    retryPolicy?: { maxRetries: number; retryDelaySeconds: number };
    timeoutSeconds?: number;
    notifyOnSuccess?: boolean;
    notifyOnFailure?: boolean;
    variables?: Record<string, string>;
    steps?: Array<{
      name: string;
      description?: string | null;
      checkScriptId?: number | null;
      resolveScriptId?: number | null;
      timeoutSeconds?: number;
      retryCount?: number;
      parameterOverrides?: Record<string, string>;
    }>;
  }, userId: number): Promise<Scenario | null> {
    return db.transaction(async (trx) => {
      const existing = await trx('scenarios').where({ id, tenant_id: tenantId }).first();
      if (!existing) return null;

      const updates: any = { updated_by: userId, updated_at: new Date() };
      if (data.name !== undefined) updates.name = data.name;
      if (data.description !== undefined) updates.description = data.description;
      if (data.triggerType !== undefined) updates.trigger_type = data.triggerType;
      if (data.triggerConfig !== undefined) updates.trigger_config = JSON.stringify(data.triggerConfig);
      if (data.targetType !== undefined) updates.target_type = data.targetType;
      if (data.targetIds !== undefined) updates.target_ids = JSON.stringify(data.targetIds);
      if (data.status !== undefined) updates.status = data.status;
      if (data.retryPolicy !== undefined) updates.retry_policy = JSON.stringify(data.retryPolicy);
      if (data.timeoutSeconds !== undefined) updates.timeout_seconds = data.timeoutSeconds;
      if (data.notifyOnSuccess !== undefined) updates.notify_on_success = data.notifyOnSuccess;
      if (data.notifyOnFailure !== undefined) updates.notify_on_failure = data.notifyOnFailure;
      if ((data as any).notificationChannels !== undefined) updates.notification_channels = JSON.stringify((data as any).notificationChannels);
      if (data.variables !== undefined) updates.variables = JSON.stringify(data.variables);

      const [row] = await trx('scenarios').where({ id }).update(updates).returning('*');

      // Replace steps if provided
      if (data.steps !== undefined) {
        await trx('scenario_steps').where({ scenario_id: id }).del();
        if (data.steps.length) {
          const stepInserts = data.steps.map((s, idx) => ({
            scenario_id: id,
            sort_order: idx,
            name: s.name,
            description: s.description || null,
            check_script_id: s.checkScriptId || null,
            resolve_script_id: s.resolveScriptId || null,
            timeout_seconds: s.timeoutSeconds ?? 300,
            retry_count: s.retryCount ?? 0,
            parameter_overrides: JSON.stringify(s.parameterOverrides || {}),
          }));
          await trx('scenario_steps').insert(stepInserts);
        }
      }

      return rowToScenario(row);
    });
  },

  async delete(id: number, tenantId: number): Promise<boolean> {
    const count = await db('scenarios').where({ id, tenant_id: tenantId }).del();
    return count > 0;
  },

  async enable(id: number, tenantId: number): Promise<Scenario | null> {
    const [row] = await db('scenarios')
      .where({ id, tenant_id: tenantId })
      .update({ status: 'active', updated_at: new Date() })
      .returning('*');
    return row ? rowToScenario(row) : null;
  },

  async disable(id: number, tenantId: number): Promise<Scenario | null> {
    const [row] = await db('scenarios')
      .where({ id, tenant_id: tenantId })
      .update({ status: 'disabled', updated_at: new Date() })
      .returning('*');
    return row ? rowToScenario(row) : null;
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. Triggers
  // ═══════════════════════════════════════════════════════════════════════════

  async fireTrigger(triggerType: ScenarioTriggerType, deviceId: number, tenantId: number, data?: { groupId?: number; scheduleId?: number; offlineSeconds?: number }) {
    // Multi-trigger model: a single scenario may carry several trigger
    // nodes of the same kind (e.g. two cron schedules) or a mix of
    // kinds. The dispatcher therefore matches on scenario_nodes.type
    // rather than scenarios.trigger_type, and fires startRun once per
    // matching node so the engine starts at the right entry point.
    const triggerNodeType = `trigger_${triggerType}`;
    const triggerNodes = await db('scenario_nodes as n')
      .join('scenarios as s', 's.id', 'n.scenario_id')
      .where({ 's.tenant_id': tenantId, 's.status': 'active', 'n.type': triggerNodeType })
      .select('n.id as node_id', 'n.config as node_config', 's.id as scenario_id') as Array<{
        node_id: number; node_config: any; scenario_id: number;
      }>;

    for (const tn of triggerNodes) {
      try {
        const scenarioRow = await db('scenarios').where({ id: tn.scenario_id }).first();
        if (!scenarioRow) continue;
        const scenario = rowToScenario(scenarioRow);

        // Same target-match check as before — applies regardless of
        // which trigger node fired.
        if (!(await matchesTarget(scenario, deviceId, data?.groupId))) continue;

        // Per-node config filters (replaces the old scenario-level
        // triggerConfig). Each trigger node carries its own filters
        // in its config JSON.
        const nodeConfig = typeof tn.node_config === 'string' ? JSON.parse(tn.node_config) : (tn.node_config ?? {});
        if (triggerType === 'schedule_failure' && nodeConfig.scheduleId) {
          if (data?.scheduleId !== nodeConfig.scheduleId) continue;
        }
        if (triggerType === 'group_join' && Array.isArray(nodeConfig.groupIds) && nodeConfig.groupIds.length > 0) {
          if (!data?.groupId || !nodeConfig.groupIds.includes(data.groupId)) continue;
        }

        // Agent-back-online debounce — each trigger node carries its
        // own `offlineDelaySeconds` (default 60s). Outages shorter
        // than that are flaps and we skip the run. This is the whole
        // point of the trigger: filter network glitches out, only
        // fire on real downtime returning to service.
        if (triggerType === 'agent_back_online') {
          const requiredSec = Number(nodeConfig.offlineDelaySeconds ?? 60);
          const actualSec = Number(data?.offlineSeconds ?? 0);
          if (!Number.isFinite(actualSec) || actualSec < requiredSec) {
            logger.debug({ scenarioId: scenario.id, deviceId, requiredSec, actualSec }, 'agent_back_online: outage too short, skipping flap');
            continue;
          }
        }

        // One-shot dedup for agent_approved — same semantics as v1
        // but scoped to (scenario, device), not (trigger node, device),
        // so two trigger_agent_approved nodes in the same scenario
        // still share the dedup window.
        if (triggerType === 'agent_approved') {
          const existing = await db('scenario_runs')
            .where({ scenario_id: scenario.id, device_id: deviceId })
            .whereNot({ status: 'cancelled' })
            .first();
          if (existing) continue;
        }

        const triggerSource = `${triggerType}${data?.groupId ? `:group:${data.groupId}` : ''}${data?.scheduleId ? `:schedule:${data.scheduleId}` : ''}`;

        const { scenarioGraphService } = await import('./scenarioGraph.service');
        await scenarioGraphService.startRun(scenario.id, deviceId, {
          triggerType, triggerSource, triggerNodeId: tn.node_id,
        });
      } catch (err) {
        logger.error(err, `Failed to fire trigger node ${tn.node_id} for device ${deviceId}`);
      }
    }
  },

  async triggerScenario(scenarioId: number, deviceId: number, tenantId: number, triggerType: ScenarioTriggerType, triggerSource: string): Promise<ScenarioRun | null> {
    const scenario = await db('scenarios').where({ id: scenarioId, tenant_id: tenantId }).first();
    if (!scenario) return null;

    // Skip-in-flight: if a previous run of this scenario is still in progress
    // on this device, refuse to launch a second one. Avoids stacking parallel
    // runs that could interfere with each other.
    const inFlight = await db('scenario_runs')
      .where({ scenario_id: scenarioId, device_id: deviceId })
      .whereIn('status', ['pending', 'running'])
      .first();
    if (inFlight) {
      logger.info({ scenarioId, deviceId }, 'scenario: skipping trigger, previous run still in progress');
      return null;
    }

    // ── v2 dispatch ────────────────────────────────────────────────────
    // Phase 1G: v2 is now the ONLY engine. The boot migration + the
    // post-create / post-instantiate hook ensure every scenario has v2
    // nodes. If we somehow get here without nodes, surface a clear
    // error rather than silently falling through to the dead v1 step
    // executor below. The v1 code paths past this point are dead code
    // kept temporarily for rollback — see Phase 1H drop.
    const hasV2 = await db('scenario_nodes').where({ scenario_id: scenarioId }).first();
    if (!hasV2) {
      logger.error({ scenarioId }, 'triggerScenario: scenario has no v2 nodes — graph migration may have failed');
      throw new Error(`Scenario ${scenarioId} has no graph nodes. Open it in the graph editor and save once.`);
    }
    const { scenarioGraphService } = await import('./scenarioGraph.service');
    const runId = await scenarioGraphService.startRun(scenarioId, deviceId, {
      triggerType, triggerSource,
    });
    const runRow = await db('scenario_runs').where({ id: runId }).first();
    return runRow ? rowToRun(runRow) : null;
  },

  async resolveTargetDevices(scenarioId: number, tenantId: number): Promise<number[]> {
    const scenarioRow = await db('scenarios').where({ id: scenarioId, tenant_id: tenantId }).first();
    if (!scenarioRow) return [];
    const scenario = rowToScenario(scenarioRow);

    if (scenario.targetType === 'all') {
      const rows = await db('devices').where({ tenant_id: tenantId }).select('id');
      return rows.map((r: any) => r.id);
    }
    if (scenario.targetType === 'group') {
      const groupIds = scenario.targetIds || [];
      if (groupIds.length === 0) return [];
      // Expand to include descendants via closure table
      const closureRows = await db('device_group_closure')
        .whereIn('ancestor_id', groupIds)
        .select('descendant_id');
      const allGroupIds = Array.from(new Set([
        ...groupIds,
        ...closureRows.map((r: any) => r.descendant_id),
      ]));
      const rows = await db('devices')
        .where({ tenant_id: tenantId })
        .whereIn('group_id', allGroupIds)
        .select('id');
      return rows.map((r: any) => r.id);
    }
    if (scenario.targetType === 'device') {
      return scenario.targetIds || [];
    }
    return [];
  },

  async triggerManual(scenarioId: number, deviceIds: number[], tenantId: number): Promise<ScenarioRun[]> {
    // If no devices provided, resolve from scenario's target config
    let targets = deviceIds;
    if (!targets || targets.length === 0) {
      targets = await scenarioService.resolveTargetDevices(scenarioId, tenantId);
    }

    const runs: ScenarioRun[] = [];
    for (const deviceId of targets) {
      try {
        const run = await scenarioService.triggerScenario(scenarioId, deviceId, tenantId, 'manual', 'manual');
        if (run) runs.push(run);
      } catch (err) {
        logger.error(err, `Failed to manually trigger scenario ${scenarioId} on device ${deviceId}`);
      }
    }
    return runs;
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. Orchestration Engine (state machine)
  // ═══════════════════════════════════════════════════════════════════════════

  async executeNextStep(runId: string) {
    const runRow = await db('scenario_runs').where({ id: runId }).first();
    if (!runRow) return;
    if (runRow.status !== 'running') return;

    const run = rowToRun(runRow);
    const stepRuns = await db('scenario_step_runs')
      .where({ run_id: runId })
      .orderBy('sort_order', 'asc');

    if (!stepRuns.length) {
      await markRunComplete(runId, run.tenantId, 'success');
      return;
    }

    const currentIndex = run.currentStep;

    // If current_step >= total steps, the run is complete
    if (currentIndex >= stepRuns.length) {
      await markRunComplete(runId, run.tenantId, 'success');
      return;
    }

    const stepRunRow = stepRuns[currentIndex];
    const stepRun = rowToStepRun(stepRunRow);

    // Load the step definition
    const step = await db('scenario_steps').where({ id: stepRun.stepId }).first();
    if (!step) {
      await markRunFailed(runId, run.tenantId, `Step definition not found for step_id ${stepRun.stepId}`);
      return;
    }

    // Load scenario variables
    const variables = run.variables || {};
    const paramOverrides = typeof step.parameter_overrides === 'string' ? JSON.parse(step.parameter_overrides) : (step.parameter_overrides || {});
    const mergedParams = { ...variables, ...paramOverrides };

    if (step.check_script_id) {
      // Enqueue check script
      await db('scenario_step_runs').where({ id: stepRun.id }).update({
        status: 'check_running',
        check_started_at: new Date(),
        started_at: db.raw('COALESCE(started_at, NOW())'),
      });
      emitStepUpdate(run.tenantId, { ...stepRun, status: 'check_running' });

      await commandService.enqueue({
        deviceId: run.deviceId,
        tenantId: run.tenantId,
        type: 'run_script',
        payload: { scriptId: step.check_script_id, parameters: mergedParams },
        priority: 'high',
        sourceType: 'scenario_step_check',
        sourceId: stepRun.id,
        expiresInSeconds: step.timeout_seconds || 300,
      });
    } else if (step.resolve_script_id) {
      // No check script — go straight to resolve
      await db('scenario_step_runs').where({ id: stepRun.id }).update({
        status: 'resolve_running',
        resolve_started_at: new Date(),
        started_at: db.raw('COALESCE(started_at, NOW())'),
      });
      emitStepUpdate(run.tenantId, { ...stepRun, status: 'resolve_running' });

      await commandService.enqueue({
        deviceId: run.deviceId,
        tenantId: run.tenantId,
        type: 'run_script',
        payload: { scriptId: step.resolve_script_id, parameters: mergedParams },
        priority: 'high',
        sourceType: 'scenario_step_resolve',
        sourceId: stepRun.id,
        expiresInSeconds: step.timeout_seconds || 300,
      });
    } else {
      // No scripts at all — auto-pass this step and advance
      await db('scenario_step_runs').where({ id: stepRun.id }).update({
        status: 'success',
        started_at: new Date(),
        finished_at: new Date(),
      });
      emitStepUpdate(run.tenantId, { ...stepRun, status: 'success' });

      await db('scenario_runs').where({ id: runId }).update({
        current_step: currentIndex + 1,
        updated_at: new Date(),
      });

      // Recurse to next step
      await scenarioService.executeNextStep(runId);
    }
  },

  async handleScenarioCommandAck(
    commandId: string,
    sourceType: string,
    sourceId: string,
    exitCode: number | null,
    stdout: string | null,
    stderr: string | null,
  ) {
    const stepRunRow = await db('scenario_step_runs').where({ id: sourceId }).first();
    if (!stepRunRow) {
      logger.warn({ sourceId, sourceType }, 'Scenario step run not found for command ack');
      return;
    }

    const stepRun = rowToStepRun(stepRunRow);
    const runRow = await db('scenario_runs').where({ id: stepRun.runId }).first();
    if (!runRow) return;

    const run = rowToRun(runRow);
    if (run.status !== 'running') return;

    const step = await db('scenario_steps').where({ id: stepRun.stepId }).first();
    if (!step) return;

    const variables = run.variables || {};
    const paramOverrides = typeof step.parameter_overrides === 'string' ? JSON.parse(step.parameter_overrides) : (step.parameter_overrides || {});
    const mergedParams = { ...variables, ...paramOverrides };

    const success = exitCode === 0;

    // ── scenario_step_check ───────────────────────────────────────────────
    if (sourceType === 'scenario_step_check') {
      await db('scenario_step_runs').where({ id: sourceId }).update({
        check_exit_code: exitCode,
        check_stdout: stdout,
        check_stderr: stderr,
        check_finished_at: new Date(),
      });

      if (success) {
        // Check passed — step is successful
        await db('scenario_step_runs').where({ id: sourceId }).update({
          status: 'success',
          finished_at: new Date(),
        });
        emitStepUpdate(run.tenantId, { ...stepRun, status: 'success', checkExitCode: exitCode });

        // Advance
        await db('scenario_runs').where({ id: run.id }).update({
          current_step: run.currentStep + 1,
          updated_at: new Date(),
        });
        await scenarioService.executeNextStep(run.id);
      } else {
        // Check failed
        if (step.resolve_script_id) {
          // Enqueue resolve script
          await db('scenario_step_runs').where({ id: sourceId }).update({
            status: 'resolve_running',
            resolve_started_at: new Date(),
          });
          emitStepUpdate(run.tenantId, { ...stepRun, status: 'resolve_running' });

          await commandService.enqueue({
            deviceId: run.deviceId,
            tenantId: run.tenantId,
            type: 'run_script',
            payload: { scriptId: step.resolve_script_id, parameters: mergedParams },
            priority: 'high',
            sourceType: 'scenario_step_resolve',
            sourceId: stepRun.id,
            expiresInSeconds: step.timeout_seconds || 300,
          });
        } else {
          // No resolve script — step failed
          await db('scenario_step_runs').where({ id: sourceId }).update({
            status: 'failed',
            finished_at: new Date(),
          });
          emitStepUpdate(run.tenantId, { ...stepRun, status: 'failed' });

          await markRunFailed(run.id, run.tenantId, `Step "${step.name}" check failed (exit code ${exitCode})`);
        }
      }
    }

    // ── scenario_step_resolve ─────────────────────────────────────────────
    else if (sourceType === 'scenario_step_resolve') {
      await db('scenario_step_runs').where({ id: sourceId }).update({
        resolve_exit_code: exitCode,
        resolve_stdout: stdout,
        resolve_stderr: stderr,
        resolve_finished_at: new Date(),
      });

      if (success) {
        // Resolve succeeded — recheck if there's a check script
        if (step.check_script_id) {
          await db('scenario_step_runs').where({ id: sourceId }).update({
            status: 'recheck_running',
            recheck_started_at: new Date(),
          });
          emitStepUpdate(run.tenantId, { ...stepRun, status: 'recheck_running' });

          await commandService.enqueue({
            deviceId: run.deviceId,
            tenantId: run.tenantId,
            type: 'run_script',
            payload: { scriptId: step.check_script_id, parameters: mergedParams },
            priority: 'high',
            sourceType: 'scenario_step_recheck',
            sourceId: stepRun.id,
            expiresInSeconds: step.timeout_seconds || 300,
          });
        } else {
          // No check script to recheck — step is successful
          await db('scenario_step_runs').where({ id: sourceId }).update({
            status: 'success',
            finished_at: new Date(),
          });
          emitStepUpdate(run.tenantId, { ...stepRun, status: 'success' });

          await db('scenario_runs').where({ id: run.id }).update({
            current_step: run.currentStep + 1,
            updated_at: new Date(),
          });
          await scenarioService.executeNextStep(run.id);
        }
      } else {
        // Resolve failed — check retries
        const currentRetry = stepRunRow.retry_attempt || 0;
        const maxRetries = step.retry_count || 0;

        if (currentRetry < maxRetries) {
          // Retry the resolve script
          await db('scenario_step_runs').where({ id: sourceId }).update({
            retry_attempt: currentRetry + 1,
            status: 'resolve_running',
            resolve_started_at: new Date(),
            resolve_exit_code: null,
            resolve_stdout: null,
            resolve_stderr: null,
            resolve_finished_at: null,
          });
          emitStepUpdate(run.tenantId, { ...stepRun, status: 'resolve_running', retryAttempt: currentRetry + 1 });

          await commandService.enqueue({
            deviceId: run.deviceId,
            tenantId: run.tenantId,
            type: 'run_script',
            payload: { scriptId: step.resolve_script_id, parameters: mergedParams },
            priority: 'high',
            sourceType: 'scenario_step_resolve',
            sourceId: stepRun.id,
            expiresInSeconds: step.timeout_seconds || 300,
          });
        } else {
          // No retries left — step failed
          await db('scenario_step_runs').where({ id: sourceId }).update({
            status: 'failed',
            finished_at: new Date(),
          });
          emitStepUpdate(run.tenantId, { ...stepRun, status: 'failed' });

          await markRunFailed(run.id, run.tenantId, `Step "${step.name}" resolve failed after ${maxRetries} retries (exit code ${exitCode})`);
        }
      }
    }

    // ── scenario_step_recheck ─────────────────────────────────────────────
    else if (sourceType === 'scenario_step_recheck') {
      await db('scenario_step_runs').where({ id: sourceId }).update({
        recheck_exit_code: exitCode,
        recheck_stdout: stdout,
        recheck_stderr: stderr,
        recheck_finished_at: new Date(),
      });

      if (success) {
        // Recheck passed — step is successful
        await db('scenario_step_runs').where({ id: sourceId }).update({
          status: 'success',
          finished_at: new Date(),
        });
        emitStepUpdate(run.tenantId, { ...stepRun, status: 'success' });

        // Advance
        await db('scenario_runs').where({ id: run.id }).update({
          current_step: run.currentStep + 1,
          updated_at: new Date(),
        });
        await scenarioService.executeNextStep(run.id);
      } else {
        // Recheck failed — step failed, run failed
        await db('scenario_step_runs').where({ id: sourceId }).update({
          status: 'failed',
          finished_at: new Date(),
        });
        emitStepUpdate(run.tenantId, { ...stepRun, status: 'failed' });

        await markRunFailed(run.id, run.tenantId, `Step "${step.name}" recheck failed after remediation (exit code ${exitCode})`);
      }
    }
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. Run queries
  // ═══════════════════════════════════════════════════════════════════════════

  async listRuns(tenantId: number, filters?: { scenarioId?: number; deviceId?: number; status?: ScenarioRunStatus; page?: number; limit?: number }) {
    const limit = filters?.limit ?? 50;
    const page = filters?.page ?? 1;

    let baseQ = db('scenario_runs').where({ 'scenario_runs.tenant_id': tenantId });
    if (filters?.scenarioId) baseQ = baseQ.where({ 'scenario_runs.scenario_id': filters.scenarioId });
    if (filters?.deviceId) baseQ = baseQ.where({ 'scenario_runs.device_id': filters.deviceId });
    if (filters?.status) baseQ = baseQ.where({ 'scenario_runs.status': filters.status });

    const countResult = await baseQ.clone().count('scenario_runs.id as count').first();
    const total = parseInt(String((countResult as any)?.count ?? 0));

    const rows = await baseQ.clone()
      .select(
        'scenario_runs.*',
        's.name as scenario_name',
        'd.hostname as device_hostname',
        'd.display_name as device_display_name',
        'd.os_type as device_os_type',
      )
      .leftJoin('scenarios as s', 'scenario_runs.scenario_id', 's.id')
      .leftJoin('devices as d', 'scenario_runs.device_id', 'd.id')
      .orderBy('scenario_runs.created_at', 'desc')
      .limit(limit)
      .offset((page - 1) * limit);

    return { items: rows.map(rowToRun), total };
  },

  async getRunById(runId: string, tenantId: number): Promise<ScenarioRun | null> {
    const row = await db('scenario_runs')
      .where({ 'scenario_runs.id': runId, 'scenario_runs.tenant_id': tenantId })
      .select(
        'scenario_runs.*',
        's.name as scenario_name',
        'd.hostname as device_hostname',
        'd.display_name as device_display_name',
        'd.os_type as device_os_type',
      )
      .leftJoin('scenarios as s', 'scenario_runs.scenario_id', 's.id')
      .leftJoin('devices as d', 'scenario_runs.device_id', 'd.id')
      .first();

    if (!row) return null;

    const run = rowToRun(row);

    // Load step runs with step info
    const stepRunRows = await db('scenario_step_runs')
      .where({ run_id: runId })
      .select(
        'scenario_step_runs.*',
      )
      .orderBy('scenario_step_runs.sort_order', 'asc');

    run.stepRuns = stepRunRows.map(rowToStepRun);

    // Attach step definitions
    if (run.stepRuns.length) {
      const stepIds = run.stepRuns.map((sr) => sr.stepId);
      const steps = await db('scenario_steps')
        .whereIn('id', stepIds)
        .select(
          'scenario_steps.*',
          'cs.name as check_script_name', 'cs.platform as check_script_platform', 'cs.runtime as check_script_runtime',
          'rs.name as resolve_script_name', 'rs.platform as resolve_script_platform', 'rs.runtime as resolve_script_runtime',
        )
        .leftJoin('scripts as cs', 'scenario_steps.check_script_id', 'cs.id')
        .leftJoin('scripts as rs', 'scenario_steps.resolve_script_id', 'rs.id');

      const stepMap = new Map(steps.map((s: any) => [s.id, rowToStep(s)]));
      for (const sr of run.stepRuns) {
        sr.step = stepMap.get(sr.stepId);
      }
    }

    return run;
  },

  async cancelRun(runId: string, tenantId: number): Promise<boolean> {
    // Best-effort cancel: each section is wrapped so a partial
    // failure (e.g. a stale row from an older schema) doesn't prevent
    // us from at least flipping the parent run to 'cancelled'. The
    // primary goal is to free the user from a stuck-running UI.
    const runRow = await db('scenario_runs').where({ id: runId, tenant_id: tenantId }).first();
    if (!runRow) {
      logger.warn({ runId, tenantId }, 'cancelRun: run not found');
      return false;
    }
    if (!['pending', 'running'].includes(runRow.status)) {
      // Already terminal — idempotent no-op, treat as success so the
      // caller's UI just flips the row to 'cancelled' without an
      // error toast.
      return true;
    }

    const finishedAt = new Date();

    try {
      await db('scenario_runs').where({ id: runId }).update({
        status: 'cancelled',
        finished_at: finishedAt,
        updated_at: finishedAt,
        error_message: 'Run cancelled by user',
      });
    } catch (err) {
      logger.error({ err, runId }, 'cancelRun: failed to update scenario_runs');
      throw err;
    }

    // v1 — mark all in-flight step runs as skipped. Old enum has no
    // 'cancelled' value; 'skipped' is the closest terminal state.
    try {
      await db('scenario_step_runs')
        .where({ run_id: runId })
        .whereIn('status', ['pending', 'check_running', 'resolve_running', 'recheck_running'])
        .update({
          status: 'skipped',
          finished_at: finishedAt,
        });
    } catch (err) {
      logger.error({ err, runId }, 'cancelRun: failed to update scenario_step_runs (non-fatal)');
    }

    // v2 — mark in-flight node runs as cancelled and emit a socket
    // event per node so the editor unpaints the running ring and
    // shows the terminal state. Any failure here is non-fatal — the
    // parent run is already cancelled.
    let inflightNodeRuns: Array<{ id: string; node_id: number }> = [];
    try {
      inflightNodeRuns = await db('scenario_node_runs')
        .where({ run_id: runId })
        .where('status', 'running')
        .select('id', 'node_id') as Array<{ id: string; node_id: number }>;
      if (inflightNodeRuns.length > 0) {
        await db('scenario_node_runs')
          .whereIn('id', inflightNodeRuns.map((r) => r.id))
          .update({
            status: 'cancelled',
            error_message: 'Run cancelled by user',
            finished_at: finishedAt,
          });
      }
    } catch (err) {
      logger.error({ err, runId }, 'cancelRun: failed to update scenario_node_runs (non-fatal)');
    }

    // Cancel any pending command_queue rows tied to those node-runs
    // so the agent doesn't pick up commands that no longer matter.
    // 'sent' commands are already on the agent — those will fail
    // naturally on the agent side or via the cleanup-job timeout.
    if (inflightNodeRuns.length > 0) {
      try {
        await db('command_queue')
          .whereIn('source_id', inflightNodeRuns.map((r) => r.id))
          .where('source_type', 'scenario_node')
          .where('status', 'pending')
          .update({ status: 'cancelled', updated_at: finishedAt });
      } catch (err) {
        logger.error({ err, runId }, 'cancelRun: failed to cancel command_queue rows (non-fatal)');
      }
    }

    // Push a socket event for each node so the editor live-viewer
    // sees the cancellation immediately. Wrapped because getIO()
    // may not be initialised in some test contexts.
    try {
      const io = getIO();
      if (io) {
        for (const nr of inflightNodeRuns) {
          io.to(`tenant:${tenantId}`).emit(SocketEvents.SCENARIO_NODE_UPDATED, {
            runId, nodeRunId: nr.id, nodeId: nr.node_id,
            status: 'cancelled',
            scenarioId: runRow.scenario_id,
            exitCode: null,
            stdout: null,
            stderr: 'Run cancelled by user',
            errorMessage: 'Run cancelled by user',
            deviceId: runRow.device_id,
          });
        }
      }
    } catch { /* socket not ready */ }

    try {
      const run = rowToRun({ ...runRow, status: 'cancelled', finished_at: finishedAt });
      emitRunUpdate(tenantId, run);
    } catch { /* socket not ready */ }

    return true;
  },

  /**
   * Cancel every in-flight run for a scenario. Returns the number of
   * runs that were actually cancelled (some may already be terminal
   * by the time we read them). Used by the "Stop scenario" button on
   * the overview page when the user wants to abort everything at once.
   */
  async cancelAllRuns(scenarioId: number, tenantId: number): Promise<number> {
    const inFlight = await db('scenario_runs')
      .where({ scenario_id: scenarioId, tenant_id: tenantId })
      .whereIn('status', ['pending', 'running'])
      .select('id') as Array<{ id: string }>;
    let cancelled = 0;
    for (const r of inFlight) {
      const ok = await this.cancelRun(r.id, tenantId);
      if (ok) cancelled++;
    }
    return cancelled;
  },
};

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Check whether a given device falls under a scenario's target. Handles
 * the four `targetType` values:
 *
 *  - 'all'    → every device in the tenant qualifies.
 *  - 'self'   → the originating device of an event trigger ALWAYS qualifies
 *               (the action runs on the device that emitted session_login,
 *               machine_boot, group_join, agent_approved, etc.).
 *  - 'device' → device must be in `targetIds`.
 *  - 'group'  → device's group must be one of `targetIds`, OR a descendant
 *               of one (via the device_group_closure table). The optional
 *               `originGroupId` short-circuits the check when the trigger
 *               already knows the joined/relevant group (group_join).
 *
 * Async because the 'group' branch has to look up the device's group_id
 * and walk the closure when the caller didn't pass `originGroupId`.
 */
async function matchesTarget(
  scenario: Scenario,
  deviceId: number,
  originGroupId?: number,
): Promise<boolean> {
  if (scenario.targetType === 'all') return true;
  if (scenario.targetType === 'self') return true;
  if (scenario.targetType === 'device') return scenario.targetIds.includes(deviceId);
  if (scenario.targetType === 'group') {
    if (!scenario.targetIds.length) return false;

    // Fast path: caller already knows the relevant group (e.g. the one
    // the device just joined for a group_join event). If it's directly
    // listed as a target we're done; otherwise still need the closure
    // check below to handle "target = parent group, joined = child".
    if (originGroupId && scenario.targetIds.includes(originGroupId)) return true;

    // Resolve the device's actual group, then ask the closure: is that
    // group a descendant of any target? Falls back to originGroupId when
    // the device row hasn't been refreshed yet (e.g. group_join fires
    // before the move has been committed in our caller's transaction).
    let groupId: number | null = originGroupId ?? null;
    if (groupId == null) {
      const device = await db('devices').where({ id: deviceId }).select('group_id').first();
      groupId = device?.group_id ?? null;
    }
    if (groupId == null) return false;

    const match = await db('device_group_closure')
      .whereIn('ancestor_id', scenario.targetIds)
      .where('descendant_id', groupId)
      .first();
    return !!match;
  }
  return false;
}

async function dispatchScenarioChannelNotification(
  runId: string,
  tenantId: number,
  outcome: 'success' | 'failure',
): Promise<void> {
  try {
    const run = await db('scenario_runs').where({ id: runId }).first();
    if (!run) return;
    const scenario = await db('scenarios').where({ id: run.scenario_id }).first();
    if (!scenario?.notification_channels) return;
    const bindings = typeof scenario.notification_channels === 'string'
      ? JSON.parse(scenario.notification_channels)
      : scenario.notification_channels;
    if (!Array.isArray(bindings) || bindings.length === 0) return;

    const device = await db('devices').where({ id: run.device_id }).select('hostname', 'display_name').first();
    const name = device?.display_name || device?.hostname || `#${run.device_id}`;
    const { automationNotificationService } = await import('./automationNotification.service');
    await automationNotificationService.notify(tenantId, bindings, {
      automationType: 'scenario',
      automationName: scenario.name,
      successCount: outcome === 'success' ? 1 : 0,
      failureCount: outcome === 'failure' ? 1 : 0,
      totalCount: 1,
      failedDeviceNames: outcome === 'failure' ? [name] : [],
    });
  } catch (err) {
    logger.error(err, 'scenario notification dispatch failed');
  }
}

async function markRunComplete(runId: string, tenantId: number, status: 'success') {
  const [row] = await db('scenario_runs').where({ id: runId }).update({
    status,
    finished_at: new Date(),
    updated_at: new Date(),
  }).returning('*');

  if (row) {
    const run = rowToRun(row);
    emitRunUpdate(tenantId, run);
    await dispatchScenarioChannelNotification(runId, tenantId, 'success');
  }
}

async function markRunFailed(runId: string, tenantId: number, errorMessage: string) {
  const [row] = await db('scenario_runs').where({ id: runId }).update({
    status: 'failure',
    error_message: errorMessage,
    finished_at: new Date(),
    updated_at: new Date(),
  }).returning('*');

  // Mark remaining pending steps as skipped
  await db('scenario_step_runs')
    .where({ run_id: runId, status: 'pending' })
    .update({ status: 'skipped', finished_at: new Date() });

  if (row) {
    const run = rowToRun(row);
    emitRunUpdate(tenantId, run);
    await dispatchScenarioChannelNotification(runId, tenantId, 'failure');
  }
}
