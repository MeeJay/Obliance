import { Router } from 'express';
import { remoteService } from '../services/remote.service';

const router = Router();

router.post('/sessions', async (req, res, next) => {
  try {
    const { deviceId, protocol } = req.body;
    const session = await remoteService.createSession(
      deviceId, req.tenantId!, req.session.userId!, protocol
    );
    res.status(201).json(session);
  } catch (err) { next(err); }
});

router.get('/sessions', async (req, res, next) => {
  try {
    const { deviceId, status } = req.query as any;
    const sessions = await remoteService.getSessions(req.tenantId!, {
      deviceId: deviceId ? parseInt(deviceId) : undefined, status,
    });
    res.json(sessions);
  } catch (err) { next(err); }
});

router.delete('/sessions/:id', async (req, res, next) => {
  try {
    await remoteService.endSession(req.params.id, req.tenantId!, 'user_disconnect');
    res.status(204).send();
  } catch (err) { next(err); }
});

export default router;
