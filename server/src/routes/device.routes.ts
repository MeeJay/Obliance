import { Router } from 'express';
import dns from 'dns/promises';
import { deviceService } from '../services/device.service';
import { commandService } from '../services/command.service';
import { requireRole, requireDeviceRead, requireDeviceWrite } from '../middleware/rbac';
import { permissionService } from '../services/permission.service';
import { AppError } from '../middleware/errorHandler';
import { db } from '../db';
import { getIO } from '../socket';
import { SocketEvents } from '@obliance/shared';
import { scenarioService } from '../services/scenario.service';
import { logger } from '../utils/logger';

const router = Router();

// ── Static / collection routes (must come before /:id routes) ─────────────────

// GET /api/devices
router.get('/', async (req, res, next) => {
  try {
    const { groupId, includeSubgroups, status, approvalStatus, search, osType, page, pageSize, sortBy, sortOrder } = req.query as any;

    const result = await deviceService.getDevices(req.tenantId!, {
      groupId: groupId ? parseInt(groupId) : undefined,
      includeSubgroups: includeSubgroups === 'true',
      status, approvalStatus, search, osType,
      page: page ? parseInt(page) : undefined,
      pageSize: pageSize ? parseInt(pageSize) : undefined,
      sortBy, sortOrder,
    });

    // Filter by visible devices for non-admins
    if (req.session.role !== 'admin') {
      const visible = await permissionService.getVisibleDeviceIds(req.session.userId!, false);
      if (Array.isArray(visible)) {
        const visibleSet = new Set(visible);
        result.items = result.items.filter((d: any) => visibleSet.has(d.id));
        result.total = result.items.length;
      }
    }

    res.json({ data: result });
  } catch (err) { next(err); }
});

// GET /api/devices/export
router.get('/export', async (req, res, next) => {
  try {
    const { format, groupId, includeSubgroups, status, approvalStatus, search, osType, sortBy, sortOrder } = req.query as any;
    const fmt = (format ?? 'csv').toString().toLowerCase();
    if (!['csv', 'xlsx', 'pdf'].includes(fmt)) {
      return res.status(400).json({ error: 'Invalid format (csv|xlsx|pdf)' });
    }

    let devices = await deviceService.exportDevices(req.tenantId!, {
      groupId: groupId ? parseInt(groupId) : undefined,
      includeSubgroups: includeSubgroups === 'true',
      status, approvalStatus, search, osType, sortBy, sortOrder,
    });

    // Non-admins: filter to visible devices only
    if (req.session.role !== 'admin') {
      const visible = await permissionService.getVisibleDeviceIds(req.session.userId!, false);
      if (Array.isArray(visible)) {
        const visibleSet = new Set(visible);
        devices = devices.filter((d: any) => visibleSet.has(d.id));
      }
    }

    const ts = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
    const baseName = `obliance-devices-${ts}`;

    // Rows for the export — stable column order
    const columns = [
      { header: 'Hostname',       key: 'hostname',      width: 24 },
      { header: 'Display Name',   key: 'displayName',   width: 24 },
      { header: 'Status',         key: 'status',        width: 12 },
      { header: 'OS',             key: 'osName',        width: 18 },
      { header: 'OS Version',     key: 'osVersion',     width: 16 },
      { header: 'Architecture',   key: 'osArch',        width: 10 },
      { header: 'Agent Version',  key: 'agentVersion',  width: 12 },
      { header: 'Group',          key: 'groupName',     width: 20 },
      { header: 'Local IP',       key: 'ipLocal',       width: 16 },
      { header: 'Public IP',      key: 'ipPublic',      width: 16 },
      { header: 'MAC Address',    key: 'macAddress',    width: 18 },
      { header: 'Last Seen',      key: 'lastSeenAt',    width: 22 },
      { header: 'Last User',      key: 'lastLoggedInUser', width: 18 },
      { header: 'Agent UUID',     key: 'uuid',          width: 38 },
    ];

    const rows = devices.map((d: any) => ({
      hostname:         d.hostname ?? '',
      displayName:      d.displayName ?? '',
      status:           d.status ?? '',
      osName:           d.osName ?? d.osType ?? '',
      osVersion:        d.osVersion ?? '',
      osArch:           d.osArch ?? '',
      agentVersion:     d.agentVersion ?? '',
      groupName:        d.groupName ?? '',
      ipLocal:          d.ipLocal ?? '',
      ipPublic:         d.ipPublic ?? '',
      macAddress:       d.macAddress ?? '',
      lastSeenAt:       d.lastSeenAt ?? '',
      lastLoggedInUser: d.lastLoggedInUser ?? '',
      uuid:             d.uuid ?? '',
    }));

    const ExcelJS = (await import('exceljs')).default;

    if (fmt === 'csv') {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Devices');
      ws.columns = columns;
      rows.forEach((r) => ws.addRow(r));
      const buffer = await wb.csv.writeBuffer();
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${baseName}.csv"`);
      return res.send(Buffer.from(buffer as any));
    }

    if (fmt === 'xlsx') {
      const wb = new ExcelJS.Workbook();
      wb.creator = 'Obliance';
      wb.created = new Date();
      const ws = wb.addWorksheet('Devices');
      ws.columns = columns;
      ws.getRow(1).font = { bold: true };
      ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } };
      ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      rows.forEach((r) => ws.addRow(r));
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
      const buffer = await wb.xlsx.writeBuffer();
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${baseName}.xlsx"`);
      return res.send(Buffer.from(buffer as any));
    }

    // PDF via playwright (renders an HTML table to PDF).
    const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
    const headHtml = columns.map((c) => `<th>${escapeHtml(c.header)}</th>`).join('');
    const rowsHtml = rows.map((r) =>
      `<tr>${columns.map((c) => `<td>${escapeHtml(String((r as any)[c.key] ?? ''))}</td>`).join('')}</tr>`
    ).join('');
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Devices</title><style>
body { font-family: -apple-system, Segoe UI, sans-serif; font-size: 9px; color: #111; margin: 20px; }
h1 { font-size: 14px; margin: 0 0 12px; }
.meta { font-size: 8px; color: #666; margin-bottom: 12px; }
table { width: 100%; border-collapse: collapse; }
th, td { border: 1px solid #ddd; padding: 4px 6px; text-align: left; vertical-align: top; }
th { background: #1f2937; color: white; font-weight: 600; }
tr:nth-child(even) td { background: #f9fafb; }
</style></head><body>
<h1>Obliance — Devices export</h1>
<div class="meta">${devices.length} devices · generated ${new Date().toISOString()}</div>
<table><thead><tr>${headHtml}</tr></thead><tbody>${rowsHtml}</tbody></table>
</body></html>`;

    const { chromium } = await import('playwright-chromium');
    const browser = await chromium.launch({ args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'domcontentloaded' });
      const pdf = await page.pdf({ format: 'A4', landscape: true, margin: { top: '15mm', bottom: '15mm', left: '10mm', right: '10mm' }, printBackground: true });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${baseName}.pdf"`);
      return res.send(pdf);
    } finally {
      await browser.close();
    }
  } catch (err) { next(err); }
});

// GET /api/devices/summary
router.get('/summary', async (req, res, next) => {
  try {
    const summary = await deviceService.getFleetSummary(req.tenantId!);
    res.json({ data: summary });
  } catch (err) { next(err); }
});

// GET /api/devices/group-stats — stats per group for dashboard
router.get('/group-stats', async (req, res, next) => {
  try {
    const tenantId = req.tenantId!;

    // Device counts per group + status
    const deviceRows = await db('devices')
      .where({ tenant_id: tenantId, approval_status: 'approved' })
      .whereNot({ status: 'pending_uninstall' })
      .select('group_id', 'status')
      .count('* as count')
      .groupBy('group_id', 'status');

    // Compliance scores per group (latest per device)
    const complianceRows = await db.raw(`
      SELECT d.group_id,
             ROUND(AVG(cr.compliance_score)::numeric, 1) as avg_score,
             COUNT(DISTINCT cr.policy_id) as policy_count
      FROM compliance_results cr
      JOIN devices d ON d.id = cr.device_id
      WHERE d.tenant_id = ? AND d.approval_status = 'approved'
        AND cr.id IN (
          SELECT DISTINCT ON (device_id, policy_id) id
          FROM compliance_results
          WHERE tenant_id = ?
          ORDER BY device_id, policy_id, checked_at DESC
        )
      GROUP BY d.group_id
    `, [tenantId, tenantId]);

    // Pending updates per group
    const updateRows = await db.raw(`
      SELECT d.group_id, COUNT(DISTINCT du.device_id) as devices_with_updates
      FROM device_updates du
      JOIN devices d ON d.id = du.device_id
      WHERE d.tenant_id = ? AND du.status = 'available'
      GROUP BY d.group_id
    `, [tenantId]);

    // Group names
    const groups = await db('device_groups')
      .where({ tenant_id: tenantId })
      .select('id', 'name', 'parent_id');

    // Build stats map
    const statsMap = new Map<number | null, any>();

    const getOrCreate = (gid: number | null) => {
      if (!statsMap.has(gid)) {
        statsMap.set(gid, { groupId: gid, groupName: null, online: 0, offline: 0, warning: 0, critical: 0, total: 0, complianceScore: null, policyCount: 0, pendingUpdates: 0 });
      }
      return statsMap.get(gid)!;
    };

    for (const row of deviceRows) {
      const s = getOrCreate(Number(row.group_id));
      const count = parseInt(String(row.count));
      s.total += count;
      if (row.status === 'online') s.online += count;
      else if (row.status === 'offline') s.offline += count;
      else if (row.status === 'warning') s.warning += count;
      else if (row.status === 'critical') s.critical += count;
    }

    for (const row of (complianceRows.rows ?? complianceRows)) {
      const s = getOrCreate(row.group_id);
      s.complianceScore = parseFloat(row.avg_score);
      s.policyCount = parseInt(row.policy_count);
    }

    for (const row of (updateRows.rows ?? updateRows)) {
      const s = getOrCreate(row.group_id);
      s.pendingUpdates = parseInt(row.devices_with_updates);
    }

    // Set group names
    const groupMap = new Map(groups.map((g: any) => [g.id, g.name]));
    for (const [gid, stats] of statsMap) {
      stats.groupName = gid ? (groupMap.get(gid) ?? 'Unknown') : null;
    }

    res.json({ data: Array.from(statsMap.values()).sort((a: any, b: any) => b.total - a.total) });
  } catch (err) { next(err); }
});

// POST /api/devices/bulk/approve
router.post('/bulk/approve', requireRole('admin'), async (req, res, next) => {
  try {
    const { ids, deviceIds } = req.body;
    const list = ids ?? deviceIds ?? [];
    await deviceService.bulkApprove(list, req.tenantId!, req.session.userId!);
    res.json({ success: true, count: list.length });
  } catch (err) { next(err); }
});

// DELETE /api/devices/bulk/delete
router.delete('/bulk/delete', requireRole('admin'), async (req, res, next) => {
  try {
    const { ids, deviceIds } = req.body;
    const list = ids ?? deviceIds ?? [];
    await deviceService.bulkDelete(list, req.tenantId!);
    res.json({ success: true });
  } catch (err) { next(err); }
});

// POST /api/devices/batch — batch action by group or device IDs
router.post('/batch', requireRole('admin'), async (req, res, next) => {
  try {
    const { groupId, deviceIds, action } = req.body as {
      groupId?: number; deviceIds?: number[];
      action: 'restart_agent' | 'reboot' | 'shutdown' | 'sleep' | 'scan_inventory' | 'scan_updates' | 'check_compliance';
    };
    if (!action) return res.status(400).json({ error: 'action required' });

    let ids: number[] = deviceIds ?? [];
    if (groupId && !deviceIds?.length) {
      const rows = await db('devices')
        .where({ tenant_id: req.tenantId!, group_id: groupId, approval_status: 'approved' })
        .whereNot({ status: 'suspended' })
        .select('id');
      ids = rows.map((r: any) => r.id);
    }
    if (!ids.length) return res.json({ data: { dispatched: 0 } });

    let dispatched = 0;
    for (const deviceId of ids) {
      await commandService.enqueue({
        deviceId,
        tenantId: req.tenantId!,
        type: action as any,
        priority: 'normal',
        createdBy: req.session.userId,
      });
      dispatched++;
    }
    res.json({ data: { dispatched } });
  } catch (err) { next(err); }
});

// ── Single-device routes (:id) ────────────────────────────────────────────────

// GET /api/devices/:id
router.get('/:id', requireDeviceRead(), async (req, res, next) => {
  try {
    const device = await deviceService.getDeviceById(parseInt(req.params.id), req.tenantId!);
    if (!device) return res.status(404).json({ error: 'Device not found' });
    res.json({ data: device });
  } catch (err) { next(err); }
});

// PATCH /api/devices/:id
router.patch('/:id', requireDeviceWrite(), async (req, res, next) => {
  try {
    const deviceId = parseInt(req.params.id);
    // Check if group is changing so we can fire a scenario trigger
    const hadGroupChange = req.body.groupId !== undefined;
    const device = await deviceService.updateDevice(deviceId, req.tenantId!, req.body);
    if (!device) return res.status(404).json({ error: 'Device not found' });
    // Fire scenario trigger when device joins a new group
    if (hadGroupChange && device.groupId) {
      scenarioService.fireTrigger('group_join', deviceId, req.tenantId!, { groupId: device.groupId }).catch(err => {
        logger.error({ err, deviceId }, 'Failed to fire group_join scenario trigger');
      });
    }
    res.json({ data: device });
  } catch (err) { next(err); }
});

// GET /api/devices/:id/services
router.get('/:id/services', requireDeviceRead(), async (req, res, next) => {
  try {
    const deviceId = parseInt(req.params.id);
    const device = await db('devices')
      .where({ id: deviceId, tenant_id: req.tenantId! })
      .select('latest_services')
      .first();
    if (!device) return res.status(404).json({ error: 'Device not found' });
    const services = device.latest_services ?? [];
    res.json({ data: services });
  } catch (err) { next(err); }
});

// POST /api/devices/:id/approve
router.post('/:id/approve', requireRole('admin'), async (req, res, next) => {
  try {
    const device = await deviceService.approveDevice(
      parseInt(req.params.id), req.tenantId!, req.session.userId!
    );
    // Fire scenario trigger for newly approved agent
    if (device) {
      scenarioService.fireTrigger('agent_approved', device.id, req.tenantId!).catch(err => {
        logger.error({ err, deviceId: device.id }, 'Failed to fire agent_approved scenario trigger');
      });
    }
    res.json({ data: device });
  } catch (err) { next(err); }
});

// POST /api/devices/:id/refuse
router.post('/:id/refuse', requireRole('admin'), async (req, res, next) => {
  try {
    const device = await deviceService.refuseDevice(parseInt(req.params.id), req.tenantId!);
    res.json({ data: device });
  } catch (err) { next(err); }
});

// POST /api/devices/:id/suspend
router.post('/:id/suspend', requireRole('admin'), async (req, res, next) => {
  try {
    const device = await deviceService.suspendDevice(parseInt(req.params.id), req.tenantId!);
    if (!device) return res.status(404).json({ error: 'Device not found' });
    res.json({ data: device });
  } catch (err) { next(err); }
});

// POST /api/devices/:id/unsuspend
router.post('/:id/unsuspend', requireRole('admin'), async (req, res, next) => {
  try {
    const device = await deviceService.unsuspendDevice(parseInt(req.params.id), req.tenantId!);
    if (!device) return res.status(404).json({ error: 'Device not found' });
    res.json({ data: device });
  } catch (err) { next(err); }
});

// POST /api/devices/:id/privacy-mode/disable — send disable_privacy_mode command to agent
router.post('/:id/privacy-mode/disable', requireRole('admin'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    const device = await deviceService.getDeviceById(id, req.tenantId!);
    if (!device) return res.status(404).json({ error: 'Device not found' });
    const cmd = await commandService.enqueue({
      deviceId: id,
      tenantId: req.tenantId!,
      type: 'disable_privacy_mode',
      priority: 'high',
      expiresInSeconds: 300,
      createdBy: req.session.userId,
    });
    res.json({ data: cmd });
  } catch (err) { next(err); }
});

// POST /api/devices/:id/airgap/enable — enable airgap mode on device
router.post('/:id/airgap/enable', requireRole('admin'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    const device = await deviceService.getDeviceById(id, req.tenantId!);
    if (!device) return res.status(404).json({ error: 'Device not found' });

    // Resolve server hostname to IPs so the agent knows which IPs to allow
    const serverUrl = process.env.SERVER_URL || `${req.protocol}://${req.get('host')}`;
    const hostname = new URL(serverUrl).hostname;
    let serverIPs: string[] = [];
    try { serverIPs.push(...await dns.resolve4(hostname)); } catch {}
    try { serverIPs.push(...await dns.resolve6(hostname)); } catch {}

    await commandService.enqueue({
      deviceId: id,
      tenantId: req.tenantId!,
      type: 'enable_airgap' as any,
      payload: { serverIPs },
      priority: 'high',
      expiresInSeconds: 300,
      createdBy: req.session.userId,
    });

    await db('devices').where({ id, tenant_id: req.tenantId! }).update({
      airgap_enabled: true,
      airgap_enabled_at: new Date(),
      updated_at: new Date(),
    });

    getIO().to(`tenant:${req.tenantId}`).emit(SocketEvents.DEVICE_UPDATED, { id, airgapEnabled: true, airgapEnabledAt: new Date().toISOString() });
    res.json({ data: { success: true } });
  } catch (err) { next(err); }
});

// POST /api/devices/:id/airgap/disable — disable airgap mode on device
router.post('/:id/airgap/disable', requireRole('admin'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    const device = await deviceService.getDeviceById(id, req.tenantId!);
    if (!device) return res.status(404).json({ error: 'Device not found' });

    await commandService.enqueue({
      deviceId: id,
      tenantId: req.tenantId!,
      type: 'disable_airgap' as any,
      priority: 'high',
      expiresInSeconds: 300,
      createdBy: req.session.userId,
    });

    await db('devices').where({ id, tenant_id: req.tenantId! }).update({
      airgap_enabled: false,
      airgap_enabled_at: null,
      updated_at: new Date(),
    });

    getIO().to(`tenant:${req.tenantId}`).emit(SocketEvents.DEVICE_UPDATED, { id, airgapEnabled: false, airgapEnabledAt: null });
    res.json({ data: { success: true } });
  } catch (err) { next(err); }
});

// POST /api/devices/:id/uninstall — mark as pending_uninstall + send uninstall command to agent
router.post('/:id/uninstall', requireRole('admin'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    const device = await deviceService.initiateUninstall(id, req.tenantId!);
    if (!device) return res.status(404).json({ error: 'Device not found' });
    // Fire-and-forget — best effort; if agent is offline it'll receive it when it reconnects
    commandService.enqueue({
      deviceId: id, tenantId: req.tenantId!,
      type: 'uninstall_agent', payload: {},
      priority: 'urgent', expiresInSeconds: 600,
      createdBy: req.session.userId,
    }).catch(() => { /* ignore enqueue errors */ });
    res.json({ data: device });
  } catch (err) { next(err); }
});

// POST /api/devices/:id/cancel-uninstall — abort a pending uninstall, restore to offline
router.post('/:id/cancel-uninstall', requireRole('admin'), async (req, res, next) => {
  try {
    const device = await deviceService.cancelUninstall(parseInt(req.params.id), req.tenantId!);
    if (!device) return res.status(404).json({ error: 'Device not found' });
    res.json({ data: device });
  } catch (err) { next(err); }
});

// DELETE /api/devices/:id
router.delete('/:id', requireRole('admin'), async (req, res, next) => {
  try {
    await deviceService.deleteDevice(parseInt(req.params.id), req.tenantId!);
    res.status(204).send();
  } catch (err) { next(err); }
});

export default router;
