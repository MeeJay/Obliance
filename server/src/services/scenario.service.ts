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
        db.raw('(SELECT COUNT(*) FROM scenario_steps WHERE scenario_steps.scenario_id = scenarios.id) as step_count'),
      )
      .orderBy('scenarios.created_at', 'desc')
      .limit(limit)
      .offset((page - 1) * limit);

    return {
      items: rows.map((r: any) => ({ ...rowToScenario(r), stepCount: parseInt(String(r.step_count ?? 0)) })),
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

  async fireTrigger(triggerType: ScenarioTriggerType, deviceId: number, tenantId: number, data?: { groupId?: number; scheduleId?: number }) {
    // Find all active scenarios matching this trigger type for this tenant
    const scenarios = await db('scenarios')
      .where({ tenant_id: tenantId, trigger_type: triggerType, status: 'active' });

    for (const scenarioRow of scenarios) {
      const scenario = rowToScenario(scenarioRow);

      // Check target matching: does this device match the scenario targets?
      if (!matchesTarget(scenario, deviceId, data?.groupId)) continue;

      // For trigger configs with scheduleId filter (schedule_failure)
      if (triggerType === 'schedule_failure' && scenario.triggerConfig.scheduleId) {
        if (data?.scheduleId !== scenario.triggerConfig.scheduleId) continue;
      }

      // For trigger configs with groupIds filter (group_join)
      if (triggerType === 'group_join' && scenario.triggerConfig.groupIds?.length) {
        if (!data?.groupId || !scenario.triggerConfig.groupIds.includes(data.groupId)) continue;
      }

      // Dedup: for one-time triggers, skip if there's already a run for this device + scenario
      if (triggerType === 'agent_approved') {
        const existingRun = await db('scenario_runs')
          .where({ scenario_id: scenario.id, device_id: deviceId })
          .whereNot({ status: 'cancelled' })
          .first();
        if (existingRun) continue;
      }

      const triggerSource = `${triggerType}${data?.groupId ? `:group:${data.groupId}` : ''}${data?.scheduleId ? `:schedule:${data.scheduleId}` : ''}`;

      try {
        await scenarioService.triggerScenario(scenario.id, deviceId, tenantId, triggerType, triggerSource);
      } catch (err) {
        logger.error(err, `Failed to trigger scenario ${scenario.id} for device ${deviceId}`);
      }
    }
  },

  async triggerScenario(scenarioId: number, deviceId: number, tenantId: number, triggerType: ScenarioTriggerType, triggerSource: string): Promise<ScenarioRun | null> {
    const scenario = await db('scenarios').where({ id: scenarioId, tenant_id: tenantId }).first();
    if (!scenario) return null;

    const steps = await db('scenario_steps')
      .where({ scenario_id: scenarioId })
      .orderBy('sort_order', 'asc');

    if (!steps.length) {
      logger.warn({ scenarioId }, 'Scenario has no steps, skipping trigger');
      return null;
    }

    const scenarioObj = rowToScenario(scenario);
    const variables = scenarioObj.variables || {};

    // Create the run
    const [runRow] = await db('scenario_runs').insert({
      tenant_id: tenantId,
      scenario_id: scenarioId,
      device_id: deviceId,
      trigger_type: triggerType,
      trigger_source: triggerSource,
      status: 'running',
      current_step: 0,
      variables: JSON.stringify(variables),
      started_at: new Date(),
    }).returning('*');

    // Create step runs
    const stepRunInserts = steps.map((s: any) => ({
      run_id: runRow.id,
      step_id: s.id,
      sort_order: s.sort_order,
      status: 'pending' as ScenarioStepRunStatus,
      retry_attempt: 0,
    }));
    await db('scenario_step_runs').insert(stepRunInserts);

    const run = rowToRun(runRow);
    emitRunUpdate(tenantId, run);

    // Start the state machine
    await scenarioService.executeNextStep(runRow.id);

    return run;
  },

  async triggerManual(scenarioId: number, deviceIds: number[], tenantId: number): Promise<ScenarioRun[]> {
    const runs: ScenarioRun[] = [];
    for (const deviceId of deviceIds) {
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
    const runRow = await db('scenario_runs').where({ id: runId, tenant_id: tenantId }).first();
    if (!runRow || !['pending', 'running'].includes(runRow.status)) return false;

    await db('scenario_runs').where({ id: runId }).update({
      status: 'cancelled',
      finished_at: new Date(),
      updated_at: new Date(),
    });

    // Mark all pending step runs as skipped
    await db('scenario_step_runs')
      .where({ run_id: runId })
      .whereIn('status', ['pending', 'check_running', 'resolve_running', 'recheck_running'])
      .update({
        status: 'skipped',
        finished_at: new Date(),
      });

    const run = rowToRun({ ...runRow, status: 'cancelled', finished_at: new Date() });
    emitRunUpdate(tenantId, run);

    return true;
  },
};

// ── Internal helpers ──────────────────────────────────────────────────────────

function matchesTarget(scenario: Scenario, deviceId: number, groupId?: number): boolean {
  if (scenario.targetType === 'all') return true;
  if (scenario.targetType === 'device') return scenario.targetIds.includes(deviceId);
  if (scenario.targetType === 'group') {
    if (groupId && scenario.targetIds.includes(groupId)) return true;
    // For non-group-join triggers, we need to check if the device belongs to one of the target groups
    // (caller may not pass groupId for all trigger types)
    return false;
  }
  return false;
}

async function matchesTargetAsync(scenario: Scenario, deviceId: number): Promise<boolean> {
  if (scenario.targetType === 'all') return true;
  if (scenario.targetType === 'device') return scenario.targetIds.includes(deviceId);
  if (scenario.targetType === 'group') {
    const device = await db('devices').where({ id: deviceId }).select('group_id').first();
    if (!device?.group_id) return false;
    return scenario.targetIds.includes(device.group_id);
  }
  return false;
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

    // Send notification if configured
    try {
      const scenario = await db('scenarios').where({ id: run.scenarioId }).first();
      if (scenario?.notify_on_success) {
        const { notificationService } = await import('./notification.service');
        const device = await db('devices').where({ id: run.deviceId }).select('hostname', 'display_name', 'tenant_id').first();
        const deviceName = device?.display_name || device?.hostname || `Device #${run.deviceId}`;
        await notificationService.sendForAgent(run.deviceId, tenantId, 'online', `Scenario "${scenario.name}" completed successfully on ${deviceName}`);
      }
    } catch {}
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

    // Send failure notification if configured
    try {
      const scenario = await db('scenarios').where({ id: run.scenarioId }).first();
      if (scenario?.notify_on_failure) {
        const { notificationService } = await import('./notification.service');
        const device = await db('devices').where({ id: run.deviceId }).select('hostname', 'display_name', 'tenant_id').first();
        const deviceName = device?.display_name || device?.hostname || `Device #${run.deviceId}`;
        await notificationService.sendForAgent(run.deviceId, tenantId, 'warning', `Scenario "${scenario.name}" failed on ${deviceName}: ${errorMessage}`);
      }
    } catch {}
  }
}
