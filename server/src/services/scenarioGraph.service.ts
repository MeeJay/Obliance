import { db } from '../db';
import { logger } from '../utils/logger';
import { commandService } from './command.service';
import { getIO } from '../socket';
import { SocketEvents } from '@obliance/shared';
import type {
  ScenarioNode, ScenarioEdge, ScenarioNodeType, ScenarioEdgeCondition,
} from '@obliance/shared';

// ── Phase 1A — graph engine ──────────────────────────────────────────────────
// Walks the scenario_nodes / scenario_edges graph for a given run. The
// engine is event-driven: each node either completes synchronously (and we
// immediately advance to the next) or fires an external action (typically an
// agent command) and parks until the ack lands in `handleNodeCommandAck`.
//
// Per-node-type behaviour lives in the `EXECUTORS` map below — keep this
// file as the single source of truth so the legacy linear engine in
// scenario.service.ts can be retired cleanly once Phase 1B's auto-migration
// has rewritten every tenant's scenarios.

// ── Helpers — row mappers ────────────────────────────────────────────────────

function rowToNode(row: any): ScenarioNode {
  return {
    id: row.id,
    uuid: row.uuid,
    scenarioId: row.scenario_id,
    type: row.type as ScenarioNodeType,
    label: row.label,
    config: typeof row.config === 'string' ? JSON.parse(row.config) : (row.config ?? {}),
    positionX: row.position_x,
    positionY: row.position_y,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  };
}

function rowToEdge(row: any): ScenarioEdge {
  return {
    id: row.id,
    uuid: row.uuid,
    scenarioId: row.scenario_id,
    sourceNodeId: row.source_node_id,
    sourceHandle: row.source_handle,
    targetNodeId: row.target_node_id,
    condition: typeof row.condition === 'string' ? JSON.parse(row.condition) : (row.condition ?? { kind: 'always' }),
    sortOrder: row.sort_order,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  };
}

// ── Cycle protection ─────────────────────────────────────────────────────────
// A misconfigured graph (or a deliberate loop in Phase 2) could spin
// forever. We cap each node at 100 visits per run; beyond that the run is
// failed with a clear error so the user can fix the graph.
const MAX_NODE_VISITS = 100;

// ── Edge selection ───────────────────────────────────────────────────────────
//
// Given the node we just left and the result it produced (last_exit_code),
// pick the outgoing edge to follow. Edges sorted by sort_order — the first
// matching condition wins. `default` edges are reserved for "no other edge
// matched" semantics so admins can build switch-case patterns naturally.

function edgeMatches(condition: ScenarioEdgeCondition, exitCode: number | null): boolean {
  switch (condition.kind) {
    case 'always':       return true;
    case 'default':      return false; // handled separately as fallback
    case 'exit_code_eq': return exitCode === condition.value;
    case 'exit_code_in': return exitCode != null && condition.values.includes(exitCode);
    case 'exit_code_neq': return exitCode !== condition.value;
  }
}

async function pickNextEdge(scenarioId: number, fromNodeId: number, exitCode: number | null): Promise<ScenarioEdge | null> {
  const rows = await db('scenario_edges')
    .where({ scenario_id: scenarioId, source_node_id: fromNodeId })
    .orderBy('sort_order', 'asc');
  const edges = rows.map(rowToEdge);

  // Direct matches (anything except 'default') are evaluated first.
  for (const e of edges) {
    if (e.condition.kind !== 'default' && edgeMatches(e.condition, exitCode)) return e;
  }
  // Fallback to a default edge if any.
  return edges.find((e) => e.condition.kind === 'default') ?? null;
}

// ── Boot janitor — re-arm wait timers ───────────────────────────────────────
// A `wait` node parks the run via setTimeout. If the server reboots
// during the wait, the timer is gone but the run row is still in
// 'running' state with current_node_id pointing at the wait node. This
// helper finds those orphans at boot and either fires the resume
// immediately (if the wait window has elapsed) or rearms the timer for
// the remaining seconds.

export async function rearmWaitTimersOnBoot(): Promise<void> {
  const orphans = await db('scenario_runs as r')
    .join('scenario_node_runs as nr', function() {
      this.on('nr.run_id', 'r.id').andOn('nr.node_id', 'r.current_node_id');
    })
    .join('scenario_nodes as n', 'n.id', 'r.current_node_id')
    .where({ 'r.status': 'running', 'n.type': 'wait', 'nr.status': 'running' })
    .whereNull('nr.finished_at')
    .select('r.id as run_id', 'nr.id as node_run_id', 'nr.started_at', 'n.config') as Array<{
      run_id: string; node_run_id: string; started_at: Date; config: any;
    }>;
  for (const o of orphans) {
    try {
      const cfg = typeof o.config === 'string' ? JSON.parse(o.config) : (o.config ?? {});
      const seconds = Number(cfg.seconds ?? 0);
      const elapsedMs = Date.now() - new Date(o.started_at).getTime();
      const remainingMs = Math.max(0, seconds * 1000 - elapsedMs);
      if (remainingMs === 0) {
        // Wait window already elapsed — resume immediately.
        await scenarioGraphService.handleNodeCommandAck(o.node_run_id, 0, null, null);
      } else {
        setTimeout(async () => {
          try { await scenarioGraphService.handleNodeCommandAck(o.node_run_id, 0, null, null); }
          catch (err) { logger.error({ err, nodeRunId: o.node_run_id }, 'rearm wait resume failed'); }
        }, remainingMs).unref();
      }
    } catch (err) {
      logger.error({ err, runId: o.run_id }, 'rearm wait — config parse failed');
    }
  }
  if (orphans.length > 0) {
    logger.info({ count: orphans.length }, 'Scenarios v2: rearmed wait timers after reboot');
  }
}

// ── Public entry points ──────────────────────────────────────────────────────

export const scenarioGraphService = {
  /**
   * Kick off a run for a scenario on a target device. Three modes:
   *
   * 1. **Trigger-driven** (default): pass `triggerNodeId` (optional) — engine
   *    walks from that trigger node's first downstream edge. Used by event
   *    triggers + the editor's "Run on device" button.
   * 2. **Mid-graph entry**: pass `startNodeId` to execute that exact node
   *    directly (skipping any trigger walk). Used by the right-click
   *    "Run from this node" action so admins can test the bottom half of
   *    a graph without re-running the trigger preamble.
   * 3. **Single-node test**: pass `singleNode: true` (with `startNodeId`
   *    or `triggerNodeId`) to halt the run with success after the
   *    selected node finishes — no edge walk after completion. The flag
   *    is encoded into trigger_source as a `__single_node` marker so
   *    `_advance` can short-circuit it without a schema migration.
   *
   * The scenario's status is intentionally NOT checked — admins must be
   * able to test disabled/draft scenarios from the editor before flipping
   * them to active.
   */
  async startRun(scenarioId: number, deviceId: number, opts: {
    triggerType: string;
    triggerSource?: string;
    triggerNodeId?: number;
    /** Mid-graph entry: execute this node directly. */
    startNodeId?: number;
    /** Stop with success after the entry node completes (one-shot test). */
    singleNode?: boolean;
  }): Promise<string> {
    const scenario = await db('scenarios').where({ id: scenarioId }).first();
    if (!scenario) throw new Error(`Scenario ${scenarioId} not found`);

    // Compose the trigger_source carrier so _advance can detect single-
    // node test runs. Format: "<base>|__single_node" with empty base ok.
    const baseSource = opts.triggerSource ?? null;
    const triggerSource = opts.singleNode
      ? `${baseSource ?? ''}|__single_node`
      : baseSource;

    // Resolve the entry node — either an explicit startNodeId (mid-graph)
    // or the trigger flow.
    let entryNodeId: number | undefined;
    let walkFromTrigger = false;
    if (opts.startNodeId) {
      const node = await db('scenario_nodes')
        .where({ id: opts.startNodeId, scenario_id: scenarioId })
        .first() as { id: number } | undefined;
      if (!node) throw new Error(`Node ${opts.startNodeId} not found in scenario ${scenarioId}`);
      entryNodeId = node.id;
    } else {
      let triggerNode: { id: number } | undefined;
      if (opts.triggerNodeId) {
        triggerNode = await db('scenario_nodes')
          .where({ id: opts.triggerNodeId, scenario_id: scenarioId })
          .first() as { id: number } | undefined;
      }
      if (!triggerNode) {
        triggerNode = await db('scenario_nodes')
          .where({ scenario_id: scenarioId })
          .whereLike('type', 'trigger_%')
          .first() as { id: number } | undefined;
      }
      if (!triggerNode) throw new Error(`Scenario ${scenarioId} has no trigger node — graph is incomplete`);
      entryNodeId = triggerNode.id;
      walkFromTrigger = true;
    }

    const [runRow] = await db('scenario_runs')
      .insert({
        tenant_id: scenario.tenant_id,
        scenario_id: scenarioId,
        device_id: deviceId,
        trigger_type: opts.triggerType,
        trigger_source: triggerSource,
        status: 'running',
        started_at: new Date(),
      })
      .returning('id') as Array<{ id: string }>;

    // The whole executeNode chain is wrapped here as a safety net:
    // executeNode already catches per-node executor errors, but a
    // failure in its own bookkeeping (markRunFailure / _completeNode
    // hitting an unexpected DB state) would otherwise propagate up and
    // turn the route into a 500. Catching here lets us still return a
    // runId so the caller can render the failed run in the UI.
    try {
      if (walkFromTrigger) {
        // Trigger nodes are passive — advance to the first non-trigger
        // neighbour. If a single-node test was asked from a trigger, the
        // first downstream node is the one that runs and stops.
        const firstEdge = await pickNextEdge(scenarioId, entryNodeId!, null);
        if (!firstEdge) {
          await markRunFailure(runRow.id, 'Trigger node has no outgoing edge');
          return runRow.id;
        }
        await this.executeNode(runRow.id, firstEdge.targetNodeId);
      } else {
        // Mid-graph entry — run the named node directly.
        await this.executeNode(runRow.id, entryNodeId!);
      }
    } catch (err) {
      logger.error({ err, runId: runRow.id, scenarioId }, 'startRun: engine top-level threw — marking run failed');
      try { await markRunFailure(runRow.id, err instanceof Error ? err.message : String(err)); } catch { /* swallow secondary failure */ }
    }
    return runRow.id;
  },

  /**
   * Execute a single node. Records a scenario_node_runs row, dispatches to
   * the right executor by `type`, and either advances synchronously
   * (logical / terminator nodes) or parks waiting for an agent ack
   * (run_script / run_command / wait).
   */
  async executeNode(runId: string, nodeId: number): Promise<void> {
    const run = await db('scenario_runs').where({ id: runId }).first();
    if (!run || run.status !== 'running') return;

    const node = await db('scenario_nodes').where({ id: nodeId }).first();
    if (!node) {
      await markRunFailure(runId, `Node ${nodeId} not found`);
      return;
    }
    const typedNode = rowToNode(node);

    // Cycle guard. Increment first so even a node that immediately fails
    // counts toward the cap.
    const visits = (typeof run.visit_counts === 'string' ? JSON.parse(run.visit_counts) : (run.visit_counts ?? {})) as Record<string, number>;
    visits[String(nodeId)] = (visits[String(nodeId)] ?? 0) + 1;
    if (visits[String(nodeId)] > MAX_NODE_VISITS) {
      await markRunFailure(runId, `Node "${typedNode.label || typedNode.type}" visited ${MAX_NODE_VISITS}+ times — likely cycle`);
      return;
    }
    await db('scenario_runs').where({ id: runId }).update({
      current_node_id: nodeId,
      visit_counts: JSON.stringify(visits),
      updated_at: new Date(),
    });

    const [nrRow] = await db('scenario_node_runs').insert({
      run_id: runId,
      node_id: nodeId,
      node_type: typedNode.type,
      status: 'running',
      started_at: new Date(),
    }).returning('id') as Array<{ id: string }>;
    const nodeRunId = nrRow.id;

    // Live viewer — emit a 'running' event the moment the node starts so
    // the editor lights up the matching node immediately. Without this
    // the canvas only paints once the ack lands (i.e. only on script
    // finish), and a long-running script never visibly enters 'running'.
    //
    // Including `scenarioId` lets the client filter incoming events by
    // its own scenarioId rather than by a runId it might not yet know
    // about — the synchronous `running` emit happens BEFORE the HTTP
    // response carrying the runIds reaches the client, otherwise the
    // event would be dropped.
    try {
      const io = getIO();
      if (io) io.to(`tenant:${run.tenant_id}`).emit(SocketEvents.SCENARIO_NODE_UPDATED, {
        runId, nodeRunId, nodeId, status: 'running',
        scenarioId: run.scenario_id,
        exitCode: null, stdout: null, stderr: null, errorMessage: null,
        deviceId: run.device_id ?? null,
      });
    } catch { /* socket not ready — fine */ }

    const exec = EXECUTORS[typedNode.type];
    if (!exec) {
      await this._completeNode(runId, nodeRunId, { exitCode: null, stdout: null, stderr: null, errorMessage: `Unsupported node type: ${typedNode.type}` }, 'failed');
      await markRunFailure(runId, `Unsupported node type: ${typedNode.type}`);
      return;
    }

    try {
      const result = await exec({ run, node: typedNode, nodeRunId });
      // `awaitsAck` = the executor fired an external action and parked the
      // run. The ack handler will advance the graph.
      if (result.awaitsAck) return;

      // Terminal? End the run right here.
      //
      // Capture the executor's `errorMessage` (used by end_success and
      // end_failure to surface the admin-defined message) into the
      // node-run trace so the history modal renders it instead of
      // showing a blank "no output" terminator. Convention:
      //   - end_success: store message as stdout (it's a positive
      //     completion note — "Deployment finished" — and lives
      //     alongside any earlier node's stdout in the trace).
      //   - end_failure: store message as errorMessage so the red
      //     banner highlights it the way runtime errors are surfaced.
      if (result.terminate) {
        const isSuccess = result.terminate === 'success';
        await this._completeNode(runId, nodeRunId, {
          exitCode: result.exitCode ?? null,
          stdout:  isSuccess ? (result.errorMessage ?? null) : null,
          stderr:  null,
          errorMessage: isSuccess ? null : (result.errorMessage ?? null),
        }, isSuccess ? 'success' : 'failed');
        if (isSuccess) await markRunSuccess(runId);
        else           await markRunFailure(runId, result.errorMessage ?? 'Scenario ended in failure node');
        return;
      }

      // Synchronous completion — record the result and pick the next edge.
      await this._completeNode(runId, nodeRunId, {
        exitCode: result.exitCode ?? null,
        stdout: result.stdout ?? null,
        stderr: null,
        errorMessage: null,
      }, 'success');
      await this._advance(runId, nodeId, result.exitCode ?? null);
    } catch (err) {
      logger.error({ err, nodeId, type: typedNode.type }, 'Scenario v2 node executor threw');
      await this._completeNode(runId, nodeRunId, {
        exitCode: null, stdout: null, stderr: null,
        errorMessage: err instanceof Error ? err.message : String(err),
      }, 'failed');
      await markRunFailure(runId, `Node "${typedNode.label || typedNode.type}" failed: ${err instanceof Error ? err.message : err}`);
    }
  },

  /**
   * Called by command.service when an agent command tied to a scenario
   * node finishes. Updates the node run with the exit code, then walks
   * the graph from this node based on the result.
   */
  async handleNodeCommandAck(nodeRunId: string, exitCode: number | null, stdout: string | null, stderr: string | null): Promise<void> {
    const nrRow = await db('scenario_node_runs').where({ id: nodeRunId }).first();
    if (!nrRow) return;
    const runRow = await db('scenario_runs').where({ id: nrRow.run_id }).first();
    if (!runRow || runRow.status !== 'running') return;

    const passed = exitCode === 0;
    await this._completeNode(nrRow.run_id, nodeRunId, { exitCode, stdout, stderr, errorMessage: null }, passed ? 'success' : 'success');
    // We always advance after an ack — the graph's branch_exit_code nodes
    // (or simple two-edge layouts) decide what 'pass' vs 'fail' means.
    await this._advance(nrRow.run_id, nrRow.node_id, exitCode);
  },

  /**
   * Internal: write the node-run trace + bump remediation_count when a
   * resolve-style node ran. Called by every executor at completion.
   */
  async _completeNode(
    runId: string,
    nodeRunId: string,
    result: { exitCode: number | null; stdout: string | null; stderr: string | null; errorMessage: string | null },
    status: 'success' | 'failed' | 'skipped',
  ) {
    const [updated] = await db('scenario_node_runs').where({ id: nodeRunId }).update({
      status,
      exit_code: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      error_message: result.errorMessage,
      finished_at: new Date(),
    }).returning('*');
    // Mirror the last result on the run so the next branch_exit_code can
    // see it without re-reading scenario_node_runs. Returning device_id
    // and tenant_id lets the live socket payload identify which device
    // the result belongs to (multi-device test runs need this to bucket
    // outputs per agent in the editor's panel).
    const runRow = await db('scenario_runs').where({ id: runId }).update({
      last_exit_code: result.exitCode,
      last_stdout: result.stdout,
      last_stderr: result.stderr,
      updated_at: new Date(),
    }).returning(['tenant_id', 'device_id']);
    // Live viewer broadcast — the editor listens for SCENARIO_NODE_UPDATED
    // and highlights the matching node in the React Flow canvas. We
    // include a truncated copy of stdout/stderr so the editor's output
    // panel can render the script result inline without a follow-up
    // HTTP fetch. Truncation keeps the websocket frame small even when a
    // misbehaving script dumps megabytes.
    if (updated && runRow[0]) {
      try {
        const io = getIO();
        if (io) {
          const truncate = (s: string | null, max = 16 * 1024) => {
            if (s == null) return null;
            return s.length > max ? `${s.slice(0, max)}\n…[truncated, full output ${s.length} chars]` : s;
          };
          // Look up scenario_id once for the payload — _completeNode
          // only updates scenario_runs columns, so we read it back
          // alongside the tenant/device for the socket envelope.
          const ridRow = await db('scenario_runs').where({ id: runId }).select('scenario_id').first();
          io.to(`tenant:${runRow[0].tenant_id}`).emit(SocketEvents.SCENARIO_NODE_UPDATED, {
            runId, nodeRunId, nodeId: updated.node_id, status,
            scenarioId: ridRow?.scenario_id ?? null,
            exitCode: result.exitCode,
            stdout: truncate(result.stdout),
            stderr: truncate(result.stderr),
            errorMessage: result.errorMessage,
            deviceId: runRow[0].device_id ?? null,
          });
        }
      } catch { /* socket not ready at boot — fine */ }
    }
  },

  /**
   * Internal: pick the next edge based on the previous node's exit code,
   * then execute the target. If no edge matches, we treat that as a
   * graph-design error and fail the run.
   *
   * Single-node test runs (trigger_source carries the `__single_node`
   * marker) short-circuit here: the engine ends the run with success
   * after the entry node completes, regardless of whether outgoing
   * edges exist. Lets admins right-click a node and "run only this
   * node" without polluting the rest of the graph.
   */
  async _advance(runId: string, fromNodeId: number, exitCode: number | null): Promise<void> {
    const run = await db('scenario_runs').where({ id: runId }).first();
    if (!run) return;
    if (typeof run.trigger_source === 'string' && run.trigger_source.includes('__single_node')) {
      await markRunSuccess(runId);
      return;
    }
    const next = await pickNextEdge(run.scenario_id, fromNodeId, exitCode);
    if (!next) {
      // No matching edge means the graph has nothing to do for this
      // result. Treat as a successful run end — admins who want a hard
      // fail-on-no-match should add an explicit `default` → end_failure
      // edge.
      await markRunSuccess(runId);
      return;
    }
    await this.executeNode(runId, next.targetNodeId);
  },
};

// ── Per-type executors ───────────────────────────────────────────────────────

interface ExecutorContext {
  run: any;
  node: ScenarioNode;
  nodeRunId: string;
}
interface ExecutorResult {
  /** Engine should not advance — an external ack will do it. */
  awaitsAck?: boolean;
  /** Engine should mark the run as ended in this state. */
  terminate?: 'success' | 'failure';
  errorMessage?: string;
  /** Result captured for downstream branch_exit_code edges. */
  exitCode?: number | null;
  stdout?: string | null;
}

const EXECUTORS: Partial<Record<ScenarioNodeType, (ctx: ExecutorContext) => Promise<ExecutorResult>>> = {
  // ── Triggers — passive, never executed (the engine starts at their
  // first downstream neighbour). Kept here so unrecognised triggers fail
  // loud rather than silently mis-route.
  trigger_manual:           async () => ({ exitCode: null }),
  trigger_session_login:    async () => ({ exitCode: null }),
  trigger_machine_boot:     async () => ({ exitCode: null }),
  trigger_agent_approved:   async () => ({ exitCode: null }),
  trigger_group_join:       async () => ({ exitCode: null }),
  trigger_schedule_failure: async () => ({ exitCode: null }),
  trigger_schedule_cron:    async () => ({ exitCode: null }),
  trigger_agent_back_online: async () => ({ exitCode: null }),

  // ── run_script — fires an agent command and parks. Resumes via
  // handleNodeCommandAck once the ack lands. The exit code captured at
  // ack time drives every downstream branch_exit_code.
  run_script: async ({ run, node, nodeRunId }) => {
    const cfg = node.config as { scriptId?: number; parameters?: Record<string, string>; timeoutSeconds?: number };
    if (!cfg.scriptId) throw new Error('run_script node missing scriptId');
    // Resolve the script row so the payload carries everything the
    // agent's run_script handler expects. Sending only `scriptId`
    // makes the agent reject with "runtime not specified" — the
    // schedule and execute paths both resolve here.
    const script = await db('scripts')
      .where({ id: cfg.scriptId, tenant_id: run.tenant_id })
      .first() as {
        id: number; runtime: string; content: string;
        timeout_seconds: number;
        expected_exit_code: number | null;
        run_as: string | null;
      } | undefined;
    if (!script) throw new Error(`run_script: script ${cfg.scriptId} not found in tenant`);
    const effectiveTimeout = cfg.timeoutSeconds ?? script.timeout_seconds ?? 300;
    await commandService.enqueue({
      deviceId: run.device_id,
      tenantId: run.tenant_id,
      type: 'run_script',
      payload: {
        scriptId: script.id,
        runtime: script.runtime,
        content: script.content,
        parameters: cfg.parameters ?? {},
        timeoutSeconds: effectiveTimeout,
        expectedExitCode: script.expected_exit_code ?? 0,
        runAs: script.run_as,
      },
      priority: 'high',
      sourceType: 'scenario_node',
      sourceId: nodeRunId,
      expiresInSeconds: effectiveTimeout + 300,
    });
    return { awaitsAck: true };
  },

  // ── send_notification — tenant-channel dispatch via the existing
  // automation notification service. Does not park; the result is
  // synchronous (we don't wait for the channel's HTTP round trip).
  send_notification: async ({ run, node }) => {
    const cfg = node.config as { channels?: Array<{ channelId: number; mode: 'on_error' | 'summary' }>; subject?: string; body?: string };
    if (!cfg.channels?.length) return { exitCode: 0 };
    const { automationNotificationService } = await import('./automationNotification.service');
    const scenario = await db('scenarios').where({ id: run.scenario_id }).first();
    const device = await db('devices').where({ id: run.device_id }).select('hostname', 'display_name').first();
    const deviceName = device?.display_name || device?.hostname || `#${run.device_id}`;
    await automationNotificationService.notify(run.tenant_id, cfg.channels, {
      automationType: 'scenario',
      automationName: cfg.subject || scenario?.name || 'Scenario',
      successCount: 1,
      failureCount: 0,
      totalCount: 1,
      failedDeviceNames: [],
      // The body field isn't part of the existing summary payload, but
      // automationNotificationService logs it via its renderer when the
      // template includes a body slot. Future Phase 2 will add proper
      // templating with run variables.
      ...(cfg.body ? { customBody: cfg.body } : {}),
    } as any);
    return { exitCode: 0 };
  },

  // ── wait — schedules a setTimeout that re-enters the engine after the
  // delay. Lightweight; if the server restarts mid-wait, the run is left
  // in 'running' status and a janitor job (Phase 1B) re-arms the timer.
  wait: async ({ run, node, nodeRunId }) => {
    const cfg = node.config as { seconds?: number };
    const delayMs = Math.max(0, (cfg.seconds ?? 0) * 1000);
    if (delayMs === 0) return { exitCode: 0 };
    setTimeout(async () => {
      try {
        await scenarioGraphService.handleNodeCommandAck(nodeRunId, 0, null, null);
      } catch (err) {
        logger.error({ err, nodeRunId }, 'wait node resume failed');
      }
    }, delayMs).unref();
    return { awaitsAck: true };
  },

  // ── branch_exit_code — pure logic, no side effect. The engine reads
  // run.last_exit_code from the previous node and our outgoing edges'
  // conditions match against it. We just pass through.
  branch_exit_code: async ({ run }) => {
    return { exitCode: run.last_exit_code ?? null };
  },

  // ── run_command — fires a typed command (reboot, shutdown, install_updates,
  // start/stop/restart_service, kill_process, …). The agent's command
  // dispatcher handles each type; on ack the engine resumes the graph.
  // Same source_type pattern as run_script, so the unified ack handler
  // routes it correctly without extra wiring.
  run_command: async ({ run, node, nodeRunId }) => {
    const cfg = node.config as { commandType?: string; payload?: Record<string, unknown>; timeoutSeconds?: number };
    if (!cfg.commandType) throw new Error('run_command node missing commandType');
    await commandService.enqueue({
      deviceId: run.device_id,
      tenantId: run.tenant_id,
      type: cfg.commandType as any,
      payload: cfg.payload ?? {},
      priority: 'high',
      sourceType: 'scenario_node',
      sourceId: nodeRunId,
      expiresInSeconds: cfg.timeoutSeconds ?? 300,
    });
    return { awaitsAck: true };
  },

  // ── tag_device — synchronous mutation of the target device's tags
  // array. add/remove are comma-separated strings or string arrays;
  // add wins over remove for the same value.
  tag_device: async ({ run, node }) => {
    const cfg = node.config as { add?: string | string[]; remove?: string | string[] };
    const toArr = (v: unknown): string[] => {
      if (Array.isArray(v)) return v.map(String).map((x) => x.trim()).filter(Boolean);
      if (typeof v === 'string') return v.split(',').map((x) => x.trim()).filter(Boolean);
      return [];
    };
    const add = new Set(toArr(cfg.add));
    const remove = new Set(toArr(cfg.remove));
    const row = await db('devices').where({ id: run.device_id, tenant_id: run.tenant_id }).select('tags').first();
    if (!row) throw new Error(`tag_device: device ${run.device_id} not found`);
    const current: string[] = Array.isArray(row.tags) ? row.tags : (typeof row.tags === 'string' ? JSON.parse(row.tags) : []);
    const next = new Set(current);
    for (const t of remove) next.delete(t);
    for (const t of add)    next.add(t);
    await db('devices').where({ id: run.device_id, tenant_id: run.tenant_id }).update({
      tags: JSON.stringify([...next]),
      updated_at: new Date(),
    });
    return { exitCode: 0 };
  },

  // ── move_device_to_group — set group_id (null clears). Validates the
  // target group is in the same tenant before writing.
  move_device_to_group: async ({ run, node }) => {
    const cfg = node.config as { groupId?: number | null };
    const groupId = cfg.groupId ?? null;
    if (groupId != null) {
      const grp = await db('device_groups').where({ id: groupId, tenant_id: run.tenant_id }).first();
      if (!grp) throw new Error(`move_device_to_group: group ${groupId} not in tenant`);
    }
    await db('devices').where({ id: run.device_id, tenant_id: run.tenant_id }).update({
      group_id: groupId,
      updated_at: new Date(),
    });
    return { exitCode: 0 };
  },

  // ── branch_on_device — synchronous logic. The match field selects which
  // attribute to compare; the result is encoded as the node's exit code so
  // outgoing branch_exit_code-style edges can route on it. 0 = matched,
  // 1 = did not match. Edges should use exit_code_eq:0 for the "yes"
  // path and `default` (or exit_code_eq:1) for the "no" path.
  branch_on_device: async ({ run, node }) => {
    const cfg = node.config as { match?: string; value?: string };
    const match = cfg.match ?? '';
    const value = cfg.value ?? '';
    const dev = await db('devices').where({ id: run.device_id }).first();
    if (!dev) return { exitCode: 1 };
    let actual: string | null = null;
    switch (match) {
      case 'os_type':  actual = String(dev.os_type ?? ''); break;
      case 'group':    actual = String(dev.group_id ?? ''); break;
      case 'status':   actual = String(dev.status ?? ''); break;
      case 'tag': {
        const tags: string[] = Array.isArray(dev.tags) ? dev.tags : (typeof dev.tags === 'string' ? JSON.parse(dev.tags) : []);
        return { exitCode: tags.map(String).includes(value) ? 0 : 1 };
      }
      default: actual = '';
    }
    return { exitCode: actual === value ? 0 : 1 };
  },

  // ── Terminators — instruct the engine to end the run.
  end_success: async ({ node }) => {
    const cfg = node.config as { message?: string };
    return { terminate: 'success', errorMessage: cfg.message };
  },
  end_failure: async ({ node }) => {
    const cfg = node.config as { message?: string };
    return { terminate: 'failure', errorMessage: cfg.message ?? 'Ended via end_failure node' };
  },
};

// ── Run-level terminal helpers ───────────────────────────────────────────────
// Mirror the v1 helpers — set status, dispatch the configured channel
// notification, and emit the socket event so the UI refreshes.

async function markRunSuccess(runId: string): Promise<void> {
  const [row] = await db('scenario_runs').where({ id: runId }).update({
    status: 'success', finished_at: new Date(), updated_at: new Date(),
  }).returning('*');
  if (!row) return;
  await dispatchScenarioChannelNotification(row, 'success');
  emitRunUpdate(row);
}

async function markRunFailure(runId: string, errorMessage: string): Promise<void> {
  const [row] = await db('scenario_runs').where({ id: runId }).update({
    status: 'failure', finished_at: new Date(), error_message: errorMessage, updated_at: new Date(),
  }).returning('*');
  if (!row) return;
  await dispatchScenarioChannelNotification(row, 'failure');
  emitRunUpdate(row);
}

async function dispatchScenarioChannelNotification(runRow: any, outcome: 'success' | 'failure'): Promise<void> {
  try {
    const scenario = await db('scenarios').where({ id: runRow.scenario_id }).first();
    if (!scenario?.notification_channels) return;
    const bindings = typeof scenario.notification_channels === 'string'
      ? JSON.parse(scenario.notification_channels)
      : scenario.notification_channels;
    if (!Array.isArray(bindings) || bindings.length === 0) return;
    if (outcome === 'success' && !scenario.notify_on_success) return;
    if (outcome === 'failure' && !scenario.notify_on_failure) return;
    const device = await db('devices').where({ id: runRow.device_id }).select('hostname', 'display_name').first();
    const name = device?.display_name || device?.hostname || `#${runRow.device_id}`;
    const { automationNotificationService } = await import('./automationNotification.service');
    await automationNotificationService.notify(runRow.tenant_id, bindings, {
      automationType: 'scenario',
      automationName: scenario.name,
      successCount: outcome === 'success' ? 1 : 0,
      failureCount: outcome === 'failure' ? 1 : 0,
      totalCount: 1,
      failedDeviceNames: outcome === 'failure' ? [name] : [],
    });
  } catch (err) {
    logger.error(err, 'scenario v2 notification dispatch failed');
  }
}

function emitRunUpdate(runRow: any): void {
  try {
    const io = getIO();
    if (!io) return;
    io.to(`tenant:${runRow.tenant_id}`).emit(SocketEvents.SCENARIO_RUN_UPDATED, {
      id: runRow.id,
      tenantId: runRow.tenant_id,
      scenarioId: runRow.scenario_id,
      deviceId: runRow.device_id,
      status: runRow.status,
      currentNodeId: runRow.current_node_id,
      lastExitCode: runRow.last_exit_code,
      finishedAt: runRow.finished_at,
      errorMessage: runRow.error_message,
    });
  } catch { /* socket not ready — non-fatal */ }
}
