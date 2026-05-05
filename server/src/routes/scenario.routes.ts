import { Router } from 'express';
import { requireRole } from '../middleware/rbac';
import { scenarioService } from '../services/scenario.service';

const router = Router();

// ── Routes with fixed paths MUST come before /:id ──

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
    const variables = { ...template.variables, ...req.body.variables }; // user overrides

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

// GET /:id — get scenario with steps
router.get('/:id', async (req, res, next) => {
  try {
    const scenario = await scenarioService.getById(parseInt(req.params.id), req.tenantId!);
    if (!scenario) return res.status(404).json({ error: 'Scenario not found' });
    res.json({ data: scenario });
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
    const scenario = await scenarioService.update(parseInt(req.params.id), req.tenantId!, req.body, req.session.userId!);
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
    // Tenant scope: confirm the scenario belongs to the caller's tenant
    // before exposing nodes/edges, since these don't carry tenant_id
    // themselves (FK to scenarios is enough).
    const scenario = await db('scenarios').where({ id: scenarioId, tenant_id: req.tenantId! }).first();
    if (!scenario) return res.status(404).json({ error: 'Scenario not found' });
    const [nodes, edges] = await Promise.all([
      db('scenario_nodes').where({ scenario_id: scenarioId }).orderBy('id'),
      db('scenario_edges').where({ scenario_id: scenarioId }).orderBy('sort_order'),
    ]);
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
    const scenario = await db('scenarios').where({ id: scenarioId, tenant_id: req.tenantId! }).first();
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

// POST /:id/start-graph-run — fire a manual run via the v2 engine on a
// specific device (admin only; the device must belong to the tenant).
router.post('/:id/start-graph-run', requireRole('admin'), async (req, res, next) => {
  try {
    const scenarioId = parseInt(req.params.id);
    const { deviceId } = req.body as { deviceId?: number };
    if (!deviceId) return res.status(400).json({ error: 'deviceId required' });
    const scenario = await db('scenarios').where({ id: scenarioId, tenant_id: req.tenantId! }).first();
    if (!scenario) return res.status(404).json({ error: 'Scenario not found' });
    const device = await db('devices').where({ id: deviceId, tenant_id: req.tenantId! }).first();
    if (!device) return res.status(404).json({ error: 'Device not found' });
    const runId = await scenarioGraphService.startRun(scenarioId, deviceId, {
      triggerType: 'manual',
      triggerSource: 'graph-run',
    });
    res.status(202).json({ data: { runId } });
  } catch (err) { next(err); }
});

export default router;
