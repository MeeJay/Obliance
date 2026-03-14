import { Router } from 'express';
import { complianceService } from '../services/compliance.service';

const router = Router();

router.get('/policies', async (req, res, next) => {
  try { res.json(await complianceService.getPolicies(req.tenantId!)); } catch (err) { next(err); }
});

router.post('/policies', async (req, res, next) => {
  try {
    const policy = await complianceService.createPolicy(req.tenantId!, {
      ...req.body, createdBy: req.session.userId,
    });
    res.status(201).json(policy);
  } catch (err) { next(err); }
});

router.put('/policies/:id', async (req, res, next) => {
  try {
    const policy = await complianceService.updatePolicy(parseInt(req.params.id), req.tenantId!, req.body);
    res.json(policy);
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
    res.json(cmd);
  } catch (err) { next(err); }
});

router.get('/results/device/:deviceId', async (req, res, next) => {
  try {
    const results = await complianceService.getLatestResults(parseInt(req.params.deviceId), req.tenantId!);
    res.json(results);
  } catch (err) { next(err); }
});

router.get('/overview', async (req, res, next) => {
  try { res.json(await complianceService.getTenantCompliance(req.tenantId!)); } catch (err) { next(err); }
});

router.get('/templates', async (req, res, next) => {
  try { res.json(await complianceService.getTemplates(req.tenantId!)); } catch (err) { next(err); }
});

router.post('/templates', async (req, res, next) => {
  try {
    const t = await complianceService.createTemplate(req.tenantId!, {
      ...req.body, createdBy: req.session.userId,
    });
    res.status(201).json(t);
  } catch (err) { next(err); }
});

export default router;
