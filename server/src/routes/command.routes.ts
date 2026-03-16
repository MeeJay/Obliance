import { Router } from 'express';
import { commandService } from '../services/command.service';
import { agentHub } from '../services/agentHub.service';
import { db } from '../db';
import type { CommandType, CommandPriority } from '@obliance/shared';

const router = Router();

// POST /api/commands — enqueue a command for a device (try immediate delivery first)
router.post('/', async (req, res, next) => {
  try {
    const { deviceId, type, payload = {}, priority = 'normal' } = req.body as {
      deviceId: number;
      type: CommandType;
      payload?: Record<string, any>;
      priority?: CommandPriority;
    };

    if (!deviceId || !type) {
      return res.status(400).json({ error: 'deviceId and type are required' });
    }

    // Verify device belongs to tenant
    const device = await db('devices').where({ id: deviceId, tenant_id: req.tenantId! }).first();
    if (!device) return res.status(404).json({ error: 'Device not found' });

    const cmd = await commandService.enqueue({
      deviceId,
      tenantId: req.tenantId!,
      type,
      payload,
      priority: priority as CommandPriority,
      expiresInSeconds: 300,
      createdBy: req.session?.userId,
    });

    // Try immediate delivery via WebSocket command channel
    agentHub.push(deviceId, {
      type: 'command',
      id: cmd.id,
      commandType: type,
      payload,
    });

    res.json({ data: cmd });
  } catch (err) { next(err); }
});

router.get('/', async (req, res, next) => {
  try {
    const { deviceId, status } = req.query as any;
    const commands = await commandService.getCommands(req.tenantId!, {
      deviceId: deviceId ? parseInt(deviceId) : undefined, status,
    });
    res.json({ data: { items: commands, total: commands.length } });
  } catch (err) { next(err); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    await commandService.cancelCommand(req.params.id, req.tenantId!);
    res.status(204).send();
  } catch (err) { next(err); }
});

export default router;
