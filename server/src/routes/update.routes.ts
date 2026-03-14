import { Router } from 'express';
import { updateService } from '../services/update.service';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const { status, severity, deviceId } = req.query as any;
    const updates = await updateService.getTenantUpdates(req.tenantId!, {
      status, severity, deviceId: deviceId ? parseInt(deviceId) : undefined,
    });
    res.json(updates);
  } catch (err) { next(err); }
});

router.get('/stats', async (req, res, next) => {
  try {
    const stats = await updateService.getUpdateStats(req.tenantId!);
    res.json(stats);
  } catch (err) { next(err); }
});

router.get('/policies', async (req, res, next) => {
  try {
    res.json(await updateService.getPolicies(req.tenantId!));
  } catch (err) { next(err); }
});

router.post('/policies', async (req, res, next) => {
  try {
    const policy = await updateService.createPolicy(req.tenantId!, {
      ...req.body, createdBy: req.session.userId,
    });
    res.status(201).json(policy);
  } catch (err) { next(err); }
});

router.delete('/policies/:id', async (req, res, next) => {
  try {
    await updateService.deletePolicy(parseInt(req.params.id), req.tenantId!);
    res.status(204).send();
  } catch (err) { next(err); }
});

router.post('/device/:deviceId/approve', async (req, res, next) => {
  try {
    const { updateId, severities } = req.body;
    if (updateId) {
      await updateService.approveUpdate(updateId, req.tenantId!, req.session.userId!);
    } else if (severities) {
      await updateService.approveByDeviceAndSeverity(
        parseInt(req.params.deviceId), req.tenantId!, severities, req.session.userId!
      );
    }
    res.json({ success: true });
  } catch (err) { next(err); }
});

router.post('/device/:deviceId/deploy', async (req, res, next) => {
  try {
    const updates = await updateService.deployApprovedUpdates(
      parseInt(req.params.deviceId), req.tenantId!, req.session.userId!
    );
    res.json({ dispatched: updates.length });
  } catch (err) { next(err); }
});

router.post('/device/:deviceId/scan', async (req, res, next) => {
  try {
    const cmd = await updateService.triggerUpdateScan(
      parseInt(req.params.deviceId), req.tenantId!, req.session.userId!
    );
    res.json(cmd);
  } catch (err) { next(err); }
});

export default router;
