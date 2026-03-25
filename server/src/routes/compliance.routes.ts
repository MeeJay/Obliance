import { Router } from 'express';
import { complianceService } from '../services/compliance.service';
import { requireRole, requireDeviceWriteParam, requireDeviceRead } from '../middleware/rbac';
import { permissionService } from '../services/permission.service';
import { AppError } from '../middleware/errorHandler';

const router = Router();

router.get('/policies', async (req, res, next) => {
  try {
    const policies = await complianceService.getPolicies(req.tenantId!);
    res.json({ data: policies });
  } catch (err) { next(err); }
});

router.post('/policies', requireRole('admin'), async (req, res, next) => {
  try {
    const policy = await complianceService.createPolicy(req.tenantId!, {
      ...req.body, createdBy: req.session.userId,
    });
    res.status(201).json({ data: policy });
  } catch (err) { next(err); }
});

router.put('/policies/:id', requireRole('admin'), async (req, res, next) => {
  try {
    const policy = await complianceService.updatePolicy(parseInt(req.params.id), req.tenantId!, req.body);
    res.json({ data: policy });
  } catch (err) { next(err); }
});

router.delete('/policies/:id', requireRole('admin'), async (req, res, next) => {
  try {
    await complianceService.deletePolicy(parseInt(req.params.id), req.tenantId!);
    res.status(204).send();
  } catch (err) { next(err); }
});

router.post('/policies/:id/check/:deviceId', requireDeviceWriteParam('deviceId'), async (req, res, next) => {
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

    // Permission check: user must have write access to the device
    if (req.session.role !== 'admin') {
      const canWrite = await permissionService.canWriteDevice(req.session.userId!, parseInt(deviceId), false);
      if (!canWrite) throw new AppError(403, 'Insufficient permissions');
    }

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
      // Permission check: user must have read access to the device
      if (req.session.role !== 'admin') {
        const canRead = await permissionService.canReadDevice(req.session.userId!, parseInt(deviceId), false);
        if (!canRead) throw new AppError(403, 'Insufficient permissions');
      }
      const items = await complianceService.getLatestResults(parseInt(deviceId), req.tenantId!);
      res.json({ data: { items, total: items.length } });
    } else {
      const items = await complianceService.getAllResults(req.tenantId!, page ? parseInt(page) : 1);
      // Filter by visible devices for non-admins
      if (req.session.role !== 'admin') {
        const visibleIds = await permissionService.getVisibleDeviceIds(req.session.userId!, false);
        if (Array.isArray(visibleIds)) {
          const filtered = items.filter((item: any) => visibleIds.includes(item.device_id));
          return res.json({ data: { items: filtered, total: filtered.length } });
        }
      }
      res.json({ data: { items, total: items.length } });
    }
  } catch (err) { next(err); }
});

// GET /compliance/results/filter?deviceId=&page= — tenant-wide with optional device filter
router.get('/results/filter', async (req, res, next) => {
  try {
    const { deviceId, page } = req.query as any;

    // Permission check: if filtering by specific device, check read access
    if (deviceId && req.session.role !== 'admin') {
      const canRead = await permissionService.canReadDevice(req.session.userId!, parseInt(deviceId), false);
      if (!canRead) throw new AppError(403, 'Insufficient permissions');
    }

    const items = await complianceService.getAllResults(
      req.tenantId!,
      page ? parseInt(page) : 1,
      100, // limit (default page size)
      deviceId ? parseInt(deviceId) : undefined,
    );

    // Filter by visible devices for non-admins when no specific device filter
    if (!deviceId && req.session.role !== 'admin') {
      const visibleIds = await permissionService.getVisibleDeviceIds(req.session.userId!, false);
      if (Array.isArray(visibleIds)) {
        const filtered = items.filter((item: any) => visibleIds.includes(item.device_id));
        return res.json({ data: { items: filtered, total: filtered.length } });
      }
    }

    res.json({ data: { items, total: items.length } });
  } catch (err) { next(err); }
});

// Legacy path kept for backward compat
router.get('/results/device/:deviceId', requireDeviceRead('deviceId'), async (req, res, next) => {
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

// POST /compliance/remediate — trigger remediation on failing rules
router.post('/remediate', async (req, res, next) => {
  try {
    const { deviceId, policyId, ruleIds } = req.body;
    if (!deviceId || !policyId || !ruleIds?.length) {
      return res.status(400).json({ error: 'deviceId, policyId, ruleIds required' });
    }
    if (req.session.role !== 'admin') {
      const canWrite = await permissionService.canWriteDevice(req.session.userId!, parseInt(deviceId), false);
      if (!canWrite) throw new AppError(403, 'Insufficient permissions');
    }
    const cmds = await complianceService.triggerRemediation(
      parseInt(deviceId), parseInt(policyId), ruleIds,
      req.tenantId!, req.session.userId!
    );
    res.json({ data: cmds });
  } catch (err) { next(err); }
});

// POST /compliance/ignore — ignore rules on a device
router.post('/ignore', async (req, res, next) => {
  try {
    const { deviceId, policyId, ruleIds } = req.body;
    if (!deviceId || !policyId || !ruleIds?.length) {
      return res.status(400).json({ error: 'deviceId, policyId, ruleIds required' });
    }
    if (req.session.role !== 'admin') {
      const canWrite = await permissionService.canWriteDevice(req.session.userId!, parseInt(deviceId), false);
      if (!canWrite) throw new AppError(403, 'Insufficient permissions');
    }
    await complianceService.ignoreRules(
      parseInt(deviceId), parseInt(policyId), ruleIds,
      req.tenantId!, req.session.userId!
    );
    res.json({ data: { ok: true } });
  } catch (err) { next(err); }
});

// POST /compliance/unignore — remove ignore on rules
router.post('/unignore', async (req, res, next) => {
  try {
    const { deviceId, policyId, ruleIds } = req.body;
    if (!deviceId || !policyId || !ruleIds?.length) {
      return res.status(400).json({ error: 'deviceId, policyId, ruleIds required' });
    }
    if (req.session.role !== 'admin') {
      const canWrite = await permissionService.canWriteDevice(req.session.userId!, parseInt(deviceId), false);
      if (!canWrite) throw new AppError(403, 'Insufficient permissions');
    }
    await complianceService.unignoreRules(
      parseInt(deviceId), parseInt(policyId), ruleIds, req.tenantId!
    );
    res.json({ data: { ok: true } });
  } catch (err) { next(err); }
});

// GET /compliance/ignored/:deviceId — get all ignored rules for a device
router.get('/ignored/:deviceId', async (req, res, next) => {
  try {
    const deviceId = parseInt(req.params.deviceId);
    if (req.session.role !== 'admin') {
      const canRead = await permissionService.canReadDevice(req.session.userId!, deviceId, false);
      if (!canRead) throw new AppError(403, 'Insufficient permissions');
    }
    const ignored = await complianceService.getIgnoredRulesForDevice(deviceId, req.tenantId!);
    res.json({ data: ignored });
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

router.post('/templates', requireRole('admin'), async (req, res, next) => {
  try {
    const t = await complianceService.createTemplate(req.tenantId!, {
      ...req.body, createdBy: req.session.userId,
    });
    res.status(201).json({ data: t });
  } catch (err) { next(err); }
});

export default router;
