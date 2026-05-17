import { Router } from 'express';
import { db } from '../db';
import { requireRole } from '../middleware/rbac';
import { scenarioService } from '../services/scenario.service';
import { isMasterTenant } from '@obliance/shared';

const router = Router();

// ── Routes with fixed paths MUST come before /:id ──

// GET /export-all — bulk export every scenario in the tenant as one
// JSON document. Each entry is the same shape as a single export, so
// the bulk importer can iterate and route through the per-scenario
// import flow with the same conflict resolution UI. Optionally
// embeds scripts via `?includeScripts=1`.
router.get('/export-all', requireRole('admin'), async (req, res, next) => {
  try {
    const includeScripts = req.query.includeScripts === '1' || req.query.includeScripts === 'true';
    const list = await scenarioService.list(req.tenantId!);
    const items: any[] = [];
    for (const s of list.items ?? list) {
      const bundle = await scenarioService.exportScenario(s.id, req.tenantId!, { includeScripts });
      if (bundle) items.push(bundle);
    }
    res.json({
      data: {
        formatVersion: 1,
        bundle: 'scenarios-bulk',
        exportedAt: new Date().toISOString(),
        count: items.length,
        scenarios: items,
      },
    });
  } catch (err) { next(err); }
});

// POST /import-bulk — accepts the bulk export body and runs each
// scenario through the standard import path with a shared
// conflictResolutions map. Reports per-scenario success/error.
router.post('/import-bulk', requireRole('admin'), async (req, res, next) => {
  try {
    const { bundle, conflictResolutions } = req.body as {
      bundle: { scenarios: any[] };
      conflictResolutions?: Record<string, 'skip' | 'overwrite' | 'new'>;
    };
    if (!bundle || !Array.isArray(bundle.scenarios)) {
      return res.status(400).json({ error: 'bundle.scenarios array required' });
    }
    const results: Array<{ name: string; ok: boolean; error?: string; scenarioId?: number }> = [];
    for (const payload of bundle.scenarios) {
      try {
        const out = await scenarioService.importScenario(req.tenantId!, payload, {
          commit: true,
          conflictResolutions: conflictResolutions ?? {},
          userId: req.session.userId!,
        });
        if (out.kind === 'commit') {
          results.push({ name: out.scenario.name, ok: true, scenarioId: out.scenario.id });
        } else {
          // preview kind shouldn't happen with commit:true, but type-narrow
          results.push({ name: payload?.scenario?.name ?? '?', ok: false, error: 'unexpected preview response' });
        }
      } catch (err: any) {
        results.push({
          name: payload?.scenario?.name ?? '?',
          ok: false,
          error: err?.message ?? String(err),
        });
      }
    }
    res.json({ data: { results, total: results.length, succeeded: results.filter((r) => r.ok).length } });
  } catch (err) { next(err); }
});

// GET /dummy-export — return a fully-commented skeleton illustrating
// every node type, every edge condition, and the recommended payload
// shape. Designed to be pasted into an LLM prompt as "here's the
// format, please generate scenarios in this shape".
router.get('/dummy-export', async (_req, res, next) => {
  try {
    const { scenarioService } = await import('../services/scenario.service');
    res.json({ data: scenarioService.getDummyExportTemplate() });
  } catch (err) { next(err); }
});

// GET /templates — list available scenario templates
router.get('/templates', async (req, res, next) => {
  try {
    const { scenarioTemplates } = await import('../services/scenario-templates');
    const list = scenarioTemplates.map((t, i) => ({
      id: i,
      name: t.name,
      description: t.description,
      triggerType: t.triggerType,
      variables: t.variables,
      stepCount: t.steps.length,
    }));
    res.json({ data: list });
  } catch (err) { next(err); }
});

// POST /templates/:index/instantiate — create a scenario from a template
router.post('/templates/:index/instantiate', requireRole('admin'), async (req, res, next) => {
  try {
    const { scenarioTemplates } = await import('../services/scenario-templates');
    const index = parseInt(req.params.index);
    if (index < 0 || index >= scenarioTemplates.length) {
      return res.status(404).json({ error: 'Template not found' });
    }
    const template = scenarioTemplates[index];
    // SECURITY: only accept overrides for variable names the template
    // explicitly declares. Without this whitelist, an attacker could
    // smuggle extra keys (e.g. `bashCommand: "rm -rf /"`) into the
    // variable dict and have them substituted into a script body.
    // Variables also rejected if their values contain control / NUL
    // bytes, which are pure mischief in a script template.
    const requestedOverrides = (req.body.variables && typeof req.body.variables === 'object') ? req.body.variables as Record<string, unknown> : {};
    const allowedKeys = new Set(Object.keys(template.variables ?? {}));
    const sanitisedOverrides: Record<string, string> = {};
    for (const [k, v] of Object.entries(requestedOverrides)) {
      if (!allowedKeys.has(k)) continue;
      if (typeof v !== 'string') continue;
      if (/[\u0000-\u001f]/.test(v)) continue;
      sanitisedOverrides[k] = v;
    }
    const variables = { ...template.variables, ...sanitisedOverrides };

    // Create scripts first, then create the scenario with steps referencing them
    const { db } = await import('../db');
    const scriptIds: Record<string, number> = {};

    for (const step of template.steps) {
      for (const scriptDef of [step.checkScript, step.resolveScript]) {
        if (!scriptDef) continue;
        const key = scriptDef.name;
        if (scriptIds[key]) continue; // already created
        const [row] = await db('scripts').insert({
          tenant_id: req.tenantId!,
          name: scriptDef.name,
          platform: scriptDef.platform,
          runtime: scriptDef.runtime,
          purpose: scriptDef.purpose,
          content: scriptDef.content,
          created_by: req.session.userId,
          updated_at: new Date(),
        }).returning('id');
        scriptIds[key] = row.id;
      }
    }

    // Create scenario
    const scenarioData = {
      name: req.body.name || template.name,
      description: template.description,
      triggerType: template.triggerType,
      triggerConfig: template.triggerConfig || {},
      targetType: template.targetType || 'all',
      targetIds: [],
      status: 'draft' as const,
      retryPolicy: { maxRetries: 0, retryDelaySeconds: 60 },
      timeoutSeconds: template.timeoutSeconds,
      notifyOnSuccess: false,
      notifyOnFailure: true,
      variables,
      steps: template.steps.map((s, i) => ({
        name: s.name,
        description: s.description,
        sortOrder: i,
        checkScriptId: s.checkScript ? scriptIds[s.checkScript.name] : null,
        resolveScriptId: s.resolveScript ? scriptIds[s.resolveScript.name] : null,
        timeoutSeconds: s.timeoutSeconds,
        retryCount: s.retryCount,
        parameterOverrides: {},
      })),
    };

    const scenario = await scenarioService.create(req.tenantId!, scenarioData, req.session.userId!);
    // v2: convert the freshly created v1 scenario to the graph model
    // immediately so the editor opens the React Flow canvas instead of the
    // legacy step list. Skip silently if the scenario already has nodes.
    try {
      const { migrateScenarioToV2 } = await import('../services/scenarioMigrate.service');
      await migrateScenarioToV2(scenario.id);
    } catch {}
    res.status(201).json({ data: scenario });
  } catch (err) { next(err); }
});

// GET /runs/:runId — get run detail
router.get('/runs/:runId', async (req, res, next) => {
  try {
    const run = await scenarioService.getRunById(req.params.runId, req.tenantId!);
    if (!run) return res.status(404).json({ error: 'Run not found' });
    res.json({ data: run });
  } catch (err) { next(err); }
});

// POST /runs/:runId/cancel — cancel run
router.post('/runs/:runId/cancel', requireRole('admin'), async (req, res, next) => {
  try {
    await scenarioService.cancelRun(req.params.runId, req.tenantId!);
    res.json({ data: { success: true } });
  } catch (err) { next(err); }
});

// POST /:id/cancel-runs — cancel every in-flight run for a scenario.
// Used by the "Stop scenario" button on the scenarios overview when
// the admin wants to abort all current runs at once. Returns the
// number of runs that were transitioned to 'cancelled'.
router.post('/:id/cancel-runs', requireRole('admin'), async (req, res, next) => {
  try {
    const scenarioId = parseInt(req.params.id);
    const cancelled = await scenarioService.cancelAllRuns(scenarioId, req.tenantId!);
    res.json({ data: { cancelled } });
  } catch (err) { next(err); }
});

// GET /for-device/:deviceId — list scenarios targeting a device
router.get('/for-device/:deviceId', async (req, res, next) => {
  try {
    const scenarios = await scenarioService.list(req.tenantId!);
    res.json({ data: scenarios });
  } catch (err) { next(err); }
});

// GET /for-device/:deviceId/runs — list runs for a device
router.get('/for-device/:deviceId/runs', async (req, res, next) => {
  try {
    const runs = await scenarioService.listRuns(req.tenantId!, { deviceId: parseInt(req.params.deviceId) });
    res.json({ data: runs });
  } catch (err) { next(err); }
});

// ── CRUD routes ──

// GET / — list scenarios
router.get('/', async (req, res, next) => {
  try {
    const { triggerType, status } = req.query;
    const scenarios = await scenarioService.list(req.tenantId!, {
      triggerType: triggerType as any,
      status: status as any,
    });
    res.json({ data: scenarios });
  } catch (err) { next(err); }
});

// POST /import — two-pass scenario importer.
//   Body: { payload: <export JSON>, conflictResolutions?: {...} }
//   When `conflictResolutions` is omitted, returns a preview with the
//   list of script-uuid conflicts so the UI can prompt the user.
//   When provided, the server commits the import inside one
//   transaction and returns the created scenario.
router.post('/import', requireRole('admin'), async (req, res, next) => {
  try {
    const { payload, conflictResolutions } = req.body as {
      payload: any;
      conflictResolutions?: Record<string, 'skip' | 'overwrite' | 'new'>;
    };
    if (!payload) return res.status(400).json({ error: 'payload is required' });
    const result = await scenarioService.importScenario(req.tenantId!, payload, {
      commit: !!conflictResolutions,
      conflictResolutions,
      userId: req.session.userId!,
    });
    res.json({ data: result });
  } catch (err: any) {
    if (err?.message) {
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  }
});

// GET /:id — get scenario with steps
router.get('/:id', async (req, res, next) => {
  try {
    const scenario = await scenarioService.getById(parseInt(req.params.id), req.tenantId!);
    if (!scenario) return res.status(404).json({ error: 'Scenario not found' });
    res.json({ data: scenario });
  } catch (err) { next(err); }
});

// GET /:id/export — portable JSON dump of a scenario (metadata + nodes
// + edges + optionally the scripts referenced by run_script nodes).
// `?includeScripts=1` embeds full script bodies so the importer on
// another tenant / install can recreate them; without it the export
// only ships scriptId references (useful when the destination already
// has the scripts under known UUIDs).
router.get('/:id/export', async (req, res, next) => {
  try {
    const includeScripts = req.query.includeScripts === '1' || req.query.includeScripts === 'true';
    const payload = await scenarioService.exportScenario(parseInt(req.params.id), req.tenantId!, { includeScripts });
    if (!payload) return res.status(404).json({ error: 'Scenario not found' });
    res.json({ data: payload });
  } catch (err) { next(err); }
});

// POST / — create scenario
router.post('/', requireRole('admin'), async (req, res, next) => {
  try {
    const scenario = await scenarioService.create(req.tenantId!, req.body, req.session.userId!);
    // v2: convert the freshly created scenario into the graph model so
    // the editor opens directly on the React Flow canvas. No-op if the
    // body already shipped nodes/edges (Phase 1C UI saves graph-first).
    try {
      const { migrateScenarioToV2 } = await import('../services/scenarioMigrate.service');
      await migrateScenarioToV2(scenario.id);
    } catch {}
    try {
      const { auditService } = await import('../services/audit.service');
      await auditService.logReq(req, 'scenario.created', {
        resourceType: 'scenario', resourcePath: String(scenario.id),
        details: { name: scenario.name, triggerType: scenario.triggerType },
      });
    } catch {}
    res.status(201).json({ data: scenario });
  } catch (err) { next(err); }
});

// PUT /:id — update scenario
router.put('/:id', requireRole('admin'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    // Bypass-privacy-mode toggle is restriction-gated. Only fire the gate
    // on the false→true transition so re-saving an already-bypassing
    // scenario (or untoggling it) doesn't require fresh 2FA / a second
    // admin's approval. When restricted, applyRestriction queues a
    // setting_change approval and strips the field from the update so
    // the rest of the form still saves.
    if (req.body && req.body.bypassPrivacyMode === true) {
      const current = await db('scenarios').where({ id, tenant_id: req.tenantId! }).first('bypass_privacy_mode');
      if (current && !current.bypass_privacy_mode) {
        const { applyRestriction } = await import('../services/restriction.service');
        const approved = await applyRestriction(res, {
          req,
          actionKey: 'scenario.bypass_privacy_mode',
          approvalRequestType: 'setting_change',
          approvalDescription: `Enable privacy-mode bypass on scenario "${(await db('scenarios').where({ id }).first('name'))?.name ?? id}"`,
          approvalPayload: { entityType: 'scenario', entityId: id, field: 'bypassPrivacyMode', value: true },
        });
        if (!approved) return;
      }
    }

    const scenario = await scenarioService.update(id, req.tenantId!, req.body, req.session.userId!);
    try {
      const { auditService } = await import('../services/audit.service');
      await auditService.logReq(req, 'scenario.updated', {
        resourceType: 'scenario', resourcePath: req.params.id,
        details: { name: scenario?.name },
      });
    } catch {}
    res.json({ data: scenario });
  } catch (err) { next(err); }
});

// DELETE /:id — delete scenario
router.delete('/:id', requireRole('admin'), async (req, res, next) => {
  try {
    await scenarioService.delete(parseInt(req.params.id), req.tenantId!);
    try {
      const { auditService } = await import('../services/audit.service');
      await auditService.logReq(req, 'scenario.deleted', {
        resourceType: 'scenario', resourcePath: req.params.id,
      });
    } catch {}
    res.json({ data: { success: true } });
  } catch (err) { next(err); }
});

// POST /:id/enable — activate scenario
router.post('/:id/enable', requireRole('admin'), async (req, res, next) => {
  try {
    await scenarioService.enable(parseInt(req.params.id), req.tenantId!);
    try {
      const { auditService } = await import('../services/audit.service');
      await auditService.logReq(req, 'scenario.enabled', { resourceType: 'scenario', resourcePath: req.params.id });
    } catch {}
    res.json({ data: { success: true } });
  } catch (err) { next(err); }
});

// POST /:id/disable — disable scenario
router.post('/:id/disable', requireRole('admin'), async (req, res, next) => {
  try {
    await scenarioService.disable(parseInt(req.params.id), req.tenantId!);
    try {
      const { auditService } = await import('../services/audit.service');
      await auditService.logReq(req, 'scenario.disabled', { resourceType: 'scenario', resourcePath: req.params.id });
    } catch {}
    res.json({ data: { success: true } });
  } catch (err) { next(err); }
});

// POST /:id/trigger — manual trigger on specified devices
router.post('/:id/trigger', requireRole('admin'), async (req, res, next) => {
  try {
    const { deviceIds } = req.body;
    const runs = await scenarioService.triggerManual(parseInt(req.params.id), deviceIds, req.tenantId!);
    try {
      const { auditService } = await import('../services/audit.service');
      await auditService.logReq(req, 'scenario.triggered_manually', {
        resourceType: 'scenario', resourcePath: req.params.id,
        details: { deviceCount: Array.isArray(deviceIds) ? deviceIds.length : 0 },
      });
    } catch {}
    res.json({ data: runs });
  } catch (err) { next(err); }
});

// GET /:id/resolved-targets — resolve scenario target to device ids
router.get('/:id/resolved-targets', async (req, res, next) => {
  try {
    const deviceIds = await scenarioService.resolveTargetDevices(parseInt(req.params.id), req.tenantId!);
    res.json({ data: { deviceIds } });
  } catch (err) { next(err); }
});

// GET /:id/runs — list runs for scenario
router.get('/:id/runs', async (req, res, next) => {
  try {
    const runs = await scenarioService.listRuns(req.tenantId!, { scenarioId: parseInt(req.params.id) });
    res.json({ data: runs });
  } catch (err) { next(err); }
});

// ── v2 — graph builder routes ───────────────────────────────────────────────
// Phase 1A foundation: read/write the nodes + edges. The React Flow editor
// (Phase 1C) saves the whole graph as one PUT — atomic replacement keeps
// the data model trivial and the editor logic simple.

import { db } from '../db';
import { scenarioGraphService } from '../services/scenarioGraph.service';

// GET /:id/graph — return nodes + edges for a scenario
router.get('/:id/graph', async (req, res, next) => {
  try {
    const scenarioId = parseInt(req.params.id);
    // Tenant scope: master tenant gets god-view access (read any
    // scenario across the install, mirrors what scenarioService.list
    // / getById already do for the parent endpoints). A child tenant
    // sees its own scenarios + any fan-outed via target_tenant_ids.
    // Without this fix the list page surfaced foreign scenarios on
    // master but their detail / graph 404'd because the strict
    // tenant_id filter blocked the lookup.
    const isMaster = isMasterTenant(req.tenantId!);
    const scenarioQ = db('scenarios').where({ id: scenarioId });
    if (!isMaster) {
      scenarioQ.where(function () {
        this.where('tenant_id', req.tenantId!)
          .orWhereRaw('? = ANY(target_tenant_ids)', [req.tenantId!]);
      });
    }
    const scenario = await scenarioQ.first();
    if (!scenario) return res.status(404).json({ error: 'Scenario not found' });
    const [nodeRows, edgeRows] = await Promise.all([
      db('scenario_nodes').where({ scenario_id: scenarioId }).orderBy('id'),
      db('scenario_edges').where({ scenario_id: scenarioId }).orderBy('sort_order'),
    ]);
    // Convert snake_case DB rows to the camelCase shape the shared
    // ScenarioNode / ScenarioEdge types declare. Without this the
    // client receives `position_x` and reads `positionX` ⇒ undefined,
    // which propagates as NaN through React Flow's node positions
    // and explodes the SVG renderer with hundreds of "cx: NaN" errors.
    const nodes = nodeRows.map((r: any) => ({
      id: r.id,
      uuid: r.uuid,
      scenarioId: r.scenario_id,
      type: r.type,
      label: r.label,
      config: typeof r.config === 'string' ? JSON.parse(r.config) : (r.config ?? {}),
      positionX: r.position_x ?? 0,
      positionY: r.position_y ?? 0,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
    const edges = edgeRows.map((r: any) => ({
      id: r.id,
      uuid: r.uuid,
      scenarioId: r.scenario_id,
      sourceNodeId: r.source_node_id,
      sourceHandle: r.source_handle,
      targetNodeId: r.target_node_id,
      condition: typeof r.condition === 'string' ? JSON.parse(r.condition) : (r.condition ?? { kind: 'always' }),
      sortOrder: r.sort_order,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
    res.json({ data: { nodes, edges } });
  } catch (err) { next(err); }
});

// PUT /:id/graph — atomic replacement of the whole graph
// Body: { nodes: [...], edges: [...] }. Each node carries its
// frontend-only `clientId` (any string) so edges can reference newly
// created nodes before the DB hands out real ids. The server resolves
// clientId → id when wiring edges.
router.put('/:id/graph', requireRole('admin'), async (req, res, next) => {
  try {
    const scenarioId = parseInt(req.params.id);
    // Master tenant can edit any scenario (god view); child tenants
    // stay strictly scoped — fan-out gives read access only, not
    // write. Mirrors the pattern in scenario.service.ts updateScenario.
    const isMaster = isMasterTenant(req.tenantId!);
    const scenarioQ = db('scenarios').where({ id: scenarioId });
    if (!isMaster) scenarioQ.where({ tenant_id: req.tenantId! });
    const scenario = await scenarioQ.first();
    if (!scenario) return res.status(404).json({ error: 'Scenario not found' });

    const { nodes = [], edges = [] } = req.body as {
      nodes: Array<{ clientId?: string; type: string; label?: string | null; config?: any; positionX?: number; positionY?: number }>;
      edges: Array<{ sourceClientId?: string; targetClientId?: string; sourceHandle?: string | null; condition?: any; sortOrder?: number }>;
    };

    await db.transaction(async (trx) => {
      // Wipe and rewrite — simplest semantics for a save-the-whole-graph
      // editor. Cascade deletes scenario_edges via FK.
      await trx('scenario_nodes').where({ scenario_id: scenarioId }).del();

      const idByClientId = new Map<string, number>();
      for (const n of nodes) {
        const [row] = await trx('scenario_nodes').insert({
          scenario_id: scenarioId,
          type: n.type,
          label: n.label ?? null,
          config: JSON.stringify(n.config ?? {}),
          position_x: n.positionX ?? 0,
          position_y: n.positionY ?? 0,
        }).returning('id') as Array<{ id: number }>;
        if (n.clientId) idByClientId.set(n.clientId, row.id);
      }

      for (const e of edges) {
        const sourceId = e.sourceClientId ? idByClientId.get(e.sourceClientId) : undefined;
        const targetId = e.targetClientId ? idByClientId.get(e.targetClientId) : undefined;
        if (!sourceId || !targetId) continue; // skip dangling edges silently
        await trx('scenario_edges').insert({
          scenario_id: scenarioId,
          source_node_id: sourceId,
          source_handle: e.sourceHandle ?? null,
          target_node_id: targetId,
          condition: JSON.stringify(e.condition ?? { kind: 'always' }),
          sort_order: e.sortOrder ?? 0,
        });
      }
    });

    res.json({ data: { success: true } });
  } catch (err) { next(err); }
});

// POST /:id/start-graph-run — fire a test run via the v2 engine on
// one or more devices (admin only; devices must belong to the tenant).
//
// Body shape (legacy single-device callers still work via `deviceId`):
//   { deviceIds?: number[], deviceId?: number,
//     triggerNodeId?: number, startNodeId?: number, singleNode?: boolean }
//
// - `triggerNodeId`: start by walking from this trigger node. Default is
//   the first `trigger_manual` (or any trigger when no manual exists).
// - `startNodeId`: bypass triggers and execute this exact node directly
//   — used by the right-click "Run from this node" action.
// - `singleNode`: stop with success after the entry node finishes (one-
//   shot test). Combine with startNodeId to test a single node in
//   isolation.
//
// Scenario.status is intentionally NOT enforced — admins must be able
// to test disabled or draft scenarios from the editor before going
// live. Permission isn't bypassed: the requireRole('admin') guard above
// still applies, plus the device tenant check below.
router.post('/:id/start-graph-run', requireRole('admin'), async (req, res, next) => {
  try {
    const scenarioId = parseInt(req.params.id);
    const body = req.body as {
      deviceId?: number;
      deviceIds?: number[];
      triggerNodeId?: number;
      startNodeId?: number;
      singleNode?: boolean;
    };
    const rawIds = Array.isArray(body.deviceIds) && body.deviceIds.length
      ? body.deviceIds
      : (body.deviceId != null ? [body.deviceId] : []);
    const deviceIds = Array.from(new Set(rawIds.map((n) => Number(n)).filter((n) => Number.isFinite(n))));
    if (deviceIds.length === 0) return res.status(400).json({ error: 'deviceIds required' });

    // Master can launch any scenario on any device they can see;
    // child tenants stay strictly scoped (own scenarios + own
    // devices). The two checks below mirror that — devices are
    // validated against the SCENARIO's tenant when on master so a
    // master-driven launch of a child-tenant's scenario uses the
    // correct device set. Without this, a master clicking "Run on
    // device" from a child scenario got "Scenario not found".
    const isMaster = isMasterTenant(req.tenantId!);
    const scenarioQ = db('scenarios').where({ id: scenarioId });
    if (!isMaster) scenarioQ.where({ tenant_id: req.tenantId! });
    const scenario = await scenarioQ.first();
    if (!scenario) return res.status(404).json({ error: 'Scenario not found' });

    const deviceTenantId = isMaster ? scenario.tenant_id : req.tenantId!;
    const tenantDevices = await db('devices')
      .whereIn('id', deviceIds)
      .where({ tenant_id: deviceTenantId })
      .select('id') as Array<{ id: number }>;
    const validIds = new Set(tenantDevices.map((d) => d.id));
    const missing = deviceIds.filter((id) => !validIds.has(id));
    if (missing.length) return res.status(404).json({ error: `Devices not in tenant: ${missing.join(',')}` });

    // Resolve a default trigger node when none was supplied: prefer a
    // trigger_manual to avoid accidentally firing a schedule trigger's
    // downstream graph. `startNodeId` overrides this and skips the
    // trigger walk entirely.
    let resolvedTriggerNodeId = body.triggerNodeId;
    if (!resolvedTriggerNodeId && !body.startNodeId) {
      const manual = await db('scenario_nodes')
        .where({ scenario_id: scenarioId, type: 'trigger_manual' })
        .first() as { id: number } | undefined;
      resolvedTriggerNodeId = manual?.id;
    }

    // Pre-flight: if the caller asked for a manual trigger walk but the
    // scenario carries zero trigger nodes at all, bail with a precise
    // 400 — otherwise startRun would throw deep in the engine and the
    // user would only see a generic 500.
    if (!body.startNodeId && !resolvedTriggerNodeId) {
      const anyTrigger = await db('scenario_nodes')
        .where({ scenario_id: scenarioId })
        .whereLike('type', 'trigger_%')
        .first();
      if (!anyTrigger) {
        return res.status(400).json({
          error: 'Graph has no trigger node — add a Manual trigger (or any other trigger) and connect it to your first action.',
        });
      }
    }

    // Start one run per device — same trigger source for the whole
    // batch so the editor can group them, and so logs/audits can spot
    // a multi-device test by the shared marker. The run ids are
    // returned in deviceId order. If a single device fails to start
    // (e.g. node config invalid, agent unreachable for an immediate
    // sync executor) we collect the error so the client can show it
    // alongside the runs that DID start, instead of failing the whole
    // batch and leaving partial state.
    const batchMarker = `graph-run:batch:${Date.now()}`;
    const runIds: string[] = [];
    const failures: Array<{ deviceId: number; error: string }> = [];
    for (const deviceId of deviceIds) {
      try {
        const runId = await scenarioGraphService.startRun(scenarioId, deviceId, {
          triggerType: 'manual',
          triggerSource: batchMarker,
          triggerNodeId: resolvedTriggerNodeId,
          startNodeId: body.startNodeId,
          singleNode: body.singleNode,
        });
        runIds.push(runId);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        failures.push({ deviceId, error: message });
      }
    }

    // Whole batch failed → 400 so the client surfaces the message
    // instead of silently swallowing.
    if (runIds.length === 0 && failures.length > 0) {
      return res.status(400).json({
        error: `All ${failures.length} run${failures.length > 1 ? 's' : ''} failed to start: ${failures.map((f) => f.error).join('; ')}`,
      });
    }

    res.status(202).json({
      data: { runIds, runId: runIds[0] ?? null, batchMarker, failures: failures.length ? failures : undefined },
    });
  } catch (err) { next(err); }
});

// GET /:id/active-runs — return recent or in-progress runs for the
// scenario, plus their per-node-run trace, so the graph editor can
// resume the live-viewer state when reopened mid-run. Defaults to
// runs created within the last hour OR still in 'running' state.
router.get('/:id/active-runs', requireRole('admin'), async (req, res, next) => {
  try {
    const scenarioId = parseInt(req.params.id);
    const sinceMin = parseInt(String(req.query.sinceMinutes ?? '60')) || 60;
    const cutoff = new Date(Date.now() - sinceMin * 60 * 1000);
    // Master = god view; child tenants strictly scoped (same pattern
    // as graph load + listRuns above). Without it, master couldn't
    // see active runs of a child tenant's scenario despite seeing
    // the scenario itself in the list.
    const isMaster = isMasterTenant(req.tenantId!);
    const scenarioQ = db('scenarios').where({ id: scenarioId });
    if (!isMaster) {
      scenarioQ.where(function () {
        this.where('tenant_id', req.tenantId!)
          .orWhereRaw('? = ANY(target_tenant_ids)', [req.tenantId!]);
      });
    }
    const scenario = await scenarioQ.first();
    if (!scenario) return res.status(404).json({ error: 'Scenario not found' });
    const runsQ = db('scenario_runs').where({ scenario_id: scenarioId });
    if (!isMaster) runsQ.where({ tenant_id: req.tenantId! });
    const runs = await runsQ
      .where(function () {
        this.where('status', 'running').orWhere('started_at', '>=', cutoff);
      })
      .orderBy('started_at', 'desc')
      .limit(200)
      .select('id', 'device_id', 'status', 'trigger_source', 'started_at', 'finished_at', 'error_message') as Array<any>;
    const runIds = runs.map((r) => r.id);
    const nodeRuns = runIds.length
      ? await db('scenario_node_runs')
          .whereIn('run_id', runIds)
          .select('id', 'run_id', 'node_id', 'node_type', 'status', 'exit_code', 'stdout', 'stderr', 'error_message', 'started_at', 'finished_at') as Array<any>
      : [];
    res.json({
      data: {
        runs: runs.map((r) => ({
          id: r.id, deviceId: r.device_id, status: r.status,
          triggerSource: r.trigger_source,
          startedAt: r.started_at, finishedAt: r.finished_at,
          errorMessage: r.error_message,
        })),
        nodeRuns: nodeRuns.map((nr) => ({
          id: nr.id, runId: nr.run_id, nodeId: nr.node_id, nodeType: nr.node_type,
          status: nr.status, exitCode: nr.exit_code,
          stdout: nr.stdout, stderr: nr.stderr, errorMessage: nr.error_message,
          startedAt: nr.started_at, finishedAt: nr.finished_at,
        })),
      },
    });
  } catch (err) { next(err); }
});

export default router;
