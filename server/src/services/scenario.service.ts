import { db } from '../db';
import { logger } from '../utils/logger';
import { getIO } from '../socket';
import { SocketEvents, isMasterTenant } from '@obliance/shared';
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
    targetTenantIds: Array.isArray(row.target_tenant_ids) ? row.target_tenant_ids : null,
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
    bypassPrivacyMode: row.bypass_privacy_mode ?? false,
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

    // Master tenant gets god view across the install. Other tenants see
    // their own scenarios + any scenario fan-outed to them via the
    // `target_tenant_ids` array (set when a master admin builds a
    // shared automation for one or more child tenants).
    const isMaster = isMasterTenant(tenantId);
    let baseQ = db('scenarios');
    if (!isMaster) {
      baseQ = baseQ.where(function() {
        this.where({ tenant_id: tenantId })
          .orWhereRaw('? = ANY(target_tenant_ids)', [tenantId]);
      });
    }
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
    // Match the list query: master sees any scenario; other tenants see
    // their own + fan-outed scenarios. Edit/delete remain strict (the
    // controller already gates writes on tenant_id = req.tenantId).
    const isMaster = isMasterTenant(tenantId);
    const q = db('scenarios').where({ id });
    if (!isMaster) {
      q.where(function() {
        this.where({ tenant_id: tenantId })
          .orWhereRaw('? = ANY(target_tenant_ids)', [tenantId]);
      });
    }
    const row = await q.first();
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
    /** Master-only fan-out (extra tenants where this scenario is visible
     *  read-only). Sanitised below — non-master callers' value is dropped. */
    targetTenantIds?: number[] | null;
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
    const fanOut = isMasterTenant(tenantId) && Array.isArray(data.targetTenantIds) && data.targetTenantIds.length > 0
      ? data.targetTenantIds.map(Number).filter(Number.isFinite)
      : null;
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
        bypass_privacy_mode: (data as any).bypassPrivacyMode === true,
        notification_channels: JSON.stringify((data as any).notificationChannels || []),
        variables: JSON.stringify(data.variables || {}),
        target_tenant_ids: fanOut,
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
    /** Master-only: replaces the fan-out target list. Pass `null` to clear. */
    targetTenantIds?: number[] | null;
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
      if ((data as any).bypassPrivacyMode !== undefined) updates.bypass_privacy_mode = (data as any).bypassPrivacyMode === true;
      if ((data as any).notificationChannels !== undefined) updates.notification_channels = JSON.stringify((data as any).notificationChannels);
      if (data.variables !== undefined) updates.variables = JSON.stringify(data.variables);
      // Fan-out edits gated to master only — child tenant admins cannot
      // promote a local scenario to fan-out.
      if (data.targetTenantIds !== undefined && isMasterTenant(tenantId)) {
        const arr = Array.isArray(data.targetTenantIds) ? data.targetTenantIds.map(Number).filter(Number.isFinite) : [];
        updates.target_tenant_ids = arr.length > 0 ? arr : null;
      }

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

  // ═══════════════════════════════════════════════════════════════════════════
  // Export / Import — JSON portability between installs / tenants / LLMs.
  // ═══════════════════════════════════════════════════════════════════════════

  /** Bundle a scenario into a portable JSON payload. Strips internal
   *  ids and timestamps (those are install-specific) but keeps node
   *  client ids stable so edges keep their shape after a roundtrip.
   *  When `includeScripts` is true, embeds full script bodies for
   *  every script referenced by a `run_script` node — the importer on
   *  another tenant can then recreate them. Without it, nodes keep
   *  their `scriptId` reference but the importer relies on matching
   *  scripts already existing on the destination. */
  async exportScenario(id: number, tenantId: number, opts: { includeScripts: boolean }): Promise<any | null> {
    const scenario = await this.getById(id, tenantId);
    if (!scenario) return null;

    const isMaster = isMasterTenant(tenantId);
    const nodeRows = await db('scenario_nodes').where({ scenario_id: id }).orderBy('id');
    const edgeRows = await db('scenario_edges').where({ scenario_id: id }).orderBy('sort_order');

    // Collect script ids referenced by run_script nodes so we can fetch
    // their full bodies in one round-trip if includeScripts is on.
    const scriptIds = new Set<number>();
    for (const n of nodeRows) {
      if (n.type !== 'run_script') continue;
      const cfg = typeof n.config === 'string' ? JSON.parse(n.config) : (n.config ?? {});
      if (typeof cfg.scriptId === 'number') scriptIds.add(cfg.scriptId);
    }

    let scripts: any[] = [];
    if (opts.includeScripts && scriptIds.size > 0) {
      const q = db('scripts').whereIn('id', [...scriptIds]);
      // Master can pull built-ins (tenant_id NULL) and any tenant's
      // scripts; child tenants restricted to own + builtins.
      if (!isMaster) {
        q.where(function () { this.where({ tenant_id: tenantId }).orWhereNull('tenant_id'); });
      }
      const rows = await q;
      const params = await db('script_parameters').whereIn('script_id', [...scriptIds]).orderBy('script_id').orderBy('sort_order');
      const paramsByScript = new Map<number, any[]>();
      for (const p of params) {
        const list = paramsByScript.get(p.script_id) ?? [];
        list.push({
          name: p.name, label: p.label, description: p.description,
          type: p.type, options: p.options ?? [],
          defaultValue: p.default_value, required: p.required,
          sortOrder: p.sort_order,
        });
        paramsByScript.set(p.script_id, list);
      }
      scripts = rows.map((r: any) => ({
        // Keep the install-side id around so nodes can resolve their
        // reference, and the uuid so the importer can detect collisions.
        _internalId: r.id,
        uuid: r.uuid,
        name: r.name,
        description: r.description,
        platform: r.platform,
        runtime: r.runtime,
        content: r.content,
        timeoutSeconds: r.timeout_seconds,
        expectedExitCode: r.expected_exit_code ?? 0,
        runAs: r.run_as,
        tags: r.tags ?? [],
        purpose: r.purpose ?? 'execute',
        availableInReach: !!r.available_in_reach,
        isBuiltin: !!r.is_builtin,
        parameters: paramsByScript.get(r.id) ?? [],
      }));
    }

    // Schedules associated with this scenario:
    //   (a) script_schedules.on_failure_scenario_id pointing at us
    //       (assertPass schedules that escalate to this scenario on
    //       failure)
    //   (b) script_schedules.id referenced by any trigger_schedule_*
    //       node config in this scenario
    // Both are exported so the destination tenant can recreate the
    // wiring after import. Each entry carries scriptUuid (resolved
    // via the embedded scripts array) so the schedule's script
    // dependency travels with the export when includeScripts is on.
    const scheduleIdsFromTriggers = new Set<number>();
    for (const n of nodeRows) {
      if (!n.type.startsWith('trigger_schedule')) continue;
      const cfg = typeof n.config === 'string' ? JSON.parse(n.config) : (n.config ?? {});
      if (typeof cfg.scheduleId === 'number') scheduleIdsFromTriggers.add(cfg.scheduleId);
    }
    const scheduleQ = db('script_schedules')
      .where(function () {
        this.where('on_failure_scenario_id', id);
        if (scheduleIdsFromTriggers.size > 0) this.orWhereIn('id', [...scheduleIdsFromTriggers]);
      });
    if (!isMaster) scheduleQ.where('tenant_id', tenantId);
    const scheduleRows = await scheduleQ;
    // Map script_id → uuid so each schedule entry exposes scriptUuid
    // alongside scriptId for portability.
    const scheduleScriptIds = scheduleRows.map((r: any) => r.script_id).filter((v: number | null): v is number => typeof v === 'number');
    const scriptUuidById = new Map<number, string>();
    if (scheduleScriptIds.length > 0) {
      const sRows = await db('scripts').whereIn('id', scheduleScriptIds).select('id', 'uuid');
      for (const r of sRows) scriptUuidById.set(r.id, r.uuid);
    }
    const exportedSchedules = scheduleRows.map((r: any) => ({
      uuid: r.uuid,
      name: r.name,
      description: r.description,
      scriptUuid: scriptUuidById.get(r.script_id) ?? null,
      scriptId: r.script_id,
      targetType: r.target_type,
      targetIds: typeof r.target_ids === 'string' ? JSON.parse(r.target_ids || '[]') : (r.target_ids ?? []),
      cronExpression: r.cron_expression,
      fireOnceAt: r.fire_once_at,
      timezone: r.timezone,
      parameterValues: typeof r.parameter_values === 'string' ? JSON.parse(r.parameter_values || '{}') : (r.parameter_values ?? {}),
      catchupEnabled: r.catchup_enabled,
      catchupMax: r.catchup_max,
      assertPass: r.assert_pass ?? false,
      notifyOnce: r.notify_once ?? false,
      notificationChannels: typeof r.notification_channels === 'string'
        ? JSON.parse(r.notification_channels || '[]')
        : (r.notification_channels ?? []),
      timeoutSeconds: r.timeout_seconds ?? null,
      skipIfInFlight: r.skip_if_in_flight !== false,
      // Boolean flag the importer reads to wire the freshly-created
      // schedule's on_failure_scenario_id back to the freshly-created
      // scenario's id (no need to chase ids on the destination).
      onFailureBindsToImportedScenario: r.on_failure_scenario_id === id,
      enabled: r.enabled,
    }));

    return {
      // Format version — bump when the importer needs to fork on shape
      // changes. The importer rejects unknown major versions.
      // v2: cooldown moved out of trigger config into its own node type.
      formatVersion: 2,
      exportedAt: new Date().toISOString(),
      scenario: {
        uuid: scenario.uuid,
        name: scenario.name,
        description: scenario.description,
        triggerType: scenario.triggerType,
        triggerConfig: scenario.triggerConfig,
        targetType: scenario.targetType,
        targetIds: scenario.targetIds,
        retryPolicy: scenario.retryPolicy,
        timeoutSeconds: scenario.timeoutSeconds,
        notifyOnSuccess: scenario.notifyOnSuccess,
        notifyOnFailure: scenario.notifyOnFailure,
        bypassPrivacyMode: scenario.bypassPrivacyMode,
        notificationChannels: scenario.notificationChannels,
        variables: scenario.variables,
        // status intentionally omitted — imports always land as 'draft'
        // so a scenario doesn't auto-fire on a new tenant before the
        // admin reviews it.
      },
      nodes: nodeRows.map((r: any) => ({
        clientId: r.uuid, // stable across roundtrip
        type: r.type,
        label: r.label,
        config: typeof r.config === 'string' ? JSON.parse(r.config) : (r.config ?? {}),
        positionX: r.position_x ?? 0,
        positionY: r.position_y ?? 0,
      })),
      edges: edgeRows.map((r: any) => {
        const sourceUuid = nodeRows.find((n: any) => n.id === r.source_node_id)?.uuid;
        const targetUuid = nodeRows.find((n: any) => n.id === r.target_node_id)?.uuid;
        return {
          sourceNodeClientId: sourceUuid,
          sourceHandle: r.source_handle,
          targetNodeClientId: targetUuid,
          condition: typeof r.condition === 'string' ? JSON.parse(r.condition) : (r.condition ?? { kind: 'always' }),
          sortOrder: r.sort_order,
        };
      }),
      scripts: opts.includeScripts ? scripts : null,
      schedules: exportedSchedules.length > 0 ? exportedSchedules : null,
    };
  },

  /** Two-pass import. First pass (`commit=false`) returns the conflict
   *  list — for each embedded script whose uuid matches an existing
   *  script in the target tenant, the caller decides per-script:
   *    - "skip"     → keep the existing script, point nodes at it
   *    - "overwrite"→ replace the existing script's body with the import
   *    - "new"      → create a fresh script (new uuid) so the existing
   *                   one stays untouched
   *  Second pass (`commit=true`) writes the scenario + edges + chosen
   *  script resolutions inside a single transaction.
   *
   *  Returns either the conflict list (no commit) or the created
   *  scenario row (commit). Throws on schema validation failure. */
  async importScenario(
    tenantId: number,
    payload: any,
    opts: {
      commit: boolean;
      conflictResolutions?: Record<string, 'skip' | 'overwrite' | 'new'>;
      userId: number;
    },
  ): Promise<
    | { kind: 'preview'; conflicts: Array<{ scriptUuid: string; existingScriptId: number; existingName: string; importedName: string }> }
    | { kind: 'commit'; scenario: Scenario }
  > {
    if (!payload || typeof payload !== 'object') throw new Error('Invalid import payload');
    // v1 = original shape, with cooldownSeconds piggybacking on triggers.
    // v2 = cooldown is its own node (`type='cooldown'`). We accept v1
    // payloads but rewrite them in-memory before validation: each
    // trigger.cooldownSeconds becomes a fresh cooldown node injected
    // between the trigger and its previous downstream targets, mirroring
    // what migration 087 does to rows already in the DB. Anything beyond
    // 2 is rejected — admins on older installs must export from a v2-
    // aware build.
    if (payload.formatVersion !== 1 && payload.formatVersion !== 2) {
      throw new Error(`Unsupported export format version: ${payload.formatVersion}`);
    }
    if (payload.formatVersion === 1) {
      payload = migrateV1ToV2(payload);
    }
    const meta = payload.scenario;
    if (!meta?.name) throw new Error('scenario.name is required');
    const nodes: any[] = Array.isArray(payload.nodes) ? payload.nodes : [];
    const edges: any[] = Array.isArray(payload.edges) ? payload.edges : [];
    const scripts: any[] = Array.isArray(payload.scripts) ? payload.scripts : [];
    if (nodes.length === 0) throw new Error('scenario must have at least one node');

    // ── Structural validation ────────────────────────────────────────
    // LLM-generated payloads are forgiving on the eye but tend to ship
    // structural lemons: duplicate clientIds, edges to nowhere, missing
    // triggers, run_script nodes without a target. Catch them all and
    // return a single multi-line error so the user sees the full list
    // instead of fixing one issue at a time.
    const issues: string[] = [];
    const seenClientIds = new Set<string>();
    const validClientIds = new Set<string>();
    let triggerCount = 0;
    const VALID_NODE_TYPES = new Set([
      'trigger_manual', 'trigger_session_login', 'trigger_machine_boot',
      'trigger_agent_approved', 'trigger_group_join', 'trigger_schedule_failure',
      'trigger_schedule_cron', 'trigger_agent_back_online', 'trigger_metric_warning',
      'trigger_metric_critical', 'trigger_metric_custom',
      'run_script', 'run_command', 'send_notification', 'wait', 'tag_device',
      'move_device_to_group', 'branch_exit_code', 'branch_on_device',
      'cooldown',
      'end_success', 'end_failure',
    ]);
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      // Strip _comment keys silently — they're documentation aids in
      // the dummy export, not real fields. Same for the inner config.
      delete n._comment;
      if (n.config && typeof n.config === 'object') delete n.config._comment;
      const where = n.clientId ? `node "${n.clientId}"` : `node #${i}`;
      if (!n.clientId || typeof n.clientId !== 'string') {
        issues.push(`${where}: clientId is required and must be a string`);
        continue;
      }
      if (seenClientIds.has(n.clientId)) {
        issues.push(`${where}: duplicate clientId — each node must have a unique id`);
        continue;
      }
      seenClientIds.add(n.clientId);
      validClientIds.add(n.clientId);
      if (!n.type || !VALID_NODE_TYPES.has(n.type)) {
        issues.push(`${where}: unknown node type "${n.type}". Valid types: ${[...VALID_NODE_TYPES].join(', ')}`);
        continue;
      }
      if (typeof n.type === 'string' && n.type.startsWith('trigger_')) triggerCount++;
      // run_script must point at SOMETHING — either an existing
      // scriptId on the destination, or a scriptUuid that resolves via
      // the embedded `scripts` array.
      if (n.type === 'run_script') {
        const cfg = n.config ?? {};
        const hasScriptId = typeof cfg.scriptId === 'number' && Number.isFinite(cfg.scriptId);
        const hasScriptUuid = typeof cfg.scriptUuid === 'string' && cfg.scriptUuid.length > 0;
        if (!hasScriptId && !hasScriptUuid) {
          issues.push(`${where}: run_script needs config.scriptId or config.scriptUuid`);
        }
        if (hasScriptUuid && !scripts.some((s) => s.uuid === cfg.scriptUuid)) {
          // Allowed: the uuid may match an existing script on the
          // destination tenant. We'll re-check when resolving.
        }
      }
    }
    if (triggerCount === 0) {
      issues.push('scenario must contain at least one trigger node (trigger_*)');
    }
    for (let i = 0; i < edges.length; i++) {
      const e = edges[i];
      delete e._comment;
      const where = `edge #${i}`;
      if (!e.sourceNodeClientId || !validClientIds.has(e.sourceNodeClientId)) {
        issues.push(`${where}: sourceNodeClientId "${e.sourceNodeClientId}" doesn't match any node`);
      }
      if (!e.targetNodeClientId || !validClientIds.has(e.targetNodeClientId)) {
        issues.push(`${where}: targetNodeClientId "${e.targetNodeClientId}" doesn't match any node`);
      }
    }
    // Embedded scripts: each must have uuid + name + content. The rest
    // has sane defaults at insert time.
    for (let i = 0; i < scripts.length; i++) {
      const s = scripts[i];
      delete s._comment;
      const where = s.name ? `script "${s.name}"` : `script #${i}`;
      if (!s.uuid || typeof s.uuid !== 'string') issues.push(`${where}: uuid is required`);
      if (!s.name || typeof s.name !== 'string') issues.push(`${where}: name is required`);
      if (!s.content || typeof s.content !== 'string') issues.push(`${where}: content is required`);
    }
    // run_script scriptUuid that doesn't resolve anywhere (not in
    // embedded scripts AND not in the destination DB) — checked at
    // resolution time below; surface a hint here when scripts are
    // embedded but the uuid isn't among them.
    if (issues.length > 0) {
      // Single error string with each issue on its own line — the
      // route handler returns it verbatim so the UI can split + render.
      throw new Error(`Import validation failed:\n - ${issues.join('\n - ')}`);
    }

    // Pass 1: detect script-uuid conflicts against the target tenant.
    const isMaster = isMasterTenant(tenantId);
    const importedUuids = scripts.map((s) => s.uuid).filter(Boolean);
    let existingByUuid = new Map<string, { id: number; name: string }>();
    if (importedUuids.length > 0) {
      const q = db('scripts').whereIn('uuid', importedUuids);
      if (!isMaster) q.where(function () { this.where({ tenant_id: tenantId }).orWhereNull('tenant_id'); });
      const existing = await q.select('id', 'uuid', 'name');
      for (const r of existing) existingByUuid.set(r.uuid, { id: r.id, name: r.name });
    }

    if (!opts.commit) {
      const conflicts = scripts
        .filter((s) => s.uuid && existingByUuid.has(s.uuid))
        .map((s) => ({
          scriptUuid: s.uuid as string,
          existingScriptId: existingByUuid.get(s.uuid)!.id,
          existingName: existingByUuid.get(s.uuid)!.name,
          importedName: s.name,
        }));
      return { kind: 'preview', conflicts };
    }

    // Pass 2: commit. Walk script resolutions, then create scenario + nodes + edges in one transaction.
    const resolutions = opts.conflictResolutions ?? {};
    return db.transaction(async (trx) => {
      // Build a uuid → final-script-id map: existing-after-resolution
      // OR newly-created from the import's content.
      const resolvedScriptId = new Map<string, number>();
      for (const s of scripts) {
        if (!s.uuid) continue;
        const conflict = existingByUuid.get(s.uuid);
        const resolution = conflict ? (resolutions[s.uuid] ?? 'skip') : 'new';
        if (conflict && resolution === 'skip') {
          resolvedScriptId.set(s.uuid, conflict.id);
          continue;
        }
        if (conflict && resolution === 'overwrite') {
          await trx('scripts').where({ id: conflict.id }).update({
            name: s.name,
            description: s.description,
            platform: s.platform,
            runtime: s.runtime,
            content: s.content,
            timeout_seconds: s.timeoutSeconds,
            expected_exit_code: s.expectedExitCode ?? 0,
            run_as: s.runAs,
            tags: JSON.stringify(s.tags || []),
            purpose: s.purpose ?? 'execute',
            available_in_reach: !!s.availableInReach,
            updated_by: opts.userId,
            updated_at: new Date(),
          });
          resolvedScriptId.set(s.uuid, conflict.id);
          continue;
        }
        // 'new' (fresh uuid) OR no conflict: insert.
        const [row] = await trx('scripts').insert({
          tenant_id: tenantId,
          name: conflict && resolution === 'new' ? `${s.name} (imported)` : s.name,
          description: s.description,
          platform: s.platform || 'all',
          runtime: s.runtime || 'bash',
          content: s.content,
          timeout_seconds: s.timeoutSeconds || 300,
          expected_exit_code: s.expectedExitCode ?? 0,
          run_as: s.runAs || 'system',
          tags: JSON.stringify(s.tags || []),
          purpose: s.purpose || 'execute',
          available_in_reach: !!s.availableInReach,
          is_builtin: false,
          created_by: opts.userId,
          updated_by: opts.userId,
        }).returning('*');
        resolvedScriptId.set(s.uuid, row.id);
        // Re-create parameters if any.
        if (Array.isArray(s.parameters) && s.parameters.length > 0) {
          await trx('script_parameters').insert(
            s.parameters.map((p: any, i: number) => ({
              script_id: row.id,
              name: p.name, label: p.label, description: p.description,
              type: p.type, options: JSON.stringify(p.options || []),
              default_value: p.defaultValue, required: p.required,
              sort_order: i,
            })),
          );
        }
      }

      // Create the scenario row. status forced to 'draft' so it doesn't
      // auto-fire on a fresh tenant before the admin reviews it.
      const [sRow] = await trx('scenarios').insert({
        tenant_id: tenantId,
        name: meta.name,
        description: meta.description ?? null,
        trigger_type: meta.triggerType ?? 'manual',
        trigger_config: JSON.stringify(meta.triggerConfig || {}),
        target_type: meta.targetType ?? 'all',
        target_ids: JSON.stringify(meta.targetIds ?? []),
        status: 'draft',
        retry_policy: JSON.stringify(meta.retryPolicy || { maxRetries: 0, retryDelaySeconds: 0 }),
        timeout_seconds: meta.timeoutSeconds ?? 3600,
        notify_on_success: meta.notifyOnSuccess ?? false,
        notify_on_failure: meta.notifyOnFailure ?? true,
        bypass_privacy_mode: meta.bypassPrivacyMode === true,
        notification_channels: JSON.stringify(meta.notificationChannels ?? []),
        variables: JSON.stringify(meta.variables ?? {}),
        created_by: opts.userId,
        updated_by: opts.userId,
      }).returning('*');

      // Insert nodes; clientId → DB id mapping for edge resolution.
      const nodeIdByClientId = new Map<string, number>();
      for (const n of nodes) {
        const cfg = { ...(n.config ?? {}) };
        // run_script nodes: resolve scriptUuid → scriptId via the
        // resolved-scripts map we just built.
        if (n.type === 'run_script' && cfg.scriptUuid && resolvedScriptId.has(cfg.scriptUuid)) {
          cfg.scriptId = resolvedScriptId.get(cfg.scriptUuid);
          delete cfg.scriptUuid;
        }
        // targetDeviceIds is a list of integer device ids from the
        // SOURCE tenant — meaningless in the destination tenant. We
        // strip them on import so a fresh import always starts in
        // "trigger target" mode. The admin can repick devices after
        // the import if they want the fan-out.
        if ('targetDeviceIds' in cfg || 'targetMode' in cfg) {
          cfg.targetMode = 'target';
          cfg.targetDeviceIds = [];
        }
        const [nr] = await trx('scenario_nodes').insert({
          scenario_id: sRow.id,
          type: n.type,
          label: n.label ?? null,
          config: JSON.stringify(cfg),
          position_x: n.positionX ?? 0,
          position_y: n.positionY ?? 0,
        }).returning('id');
        nodeIdByClientId.set(n.clientId, typeof nr === 'object' ? (nr as any).id : nr);
      }

      // Insert edges, mapping client ids back to DB ids. Drop any
      // edge that references a node we couldn't resolve (shouldn't
      // happen on a clean export, but be defensive against
      // hand-edited LLM output).
      for (const e of edges) {
        const sourceId = nodeIdByClientId.get(e.sourceNodeClientId);
        const targetId = nodeIdByClientId.get(e.targetNodeClientId);
        if (!sourceId || !targetId) continue;
        await trx('scenario_edges').insert({
          scenario_id: sRow.id,
          source_node_id: sourceId,
          source_handle: e.sourceHandle ?? null,
          target_node_id: targetId,
          condition: JSON.stringify(e.condition ?? { kind: 'always' }),
          sort_order: e.sortOrder ?? 0,
        });
      }

      // Recreate associated schedules. Each entry's scriptUuid is
      // resolved via the same resolvedScriptId map we built for nodes,
      // so embedded scripts are reused. Schedules pointing at scripts
      // that aren't in the embedded set fall through to scriptId
      // (assumes the destination already has the script).
      const importedSchedules: any[] = Array.isArray(payload.schedules) ? payload.schedules : [];
      for (const s of importedSchedules) {
        const scriptId = (s.scriptUuid && resolvedScriptId.has(s.scriptUuid))
          ? resolvedScriptId.get(s.scriptUuid)!
          : (typeof s.scriptId === 'number' ? s.scriptId : null);
        if (scriptId == null) continue; // can't recreate a schedule without a script
        const [schedRow] = await trx('script_schedules').insert({
          tenant_id: tenantId,
          script_id: scriptId,
          name: s.name,
          description: s.description ?? null,
          target_type: s.targetType ?? 'all',
          target_ids: JSON.stringify(s.targetIds ?? []),
          cron_expression: s.cronExpression ?? null,
          fire_once_at: s.fireOnceAt ?? null,
          // Engine recomputes next_run_at on next tick — leave null
          // here to avoid stale fire-immediately behavior.
          next_run_at: null,
          timezone: s.timezone || 'UTC',
          parameter_values: JSON.stringify(s.parameterValues ?? {}),
          catchup_enabled: s.catchupEnabled !== false,
          catchup_max: s.catchupMax ?? 3,
          assert_pass: s.assertPass ?? false,
          notify_once: s.notifyOnce ?? false,
          notification_channels: JSON.stringify(s.notificationChannels ?? []),
          timeout_seconds: s.timeoutSeconds ?? null,
          skip_if_in_flight: s.skipIfInFlight !== false,
          // Bind back to the freshly-created scenario when the export
          // flagged this relationship — the scenario id is only known
          // here (after the insert above).
          on_failure_scenario_id: s.onFailureBindsToImportedScenario ? sRow.id : null,
          enabled: s.enabled !== false,
          created_by: opts.userId,
        }).returning('*');
        // If a scenario node referenced this schedule by id (via
        // trigger_schedule_failure / trigger_schedule_cron config),
        // patch the inserted node's config to point at the freshly
        // created schedule's id instead of the dead source-tenant id.
        if (typeof s.scriptId === 'number') {
          await trx('scenario_nodes')
            .where({ scenario_id: sRow.id })
            .whereRaw("(config->>'scheduleId')::int = ?", [s.scriptId])
            .update({
              config: trx.raw(
                `jsonb_set(config::jsonb, '{scheduleId}', to_jsonb(?::int))`,
                [schedRow.id],
              ),
            });
        }
      }

      return { kind: 'commit', scenario: rowToScenario(sRow) };
    });
  },

  /** Heavily-commented skeleton that demonstrates every node type, edge
   *  condition shape, and trigger config. Intentionally a vanilla JSON
   *  literal (no DB lookup) so it can be served from a static handler
   *  and pasted into an LLM prompt without leaking any tenant data. */
  getDummyExportTemplate(): any {
    // Cheat-sheet of every node type the engine supports today. Any
    // new node type added in the future MUST also be added here so the
    // LLM (and future maintainers) see it. See CLAUDE.md
    // "How to add a new scenario node type" for the full checklist.
    return {
      formatVersion: 2,
      exportedAt: new Date().toISOString(),
      _comment: 'Skeleton export — paste this whole document into an LLM prompt to teach it the shape, then ask it to produce a scenario in the same format. Drop the `_comment` keys before importing. Every node type currently supported is documented below; ignore the ones you don\'t need (the example "scenario" only wires up a subset). v2: cooldown is its own node type now (`cooldown`), not a `cooldownSeconds` field on the trigger.',
      scenario: {
        _comment: 'Top-level scenario metadata. uuid is optional on import (server allocates one if omitted). status is always reset to "draft" on import — set it to "active" manually after review.',
        uuid: null,
        name: 'My imported scenario',
        description: 'Description shown in the scenarios list',
        // Legacy single-trigger fields — required at the row level even
        // though v2 scenarios primarily use trigger nodes. Pick one
        // value that matches the trigger node you place in `nodes`.
        triggerType: 'manual',
        triggerConfig: {},
        targetType: 'all',
        targetIds: [],
        retryPolicy: { maxRetries: 0, retryDelaySeconds: 60 },
        timeoutSeconds: 3600,
        notifyOnSuccess: false,
        notifyOnFailure: true,
        // When true, the scenario runs on devices currently in privacy
        // mode too. Default false — flipping it on is gated by the
        // tenant's action-restriction matrix (`scenario.bypass_privacy_mode`).
        bypassPrivacyMode: false,
        notificationChannels: [],
        variables: { EXAMPLE_KEY: 'EXAMPLE_VALUE' },
      },
      nodes: [
        // ── Triggers (exactly ONE trigger node per scenario in real use, all listed here for documentation) ──
        {
          _comment: 'TRIGGER: trigger_manual — fires when an admin clicks "Run" on the scenario. Most flexible, no conditions. To throttle re-runs, place a `cooldown` node downstream (works for ANY trigger).',
          clientId: 'doc-trigger-manual',
          type: 'trigger_manual',
          label: 'Manual trigger',
          config: {},
          positionX: 100, positionY: 100,
        },
        {
          _comment: 'TRIGGER: trigger_session_login — fires every time a new WTS session opens on the device (Windows/RDP). Useful for kiosk reset, login banners, etc.',
          clientId: 'doc-trigger-session-login',
          type: 'trigger_session_login',
          label: 'On session login',
          config: {},
          positionX: 100, positionY: 200,
        },
        {
          _comment: 'TRIGGER: trigger_machine_boot — fires when the agent reports a fresh machine boot (within ~60s of agent startup). Pairs with run_script for boot-time hardening / inventory.',
          clientId: 'doc-trigger-machine-boot',
          type: 'trigger_machine_boot',
          label: 'On machine boot',
          config: {},
          positionX: 100, positionY: 300,
        },
        {
          _comment: 'TRIGGER: trigger_agent_approved — fires once when an agent transitions from pending → approved. Idempotent (server dedupes on scenario+device). Useful for first-contact deployment.',
          clientId: 'doc-trigger-agent-approved',
          type: 'trigger_agent_approved',
          label: 'On agent approved',
          config: {},
          positionX: 100, positionY: 400,
        },
        {
          _comment: 'TRIGGER: trigger_group_join — fires when a device is moved into one of the configured groups. Set config.groupIds to a list of group ids; empty list = any group change.',
          clientId: 'doc-trigger-group-join',
          type: 'trigger_group_join',
          label: 'On group join',
          config: { groupIds: [] },
          positionX: 100, positionY: 500,
        },
        {
          _comment: 'TRIGGER: trigger_schedule_failure — fires when a script_schedule with assertPass=true reports failure. Set config.scheduleId to bind to one specific schedule, or omit to fire on any schedule failure.',
          clientId: 'doc-trigger-schedule-failure',
          type: 'trigger_schedule_failure',
          label: 'On schedule failure',
          config: { scheduleId: null },
          positionX: 100, positionY: 600,
        },
        {
          _comment: 'TRIGGER: trigger_schedule_cron — internal cron tied to the scenario itself. config.cronExpression follows standard 5-field cron + timezone. The engine maintains last_cron_fire_at per node.',
          clientId: 'doc-trigger-schedule-cron',
          type: 'trigger_schedule_cron',
          label: 'On cron',
          config: { cronExpression: '0 2 * * *', timezone: 'UTC' },
          positionX: 100, positionY: 700,
        },
        {
          _comment: 'TRIGGER: trigger_agent_back_online — fires when an agent recovers from offline state, debounced against flaps. config.offlineDelaySeconds: minimum outage duration before this counts (default 60).',
          clientId: 'doc-trigger-agent-back-online',
          type: 'trigger_agent_back_online',
          label: 'On agent back online',
          config: { offlineDelaySeconds: 60 },
          positionX: 100, positionY: 800,
        },
        {
          _comment: 'TRIGGER: trigger_metric_warning — fires once when a device transitions FROM ok/critical INTO warning. config.metric: cpu|ram|disk|"" (empty = any). For disk, config.mount limits to a specific mount.',
          clientId: 'doc-trigger-metric-warning',
          type: 'trigger_metric_warning',
          label: 'On metric warning',
          config: { metric: '', mount: '' },
          positionX: 100, positionY: 900,
        },
        {
          _comment: 'TRIGGER: trigger_metric_critical — same as warning, but on the entry to "critical" severity.',
          clientId: 'doc-trigger-metric-critical',
          type: 'trigger_metric_critical',
          label: 'On metric critical',
          config: { metric: '', mount: '' },
          positionX: 100, positionY: 1000,
        },
        {
          _comment: 'TRIGGER: trigger_metric_custom — fires on EVERY push that satisfies the comparator (not transition-based). PAIR WITH a downstream cooldown node to avoid loops. metric: cpu|ram|disk. comparator: above|below. threshold: 0-100.',
          clientId: 'doc-trigger-metric-custom',
          type: 'trigger_metric_custom',
          label: 'On metric custom',
          config: { metric: 'cpu', comparator: 'above', threshold: 90, mount: '' },
          positionX: 100, positionY: 1100,
        },
        {
          _comment: 'GATING: cooldown — pacing primitive shared across upstream paths. Place after a trigger fan-in to enforce a single window; if the same device hits this node within the window the run terminates as success without firing downstream nodes. config.duration is a positive number, config.unit is one of seconds/minutes/hours/days/months. State is keyed per (scenario, device, this-node-id) so multiple cooldown nodes in one scenario act independently.',
          clientId: 'doc-cooldown',
          type: 'cooldown',
          label: '5h cooldown',
          config: { duration: 5, unit: 'hours' },
          positionX: 350, positionY: 100,
        },

        // ── Actions ──
        {
          _comment: 'ACTION: run_script — fires a script on the device. Reference an existing script via config.scriptId, OR set config.scriptUuid to match a script embedded in the top-level "scripts" array. config.timeoutSeconds overrides the script\'s default. By default the script runs on the device that triggered the run; set config.targetMode to "devices" + config.targetDeviceIds to a non-empty integer array of approved devices in the SAME tenant to fan out the run instead (worst exit wins across all targets).',
          clientId: 'doc-action-run-script',
          type: 'run_script',
          label: 'Run script',
          config: { scriptId: null, scriptUuid: 'EXAMPLE-SCRIPT-UUID', timeoutSeconds: 300, parameters: {}, targetMode: 'target', targetDeviceIds: [] },
          positionX: 400, positionY: 100,
        },
        {
          _comment: 'ACTION: run_command — sends a built-in agent command. config.commandType: reboot|shutdown|sleep|restart_agent|install_updates|scan_inventory|scan_updates|check_compliance|... Same targetMode/targetDeviceIds fan-out as run_script.',
          clientId: 'doc-action-run-command',
          type: 'run_command',
          label: 'Run command',
          config: { commandType: 'reboot', targetMode: 'target', targetDeviceIds: [] },
          positionX: 400, positionY: 200,
        },
        {
          _comment: 'ACTION: send_notification — dispatches via the channels bound to the scenario (see scenario.notificationChannels) or specific ones in config.channels. subject/body override the default templates.',
          clientId: 'doc-action-send-notification',
          type: 'send_notification',
          label: 'Notify',
          config: { channels: [], subject: '', body: '' },
          positionX: 400, positionY: 300,
        },
        {
          _comment: 'ACTION: wait — pauses the run for config.seconds. Use sparingly; long waits keep a run-row "running" in the DB.',
          clientId: 'doc-action-wait',
          type: 'wait',
          label: 'Wait',
          config: { seconds: 60 },
          positionX: 400, positionY: 400,
        },
        {
          _comment: 'ACTION: tag_device — adds / removes tags on the device. config.add / config.remove are arrays of strings. Same targetMode/targetDeviceIds fan-out as run_script — loop is synchronous (no agent round-trip).',
          clientId: 'doc-action-tag-device',
          type: 'tag_device',
          label: 'Tag device',
          config: { add: ['imported'], remove: [], targetMode: 'target', targetDeviceIds: [] },
          positionX: 400, positionY: 500,
        },
        {
          _comment: 'ACTION: move_device_to_group — sets the device\'s group_id. config.groupId can be null (ungroup). Same targetMode/targetDeviceIds fan-out as run_script — applies the move to every listed device atomically.',
          clientId: 'doc-action-move-group',
          type: 'move_device_to_group',
          label: 'Move to group',
          config: { groupId: null, targetMode: 'target', targetDeviceIds: [] },
          positionX: 400, positionY: 600,
        },

        // ── Logic ──
        {
          _comment: 'LOGIC: branch_exit_code — routes based on the immediately-previous run_script node\'s exit code. Outgoing edges declare exit_code_eq / exit_code_neq / exit_code_in conditions; the engine picks the first matching edge.',
          clientId: 'doc-logic-branch-exit',
          type: 'branch_exit_code',
          label: 'Branch on exit code',
          config: {},
          positionX: 700, positionY: 100,
        },
        {
          _comment: 'LOGIC: branch_on_device — routes based on a device property. config.match: os_type|group|tag|status. config.value: the value to compare to. Useful for OS-specific paths in a single scenario.',
          clientId: 'doc-logic-branch-device',
          type: 'branch_on_device',
          label: 'Branch on device',
          config: { match: 'os_type', value: 'windows' },
          positionX: 700, positionY: 200,
        },

        // ── Terminators ──
        {
          _comment: 'TERMINATOR: end_success — marks the run as succeeded with an optional message. Reachable from any node.',
          clientId: 'doc-end-success',
          type: 'end_success',
          label: 'End — success',
          config: { message: 'OK' },
          positionX: 1000, positionY: 100,
        },
        {
          _comment: 'TERMINATOR: end_failure — marks the run as failed with a required message (surfaced in run history).',
          clientId: 'doc-end-failure',
          type: 'end_failure',
          label: 'End — failure',
          config: { message: 'Scenario failed' },
          positionX: 1000, positionY: 200,
        },
      ],
      edges: [
        // Edges only need to wire up the actual scenario you're building.
        // The dummy showcases every condition shape below; in your real
        // export, prune the documentation nodes/edges and keep what you
        // need. The engine evaluates outgoing edges in `sortOrder` and
        // picks the FIRST whose condition matches.
        {
          _comment: 'CONDITION: { kind: "always" } — unconditional. Default for trigger → first action and any non-branching transition.',
          sourceNodeClientId: 'doc-trigger-manual',
          sourceHandle: null,
          targetNodeClientId: 'doc-action-run-script',
          condition: { kind: 'always' },
          sortOrder: 0,
        },
        {
          _comment: 'CONDITION: { kind: "exit_code_eq", value: N } — pass branch when last run_script returned exit code N (typically 0 = success).',
          sourceNodeClientId: 'doc-logic-branch-exit',
          sourceHandle: 'pass',
          targetNodeClientId: 'doc-end-success',
          condition: { kind: 'exit_code_eq', value: 0 },
          sortOrder: 0,
        },
        {
          _comment: 'CONDITION: { kind: "exit_code_neq", value: N } — fail branch when last run_script returned anything OTHER than N.',
          sourceNodeClientId: 'doc-logic-branch-exit',
          sourceHandle: 'fail',
          targetNodeClientId: 'doc-end-failure',
          condition: { kind: 'exit_code_neq', value: 0 },
          sortOrder: 1,
        },
        {
          _comment: 'CONDITION: { kind: "exit_code_in", values: [N1, N2, …] } — match if last exit code is in the list. Useful for grouping several success codes (0, 3010 reboot-required, etc).',
          sourceNodeClientId: 'doc-logic-branch-exit',
          sourceHandle: 'special',
          targetNodeClientId: 'doc-action-wait',
          condition: { kind: 'exit_code_in', values: [3010, 3011] },
          sortOrder: 2,
        },
      ],
      scripts: [
        {
          _comment: 'When embedded, scripts include their full content. On import, the server checks each uuid against existing scripts and asks the user how to resolve conflicts (skip / overwrite / create-as-new). Drop this whole array if you only want to reference scriptIds that already exist on the destination tenant.',
          uuid: 'EXAMPLE-SCRIPT-UUID',
          name: 'Inventory check',
          description: 'Checks installed software against the baseline',
          platform: 'all',
          runtime: 'powershell',
          content: '# script body here\nWrite-Host "ok"\nexit 0',
          timeoutSeconds: 300,
          expectedExitCode: 0,
          runAs: 'system',
          tags: [],
          purpose: 'check',
          availableInReach: false,
          isBuiltin: false,
          parameters: [
            // Optional. Each parameter is exposed in the run UI / Reach
            // client and substituted into the script via {{name}}.
            // type: text|number|boolean|select. options is required for "select".
            // { name: 'SERVER_URL', label: 'Server URL', type: 'text', defaultValue: 'https://example.com', required: true, options: [] },
          ],
        },
      ],
      schedules: [
        {
          _comment: 'OPTIONAL: schedules associated with this scenario. Two relationships are recognised — (a) script_schedules whose onFailureScenarioId points at this scenario and (b) schedules referenced by trigger_schedule_failure.config.scheduleId. Each entry is recreated on import as a new schedule pointing at the imported scenario.',
          uuid: 'EXAMPLE-SCHEDULE-UUID',
          name: 'Nightly inventory',
          description: 'Runs the inventory script every night at 02:00',
          // The script the schedule itself runs (separate from the
          // scenario\'s nodes). Reference by uuid into the embedded
          // scripts array OR by id if it already exists.
          scriptUuid: 'EXAMPLE-SCRIPT-UUID',
          scriptId: null,
          targetType: 'all',
          targetIds: [],
          cronExpression: '0 2 * * *',
          fireOnceAt: null,
          timezone: 'UTC',
          parameterValues: {},
          catchupEnabled: false,
          catchupMax: 3,
          assertPass: true,
          notifyOnce: false,
          notificationChannels: [],
          timeoutSeconds: null,
          skipIfInFlight: true,
          // When assertPass is true, a failure of this schedule
          // triggers the imported scenario via trigger_schedule_failure.
          // Set this field to "this" so the importer wires the binding
          // automatically.
          onFailureBindsToImportedScenario: true,
          enabled: true,
        },
      ],
    };
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

  async fireTrigger(triggerType: ScenarioTriggerType, deviceId: number, tenantId: number, data?: { groupId?: number; scheduleId?: number; offlineSeconds?: number; metricBreaches?: Array<{ metric: string; percent: number; level: string; mount?: string }>; metrics?: { cpu?: { percent: number }; memory?: { percent: number }; disks?: Array<{ mount: string; percent: number; fstype?: string; removable?: boolean }> } }) {
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

        // Metric warning / critical filter — each trigger node may
        // restrict to a specific metric (cpu/ram/disk) or, for disk,
        // a specific mount point. Empty filter = match anything. We
        // keep the node only if at least ONE breach in the payload
        // satisfies its filter; otherwise skip.
        if (triggerType === 'metric_warning' || triggerType === 'metric_critical') {
          const wantMetric = String(nodeConfig.metric ?? '').toLowerCase().trim();
          const wantMount  = String(nodeConfig.mount ?? '').trim();
          const breaches = Array.isArray(data?.metricBreaches) ? data!.metricBreaches : [];
          // Severity must match the trigger type — a 'warning' breach
          // alone can't fire trigger_metric_critical.
          const wantLevel = triggerType === 'metric_critical' ? 'critical' : 'warning';
          const matches = breaches.some((b) => {
            if (b.level !== wantLevel) return false;
            if (wantMetric && b.metric !== wantMetric) return false;
            if (wantMount && (b.metric !== 'disk' || b.mount !== wantMount)) return false;
            return true;
          });
          if (!matches) {
            logger.debug({ scenarioId: scenario.id, deviceId, wantMetric, wantMount, breaches }, 'metric trigger: no breach matched node filter');
            continue;
          }
        }

        // Metric custom — admin-defined comparator+threshold against
        // the freshest cpu/memory/disk percentage. Unlike warning/
        // critical (which fire on transition only), this fires on
        // every push that satisfies the condition. Combine it with
        // `cooldownSeconds` below to throttle re-runs.
        if (triggerType === 'metric_custom') {
          const wantMetric = String(nodeConfig.metric ?? '').toLowerCase().trim();
          const comparator = nodeConfig.comparator === 'below' ? 'below' : 'above';
          const thresholdRaw = nodeConfig.threshold;
          const threshold = typeof thresholdRaw === 'number'
            ? thresholdRaw
            : (typeof thresholdRaw === 'string' && thresholdRaw.trim() !== '' ? Number(thresholdRaw) : NaN);
          if (!wantMetric || !Number.isFinite(threshold)) {
            logger.debug({ scenarioId: scenario.id, nodeId: tn.node_id }, 'metric_custom: incomplete config, skipping');
            continue;
          }
          const m = data?.metrics;
          let measured: number | null = null;
          if (wantMetric === 'cpu') {
            measured = typeof m?.cpu?.percent === 'number' ? m.cpu.percent : null;
          } else if (wantMetric === 'memory' || wantMetric === 'ram') {
            measured = typeof m?.memory?.percent === 'number' ? m.memory.percent : null;
          } else if (wantMetric === 'disk') {
            const wantMount = String(nodeConfig.mount ?? '').trim();
            const disks = Array.isArray(m?.disks) ? m!.disks : [];
            // Exclude removable / optical mounts so a USB stick at 99 %
            // can't trip a maintenance scenario by accident.
            const eligible = disks.filter((d) => !d.removable && d.fstype !== 'cdfs' && d.fstype !== 'iso9660' && d.fstype !== 'udf');
            if (wantMount) {
              const match = eligible.find((d) => d.mount === wantMount);
              measured = match ? match.percent : null;
            } else {
              // No mount filter — pick the worst (highest for above, lowest
              // for below) so we always evaluate against the most extreme
              // disk on the host.
              if (eligible.length > 0) {
                measured = comparator === 'above'
                  ? Math.max(...eligible.map((d) => d.percent))
                  : Math.min(...eligible.map((d) => d.percent));
              }
            }
          }
          if (measured == null) {
            logger.debug({ scenarioId: scenario.id, nodeId: tn.node_id, wantMetric }, 'metric_custom: no value for metric, skipping');
            continue;
          }
          const matches = comparator === 'above' ? measured > threshold : measured < threshold;
          if (!matches) continue;
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

        // Cooldown used to live here as a per-trigger-node field
        // (`cooldownSeconds`). It moved to a first-class graph node
        // (`type='cooldown'`) so multiple triggers fanning into the
        // same cooldown share one window — see migration 087 +
        // EXECUTORS.cooldown in scenarioGraph.service.ts. Legacy
        // configs are auto-rewired by 087 so we don't honour
        // `cooldownSeconds` here anymore.

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

    // Shared batch marker — every device run created from this call
    // carries the same trigger_source so the editor's history panel
    // can collapse them under a single batch header ("Manual · 200
    // devices · 14:32") instead of rendering 200 separate "1 device"
    // run groups. Format mirrors the graph-editor batch marker:
    //   <triggerType>:batch:<unique-id>
    // The id is timestamp + random suffix so concurrent triggers
    // remain distinguishable.
    const batchMarker = `manual:batch:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const runs: ScenarioRun[] = [];
    for (const deviceId of targets) {
      try {
        const run = await scenarioService.triggerScenario(scenarioId, deviceId, tenantId, 'manual', batchMarker);
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

    // Master tenant gets god-view across all scenarios; child tenants
    // stay strictly scoped to their own runs. Without this, opening a
    // child-tenant scenario from master (visible in the list via the
    // existing fan-out) returned an empty history because the
    // tenant_id filter excluded its runs.
    const isMaster = isMasterTenant(tenantId);
    let baseQ = db('scenario_runs');
    if (!isMaster) baseQ = baseQ.where({ 'scenario_runs.tenant_id': tenantId });
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
    const isMaster = isMasterTenant(tenantId);
    const q = db('scenario_runs').where({ 'scenario_runs.id': runId });
    if (!isMaster) q.where({ 'scenario_runs.tenant_id': tenantId });
    const row = await q
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

    // v2 — attach scenario_node_runs joined with their node definition
    // so the history modal can render node-by-node output. The legacy
    // stepRuns array stays empty for v2 graphs since they don't use
    // scenario_steps; the client checks both arrays and displays
    // whichever has rows.
    const nodeRunRows = await db('scenario_node_runs as nr')
      .leftJoin('scenario_nodes as n', 'n.id', 'nr.node_id')
      .where({ 'nr.run_id': runId })
      .orderBy('nr.started_at', 'asc')
      .select(
        'nr.id as id',
        'nr.run_id as run_id',
        'nr.node_id as node_id',
        'nr.node_type as node_type',
        'nr.status as status',
        'nr.exit_code as exit_code',
        'nr.stdout as stdout',
        'nr.stderr as stderr',
        'nr.error_message as error_message',
        'nr.started_at as started_at',
        'nr.finished_at as finished_at',
        'n.label as node_label',
      ) as Array<any>;
    (run as any).nodeRuns = nodeRunRows.map((r) => ({
      id: r.id,
      runId: r.run_id,
      nodeId: r.node_id,
      nodeType: r.node_type,
      nodeLabel: r.node_label ?? null,
      status: r.status,
      exitCode: r.exit_code,
      stdout: r.stdout,
      stderr: r.stderr,
      errorMessage: r.error_message,
      startedAt: r.started_at,
      finishedAt: r.finished_at,
    }));

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

// Rewrite a v1 import payload into v2 shape: every trigger config that
// carries a non-zero `cooldownSeconds` field gets a sibling cooldown
// node injected immediately downstream, with the trigger's existing
// outbound edges re-pointed at the cooldown node. Mirrors what the
// scenario_cooldown_node migration does on rows already in the DB so
// imports from older exports keep behaving the same.
function migrateV1ToV2(payload: any): any {
  const out = { ...payload, formatVersion: 2 };
  const nodes: any[] = Array.isArray(payload.nodes) ? [...payload.nodes] : [];
  const edges: any[] = Array.isArray(payload.edges) ? [...payload.edges] : [];
  const triggerTypes = new Set([
    'trigger_manual', 'trigger_session_login', 'trigger_machine_boot',
    'trigger_agent_approved', 'trigger_group_join', 'trigger_schedule_failure',
    'trigger_schedule_cron', 'trigger_agent_back_online', 'trigger_metric_warning',
    'trigger_metric_critical', 'trigger_metric_custom',
  ]);

  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (!n || typeof n !== 'object') continue;
    if (!triggerTypes.has(n.type)) continue;
    const cfg = (n.config && typeof n.config === 'object') ? { ...n.config } : {};
    const seconds = Number(cfg.cooldownSeconds);
    if (!Number.isFinite(seconds) || seconds <= 0) {
      delete cfg.cooldownSeconds;
      n.config = cfg;
      continue;
    }
    delete cfg.cooldownSeconds;
    n.config = cfg;
    const cdId = `${n.clientId}__cooldown_v1mig`;
    nodes.push({
      clientId: cdId,
      type: 'cooldown',
      label: 'Cooldown (v1-migrated)',
      config: { duration: seconds, unit: 'seconds' },
      positionX: (n.positionX ?? 0) + 200,
      positionY: n.positionY ?? 0,
    });
    // Re-point every outbound edge of the trigger to the cooldown node.
    for (const e of edges) {
      if (e && e.sourceNodeClientId === n.clientId) {
        e.sourceNodeClientId = cdId;
      }
    }
    // Bridge trigger -> cooldown so the chain reconnects.
    edges.push({
      sourceNodeClientId: n.clientId,
      targetNodeClientId: cdId,
      condition: { kind: 'always' },
    });
  }
  out.nodes = nodes;
  out.edges = edges;
  return out;
}
