import { db } from '../db';
import { logger } from '../utils/logger';
import type { ScenarioNodeType, ScenarioEdgeCondition, ScenarioTriggerType } from '@obliance/shared';

// Phase 1B — v1 → v2 converter. Idempotent: a scenario that already has
// any scenario_nodes is skipped. Called once at boot for every scenario
// in every tenant, and again right after `scenarioService.instantiate*`
// so newly created scenarios from templates enter the v2 pipeline
// immediately without waiting for the next reboot.

interface NodeSpec {
  type: ScenarioNodeType;
  label: string;
  config: Record<string, unknown>;
  positionX: number;
  positionY: number;
}

interface EdgeSpec {
  /** Index into the nodes array. */
  source: number;
  target: number;
  condition: ScenarioEdgeCondition;
  sortOrder: number;
}

const TRIGGER_NODE_TYPE: Record<ScenarioTriggerType, ScenarioNodeType> = {
  manual:           'trigger_manual',
  session_login:    'trigger_session_login',
  machine_boot:     'trigger_machine_boot',
  agent_approved:   'trigger_agent_approved',
  group_join:       'trigger_group_join',
  schedule_failure: 'trigger_schedule_failure',
  schedule_cron:    'trigger_schedule_cron',
  agent_back_online: 'trigger_agent_back_online',
  metric_warning:    'trigger_metric_warning',
  metric_critical:   'trigger_metric_critical',
  metric_custom:     'trigger_metric_custom',
};

/**
 * Build the v2 graph for a v1-style step list. Layout is a simple left-to-
 * right pipeline so the React Flow editor (Phase 1C) auto-layout has
 * something sensible to start from. Each step = up to 5 nodes:
 *   check → branch → resolve → recheck → branch
 * Steps without a check or resolve collapse to fewer nodes.
 */
export function buildV2GraphFromV1Steps(
  steps: Array<{
    name: string;
    checkScriptId: number | null;
    resolveScriptId: number | null;
    timeoutSeconds: number;
  }>,
  triggerType: ScenarioTriggerType,
): { nodes: NodeSpec[]; edges: EdgeSpec[] } {
  const nodes: NodeSpec[] = [];
  const edges: EdgeSpec[] = [];
  let edgeOrder = 0;
  let col = 1;
  let lastExitId = 0;
  // For each iteration we may stash how the next forward edge should
  // be conditioned (e.g. exit_code_eq:0 from a branch_exit_code), and
  // a "merge" node id whose pass-edge ALSO has to land on the next
  // forward target (branch2 from the recheck path). Both are local to
  // this invocation — function is fully reentrant.
  let pendingForwardCondition: ScenarioEdgeCondition = { kind: 'always' };
  let pendingMergeFromBranch2: number | null = null;
  const colX = (n: number) => n * 220;

  // Trigger node always at index 0.
  nodes.push({
    type: TRIGGER_NODE_TYPE[triggerType] ?? 'trigger_manual',
    label: 'Trigger',
    config: triggerType === 'schedule_cron' ? { cronExpression: '0 0 * * *', timezone: 'UTC' } : {},
    positionX: 0,
    positionY: 0,
  });

  for (const step of steps) {
    const baseY = 0;

    if (step.checkScriptId == null && step.resolveScriptId == null) {
      // Empty step — pass straight through.
      continue;
    }

    if (step.checkScriptId == null) {
      // No check, only resolve — chain it forward.
      const resolveIdx = nodes.length;
      nodes.push({
        type: 'run_script',
        label: `${step.name} — resolve`,
        config: { scriptId: step.resolveScriptId, timeoutSeconds: step.timeoutSeconds },
        positionX: colX(col), positionY: baseY,
      });
      edges.push({ source: lastExitId, target: resolveIdx, condition: pendingForwardCondition, sortOrder: edgeOrder++ });
      if (pendingMergeFromBranch2 != null) {
        edges.push({ source: pendingMergeFromBranch2, target: resolveIdx, condition: { kind: 'exit_code_eq', value: 0 }, sortOrder: edgeOrder++ });
        pendingMergeFromBranch2 = null;
      }
      lastExitId = resolveIdx;
      pendingForwardCondition = { kind: 'always' };
      col += 1;
      continue;
    }

    // Standard check → branch flow.
    const checkIdx = nodes.length;
    nodes.push({
      type: 'run_script',
      label: `${step.name} — check`,
      config: { scriptId: step.checkScriptId, timeoutSeconds: step.timeoutSeconds },
      positionX: colX(col), positionY: baseY,
    });
    col += 1;

    edges.push({ source: lastExitId, target: checkIdx, condition: pendingForwardCondition, sortOrder: edgeOrder++ });
    if (pendingMergeFromBranch2 != null) {
      edges.push({ source: pendingMergeFromBranch2, target: checkIdx, condition: { kind: 'exit_code_eq', value: 0 }, sortOrder: edgeOrder++ });
      pendingMergeFromBranch2 = null;
    }
    pendingForwardCondition = { kind: 'always' };

    const branchIdx = nodes.length;
    nodes.push({
      type: 'branch_exit_code',
      label: `${step.name} — pass?`,
      config: {},
      positionX: colX(col), positionY: baseY,
    });
    col += 1;
    edges.push({ source: checkIdx, target: branchIdx, condition: { kind: 'always' }, sortOrder: edgeOrder++ });

    if (step.resolveScriptId == null) {
      // No resolve — branch default → end_failure, success → forward.
      const failIdx = nodes.length;
      nodes.push({
        type: 'end_failure',
        label: `${step.name} — failed`,
        config: { message: `Step "${step.name}" check failed` },
        positionX: colX(col), positionY: baseY + 160,
      });
      edges.push({ source: branchIdx, target: failIdx, condition: { kind: 'default' }, sortOrder: edgeOrder++ });
      lastExitId = branchIdx;
      pendingForwardCondition = { kind: 'exit_code_eq', value: 0 };
      continue;
    }

    // With resolve: branch1 default → resolve → recheck → branch2.
    const resolveIdx = nodes.length;
    nodes.push({
      type: 'run_script',
      label: `${step.name} — resolve`,
      config: { scriptId: step.resolveScriptId, timeoutSeconds: step.timeoutSeconds },
      positionX: colX(col), positionY: baseY + 160,
    });
    col += 1;
    const recheckIdx = nodes.length;
    nodes.push({
      type: 'run_script',
      label: `${step.name} — recheck`,
      config: { scriptId: step.checkScriptId, timeoutSeconds: step.timeoutSeconds },
      positionX: colX(col), positionY: baseY + 160,
    });
    col += 1;
    const branch2Idx = nodes.length;
    nodes.push({
      type: 'branch_exit_code',
      label: `${step.name} — recheck pass?`,
      config: {},
      positionX: colX(col), positionY: baseY + 160,
    });
    col += 1;
    const failIdx = nodes.length;
    nodes.push({
      type: 'end_failure',
      label: `${step.name} — failed after resolve`,
      config: { message: `Step "${step.name}" recheck failed after remediation` },
      positionX: colX(col), positionY: baseY + 320,
    });
    col += 1;

    edges.push({ source: branchIdx, target: resolveIdx, condition: { kind: 'default' }, sortOrder: edgeOrder++ });
    edges.push({ source: resolveIdx, target: recheckIdx, condition: { kind: 'always' }, sortOrder: edgeOrder++ });
    edges.push({ source: recheckIdx, target: branch2Idx, condition: { kind: 'always' }, sortOrder: edgeOrder++ });
    edges.push({ source: branch2Idx, target: failIdx, condition: { kind: 'default' }, sortOrder: edgeOrder++ });

    // Both branch1 (check passed first try) and branch2 (recheck pass)
    // need to feed the next forward step. We use lastExitId for branch1
    // and stash branch2 to add a second edge on the next iteration.
    lastExitId = branchIdx;
    pendingForwardCondition = { kind: 'exit_code_eq', value: 0 };
    pendingMergeFromBranch2 = branch2Idx;
  }

  // Terminal end_success — both lingering branches merge here.
  const successIdx = nodes.length;
  nodes.push({
    type: 'end_success',
    label: 'Done',
    config: { message: 'Scenario completed successfully' },
    positionX: (col + 1) * 220, positionY: 0,
  });
  edges.push({ source: lastExitId, target: successIdx, condition: pendingForwardCondition, sortOrder: edgeOrder++ });
  if (pendingMergeFromBranch2 != null) {
    edges.push({ source: pendingMergeFromBranch2, target: successIdx, condition: { kind: 'exit_code_eq', value: 0 }, sortOrder: edgeOrder++ });
  }

  return { nodes, edges };
}

/**
 * Idempotent migration of one scenario to the v2 graph model. Skips if any
 * scenario_nodes already exist for the scenario. Logs and continues on
 * any failure so a single bad scenario doesn't poison the boot loop.
 */
export async function migrateScenarioToV2(scenarioId: number): Promise<{ migrated: boolean; reason?: string }> {
  const existing = await db('scenario_nodes').where({ scenario_id: scenarioId }).first();
  if (existing) return { migrated: false, reason: 'already migrated' };

  const scenario = await db('scenarios').where({ id: scenarioId }).first();
  if (!scenario) return { migrated: false, reason: 'scenario not found' };

  const stepRows = await db('scenario_steps').where({ scenario_id: scenarioId }).orderBy('sort_order') as Array<{
    id: number; name: string; check_script_id: number | null; resolve_script_id: number | null;
    timeout_seconds: number;
  }>;
  const steps = stepRows.map((s) => ({
    name: s.name,
    checkScriptId: s.check_script_id,
    resolveScriptId: s.resolve_script_id,
    timeoutSeconds: s.timeout_seconds,
  }));

  const { nodes, edges } = buildV2GraphFromV1Steps(steps, scenario.trigger_type as ScenarioTriggerType);

  await db.transaction(async (trx) => {
    const idMap: number[] = []; // index → real DB id
    for (const n of nodes) {
      const [row] = await trx('scenario_nodes').insert({
        scenario_id: scenarioId,
        type: n.type,
        label: n.label,
        config: JSON.stringify(n.config),
        position_x: n.positionX,
        position_y: n.positionY,
      }).returning('id') as Array<{ id: number }>;
      idMap.push(row.id);
    }
    for (const e of edges) {
      await trx('scenario_edges').insert({
        scenario_id: scenarioId,
        source_node_id: idMap[e.source],
        target_node_id: idMap[e.target],
        condition: JSON.stringify(e.condition),
        sort_order: e.sortOrder,
      });
    }
  });

  return { migrated: true };
}

/**
 * Boot helper — walk every scenario in every tenant and migrate any that
 * still lack v2 nodes. Designed to be safe to re-run on every restart;
 * already-migrated scenarios are detected by the existing node-count
 * check and skipped.
 */
export async function migrateAllV1Scenarios(): Promise<void> {
  const all = await db('scenarios').select('id') as Array<{ id: number }>;
  let migrated = 0;
  for (const s of all) {
    try {
      const result = await migrateScenarioToV2(s.id);
      if (result.migrated) migrated += 1;
    } catch (err) {
      logger.error({ err, scenarioId: s.id }, 'v1 → v2 scenario migration failed');
    }
  }
  if (migrated > 0) {
    logger.info(`Scenarios v2: migrated ${migrated}/${all.length} scenarios at boot`);
  }
}
