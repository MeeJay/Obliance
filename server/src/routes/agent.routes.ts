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
import { inventoryService } from '../services/inventory.service';
import { updateService } from '../services/update.service';

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
// Main agent push endpoint: receives metrics + ACKs, returns config + commands.
// Also auto-registers the device on first contact (no separate /register call needed).
router.post('/push', agentAuth, async (req, res, next) => {
  try {
    const body = req.body as AgentPushRequest & {
      hostname?: string;
      osInfo?: { platform?: string; distro?: string; release?: string; arch?: string };
    };
    const { deviceUuid, metrics, acks = [], agentVersion, hostname, osInfo } = body;

    if (!deviceUuid) return res.status(400).json({ error: 'deviceUuid required' });

    const tenantId = req.agentTenantId!;

    // Map platform string to OsType
    function toOsType(platform?: string): string {
      if (!platform) return 'other';
      const p = platform.toLowerCase();
      if (p === 'windows') return 'windows';
      if (p === 'darwin') return 'macos';
      if (p === 'linux') return 'linux';
      return 'other';
    }

    // Look up device regardless of approval status
    let device = await db('devices')
      .where({ uuid: deviceUuid, tenant_id: tenantId })
      .first();

    // Extract real WAN IP: first entry in X-Forwarded-For beats req.ip when behind proxies
    const ipPublic = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip;

    if (!device) {
      // ── First contact: auto-register the device ──────────────────────────────
      const result = await deviceService.registerDevice({
        uuid: deviceUuid,
        hostname: hostname || deviceUuid,
        osType: toOsType(osInfo?.platform),
        osName: osInfo?.distro || osInfo?.platform,
        osVersion: osInfo?.release,
        osArch: osInfo?.arch,
        agentVersion,
        ipPublic,
        apiKeyId: req.agentApiKeyId!,
        tenantId,
      });
      device = await db('devices').where({ id: result.deviceId }).first();
    } else {
      // ── Subsequent contact: keep device info fresh ───────────────────────────
      await db('devices').where({ id: device.id }).update({
        hostname: hostname || device.hostname,
        os_type: toOsType(osInfo?.platform) || device.os_type,
        os_name: osInfo?.distro || osInfo?.platform || device.os_name,
        os_version: osInfo?.release || device.os_version,
        os_arch: osInfo?.arch || device.os_arch,
        agent_version: agentVersion || device.agent_version,
        ip_public: ipPublic || device.ip_public,
        updated_at: new Date(),
      });
      device = await db('devices').where({ id: device.id }).first();
    }

    // ── Access control ─────────────────────────────────────────────────────────
    if (device.approval_status === 'refused' || device.status === 'suspended') {
      return res.status(403).json({ error: 'Device access denied' });
    }

    if (device.approval_status === 'pending') {
      // Device exists but not yet approved — tell agent to wait
      return res.status(202).json({ nextPollIn: 30 });
    }

    // ── Approved device: full push processing ──────────────────────────────────
    if (acks.length > 0) {
      await commandService.processAcks(device.id, tenantId, acks);
    }

    const response = await deviceService.handlePush(device.id, tenantId, { ...body, agentVersion });
    res.json(response);
  } catch (err) {
    next(err);
  }
});

// POST /api/agent/inventory
// Called by the agent after a scan_inventory command completes.
// Saves hardware + software inventory for the device.
router.post('/inventory', agentAuth, async (req, res, next) => {
  try {
    const deviceUuid = req.headers['x-device-uuid'] as string | undefined;
    if (!deviceUuid) return res.status(400).json({ error: 'X-Device-UUID header required' });

    const device = await db('devices')
      .where({ uuid: deviceUuid, tenant_id: req.agentTenantId! })
      .first();
    if (!device) return res.status(404).json({ error: 'Device not found' });
    if (device.approval_status === 'refused' || device.status === 'suspended') {
      return res.status(403).json({ error: 'Device access denied' });
    }

    const data = req.body;
    // Save hardware (cpu, memory, disks, networkInterfaces, gpu, motherboard, bios, raw)
    await inventoryService.saveHardware(device.id, data);
    // Save software list
    if (Array.isArray(data.software) && data.software.length > 0) {
      await inventoryService.saveSoftware(device.id, data.software);
    }

    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST /api/agent/updates
// Called by the agent after a scan_updates command completes.
// Upserts the list of available OS/software updates.
router.post('/updates', agentAuth, async (req, res, next) => {
  try {
    const deviceUuid = req.headers['x-device-uuid'] as string | undefined;
    if (!deviceUuid) return res.status(400).json({ error: 'X-Device-UUID header required' });

    const tenantId = req.agentTenantId!;
    const device = await db('devices')
      .where({ uuid: deviceUuid, tenant_id: tenantId })
      .first();
    if (!device) return res.status(404).json({ error: 'Device not found' });
    if (device.approval_status === 'refused' || device.status === 'suspended') {
      return res.status(403).json({ error: 'Device access denied' });
    }

    const { updates } = req.body as { updates: any[] };
    if (Array.isArray(updates) && updates.length > 0) {
      await updateService.upsertUpdates(device.id, tenantId, updates);
    }

    res.json({ ok: true, count: updates?.length ?? 0 });
  } catch (err) { next(err); }
});

export default router;
