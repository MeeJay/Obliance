import { Router } from 'express';
import { commandService } from '../services/command.service';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const { deviceId, status } = req.query as any;
    const commands = await commandService.getCommands(req.tenantId!, {
      deviceId: deviceId ? parseInt(deviceId) : undefined, status,
    });
    res.json(commands);
  } catch (err) { next(err); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    await commandService.cancelCommand(req.params.id, req.tenantId!);
    res.status(204).send();
  } catch (err) { next(err); }
});

export default router;
