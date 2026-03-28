import type { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { deviceService } from '../services/device.service';
import { commandService } from '../services/command.service';
import { maintenanceService } from '../services/maintenance.service';
import { obligateService } from '../services/obligate.service';
import { db } from '../db';


// ── Push endpoint (called by agent) ──────────────────────────────────────────

export async function agentPush(req: Request, res: Response): Promise<void> {
  try {
    // agentApiKeyId and agentTenantId are set by agentAuth middleware
    const agentApiKeyId = (req as unknown as { agentApiKeyId: number; agentTenantId: number }).agentApiKeyId;
    const agentTenantId = (req as unknown as { agentApiKeyId: number; agentTenantId: number }).agentTenantId;
    const deviceUuid = req.headers['x-device-uuid'] as string | undefined;

    if (!deviceUuid) {
      res.status(400).json({ error: 'X-Device-UUID header required' });
      return;
    }

    const device = await deviceService.getDeviceByUuid(deviceUuid, agentTenantId);
    if (!device || device.apiKeyId !== agentApiKeyId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const result = await deviceService.handlePush(device.id, agentTenantId, req.body);
    // Register/update device UUID with Obligate for cross-app linking (non-blocking, idempotent)
    obligateService.registerDeviceLink(deviceUuid, `/devices/${device.id}`).catch(() => {});
    res.status(200).json(result);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// ── Pre-update notification (called by agent before self-updating) ────────────

export async function notifyingUpdate(req: Request, res: Response): Promise<void> {
  try {
    const agentApiKeyId = (req as unknown as { agentApiKeyId: number; agentTenantId: number }).agentApiKeyId;
    const agentTenantId = (req as unknown as { agentApiKeyId: number; agentTenantId: number }).agentTenantId;
    const deviceUuid = req.headers['x-device-uuid'] as string | undefined;
    if (!deviceUuid) {
      res.status(400).json({ error: 'X-Device-UUID header required' });
      return;
    }
    // Identify device — must belong to the authenticated API key
    const device = await deviceService.getDeviceByUuid(deviceUuid, agentTenantId);
    if (!device || device.apiKeyId !== agentApiKeyId) {
      res.status(404).json({ error: 'Device not found' });
      return;
    }
    // Mark the device as updating so the heartbeat monitor ignores missed pushes
    await db('devices').where({ id: device.id, tenant_id: agentTenantId }).update({
      status: 'updating',
      updated_at: new Date(),
    });
    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// ── Public: version + download ──────────────────────────────────────────────

function readVersionFile(filename: string): { version: string; buildDate?: string } | null {
  try {
    const versionPath = path.resolve(__dirname, '../../../../agent/dist', filename);
    if (!fs.existsSync(versionPath)) return null;
    const raw = fs.readFileSync(versionPath, 'utf-8');
    return JSON.parse(raw) as { version: string; buildDate?: string };
  } catch {
    return null;
  }
}

export function agentVersion(_req: Request, res: Response): void {
  try {
    // Primary: agent/VERSION plain-text (always present in Docker image)
    const vp = path.resolve(__dirname, '../../../../agent/VERSION');
    if (fs.existsSync(vp)) {
      const version = fs.readFileSync(vp, 'utf-8').trim();
      if (version) { res.json({ version }); return; }
    }
    // Fallback: version-agent.json built artefact
    const info = readVersionFile('version-agent.json');
    if (!info) throw new Error('version file not found');
    res.json(info);
  } catch {
    res.status(503).json({ error: 'Agent version info unavailable' });
  }
}

export function desktopVersion(_req: Request, res: Response): void {
  try {
    const info = readVersionFile('version-desktop.json');
    if (!info) throw new Error('version file not found');
    res.json(info);
  } catch {
    res.status(503).json({ error: 'Desktop version info unavailable' });
  }
}

const ALLOWED_AGENT_BINARIES: Record<string, string> = {
  // Windows: full MSI installer (handles service, PawnIO driver, etc.)
  'obliance-agent.msi':             'obliance-agent.msi',
  // Windows: bare exe (kept for manual / legacy use)
  'obliance-agent.exe':             'obliance-agent.exe',
  'obliance-agent-linux-amd64':     'obliance-agent-linux-amd64',
  'obliance-agent-linux-arm64':     'obliance-agent-linux-arm64',
  'obliance-agent-darwin-amd64':    'obliance-agent-darwin-amd64',
  'obliance-agent-darwin-arm64':    'obliance-agent-darwin-arm64',
  'obliance-agent-freebsd-amd64':  'obliance-agent-freebsd-amd64',
  // Oblireach agent (remote desktop streaming)
  'oblireach-agent.msi':            'oblireach-agent.msi',
  'oblireach-agent.exe':            'oblireach-agent.exe',
  'oblireach-agent-linux-amd64':    'oblireach-agent-linux-amd64',
  'oblireach-agent-darwin-amd64':   'oblireach-agent-darwin-amd64',
  'oblireach-agent-darwin-arm64':   'oblireach-agent-darwin-arm64',
};

export function agentDownload(req: Request, res: Response): void {
  const { filename } = req.params;

  const binaryName = ALLOWED_AGENT_BINARIES[filename];
  if (!binaryName) {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  const filePath = path.resolve(__dirname, '../../../../agent/dist', binaryName);

  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: 'Agent binary not available' });
    return;
  }

  // Compute and send SHA-256 hash so the agent can verify integrity after download
  const crypto = require('crypto');
  const fileBuffer = fs.readFileSync(filePath);
  const hash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('X-Content-SHA256', hash);
  res.sendFile(filePath);
}

export function agentInstallerLinux(req: Request, res: Response): void {
  const apiKey = req.query.key as string | undefined;

  const scriptPath = path.resolve(__dirname, '../../../../agent/installer/install.sh');
  if (!fs.existsSync(scriptPath)) {
    res.status(404).json({ error: 'Installer not available' });
    return;
  }

  let script = fs.readFileSync(scriptPath, 'utf-8');

  // Inject server URL and API key
  const serverUrl = `${req.protocol}://${req.get('host')}`;
  script = script.replace('__SERVER_URL__', serverUrl);
  if (apiKey) {
    script = script.replace('__API_KEY__', apiKey);
  }

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="install.sh"');
  res.send(script);
}

export function agentInstallerWindows(req: Request, res: Response): void {
  const apiKey = req.query.key as string | undefined;

  const scriptPath = path.resolve(__dirname, '../../../../agent/installer/install.ps1');
  if (!fs.existsSync(scriptPath)) {
    res.status(404).json({ error: 'Installer not available' });
    return;
  }

  let script = fs.readFileSync(scriptPath, 'utf-8');

  const serverUrl = `${req.protocol}://${req.get('host')}`;
  script = script.replace('__SERVER_URL__', serverUrl);
  if (apiKey) {
    script = script.replace('__API_KEY__', apiKey);
  }

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="install.ps1"');
  res.send(script);
}

export function agentInstallerMacos(req: Request, res: Response): void {
  const apiKey = req.query.key as string | undefined;

  const scriptPath = path.resolve(__dirname, '../../../../agent/installer/install-macos.sh');
  if (!fs.existsSync(scriptPath)) {
    res.status(404).json({ error: 'macOS installer not available' });
    return;
  }

  let script = fs.readFileSync(scriptPath, 'utf-8');

  const serverUrl = `${req.protocol}://${req.get('host')}`;
  script = script.replace('__SERVER_URL__', serverUrl);
  if (apiKey) {
    script = script.replace('__API_KEY__', apiKey);
  }

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="install-macos.sh"');
  res.send(script);
}

export function agentInstallerFreebsd(req: Request, res: Response): void {
  const apiKey = req.query.key as string | undefined;

  const scriptPath = path.resolve(__dirname, '../../../../agent/installer/install-freebsd.sh');
  if (!fs.existsSync(scriptPath)) {
    res.status(404).json({ error: 'FreeBSD installer not available' });
    return;
  }

  let script = fs.readFileSync(scriptPath, 'utf-8');

  const serverUrl = `${req.protocol}://${req.get('host')}`;
  script = script.replace('__SERVER_URL__', serverUrl);
  if (apiKey) {
    script = script.replace('__API_KEY__', apiKey);
  }

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="install-freebsd.sh"');
  res.send(script);
}

export function agentInstallerWindowsMsi(_req: Request, res: Response): void {
  const msiPath = path.resolve(__dirname, '../../../../agent/dist/obliance-agent.msi');
  if (!fs.existsSync(msiPath)) {
    res.status(404).json({ error: 'MSI installer not available (not yet built)' });
    return;
  }

  res.setHeader('Content-Type', 'application/x-msi');
  res.setHeader('Content-Disposition', 'attachment; filename="obliance-agent.msi"');
  res.sendFile(msiPath);
}

// ── Admin: API Keys ──────────────────────────────────────────────────────────

export async function listKeys(req: Request, res: Response): Promise<void> {
  const rows = await db('agent_api_keys')
    .where({ 'agent_api_keys.tenant_id': req.tenantId })
    .leftJoin('devices', function () {
      this.on('devices.api_key_id', '=', 'agent_api_keys.id')
          .andOn('devices.approval_status', db.raw("'approved'"));
    })
    .leftJoin('device_groups', 'device_groups.id', 'agent_api_keys.default_group_id')
    .groupBy('agent_api_keys.id', 'device_groups.name')
    .select(
      'agent_api_keys.*',
      db.raw('COUNT(devices.id)::int as device_count'),
      'device_groups.name as default_group_name',
    )
    .orderBy('agent_api_keys.created_at', 'desc');

  const data = rows.map((r: any) => ({
    id: r.id,
    tenantId: r.tenant_id,
    name: r.name,
    key: r.key,
    defaultGroupId: r.default_group_id ?? null,
    defaultGroupName: r.default_group_name ?? null,
    createdBy: r.created_by,
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at,
    deviceCount: r.device_count ?? 0,
  }));
  res.json({ success: true, data });
}

export async function createKey(req: Request, res: Response): Promise<void> {
  const { name, defaultGroupId } = req.body as { name: string; defaultGroupId?: number | null };
  if (!name?.trim()) {
    res.status(400).json({ success: false, error: 'Name is required' });
    return;
  }
  const userId = req.session?.userId ?? 0;
  const rawKey = crypto.randomBytes(32).toString('hex');
  const [row] = await db('agent_api_keys').insert({
    tenant_id: req.tenantId,
    name: name.trim(),
    key: rawKey,
    default_group_id: defaultGroupId ?? null,
    created_by: userId,
  }).returning('*');
  res.status(201).json({
    success: true,
    data: {
      id: row.id,
      tenantId: row.tenant_id,
      name: row.name,
      key: row.key,
      defaultGroupId: row.default_group_id ?? null,
      defaultGroupName: null,
      createdBy: row.created_by,
      createdAt: row.created_at,
      lastUsedAt: row.last_used_at ?? null,
      deviceCount: 0,
    },
  });
}

export async function updateKey(req: Request, res: Response): Promise<void> {
  const id = Number(req.params.id);
  const { name, defaultGroupId } = req.body as { name?: string; defaultGroupId?: number | null };
  const updates: any = {};
  if (name !== undefined) updates.name = name.trim();
  if (defaultGroupId !== undefined) updates.default_group_id = defaultGroupId;
  if (Object.keys(updates).length === 0) {
    res.status(400).json({ success: false, error: 'Nothing to update' });
    return;
  }
  const affected = await db('agent_api_keys')
    .where({ id, tenant_id: req.tenantId })
    .update(updates);
  if (!affected) { res.status(404).json({ success: false, error: 'Key not found' }); return; }
  res.json({ success: true });
}

export async function deleteKey(req: Request, res: Response): Promise<void> {
  const id = Number(req.params.id);
  const deleted = await db('agent_api_keys')
    .where({ id, tenant_id: req.tenantId })
    .delete();
  if (!deleted) {
    res.status(404).json({ success: false, error: 'API key not found' });
    return;
  }
  res.json({ success: true });
}

// ── Admin: Devices ──────────────────────────────────────────────────────────

export async function getDevice(req: Request, res: Response): Promise<void> {
  const id = Number(req.params.id);
  const device = await deviceService.getDeviceById(id, req.tenantId);
  if (!device) {
    res.status(404).json({ success: false, error: 'Device not found' });
    return;
  }
  const inMaintenance = await maintenanceService.isInMaintenance('device', id, device.groupId);
  res.json({ success: true, data: { ...device, inMaintenance } });
}

export async function listDevices(req: Request, res: Response): Promise<void> {
  const status = req.query.status as string | undefined;
  const validStatuses = ['pending', 'approved', 'refused', 'suspended'];
  const devices = await deviceService.getDevicesList(
    req.tenantId,
    validStatuses.includes(status ?? '') ? { status } : undefined,
  );

  // Batch resolve maintenance state using the service (cached, includes global + group + own)
  const enriched = await Promise.all(devices.map(async (d) => {
    const inMaintenance = await maintenanceService.isInMaintenance('device', d.id, d.groupId);
    return { ...d, inMaintenance };
  }));

  res.json({ success: true, data: enriched });
}

export async function updateDevice(req: Request, res: Response): Promise<void> {
  const id = Number(req.params.id);
  const {
    status, groupId, checkIntervalSeconds, agentThresholds, name,
    heartbeatMonitoring, sensorDisplayNames, overrideGroupSettings, displayConfig,
    notificationTypes,
  } = req.body as {
    status?: 'approved' | 'refused' | 'pending' | 'suspended';
    groupId?: number | null;
    checkIntervalSeconds?: number;
    agentThresholds?: Record<string, unknown>;
    name?: string | null;
    heartbeatMonitoring?: boolean;
    sensorDisplayNames?: Record<string, string> | null;
    overrideGroupSettings?: boolean;
    displayConfig?: import('@obliance/shared').DeviceDisplayConfig | null;
    notificationTypes?: import('@obliance/shared').DeviceNotificationTypes | null;
  };

  // Special handling for approval
  if (status === 'approved') {
    const currentDevice = await deviceService.getDeviceById(id, req.tenantId);
    if (!currentDevice) {
      res.status(404).json({ success: false, error: 'Device not found' });
      return;
    }

    if (currentDevice.status === 'suspended') {
      // Reinstate a suspended device: re-activate its monitor, no new monitor created
      await db('devices').where({ id, tenant_id: req.tenantId }).update({
        approval_status: 'approved',
        status: 'offline',
        updated_at: new Date(),
      });
      const updates: Record<string, unknown> = {};
      if (name !== undefined) updates.displayName = name;
      if (heartbeatMonitoring !== undefined) updates.heartbeatMonitoring = heartbeatMonitoring;
      const device = Object.keys(updates).length > 0
        ? await deviceService.updateDevice(id, req.tenantId, updates)
        : await deviceService.getDeviceById(id, req.tenantId);
      res.json({ success: true, data: device });
      return;
    }

    // First-time approval (pending → approved): create monitor
    const userId = req.session?.userId ?? 0;
    const device = await deviceService.approveDevice(id, req.tenantId, userId);
    if (!device) {
      res.status(404).json({ success: false, error: 'Device not found' });
      return;
    }
    // Apply name/heartbeatMonitoring/groupId/agentThresholds if provided alongside approval
    const approvalUpdates: Record<string, unknown> = {};
    if (name !== undefined) approvalUpdates.displayName = name;
    if (heartbeatMonitoring !== undefined) approvalUpdates.heartbeatMonitoring = heartbeatMonitoring;
    if (groupId !== undefined) approvalUpdates.groupId = groupId;
    if (agentThresholds !== undefined) approvalUpdates.customFields = agentThresholds as Record<string, string>;
    if (Object.keys(approvalUpdates).length > 0) {
      await deviceService.updateDevice(id, req.tenantId, approvalUpdates);
    }
    res.json({ success: true, data: device });
    return;
  }

  // Suspend: update status in DB
  if (status === 'suspended') {
    await db('devices').where({ id, tenant_id: req.tenantId }).update({
      approval_status: 'suspended',
      status: 'suspended',
      updated_at: new Date(),
    });
  }

  const updateData: Record<string, unknown> = {};
  if (groupId !== undefined) updateData.groupId = groupId;
  if (checkIntervalSeconds !== undefined) updateData.pushIntervalSeconds = checkIntervalSeconds;
  if (sensorDisplayNames !== undefined) updateData.sensorDisplayNames = sensorDisplayNames;
  if (overrideGroupSettings !== undefined) updateData.overrideGroupSettings = overrideGroupSettings;
  if (displayConfig !== undefined) updateData.displayConfig = displayConfig;
  if ('notificationTypes' in req.body) updateData.notificationTypes = notificationTypes;
  if (name !== undefined) updateData.displayName = name;
  // agentThresholds stored in customFields as a best-effort mapping
  if (agentThresholds !== undefined) updateData.customFields = agentThresholds as Record<string, string>;

  const device = await deviceService.updateDevice(id, req.tenantId, updateData);

  if (!device) {
    res.status(404).json({ success: false, error: 'Device not found' });
    return;
  }

  res.json({ success: true, data: device });
}

// ── Admin: Device Metrics ────────────────────────────────────────────────────

export async function getDeviceMetrics(req: Request, res: Response): Promise<void> {
  const id = Number(req.params.id);
  // Return the latest_metrics stored on the device row
  const device = await deviceService.getDeviceById(id, req.tenantId);
  if (!device) {
    res.status(404).json({ success: false, error: 'No metrics available yet for this device' });
    return;
  }
  const metrics = device.latestMetrics;
  if (!metrics || Object.keys(metrics).length === 0) {
    res.status(404).json({ success: false, error: 'No metrics available yet for this device' });
    return;
  }
  res.json({
    success: true,
    data: {
      receivedAt: device.lastPushAt,
      metrics,
    },
  });
}

export async function deleteDevice(req: Request, res: Response): Promise<void> {
  const id = Number(req.params.id);
  // Verify exists first so we can return 404 properly
  const existing = await deviceService.getDeviceById(id, req.tenantId);
  if (!existing) {
    res.status(404).json({ success: false, error: 'Device not found' });
    return;
  }
  await deviceService.deleteDevice(id, req.tenantId);
  res.json({ success: true });
}

// ── Admin: Bulk Device Operations ────────────────────────────────────────────

export async function bulkDeleteDevices(req: Request, res: Response): Promise<void> {
  const { deviceIds } = req.body as { deviceIds: number[] };
  if (!Array.isArray(deviceIds) || deviceIds.length === 0) {
    res.status(400).json({ success: false, error: 'deviceIds array required' });
    return;
  }
  await deviceService.bulkDelete(deviceIds, req.tenantId);
  res.json({ success: true });
}

export async function bulkUpdateDevices(req: Request, res: Response): Promise<void> {
  const { deviceIds, groupId, heartbeatMonitoring, overrideGroupSettings, status } = req.body as {
    deviceIds: number[];
    groupId?: number | null;
    heartbeatMonitoring?: boolean;
    overrideGroupSettings?: boolean;
    status?: 'approved' | 'suspended';
  };
  if (!Array.isArray(deviceIds) || deviceIds.length === 0) {
    res.status(400).json({ success: false, error: 'deviceIds array required' });
    return;
  }

  const updates: Record<string, unknown> = { updated_at: new Date() };
  if (groupId !== undefined) updates.group_id = groupId;
  if (overrideGroupSettings !== undefined) updates.override_group_settings = overrideGroupSettings;
  if (status !== undefined) {
    updates.status = status;
    if (status === 'approved') updates.approval_status = 'approved';
    if (status === 'suspended') updates.approval_status = 'suspended';
  }

  if (Object.keys(updates).length > 1) {
    await db('devices')
      .whereIn('id', deviceIds)
      .where({ tenant_id: req.tenantId })
      .update(updates);
  }

  res.json({ success: true });
}

export async function bulkDeviceCommand(req: Request, res: Response): Promise<void> {
  const { deviceIds, command } = req.body as { deviceIds: number[]; command: string };
  if (!Array.isArray(deviceIds) || deviceIds.length === 0) {
    res.status(400).json({ success: false, error: 'deviceIds array required' });
    return;
  }
  if (!command) {
    res.status(400).json({ success: false, error: 'command required' });
    return;
  }
  const userId = req.session?.userId ?? 0;
  await Promise.all(deviceIds.map((deviceId) =>
    commandService.enqueue({
      deviceId,
      tenantId: req.tenantId,
      type: command as import('@obliance/shared').CommandType,
      priority: 'normal',
      createdBy: userId,
    }),
  ));
  res.json({ success: true });
}

export async function sendDeviceCommand(req: Request, res: Response): Promise<void> {
  const id = Number(req.params.id);
  const { command } = req.body as { command: string };
  if (!command) {
    res.status(400).json({ success: false, error: 'command required' });
    return;
  }
  const device = await deviceService.getDeviceById(id, req.tenantId);
  if (!device) {
    res.status(404).json({ success: false, error: 'Device not found' });
    return;
  }
  const userId = req.session?.userId ?? 0;
  await commandService.enqueue({
    deviceId: id,
    tenantId: req.tenantId,
    type: command as import('@obliance/shared').CommandType,
    priority: 'normal',
    createdBy: userId,
  });
  res.json({ success: true });
}
