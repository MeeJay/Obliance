import { Router } from 'express';
import { agentAuth } from '../middleware/agentAuth';
import { db } from '../db';
import { deviceService, getAgentVersion } from '../services/device.service';
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
  agentInstallerWindowsMsiX86,
  agentInstallerFreebsd,
} from '../controllers/agent.controller';
import { geolocationService } from '../services/geolocation.service';
import { inventoryService } from '../services/inventory.service';
import { updateService } from '../services/update.service';
import { complianceService } from '../services/compliance.service';
import { softwareComplianceService } from '../services/softwareCompliance.service';
import { networkDiscoveryService } from '../services/networkDiscovery.service';
import { scenarioService } from '../services/scenario.service';
import { SocketEvents } from '@obliance/shared';
import { getIO } from '../socket';

const router = Router();

// ── Public: version info, binary downloads, installer scripts ────────────────
// These are called by PowerShell / bash BEFORE any login — no auth required.

router.get('/version',             agentVersion);
router.get('/version/desktop',     desktopVersion);
router.get('/download/:filename',  agentDownload);
router.get('/installer/linux',     agentInstallerLinux);
router.get('/installer/macos',     agentInstallerMacos);
router.get('/installer/windows',   agentInstallerWindows);
router.get('/installer/freebsd',   agentInstallerFreebsd);
// Convenience URL matching Obliview pattern: /api/agent/installer/windows.msi
router.get('/installer/windows.msi', agentInstallerWindowsMsi);
// 32-bit (x86) MSI for old 32-bit Windows (Win7/Win10 x86).
router.get('/installer/windows-x86.msi', agentInstallerWindowsMsiX86);

// GET /api/agent/ws
// This endpoint is normally upgraded to a WebSocket by the Node.js upgrade
// handler (index.ts) BEFORE reaching Express.  If it reaches Express it means
// the reverse proxy (Nginx) did NOT forward the Upgrade header — the upgrade
// handler never fired.  Return a clear 426 Upgrade Required so the agent log
// shows a meaningful error instead of falling through to requireAuth (401).
router.get('/ws', agentAuth, (_req, res) => {
  res.status(426).json({ error: 'WebSocket upgrade required — proxy not forwarding Upgrade header' });
});

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
      osInfo?: { platform?: string; distro?: string; release?: string; arch?: string; bootTime?: number; timezone?: string };
      ipLocal?: string;
      macAddress?: string;
      privacyMode?: boolean;
      airgapMode?: boolean;
      lastLoggedInUser?: string;
      distroFamily?: string;
      agentFlavor?: 'modern' | 'legacy';
      virtualizationHost?: string;
      backupHost?: string;
    };
    const { deviceUuid, metrics, acks = [], agentVersion, hostname, osInfo, ipLocal, macAddress, privacyMode, airgapMode, lastLoggedInUser, distroFamily, agentFlavor, virtualizationHost, backupHost } = body;
    // Host-role flags (hypervisor / backup server). Tri-state on purpose:
    //   - field ABSENT (undefined)  => agent doesn't report this role at all
    //     (legacy Go 1.20 agent, or a modern agent older than the feature) =>
    //     `undefined` sentinel => KEEP whatever is already stored. Without this
    //     a legacy push would write null on every contact and permanently wipe
    //     a value a modern agent on the same host had set.
    //   - field PRESENT but unknown/"" => a real clear (role uninstalled /
    //     downgraded) => null => hide the tab.
    //   - field PRESENT and known => set that role.
    const vhost = virtualizationHost === undefined
      ? undefined
      : (['hyperv', 'esxi', 'proxmox', 'kvm'].includes(virtualizationHost) ? virtualizationHost : null);
    const bhost = backupHost === undefined
      ? undefined
      : (['veeam'].includes(backupHost) ? backupHost : null);

    // The Go 1.20 legacy agent doesn't include `distroFamily` in its push
    // body (and lacks every WebSocket tunnel / ObliReach / software
    // compliance handler). Infer the flavor from the payload so existing
    // deployed legacy agents get flagged without needing a rebuild. Explicit
    // `agentFlavor` on future builds takes precedence.
    const inferredFlavor: 'modern' | 'legacy' =
      agentFlavor === 'legacy' ? 'legacy'
      : agentFlavor === 'modern' ? 'modern'
      : (distroFamily ? 'modern' : 'legacy');

    if (!deviceUuid) return res.status(400).json({ error: 'deviceUuid required' });

    const tenantId = req.agentTenantId!;

    // Map platform string to OsType
    function toOsType(platform?: string): string {
      if (!platform) return 'other';
      const p = platform.toLowerCase();
      if (p === 'windows') return 'windows';
      if (p === 'darwin') return 'macos';
      if (p === 'linux') return 'linux';
      if (p === 'freebsd') return 'freebsd';
      return 'other';
    }

    // gopsutil reports `Platform = "darwin"` for every Mac, so naïvely
    // storing it as `os_name` makes the dashboard "Version" filter list
    // a single "darwin" entry for the entire fleet. Same idea as the
    // Windows convention: the major version maps to a marketing name
    // (Sonoma / Sequoia / etc.) and that's what users mentally key on.
    function macOsRelease(version: string | undefined): string | null {
      if (!version) return null;
      const m = version.match(/^(\d+)(?:\.(\d+))?/);
      if (!m) return null;
      const major = parseInt(m[1], 10);
      const minor = m[2] ? parseInt(m[2], 10) : 0;
      const NAMES: Record<number, string> = {
        11: 'Big Sur', 12: 'Monterey', 13: 'Ventura',
        14: 'Sonoma', 15: 'Sequoia',
        // Apple renumbered macOS from 15→26 at WWDC 2025 to align with
        // iOS — macOS Tahoe is the first under the new scheme. Future
        // releases land in the `macOS X` generic branch below until
        // their marketing name is added here.
        26: 'Tahoe',
      };
      if (NAMES[major]) return NAMES[major];
      if (major === 10) {
        const LEGACY: Record<number, string> = {
          15: 'Catalina', 14: 'Mojave', 13: 'High Sierra',
          12: 'Sierra', 11: 'El Capitan', 10: 'Yosemite',
        };
        return LEGACY[minor] ?? `macOS 10.${minor}`;
      }
      // Future releases — keep the major number visible so the version
      // filter doesn't show "darwin" while we update the table.
      return `macOS ${major}`;
    }

    function deriveOsName(osType: string, version: string | undefined, fallback: string | undefined): string | null {
      if (osType === 'macos') {
        const name = macOsRelease(version);
        if (name) return name;
      }
      return fallback ?? null;
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
        osName: deriveOsName(toOsType(osInfo?.platform), osInfo?.release, osInfo?.distro || osInfo?.platform) || undefined,
        osVersion: osInfo?.release,
        osArch: osInfo?.arch,
        agentVersion,
        agentFlavor: inferredFlavor,
        ipPublic,
        ipLocal,
        macAddress,
        apiKeyId: req.agentApiKeyId!,
        tenantId,
      });
      device = await db('devices').where({ id: result.deviceId }).first();
    } else {
      // ── Subsequent contact: keep device info fresh, but WRITE only what
      // actually changed. Identity (hostname/os/ip/mac/…) is stable across the
      // overwhelming majority of pushes, so at 2000 devices this turns a
      // systematic ~18-column UPDATE per push into a no-op on the hot path,
      // eliminating most of the devices-table row-version churn (the metrics
      // UPDATE inside handlePush still runs every push — latest_metrics always
      // changes). Values below reproduce the exact original expressions so the
      // stored state is identical; we just skip no-op writes.
      const patch: Record<string, unknown> = {};
      const set = (col: string, val: unknown, cur: unknown) => { if (val !== cur) patch[col] = val; };
      set('hostname', hostname || device.hostname, device.hostname);
      set('os_type', toOsType(osInfo?.platform), device.os_type);
      set('os_name', deriveOsName(toOsType(osInfo?.platform), osInfo?.release, osInfo?.distro || osInfo?.platform) || device.os_name, device.os_name);
      set('os_version', osInfo?.release || device.os_version, device.os_version);
      set('os_arch', osInfo?.arch || device.os_arch, device.os_arch);
      set('agent_version', agentVersion || device.agent_version, device.agent_version);
      set('agent_flavor', inferredFlavor, device.agent_flavor);
      set('ip_public', ipPublic || device.ip_public, device.ip_public);
      set('ip_local', ipLocal || device.ip_local, device.ip_local);
      set('mac_address', macAddress || device.mac_address, device.mac_address);
      set('privacy_mode_enabled', typeof privacyMode === 'boolean' ? privacyMode : device.privacy_mode_enabled, device.privacy_mode_enabled);
      set('airgap_enabled', typeof airgapMode === 'boolean' ? airgapMode : device.airgap_enabled, device.airgap_enabled);
      set('last_logged_in_user', lastLoggedInUser || device.last_logged_in_user, device.last_logged_in_user);
      set('os_distro', distroFamily || device.os_distro, device.os_distro);
      set('virtualization_host_type', vhost !== undefined ? vhost : device.virtualization_host_type, device.virtualization_host_type);
      set('backup_host_type', bhost !== undefined ? bhost : device.backup_host_type, device.backup_host_type);
      set('timezone', osInfo?.timezone || device.timezone, device.timezone);
      if (osInfo?.bootTime) {
        const nr = new Date(osInfo.bootTime * 1000);
        const cur = device.last_reboot_at ? new Date(device.last_reboot_at).getTime() : null;
        if (cur !== nr.getTime()) patch.last_reboot_at = nr;
      }
      if (Object.keys(patch).length > 0) {
        patch.updated_at = new Date();
        await db('devices').where({ id: device.id }).update(patch);
      }

      // Track identity fingerprint to detect duplicate machine_uuid across
      // physical hosts (typical VM-cloning symptom). Non-blocking — even
      // if the detection layer errors, the rest of the push must succeed.
      deviceService.recordIdentityFingerprint(device.id, tenantId, {
        hostname: hostname || null,
        ipLocal: ipLocal || null,
        ipPublic: ipPublic || null,
        mac: macAddress || null,
      }).catch((err) => logger.error({ err, deviceId: device.id }, 'recordIdentityFingerprint failed'));

      // Geolocate if public IP changed
      if (ipPublic && ipPublic !== device.ip_public) {
        geolocationService.updateDeviceGeo(device.id, ipPublic).catch(() => {});
      }

      // No re-SELECT: the only device fields read below (approval_status,
      // status, id, tenant_id) are never touched by an identity update.
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

    // Handle agent events (session_login, machine_boot, etc.) for scenario triggers
    if (Array.isArray(body.events)) {
      for (const event of body.events) {
        if (event.type === 'session_login' || event.type === 'machine_boot') {
          scenarioService.fireTrigger(event.type, device.id, device.tenant_id, event.data).catch(err => {
            logger.error({ err, deviceId: device.id, eventType: event.type }, 'Failed to fire scenario trigger');
          });
        }
      }
    }

    res.json(response);
  } catch (err) {
    next(err);
  }
});

// POST /api/agent/notifying-update
// Agent calls this right before applying an update. Sets status to 'updating'
// with a 10-min timeout — after which checkOfflineDevices transitions to 'update_error'.
router.post('/notifying-update', agentAuth, async (req, res) => {
  try {
    const deviceUuid = req.headers['x-device-uuid'] as string | undefined;
    if (!deviceUuid) { res.status(400).json({ error: 'X-Device-UUID header required' }); return; }
    const tenantId = req.agentTenantId!;
    const device = await deviceService.getDeviceByUuid(deviceUuid, tenantId);
    if (!device) { res.status(404).json({ error: 'Device not found' }); return; }
    await db('devices').where({ id: device.id, tenant_id: tenantId }).update({
      status: 'updating',
      update_started_at: new Date(),
      updated_at: new Date(),
    });
    // Notify UI
    try { getIO().to(`tenant:${tenantId}`).emit(SocketEvents.DEVICE_UPDATED, { deviceId: device.id, status: 'updating' }); } catch {}
    logger.info({ deviceId: device.id, uuid: deviceUuid }, 'Device entering update mode (10min timeout)');
    res.json({ ok: true });
  } catch (err) {
    logger.error(err, 'notifying-update error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/agent/commands
// Lightweight command poll — agent checks for pending tasks at its own
// task_retrieve_delay_seconds rate, without sending metrics.
router.get('/commands', agentAuth, async (req, res, next) => {
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
    if (device.approval_status === 'pending') {
      return res.json({ commands: [], nextDelaySeconds: 30 });
    }

    const pending = await db('command_queue')
      .where({ device_id: device.id, status: 'pending' })
      .orderBy([{ column: 'priority', order: 'desc' }, { column: 'created_at', order: 'asc' }])
      .limit(5);

    if (pending.length > 0) {
      await db('command_queue')
        .whereIn('id', pending.map((c: any) => c.id))
        .update({ status: 'sent', sent_at: new Date(), updated_at: new Date() });
    }

    // If the agent holds a live command-channel WebSocket, commands reach it
    // instantly over that channel (and every push also carries pending
    // commands), so the HTTP poll is pure redundancy — tell the agent to back
    // off to 120s. The agent honours nextDelaySeconds (command_poller.go), and
    // drops back to the fast delay automatically once the WS goes away and its
    // next poll returns the short value. This alone removes ~200 req/s at 2000
    // devices, with zero agent change. When commands are actually pending we
    // keep the fast delay so a WS-less agent still picks them up quickly.
    const { agentHub } = await import('../services/agentHub.service');
    const delayCfg = await db('app_config').where({ key: 'task_retrieve_delay_seconds' }).first();
    const fastDelay = delayCfg?.value ? parseInt(delayCfg.value) : 10;
    const nextDelaySeconds = (pending.length === 0 && agentHub.isConnected(device.id)) ? 120 : fastDelay;

    res.json({
      commands: pending.map((c: any) => ({ id: c.id, type: c.type, payload: c.payload, priority: c.priority })),
      nextDelaySeconds,
      latestVersion: getAgentVersion() || undefined,
    });
  } catch (err) { next(err); }
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

// POST /api/agent/hyperv-vms
// Called by the host agent after enumerating its VMs (inventory cadence or
// the hyperv_list_vms command). Replaces the stored VM set for the host.
router.post('/hyperv-vms', agentAuth, async (req, res, next) => {
  try {
    const deviceUuid = req.headers['x-device-uuid'] as string | undefined;
    if (!deviceUuid) return res.status(400).json({ error: 'X-Device-UUID header required' });

    const tenantId = req.agentTenantId!;
    const device = await db('devices').where({ uuid: deviceUuid, tenant_id: tenantId }).first();
    if (!device) return res.status(404).json({ error: 'Device not found' });
    if (device.approval_status === 'refused' || device.status === 'suspended') {
      return res.status(403).json({ error: 'Device access denied' });
    }

    const { hostType, vms } = req.body as { hostType?: string; vms?: any[] };
    const ht = (['hyperv', 'esxi', 'proxmox', 'kvm'].includes(hostType ?? '') ? hostType! : 'hyperv') as any;
    const { hyperVService } = await import('../services/hyperV.service');
    await hyperVService.ingestVMs(device.id, tenantId, ht, Array.isArray(vms) ? vms : []);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST /api/agent/veeam-jobs
// Called by the host agent after enumerating its Veeam jobs (inventory cadence
// or the veeam_list_jobs command). Replaces the stored job set for the host.
router.post('/veeam-jobs', agentAuth, async (req, res, next) => {
  try {
    const deviceUuid = req.headers['x-device-uuid'] as string | undefined;
    if (!deviceUuid) return res.status(400).json({ error: 'X-Device-UUID header required' });

    const tenantId = req.agentTenantId!;
    const device = await db('devices').where({ uuid: deviceUuid, tenant_id: tenantId }).first();
    if (!device) return res.status(404).json({ error: 'Device not found' });
    if (device.approval_status === 'refused' || device.status === 'suspended') {
      return res.status(403).json({ error: 'Device access denied' });
    }

    const { hostType, jobs } = req.body as { hostType?: string; jobs?: any[] };
    const ht = (['veeam'].includes(hostType ?? '') ? hostType! : 'veeam') as any;
    const { veeamService } = await import('../services/veeam.service');
    await veeamService.ingestJobs(device.id, tenantId, ht, Array.isArray(jobs) ? jobs : []);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST /api/agent/hyperv-thumbnail
// VM console framebuffer (PNG, base64) captured by the host agent. Relayed
// to open console previews/viewers via Socket.io; the latest frame per VM is
// also cached in memory for an immediate first paint.
router.post('/hyperv-thumbnail', agentAuth, async (req, res, next) => {
  try {
    const deviceUuid = req.headers['x-device-uuid'] as string | undefined;
    if (!deviceUuid) return res.status(400).json({ error: 'X-Device-UUID header required' });
    const tenantId = req.agentTenantId!;
    const device = await db('devices').where({ uuid: deviceUuid, tenant_id: tenantId }).first();
    if (!device) return res.status(404).json({ error: 'Device not found' });

    const { vmId, pngBase64, width, height, error } = req.body as { vmId?: string; pngBase64?: string; width?: number; height?: number; error?: string };
    if (!vmId) return res.status(400).json({ error: 'vmId required' });

    const { getIO } = await import('../socket');

    // Capture-error path: the agent couldn't grab a framebuffer (VM off, no
    // integration video, host refused). Relay the reason so the open console
    // shows it instead of spinning forever. No cache write.
    if (error) {
      try {
        getIO().to(`tenant:${tenantId}`).emit('HYPERV_THUMBNAIL', {
          hostDeviceId: device.id, vmId, error: String(error).slice(0, 300), at: Date.now(),
        });
      } catch { /* socket not ready */ }
      return res.json({ ok: true });
    }

    if (!pngBase64) return res.status(400).json({ error: 'pngBase64 or error required' });

    const { hyperVConsoleStore } = await import('../services/hyperVConsole.service');
    hyperVConsoleStore.put(device.id, vmId, { pngBase64, width: width ?? 0, height: height ?? 0 });

    try {
      getIO().to(`tenant:${tenantId}`).emit('HYPERV_THUMBNAIL', {
        hostDeviceId: device.id, vmId, pngBase64, width: width ?? 0, height: height ?? 0, at: Date.now(),
      });
    } catch { /* socket not ready */ }
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

    const { updates, rebootPending } = req.body as { updates: any[]; rebootPending?: boolean };
    if (Array.isArray(updates) && updates.length > 0) {
      await updateService.upsertUpdates(device.id, tenantId, updates);
      // Apply auto-approve policies to newly discovered updates
      await updateService.applyAutoApprove(device.id, tenantId);
    }

    // Store reboot pending flag on device
    if (typeof rebootPending === 'boolean') {
      await db('devices').where({ id: device.id }).update({
        reboot_pending: rebootPending,
        updated_at: new Date(),
      });
    }

    res.json({ ok: true, count: updates?.length ?? 0 });
  } catch (err) { next(err); }
});

// POST /api/agent/services
// Called by the agent whenever it collects a fresh service list (on scan, after
// a start/stop/restart action, or when the background watcher detects a change).
// Stores the list as `latest_services` JSONB on the device and emits a socket
// event so connected clients update in real time.
router.post('/services', agentAuth, async (req, res, next) => {
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

    const { services } = req.body as { services: unknown[] };
    if (!Array.isArray(services)) return res.status(400).json({ error: 'services must be an array' });

    await db('devices')
      .where({ id: device.id })
      .update({ latest_services: JSON.stringify(services) });

    // Emit real-time update to all clients in this tenant room
    getIO().to(`tenant:${tenantId}`).emit(SocketEvents.DEVICE_SERVICES_UPDATED, {
      deviceId: device.id,
      services,
    });

    res.json({ ok: true, count: services.length });
  } catch (err) { next(err); }
});

// POST /api/agent/compliance
// Called by the agent after evaluating compliance rules for a policy.
// Stores rule-level results in compliance_results and emits a socket event.
router.post('/compliance', agentAuth, async (req, res, next) => {
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

    const { policyId, results, score } = req.body as {
      policyId?: number;
      results: any[];
      score: number;
    };

    // Ignore periodic scans without a real policy
    if (!policyId) {
      return res.json({ ok: true, stored: false, reason: 'no_policy_id' });
    }
    if (!Array.isArray(results)) {
      return res.status(400).json({ error: 'results must be an array' });
    }

    const stored = await complianceService.storeResults(
      device.id, tenantId, Number(policyId), results, score,
    );

    // Emit real-time update
    try {
      getIO().to(`tenant:${tenantId}`).emit(SocketEvents.COMPLIANCE_RESULT, stored);
    } catch {}

    res.json({ ok: true, stored: true, id: stored.id });
  } catch (err) { next(err); }
});

// POST /api/agent/software-compliance
// Called by the agent after evaluating software compliance for a list.
// Stores entry-level results in software_compliance_results and emits a socket event.
router.post('/software-compliance', agentAuth, async (req, res, next) => {
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

    const { listId, results, score } = req.body as {
      listId?: number;
      results: any[];
      score: number;
    };

    if (!listId) {
      return res.json({ ok: true, stored: false, reason: 'no_list_id' });
    }
    if (!Array.isArray(results)) {
      return res.status(400).json({ error: 'results must be an array' });
    }

    const stored = await softwareComplianceService.storeResults(
      device.id, tenantId, Number(listId), results, score,
    );

    // Emit real-time update
    try {
      getIO().to(`tenant:${tenantId}`).emit(SocketEvents.SOFTWARE_COMPLIANCE_RESULT, stored);
    } catch {}

    res.json({ ok: true, stored: true, id: stored.id });
  } catch (err) { next(err); }
});

// POST /api/agent/network-scan
// Called by the agent after a scan_network command completes.
// Upserts discovered network hosts into discovered_devices.
router.post('/network-scan', agentAuth, async (req, res, next) => {
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

    await networkDiscoveryService.processScanResults(tenantId, device.id, req.body.results || []);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── GET /api/agent/software-repo/:uuid — agent downloads an internal repo package ──
router.get('/software-repo/:uuid', agentAuth, async (req, res, next) => {
  try {
    const { softwareRepoService } = await import('../services/softwareRepo.service');
    // Honour the per-tenant depot toggle: a disabled depot blocks agent
    // downloads too (disable = block upload AND download).
    const agentTenantId = (req as any).agentTenantId as number | undefined;
    if (agentTenantId && !(await softwareRepoService.isEnabled(agentTenantId))) {
      return res.status(403).json({ error: 'Software repository is disabled for this tenant' });
    }
    const result = await softwareRepoService.getFilePath(req.params.uuid);
    if (!result) return res.status(404).json({ error: 'Package not found' });
    res.set('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.set('Content-Type', result.mimeType);
    res.sendFile(result.filePath);
  } catch (err) { next(err); }
});

// ── DELETE /api/agent/self — agent-initiated self-removal (uninstall flow) ────
router.delete('/self', agentAuth, async (req, res, next) => {
  try {
    const { device, tenantId } = req as any;
    await deviceService.deleteDevice(device.id, tenantId);
    logger.info(`Device ${device.uuid} self-deleted via uninstall command`);
    getIO().to(`tenant:${tenantId}`).emit(SocketEvents.DEVICE_DELETED, { id: device.id });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
