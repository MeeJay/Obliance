import { Router } from 'express';
import { commandService } from '../services/command.service';
import { getAgentVersion } from '../services/device.service';
import { agentHub } from '../services/agentHub.service';
import { permissionService } from '../services/permission.service';
import { privacyGateService } from '../services/privacyGate.service';
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

    // Legacy-agent compatibility gate. The Go 1.20 build that runs on
    // Server 2008 R2 / 2012 lacks the WebSocket tunnel, ObliReach,
    // software-compliance and file upload/download handlers — queuing
    // these commands would silently hang forever. Refuse at the edge so
    // the caller gets a clear error instead of a ghost command.
    const LEGACY_INCOMPATIBLE: string[] = [
      'open_remote_tunnel', 'close_remote_tunnel',
      'install_oblireach',
      'install_software', 'uninstall_software', 'check_software_compliance',
      'enable_privacy_mode',
      'upload_file', 'download_file',
      // The legacy Go 1.20 agent has no self-update path (no MSI, deployed
      // via sc create) — it explicitly rejects update_agent. Refuse here so
      // the admin gets a clear error instead of a ghost command.
      'update_agent',
    ];
    if (device.agent_flavor === 'legacy' && LEGACY_INCOMPATIBLE.includes(type)) {
      return next(new AppError(409,
        `Command "${type}" is not supported on the legacy agent (Go 1.20 / Server 2008 R2). Upgrade the agent or use a compatible action.`));
    }

    // If a privacy-gate password is set, refuse the raw disable_privacy_mode
    // command. Clients must use /api/devices/:id/privacy/disable-with-password
    // which verifies the password via the agent before sending the command.
    if (type === 'disable_privacy_mode' && device.privacy_password_set) {
      return next(new AppError(423, 'Privacy password is set — use /privacy/disable-with-password'));
    }

    // Permission check — non-admins need write access to the device.
    //
    // Command types whose payload can trigger arbitrary code execution on the
    // agent (custom install scripts, attacker-chosen msi URLs) are forbidden
    // on this generic endpoint for non-admins. Non-admins must instead use
    // the dedicated routes (/software-compliance/check, /remediate) which
    // resolve entries server-side from admin-curated lists — the payload is
    // never taken from the client. Admins keep direct access here for debug
    // and manual orchestration.
    const ADMIN_ONLY_COMMANDS: CommandType[] = [
      'install_software',
      'uninstall_software',
      'check_software_compliance',
      // Force-applying an agent update is an admin-only operation.
      'update_agent',
    ];

    if (req.session.role !== 'admin') {
      if (ADMIN_ONLY_COMMANDS.includes(type)) {
        return next(new AppError(403,
          `Command type '${type}' must be invoked via the dedicated /api/software-compliance/* routes`));
      }

      // Determine required capability based on command type
      const POWER_COMMANDS = ['reboot', 'shutdown', 'sleep', 'restart_agent', 'uninstall_agent'];
      const REMOTE_COMMANDS = ['open_remote_tunnel', 'close_remote_tunnel'];
      const FILE_COMMANDS = ['list_directory', 'create_directory', 'rename_file', 'delete_file', 'download_file', 'upload_file'];

      let requiredCap = 'execute'; // default for scripts, scans, etc.
      if (POWER_COMMANDS.includes(type)) requiredCap = 'power';
      else if (REMOTE_COMMANDS.includes(type)) requiredCap = 'remote';
      else if (FILE_COMMANDS.includes(type)) requiredCap = 'files';

      const allowed = await permissionService.canUseCapability(req.session.userId!, deviceId, false, requiredCap);
      if (!allowed) return next(new AppError(403, `Capability '${requiredCap}' not permitted for your team`));
    }

    // If the device is in privacy mode and this command is privacy-gated,
    // check for an active unlock session owned by this user. If one exists,
    // attach the agent unlock token to the payload so the agent lets it
    // through. If none, refuse with 403 (even admins).
    let effectivePayload = payload;
    if (device.privacy_mode_enabled && privacyGateService.isBlockedByPrivacy(type)) {
      const feature = privacyGateService.featureForCommand(type);
      const token = req.session.userId
        ? privacyGateService.get(req.session.userId, deviceId, feature)
        : null;
      if (!token) {
        return next(new AppError(423, `Privacy mode is active — unlock required for feature '${feature}'`));
      }
      effectivePayload = { ...payload, unlockToken: token };
    }

    // Force-update: stamp the server's current agent version into the payload
    // when the caller didn't supply one, so the agent applies exactly the
    // build this server ships (the agent falls back to GET /api/agent/version
    // only if even this is missing).
    if (type === 'update_agent' && !effectivePayload?.version) {
      const ver = getAgentVersion();
      if (!ver) {
        return next(new AppError(409, 'Cannot determine the latest agent version (agent/VERSION missing).'));
      }
      effectivePayload = { ...effectivePayload, version: ver };
    }

    // ── Action restriction gate ───────────────────────────────────────────
    // Consults the tenant's per-action restriction map (configured under
    // /admin/users → Restrictions). If the action is "sensitive", we require
    // a valid TOTP code in req.body.twoFactorCode; if "restricted", we
    // queue a pending approval instead of executing.
    const { applyRestriction } = await import('../services/restriction.service');
    const approved = await applyRestriction(res, {
      req,
      actionKey: `command.${type}`,
      deviceIds: [deviceId],
      approvalRequestType: 'batch_command',
      approvalDescription: `${type} on ${device.hostname}`,
      approvalPayload: { action: type, deviceIds: [deviceId], params: effectivePayload },
    });
    if (!approved) return;

    const cmd = await commandService.enqueue({
      deviceId,
      tenantId: req.tenantId!,
      type,
      payload: effectivePayload,
      priority: priority as CommandPriority,
      expiresInSeconds: 300,
      createdBy: req.session?.userId,
    });

    // Audit every user-initiated command so the security tab shows who
    // triggered what on which machine (reboot / shutdown / scripts / etc).
    try {
      const { auditService } = await import('../services/audit.service');
      await auditService.logReq(req, `command.${type}`, {
        deviceId,
        resourceType: 'command',
        resourcePath: cmd.id,
        details: { hostname: device.hostname, priority },
      });
    } catch {}

    // Try immediate delivery via WebSocket command channel.
    // If the push succeeds the agent will execute and ack via WS, so mark
    // the command as 'sent' now to prevent re-delivery on the next HTTP push.
    const pushed = agentHub.push(deviceId, {
      type: 'command',
      id: cmd.id,
      commandType: type,
      payload: effectivePayload,
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
