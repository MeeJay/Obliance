import { Router } from 'express';
import { requireRole } from '../middleware/rbac';
import { scenarioService } from '../services/scenario.service';

const router = Router();

// ── Routes with fixed paths MUST come before /:id ──

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
    res.status(201).json({ data: scenario });
  } catch (err) { next(err); }
});

// PUT /:id — update scenario
router.put('/:id', requireRole('admin'), async (req, res, next) => {
  try {
    const scenario = await scenarioService.update(parseInt(req.params.id), req.tenantId!, req.body, req.session.userId!);
    res.json({ data: scenario });
  } catch (err) { next(err); }
});

// DELETE /:id — delete scenario
router.delete('/:id', requireRole('admin'), async (req, res, next) => {
  try {
    await scenarioService.delete(parseInt(req.params.id), req.tenantId!);
    res.json({ data: { success: true } });
  } catch (err) { next(err); }
});

// POST /:id/enable — activate scenario
router.post('/:id/enable', requireRole('admin'), async (req, res, next) => {
  try {
    await scenarioService.enable(parseInt(req.params.id), req.tenantId!);
    res.json({ data: { success: true } });
  } catch (err) { next(err); }
});

// POST /:id/disable — disable scenario
router.post('/:id/disable', requireRole('admin'), async (req, res, next) => {
  try {
    await scenarioService.disable(parseInt(req.params.id), req.tenantId!);
    res.json({ data: { success: true } });
  } catch (err) { next(err); }
});

// POST /:id/trigger — manual trigger on specified devices
router.post('/:id/trigger', requireRole('admin'), async (req, res, next) => {
  try {
    const { deviceIds } = req.body;
    const runs = await scenarioService.triggerManual(parseInt(req.params.id), deviceIds, req.tenantId!);
    res.json({ data: runs });
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
