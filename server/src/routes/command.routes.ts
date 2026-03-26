import { Router } from 'express';
import { commandService } from '../services/command.service';
import { agentHub } from '../services/agentHub.service';
import { permissionService } from '../services/permission.service';
import { db } from '../db';
import { AppError } from '../middleware/errorHandler';
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

    // Permission check — non-admins need write access to the device
    if (req.session.role !== 'admin') {
      // Determine required capability based on command type
      const POWER_COMMANDS = ['reboot', 'shutdown', 'restart_agent', 'uninstall_agent'];
      const REMOTE_COMMANDS = ['open_remote_tunnel', 'close_remote_tunnel'];
      const FILE_COMMANDS = ['list_directory', 'create_directory', 'rename_file', 'delete_file', 'download_file', 'upload_file'];

      let requiredCap = 'execute'; // default for scripts, scans, etc.
      if (POWER_COMMANDS.includes(type)) requiredCap = 'power';
      else if (REMOTE_COMMANDS.includes(type)) requiredCap = 'remote';
      else if (FILE_COMMANDS.includes(type)) requiredCap = 'files';

      const allowed = await permissionService.canUseCapability(req.session.userId!, deviceId, false, requiredCap);
      if (!allowed) return next(new AppError(403, `Capability '${requiredCap}' not permitted for your team`));
    }

    const cmd = await commandService.enqueue({
      deviceId,
      tenantId: req.tenantId!,
      type,
      payload,
      priority: priority as CommandPriority,
      expiresInSeconds: 300,
      createdBy: req.session?.userId,
    });

    // Try immediate delivery via WebSocket command channel.
    // If the push succeeds the agent will execute and ack via WS, so mark
    // the command as 'sent' now to prevent re-delivery on the next HTTP push.
    const pushed = agentHub.push(deviceId, {
      type: 'command',
      id: cmd.id,
      commandType: type,
      payload,
    });
    if (pushed) {
      try {
        await db('command_queue')
          .where({ id: cmd.id })
          .update({ status: 'sent', sent_at: new Date(), updated_at: new Date() });
      } catch { /* non-fatal — command will be re-delivered via HTTP push */ }
    }

    res.json({ data: cmd });
  } catch (err) { next(err); }
});

router.get('/', async (req, res, next) => {
  try {
    const { deviceId, status, page, limit } = req.query as any;

    // Non-admins: if deviceId specified, check read access; otherwise filter to visible devices
    if (req.session.role !== 'admin' && deviceId) {
      const canRead = await permissionService.canReadDevice(req.session.userId!, parseInt(deviceId), false);
      if (!canRead) return next(new AppError(403, 'Insufficient permissions'));
    }

    const result = await commandService.getCommands(req.tenantId!, {
      deviceId: deviceId ? parseInt(deviceId) : undefined,
      status,
      page: page ? parseInt(page) : undefined,
      limit: limit ? parseInt(limit) : undefined,
    });

    // Filter results to visible devices for non-admins
    if (req.session.role !== 'admin') {
      const visible = await permissionService.getVisibleDeviceIds(req.session.userId!, false);
      if (visible !== 'all') {
        const visibleSet = new Set(visible);
        const filtered = result.items.filter((c: any) => visibleSet.has(c.deviceId));
        return res.json({ data: { items: filtered, total: filtered.length } });
      }
    }

    res.json({ data: result });
  } catch (err) { next(err); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    if (req.session.role !== 'admin') {
      const cmd = await db('command_queue').where({ id: req.params.id, tenant_id: req.tenantId! }).first();
      if (cmd) {
        const canWrite = await permissionService.canWriteDevice(req.session.userId!, cmd.device_id, false);
        if (!canWrite) return next(new AppError(403, 'Insufficient permissions'));
      }
    }
    await commandService.cancelCommand(req.params.id, req.tenantId!);
    res.status(204).send();
  } catch (err) { next(err); }
});

export default router;
