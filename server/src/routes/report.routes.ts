import { Router } from 'express';
import { reportService } from '../services/report.service';
import { requireTenantCapability, requireAnyTenantCapability } from '../middleware/rbac';
import fs from 'fs';

const router = Router();

// Reports were previously gated by the legacy `manage_reports` cap;
// the new sidebar reorg consolidates Reports / History / Remote
// sessions under a single `supervision:read` capability so admins
// don't have to grant three separate flags. Old `manage_reports`
// rows are filtered out by the team.service VALID_CAPABILITIES set
// and replaced by migration 090's seeding rule.
router.use(requireAnyTenantCapability('reports', 'supervision:read'));

router.get('/', async (req, res, next) => {
  try { res.json({ data: await reportService.getReports(req.tenantId!) }); } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const report = await reportService.createReport(req.tenantId!, {
      ...req.body, createdBy: req.session.userId,
    });
    res.status(201).json({ data: report });
  } catch (err) { next(err); }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const updated = await reportService.updateReport(parseInt(req.params.id), req.tenantId!, req.body);
    res.json({ data: updated });
  } catch (err) { next(err); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    await reportService.deleteReport(parseInt(req.params.id), req.tenantId!);
    res.status(204).send();
  } catch (err) { next(err); }
});

router.post('/:id/generate', async (req, res, next) => {
  try {
    const output = await reportService.generateReport(parseInt(req.params.id), req.tenantId!);
    res.status(202).json({ data: output });
  } catch (err) { next(err); }
});

router.get('/:id/outputs', async (req, res, next) => {
  try {
    const outputs = await reportService.getOutputs(parseInt(req.params.id), req.tenantId!);
    res.json({ data: outputs });
  } catch (err) { next(err); }
});

// Client builds /reports/outputs/:outputId/download (no report id) — authorize
// by outputId + tenant (the report id in the path was never used).
router.get('/outputs/:outputId/download', async (req, res, next) => {
  try {
    const { db } = await import('../db');
    const output = await db('report_outputs').where({ id: parseInt(req.params.outputId), tenant_id: req.tenantId! }).first();
    if (!output?.file_path) return res.status(404).json({ error: 'Output not found' });
    if (!fs.existsSync(output.file_path)) return res.status(404).json({ error: 'File not found' });
    res.download(output.file_path);
  } catch (err) { next(err); }
});

export default router;
