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
        details: { name: scenario.name },
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

export default router;
