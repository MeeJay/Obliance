import { Router } from 'express';
import { complianceService } from '../services/compliance.service';

const router = Router();

router.get('/policies', async (req, res, next) => {
  try {
    const policies = await complianceService.getPolicies(req.tenantId!);
    res.json({ data: policies });
  } catch (err) { next(err); }
});

router.post('/policies', async (req, res, next) => {
  try {
    const policy = await complianceService.createPolicy(req.tenantId!, {
      ...req.body, createdBy: req.session.userId,
    });
    res.status(201).json({ data: policy });
  } catch (err) { next(err); }
});

router.put('/policies/:id', async (req, res, next) => {
  try {
    const policy = await complianceService.updatePolicy(parseInt(req.params.id), req.tenantId!, req.body);
    res.json({ data: policy });
  } catch (err) { next(err); }
});

router.delete('/policies/:id', async (req, res, next) => {
  try {
    await complianceService.deletePolicy(parseInt(req.params.id), req.tenantId!);
    res.status(204).send();
  } catch (err) { next(err); }
});

router.post('/policies/:id/check/:deviceId', async (req, res, next) => {
  try {
    const cmd = await complianceService.triggerCheck(
      parseInt(req.params.deviceId), parseInt(req.params.id),
      req.tenantId!, req.session.userId!
    );
    res.json({ data: cmd });
  } catch (err) { next(err); }
});

// Body-based check endpoint matching client call: POST /compliance/check { deviceId, policyId }
router.post('/check', async (req, res, next) => {
  try {
    const { deviceId, policyId } = req.body;
    if (!deviceId) return res.status(400).json({ error: 'deviceId required' });

    if (policyId) {
      // Check against a specific policy
      const cmd = await complianceService.triggerCheck(
        parseInt(deviceId), parseInt(policyId),
        req.tenantId!, req.session.userId!
      );
      res.json({ data: cmd });
    } else {
      // Check against all enabled policies for this device
      const policies = await complianceService.getPolicies(req.tenantId!);
      const enabled = policies.filter(p => p.enabled);
      const cmds = await Promise.all(
        enabled.map(p => complianceService.triggerCheck(
          parseInt(deviceId), p.id, req.tenantId!, req.session.userId!
        ))
      );
      res.json({ data: cmds });
    }
  } catch (err) { next(err); }
});

// GET /compliance/results?deviceId=&page= — deviceId optional; omit for tenant-wide results
router.get('/results', async (req, res, next) => {
  try {
    const { deviceId, page } = req.query as any;
    if (deviceId) {
      const items = await complianceService.getLatestResults(parseInt(deviceId), req.tenantId!);
      res.json({ data: { items, total: items.length } });
    } else {
      const items = await complianceService.getAllResults(req.tenantId!, page ? parseInt(page) : 1);
      res.json({ data: { items, total: items.length } });
    }
  } catch (err) { next(err); }
});

// GET /compliance/results/filter?deviceId=&page= — tenant-wide with optional device filter
router.get('/results/filter', async (req, res, next) => {
  try {
    const { deviceId, page } = req.query as any;
    const items = await complianceService.getAllResults(
      req.tenantId!,
      page ? parseInt(page) : 1,
      deviceId ? parseInt(deviceId) : undefined,
    );
    res.json({ data: { items, total: items.length } });
  } catch (err) { next(err); }
});

// Legacy path kept for backward compat
router.get('/results/device/:deviceId', async (req, res, next) => {
  try {
    const items = await complianceService.getLatestResults(parseInt(req.params.deviceId), req.tenantId!);
    res.json({ data: { items, total: items.length } });
  } catch (err) { next(err); }
});

router.get('/overview', async (req, res, next) => {
  try {
    const overview = await complianceService.getTenantCompliance(req.tenantId!);
    res.json({ data: overview });
  } catch (err) { next(err); }
});

// GET /compliance/presets — built-in preset policies (static, no DB)
router.get('/presets', async (_req, res, next) => {
  try {
    res.json({ data: complianceService.getPresets() });
  } catch (err) { next(err); }
});

router.get('/templates', async (req, res, next) => {
  try {
    const templates = await complianceService.getTemplates(req.tenantId!);
    res.json({ data: templates });
  } catch (err) { next(err); }
});

router.post('/templates', async (req, res, next) => {
  try {
    const t = await complianceService.createTemplate(req.tenantId!, {
      ...req.body, createdBy: req.session.userId,
    });
    res.status(201).json({ data: t });
  } catch (err) { next(err); }
});

export default router;
