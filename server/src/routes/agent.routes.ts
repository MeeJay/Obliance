import { Router } from 'express';
import { agentAuth } from '../middleware/agentAuth';
import { db } from '../db';
import { deviceService } from '../services/device.service';
import { commandService } from '../services/command.service';
import { logger } from '../utils/logger';
import type { AgentPushRequest } from '@obliance/shared';
import {
  agentVersion,
  desktopVersion,
  agentDownload,
  agentInstallerLinux,
  agentInstallerMacos,
  agentInstallerWindows,
  agentInstallerWindowsMsi,
} from '../controllers/agent.controller';

const router = Router();

// ── Public: version info, binary downloads, installer scripts ────────────────
// These are called by PowerShell / bash BEFORE any login — no auth required.

router.get('/version',             agentVersion);
router.get('/version/desktop',     desktopVersion);
router.get('/download/:filename',  agentDownload);
router.get('/installer/linux',     agentInstallerLinux);
router.get('/installer/macos',     agentInstallerMacos);
router.get('/installer/windows',   agentInstallerWindows);
// Convenience URL matching Obliview pattern: /api/agent/installer/windows.msi
router.get('/installer/windows.msi', agentInstallerWindowsMsi);

// POST /api/agent/register
// Agent registers itself and gets back its device UUID confirmation
router.post('/register', agentAuth, async (req, res, next) => {
  try {
    const { uuid, hostname, osType, osName, osVersion, osBuild, osArch,
            cpuModel, cpuCores, ramTotalGb, ipLocal, agentVersion } = req.body;

    if (!uuid || !hostname) {
      return res.status(400).json({ error: 'uuid and hostname required' });
    }

    const result = await deviceService.registerDevice({
      uuid, hostname,
      osType: osType || 'other',
      osName, osVersion, osBuild, osArch,
      cpuModel, cpuCores, ramTotalGb,
      ipLocal,
      ipPublic: req.ip,
      agentVersion,
      apiKeyId: req.agentApiKeyId!,
      tenantId: req.agentTenantId!,
    });

    res.json({ deviceId: result.deviceId, isNew: result.isNew });
  } catch (err) {
    next(err);
  }
});

// POST /api/agent/push
// Main agent push endpoint: receives metrics + ACKs, returns config + commands
router.post('/push', agentAuth, async (req, res, next) => {
  try {
    const body = req.body as AgentPushRequest;
    const { deviceUuid, metrics, acks = [], agentVersion } = body;

    if (!deviceUuid) return res.status(400).json({ error: 'deviceUuid required' });

    const tenantId = req.agentTenantId!;

    // Find device
    const device = await db('devices')
      .where({ uuid: deviceUuid, tenant_id: tenantId, approval_status: 'approved' })
      .first();

    if (!device) {
      return res.status(403).json({ error: 'Device not found or not approved' });
    }

    // Process ACKs from previous commands
    if (acks.length > 0) {
      await commandService.processAcks(device.id, tenantId, acks);
    }

    // Handle push: update metrics, get commands + config
    const response = await deviceService.handlePush(device.id, tenantId, { ...body, agentVersion });

    res.json(response);
  } catch (err) {
    next(err);
  }
});

export default router;
