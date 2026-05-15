import { Router } from 'express';
import dns from 'dns/promises';
import { deviceService } from '../services/device.service';
import { customMetricService } from '../services/customMetric.service';
import { customSectionService } from '../services/customSection.service';
import { commandService } from '../services/command.service';
import { requireRole, requireDeviceRead, requireDeviceWrite, requireTenantCapability } from '../middleware/rbac';
import { permissionService } from '../services/permission.service';
import { AppError } from '../middleware/errorHandler';
import { db } from '../db';
import { getIO } from '../socket';
import { SocketEvents, isMasterTenant } from '@obliance/shared';
import { scenarioService } from '../services/scenario.service';
import { logger } from '../utils/logger';

const router = Router();

// ── Static / collection routes (must come before /:id routes) ─────────────────

// GET /api/devices
router.get('/', async (req, res, next) => {
  try {
    const { groupId, includeSubgroups, status, approvalStatus, search, osType, osName, osVersion, page, pageSize, sortBy, sortOrder, ungrouped, staleHours, pendingUpdates, tags, tenantIds } = req.query as any;

    // Tags arrive either as repeated query params (`?tags=a&tags=b`)
    // → already an array — or as a comma-separated string. Normalise.
    let tagsArr: string[] | undefined;
    if (Array.isArray(tags)) tagsArr = tags.map(String).filter(Boolean);
    else if (typeof tags === 'string' && tags.length > 0) tagsArr = tags.split(',').map((t) => t.trim()).filter(Boolean);

    // Same parsing rules for `tenantIds` (master only — service drops
    // it for non-master callers).
    let tenantIdsArr: number[] | undefined;
    if (Array.isArray(tenantIds)) tenantIdsArr = tenantIds.map((v) => parseInt(String(v))).filter(Number.isFinite);
    else if (typeof tenantIds === 'string' && tenantIds.length > 0) {
      tenantIdsArr = tenantIds.split(',').map((v: string) => parseInt(v.trim())).filter(Number.isFinite);
    }

    const result = await deviceService.getDevices(req.tenantId!, {
      groupId: groupId ? parseInt(groupId) : undefined,
      includeSubgroups: includeSubgroups === 'true',
      status, approvalStatus, search, osType, osName, osVersion,
      page: page ? parseInt(page) : undefined,
      pageSize: pageSize ? parseInt(pageSize) : undefined,
      sortBy, sortOrder,
      ungrouped: ungrouped === 'true' || ungrouped === true,
      staleHours: staleHours ? parseInt(staleHours) : undefined,
      pendingUpdates: pendingUpdates === 'true' || pendingUpdates === '1' || pendingUpdates === true,
      tags: tagsArr,
      tenantIds: tenantIdsArr,
    });

    // Filter by visible devices for non-admins. The visibility set
    // now includes pre-approval devices "claimed" via their API key's
    // default group + devices in the catch-all `ungrouped` scope —
    // see permissionService.getVisibleDeviceIds for the full ruleset.
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
    const { format, groupId, includeSubgroups, status, approvalStatus, search, osType, sortBy, sortOrder, ungrouped } = req.query as any;
    const fmt = (format ?? 'csv').toString().toLowerCase();
    if (!['csv', 'xlsx', 'pdf'].includes(fmt)) {
      return res.status(400).json({ error: 'Invalid format (csv|xlsx|pdf)' });
    }

    let devices = await deviceService.exportDevices(req.tenantId!, {
      groupId: groupId ? parseInt(groupId) : undefined,
      includeSubgroups: includeSubgroups === 'true',
      status, approvalStatus, search, osType, sortBy, sortOrder,
      ungrouped: ungrouped === 'true' || ungrouped === true,
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

// GET /api/devices/fleet-timeseries?days=14
// Returns daily online/offline/total/pendingUpdates/stale72/critical for the
// last N days. Used by the dashboard hero sparklines and the "Activité du
// parc" chart. The current-day point is always synthesized from live state
// (no waiting for the nightly snapshot job).
router.get('/fleet-timeseries', async (req, res, next) => {
  try {
    const days = Math.min(parseInt(String(req.query.days ?? '14')) || 14, 90);
    const series = await deviceService.getFleetTimeseries(req.tenantId!, days);
    res.json({ data: series });
  } catch (err) { next(err); }
});

// GET /api/devices/fleet-hourly?hours=24
// Hourly granularity timeseries for the dashboard "Activité du parc" 24h
// view. Returns one point per hour (capped 7d), each with total / online /
// offline / pending_updates / stale_72h.
router.get('/fleet-hourly', async (req, res, next) => {
  try {
    const hours = Math.min(168, Math.max(2, parseInt(String(req.query.hours ?? '24')) || 24));
    const series = await deviceService.getFleetHourlySeries(req.tenantId!, hours);
    res.json({ data: series });
  } catch (err) { next(err); }
});

// GET /api/devices/agent-versions
// Top N agent versions by device count. Used by the dashboard "Top versions
// agent" mini chart so admins spot devices stuck on old auto-update cycles.
router.get('/agent-versions', async (req, res, next) => {
  try {
    const versions = await deviceService.getAgentVersionDistribution(req.tenantId!);
    res.json({ data: versions });
  } catch (err) { next(err); }
});

// GET /api/devices/os-facets
// Grouped facets used by the /devices 3-tier OS filter (family → name → build).
// Returns one row per (osType, osName, osVersion) triplet with a count, so the
// client can render dropdowns showing only options that actually have devices.
router.get('/os-facets', async (req, res, next) => {
  try {
    const facets = await deviceService.getOsFacets(req.tenantId!);
    res.json({ data: facets });
  } catch (err) { next(err); }
});

// GET /api/devices/tags
// Distinct tag list for the tenant with per-tag device counts. Drives the
// /devices tag-filter chip popover so admins pick from existing tags
// (typo-free) rather than retyping. Returns [{ tag, count }] desc by count.
router.get('/tags', async (req, res, next) => {
  try {
    const tags = await deviceService.getTagFacets(req.tenantId!);
    res.json({ data: tags });
  } catch (err) { next(err); }
});

// GET /api/devices/disk-saturated?threshold=0
// Devices whose latest hardware snapshot reports any disk above their
// resolved per-device threshold (Lot D.2). The optional `threshold` query
// param is a floor — useful when the dashboard wants a single "show me
// anything ≥ N" override regardless of per-group/per-device settings.
router.get('/disk-saturated', async (req, res, next) => {
  try {
    const threshold = Math.min(Math.max(parseInt(String(req.query.threshold ?? '0')) || 0, 0), 99);
    const result = await deviceService.getDiskSaturation(req.tenantId!, threshold);
    res.json({ data: result });
  } catch (err) { next(err); }
});

// GET /api/devices/group-stats — stats per group for dashboard
router.get('/group-stats', async (req, res, next) => {
  try {
    const tenantId = req.tenantId!;
    const isMaster = isMasterTenant(tenantId);

    // Device counts per group + status. Master sees the aggregate
    // across every tenant; child tenants stay scoped.
    const deviceQ = db('devices')
      .where({ approval_status: 'approved' })
      .whereNot({ status: 'pending_uninstall' })
      .select('group_id', 'status')
      .count('* as count')
      .groupBy('group_id', 'status');
    if (!isMaster) deviceQ.where({ tenant_id: tenantId });
    const deviceRows = await deviceQ;

    // Compliance scores per group (latest per device). On master we
    // drop the tenant filter on both sides of the JOIN/sub-select —
    // everything flows through `compliance_results` rows already
    // tied to the right device's tenant.
    const tenantFilterCompliance = isMaster ? '' : 'AND d.tenant_id = ?';
    const tenantFilterComplianceSub = isMaster ? '' : 'WHERE tenant_id = ?';
    const complianceParams = isMaster ? [] : [tenantId, tenantId];
    const complianceRows = await db.raw(`
      SELECT d.group_id,
             ROUND(AVG(cr.compliance_score)::numeric, 1) as avg_score,
             COUNT(DISTINCT cr.policy_id) as policy_count
      FROM compliance_results cr
      JOIN devices d ON d.id = cr.device_id
      WHERE d.approval_status = 'approved' ${tenantFilterCompliance}
        AND cr.id IN (
          SELECT DISTINCT ON (device_id, policy_id) id
          FROM compliance_results
          ${tenantFilterComplianceSub}
          ORDER BY device_id, policy_id, checked_at DESC
        )
      GROUP BY d.group_id
    `, complianceParams);

    // Pending updates per group
    const tenantFilterUpdates = isMaster ? '' : 'WHERE d.tenant_id = ? AND du.status = \'available\'';
    const updateWhere = isMaster ? `WHERE du.status = 'available'` : tenantFilterUpdates;
    const updateParams = isMaster ? [] : [tenantId];
    const updateRows = await db.raw(`
      SELECT d.group_id, COUNT(DISTINCT du.device_id) as devices_with_updates
      FROM device_updates du
      JOIN devices d ON d.id = du.device_id
      ${updateWhere}
      GROUP BY d.group_id
    `, updateParams);

    // Group metadata (parent + sortOrder feed the dashboard's hierarchical
    // "Vue par groupe" — root → children indented by depth, ordered by the
    // admin-defined sort_order rather than device count).
    // On master tenant we also pull `tenant_id` + tenant name so the
    // dashboard can bucket groups under their owning tenant (mirroring
    // the sidebar grouping). Without this, master shows a flat mix of
    // "DC" / "Caisses" / etc. from every tenant — unreadable.
    const groupsQ = db('device_groups as g')
      .leftJoin('tenants as t', 't.id', 'g.tenant_id')
      .select('g.id', 'g.name', 'g.parent_id', 'g.sort_order', 'g.tenant_id', 't.name as tenant_name');
    if (!isMaster) groupsQ.where({ 'g.tenant_id': tenantId });
    const groups = await groupsQ as Array<{
      id: number; name: string; parent_id: number | null; sort_order: number;
      tenant_id: number; tenant_name: string | null;
    }>;

    // Build stats map
    const statsMap = new Map<number | null, any>();

    const getOrCreate = (gid: number | null) => {
      if (!statsMap.has(gid)) {
        statsMap.set(gid, {
          groupId: gid, groupName: null, parentId: null, sortOrder: 0,
          tenantId: null, tenantName: null,
          online: 0, offline: 0, warning: 0, critical: 0, total: 0,
          complianceScore: null, policyCount: 0, pendingUpdates: 0,
        });
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
      else if (row.status === 'update_error') s.warning += count;
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

    // Make sure every group has a stats row even if it has no devices —
    // the hierarchical render still wants the empty group to appear.
    for (const g of groups) getOrCreate(g.id);

    // Set group names + parent + sortOrder + tenant info
    const groupMap = new Map(groups.map((g) => [g.id, g]));
    for (const [gid, stats] of statsMap) {
      if (gid != null) {
        const g = groupMap.get(gid);
        stats.groupName = g?.name ?? 'Unknown';
        stats.parentId = g?.parent_id ?? null;
        stats.sortOrder = g?.sort_order ?? 0;
        stats.tenantId = g?.tenant_id ?? null;
        stats.tenantName = g?.tenant_name ?? null;
      }
    }

    // Pre-sort by (parentId nulls first, then sortOrder) so the client can
    // build the tree in linear order without a second pass.
    res.json({ data: Array.from(statsMap.values()).sort((a: any, b: any) => {
      if ((a.parentId ?? -1) !== (b.parentId ?? -1)) return (a.parentId ?? -1) - (b.parentId ?? -1);
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      return (a.groupName ?? '').localeCompare(b.groupName ?? '');
    }) });
  } catch (err) { next(err); }
});

// POST /api/devices/bulk/approve
router.post('/bulk/approve', requireTenantCapability('agent_config:approval'), async (req, res, next) => {
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

// POST /api/devices/batch/transfer — move N devices to another tenant in
// one shot. All devices must currently belong to `req.tenantId` and the
// caller must be admin in both source and target (or platform admin).
// Honours the tenant's `device.transfer_tenant` restriction policy — if
// the action is Sensitive the whole batch prompts for TOTP once; if
// Restricted the batch hits the approvals queue as a single request.
router.post('/batch/transfer', requireRole('admin'), async (req, res, next) => {
  try {
    const { deviceIds, targetTenantId, targetApiKeyId } = req.body as {
      deviceIds: number[]; targetTenantId: number; targetApiKeyId: number;
    };
    if (!Array.isArray(deviceIds) || deviceIds.length === 0) {
      return res.status(400).json({ error: 'deviceIds required' });
    }
    if (!targetTenantId || !targetApiKeyId) {
      return res.status(400).json({ error: 'targetTenantId and targetApiKeyId required' });
    }
    if (targetTenantId === req.tenantId!) {
      return res.status(400).json({ error: 'Target tenant is the same as source' });
    }

    const userId = req.session.userId!;
    const isPlatformAdmin = req.session.role === 'admin';
    if (!isPlatformAdmin) {
      const [sourceMembership, targetMembership] = await Promise.all([
        db('user_tenants').where({ user_id: userId, tenant_id: req.tenantId!, role: 'admin' }).first(),
        db('user_tenants').where({ user_id: userId, tenant_id: targetTenantId, role: 'admin' }).first(),
      ]);
      if (!sourceMembership || !targetMembership) {
        return res.status(403).json({ error: 'You must be admin of both tenants' });
      }
    }

    const targetKey = await db('agent_api_keys')
      .where({ id: targetApiKeyId, tenant_id: targetTenantId })
      .first();
    if (!targetKey) return res.status(400).json({ error: 'Target API key not found in target tenant' });

    // Ensure every device belongs to the source tenant — prevents a
    // malicious admin from stuffing arbitrary device ids into the batch.
    const validDevices = await db('devices')
      .whereIn('id', deviceIds)
      .andWhere({ tenant_id: req.tenantId! })
      .select('id', 'hostname');
    if (validDevices.length === 0) {
      return res.status(404).json({ error: 'No matching devices in this tenant' });
    }

    // Gate via the transfer restriction policy. deviceIds drives scope
    // evaluation (e.g. "Sensitive only for prod group") — same semantics
    // as the single-device transfer.
    const { applyRestriction } = await import('../services/restriction.service');
    const approved = await applyRestriction(res, {
      req,
      actionKey: 'device.transfer_tenant',
      deviceIds: validDevices.map((d: any) => d.id),
      approvalRequestType: 'batch_command',
      approvalDescription: `Transfer ${validDevices.length} device(s) to tenant #${targetTenantId}`,
      approvalPayload: { action: 'transfer_tenant', deviceIds: validDevices.map((d: any) => d.id), params: { targetTenantId, targetApiKeyId } },
    });
    if (!approved) return;

    const serverUrl = `${req.protocol}://${req.get('host')}`;

    const results = { transferred: 0, failed: 0 };
    for (const device of validDevices) {
      try {
        await db.transaction(async (trx) => {
          // Enqueue the reconfigure command in the SOURCE tenant so the
          // agent (still on the old key) receives it on its next push.
          await trx('command_queue').insert({
            device_id: device.id,
            tenant_id: req.tenantId!,
            type: 'reconfigure_agent',
            payload: JSON.stringify({ apiKey: targetKey.key, serverUrl, targetTenantId }),
            priority: 'urgent',
            status: 'pending',
            expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
            created_by: userId,
          });

          await trx('devices').where({ id: device.id }).update({
            tenant_id: targetTenantId,
            api_key_id: targetApiKeyId,
            group_id: null,
            schedule_alert: null,
            updated_at: new Date(),
          });

          await trx('device_custom_metrics').where({ device_id: device.id }).delete();
          await trx('software_compliance_results').where({ device_id: device.id }).delete();
          await trx('command_queue')
            .where({ device_id: device.id, tenant_id: req.tenantId! })
            .whereIn('status', ['pending', 'sent'])
            .whereNot({ type: 'reconfigure_agent' })
            .update({ status: 'cancelled', finished_at: new Date() });
        });
        results.transferred++;
      } catch (err) {
        logger.error({ err, deviceId: device.id }, 'bulk transfer: failed for device');
        results.failed++;
      }
    }

    try {
      const { auditService } = await import('../services/audit.service');
      await auditService.logReq(req, 'device.bulk_transferred', {
        resourceType: 'device',
        resourcePath: validDevices.map((d: any) => d.id).join(','),
        details: { fromTenantId: req.tenantId, toTenantId: targetTenantId, count: validDevices.length, transferred: results.transferred, failed: results.failed },
      });
    } catch {}

    res.json({ data: results });
  } catch (err) { next(err); }
});

// POST /api/devices/batch/change-group — move N devices to a new group in one shot.
// Body: { deviceIds: number[], groupId: number | null }
// Fires the 'group_join' scenario trigger for each device whose group actually
// changed, matching the single-device PATCH flow.
router.post('/batch/change-group', requireRole('admin'), async (req, res, next) => {
  try {
    const { deviceIds, groupId } = req.body as { deviceIds: number[]; groupId: number | null };
    if (!Array.isArray(deviceIds) || deviceIds.length === 0) {
      return res.status(400).json({ error: 'deviceIds required' });
    }
    // Validate group if provided (null = ungrouped).
    if (groupId !== null && groupId !== undefined) {
      const grp = await db('device_groups').where({ id: groupId, tenant_id: req.tenantId! }).first();
      if (!grp) return res.status(404).json({ error: 'Group not found' });
    }
    const normalized = groupId === undefined ? null : groupId;

    const { applyRestriction } = await import('../services/restriction.service');
    const approved = await applyRestriction(res, {
      req,
      actionKey: 'device.bulk_group_change',
      deviceIds,
      approvalRequestType: 'batch_command',
      approvalDescription: `Move ${deviceIds.length} device(s) to group #${normalized ?? 'none'}`,
      approvalPayload: { action: 'change_group', deviceIds, params: { groupId: normalized } },
    });
    if (!approved) return;

    // Capture previous groupIds so we only fire triggers when the group changed.
    const prev = await db('devices')
      .whereIn('id', deviceIds)
      .andWhere({ tenant_id: req.tenantId! })
      .select('id', 'group_id');
    const prevById = new Map(prev.map((p: any) => [p.id, p.group_id]));

    await db('devices')
      .whereIn('id', deviceIds)
      .andWhere({ tenant_id: req.tenantId! })
      .update({ group_id: normalized, updated_at: new Date() });

    let changedCount = 0;
    for (const id of deviceIds) {
      if (prevById.get(id) !== normalized) {
        changedCount++;
        if (normalized !== null) {
          scenarioService.fireTrigger('group_join', id, req.tenantId!, { groupId: normalized })
            .catch(err => logger.error({ err, deviceId: id }, 'group_join trigger failed'));
        }
      }
    }

    try {
      const { auditService } = await import('../services/audit.service');
      await auditService.logReq(req, 'device.bulk_group_changed', {
        resourceType: 'device',
        resourcePath: deviceIds.join(','),
        details: { count: deviceIds.length, changed: changedCount, toGroupId: normalized },
      });
    } catch {}

    res.json({ data: { updated: deviceIds.length, changed: changedCount } });
  } catch (err) { next(err); }
});

// POST /api/devices/batch — batch action by group or device IDs.
// When 2-step approval is enabled AND the action is destructive
// (reboot/shutdown/restart_agent/sleep), a pending_approvals row is
// created instead of direct dispatch.
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

    // Gate destructive actions via the per-action restriction policy.
    const destructive = ['reboot', 'shutdown', 'restart_agent', 'sleep'].includes(action);
    if (destructive) {
      const { applyRestriction } = await import('../services/restriction.service');
      const approved = await applyRestriction(res, {
        req,
        actionKey: `command.${action}`,
        deviceIds: ids,
        approvalRequestType: 'batch_command',
        approvalDescription: `${action} on ${ids.length} device${ids.length > 1 ? 's' : ''}`,
        approvalPayload: { action, deviceIds: ids },
      });
      if (!approved) return;
    }

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

// POST /api/devices/:id/live-metrics
// Toggles a "live mode" on the device — the agent pushes metrics every
// ~3 seconds until the window expires (default 60s, refreshed by every
// new request). Used by the device detail page so the user sees CPU
// actually moving instead of waiting for the next 60s push tick. With
// `mode: 'push_now'` the agent fires a single immediate push instead,
// which is what the manual refresh button hooks into.
router.post('/:id/live-metrics', requireDeviceRead('id'), async (req, res, next) => {
  try {
    const deviceId = parseInt(req.params.id);
    const mode = (req.body?.mode === 'live' ? 'live' : 'push_now') as 'live' | 'push_now';
    const windowSec = mode === 'live'
      ? Math.max(5, Math.min(600, Number(req.body?.windowSec ?? 60)))
      : undefined;
    const sent = await deviceService.requestLiveMetrics(deviceId, req.tenantId!, mode, windowSec);
    res.json({ data: { sent, mode, windowSec } });
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

// GET /api/devices/:id/custom-metrics
router.get('/:id/custom-metrics', requireDeviceRead(), async (req, res, next) => {
  try {
    const deviceId = parseInt(req.params.id);
    const metrics = await customMetricService.listForDevice(deviceId, req.tenantId!);
    res.json({ data: metrics });
  } catch (err) { next(err); }
});

// GET /api/devices/:id/custom-sections — list sections that apply to this device
router.get('/:id/custom-sections', requireDeviceRead(), async (req, res, next) => {
  try {
    const deviceId = parseInt(req.params.id);
    const sections = await customSectionService.listForDevice(deviceId, req.tenantId!);
    res.json({ data: sections });
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
router.post('/:id/approve', requireTenantCapability('agent_config:approval'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    const device = await deviceService.approveDevice(id, req.tenantId!, req.session.userId!);
    // Fire scenario trigger for newly approved agent
    if (device) {
      scenarioService.fireTrigger('agent_approved', device.id, req.tenantId!).catch(err => {
        logger.error({ err, deviceId: device.id }, 'Failed to fire agent_approved scenario trigger');
      });
      try {
        const { auditService } = await import('../services/audit.service');
        await auditService.logReq(req, 'device.approved', {
          deviceId: id, resourceType: 'device', resourcePath: String(id),
          details: { hostname: device.hostname },
        });
      } catch {}
    }
    res.json({ data: device });
  } catch (err) { next(err); }
});

// POST /api/devices/:id/refuse
router.post('/:id/refuse', requireTenantCapability('agent_config:approval'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    const device = await deviceService.refuseDevice(id, req.tenantId!);
    if (device) {
      try {
        const { auditService } = await import('../services/audit.service');
        await auditService.logReq(req, 'device.refused', {
          deviceId: id, resourceType: 'device', resourcePath: String(id),
          details: { hostname: device.hostname },
        });
      } catch {}
    }
    res.json({ data: device });
  } catch (err) { next(err); }
});

// POST /api/devices/:id/suspend
router.post('/:id/suspend', requireRole('admin'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    const device = await deviceService.suspendDevice(id, req.tenantId!);
    if (!device) return res.status(404).json({ error: 'Device not found' });
    try {
      const { auditService } = await import('../services/audit.service');
      await auditService.logReq(req, 'device.suspended', {
        deviceId: id, resourceType: 'device', resourcePath: String(id),
        details: { hostname: device.hostname },
      });
    } catch {}
    res.json({ data: device });
  } catch (err) { next(err); }
});

// POST /api/devices/:id/unsuspend
router.post('/:id/unsuspend', requireRole('admin'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    const device = await deviceService.unsuspendDevice(id, req.tenantId!);
    if (!device) return res.status(404).json({ error: 'Device not found' });
    try {
      const { auditService } = await import('../services/audit.service');
      await auditService.logReq(req, 'device.unsuspended', {
        deviceId: id, resourceType: 'device', resourcePath: String(id),
        details: { hostname: device.hostname },
      });
    } catch {}
    res.json({ data: device });
  } catch (err) { next(err); }
});

// POST /api/devices/:id/duplicate-id/acknowledge
// Admin confirms they've seen the "duplicate agent ID suspected" warning.
// Trims the identity-fingerprints buffer to its latest entry and clears
// the flag — if duplication continues, the next ~2-3 alternating pushes
// will re-flag automatically. Any tenant member with device-write on
// this device can ack (no platform-admin gate — the fix lives outside
// Obliance and the owning team should be able to silence the noise).
router.post('/:id/duplicate-id/acknowledge', requireDeviceWrite(), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    await deviceService.acknowledgeDuplicateAgentId(id, req.tenantId!);
    try {
      const { auditService } = await import('../services/audit.service');
      await auditService.logReq(req, 'device.duplicate_id_acknowledged', {
        deviceId: id, resourceType: 'device', resourcePath: String(id),
      });
    } catch {}
    res.json({ data: { ok: true } });
  } catch (err) { next(err); }
});

// POST /api/devices/:id/privacy-mode/enable — send enable_privacy_mode command to agent
router.post('/:id/privacy-mode/enable', requireRole('admin'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    const device = await deviceService.getDeviceById(id, req.tenantId!);
    if (!device) return res.status(404).json({ error: 'Device not found' });

    const { applyRestriction } = await import('../services/restriction.service');
    const approved = await applyRestriction(res, {
      req, actionKey: 'command.enable_privacy_mode', deviceIds: [id],
      approvalRequestType: 'batch_command',
      approvalDescription: `Enable privacy mode on ${device.hostname}`,
      approvalPayload: { action: 'enable_privacy_mode', deviceIds: [id] },
    });
    if (!approved) return;

    const cmd = await commandService.enqueue({
      deviceId: id,
      tenantId: req.tenantId!,
      type: 'enable_privacy_mode' as any,
      priority: 'high',
      expiresInSeconds: 300,
      createdBy: req.session.userId,
    });
    try {
      const { auditService } = await import('../services/audit.service');
      await auditService.logReq(req, 'command.enable_privacy_mode', {
        deviceId: id, resourceType: 'command', resourcePath: cmd.id,
        details: { hostname: device.hostname },
      });
    } catch {}
    res.json({ data: cmd });
  } catch (err) { next(err); }
});

// POST /api/devices/:id/privacy-mode/disable — send disable_privacy_mode command to agent
router.post('/:id/privacy-mode/disable', requireRole('admin'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    const device = await deviceService.getDeviceById(id, req.tenantId!);
    if (!device) return res.status(404).json({ error: 'Device not found' });

    // If a privacy-gate password is set, refuse here. Callers must use
    // /api/devices/:id/privacy/disable-with-password which verifies the
    // password on the agent first.
    if ((device as any).privacyPasswordSet) {
      return next(new AppError(423, 'Privacy password is set — use /privacy/disable-with-password'));
    }

    const { applyRestriction } = await import('../services/restriction.service');
    const approved = await applyRestriction(res, {
      req, actionKey: 'command.disable_privacy_mode', deviceIds: [id],
      approvalRequestType: 'batch_command',
      approvalDescription: `Disable privacy mode on ${device.hostname}`,
      approvalPayload: { action: 'disable_privacy_mode', deviceIds: [id] },
    });
    if (!approved) return;

    const cmd = await commandService.enqueue({
      deviceId: id,
      tenantId: req.tenantId!,
      type: 'disable_privacy_mode',
      priority: 'high',
      expiresInSeconds: 300,
      createdBy: req.session.userId,
    });
    try {
      const { auditService } = await import('../services/audit.service');
      await auditService.logReq(req, 'command.disable_privacy_mode', {
        deviceId: id, resourceType: 'command', resourcePath: cmd.id,
        details: { hostname: device.hostname },
      });
    } catch {}
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

    const { applyRestriction } = await import('../services/restriction.service');
    const approved = await applyRestriction(res, {
      req, actionKey: 'command.enable_airgap', deviceIds: [id],
      approvalRequestType: 'batch_command',
      approvalDescription: `Enable airgap on ${device.hostname}`,
      approvalPayload: { action: 'enable_airgap', deviceIds: [id] },
    });
    if (!approved) return;

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

    try {
      const { auditService } = await import('../services/audit.service');
      await auditService.logReq(req, 'command.enable_airgap', {
        deviceId: id, resourceType: 'device', resourcePath: String(id),
        details: { hostname: device.hostname },
      });
    } catch {}

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

    const { applyRestriction } = await import('../services/restriction.service');
    const approved = await applyRestriction(res, {
      req, actionKey: 'command.disable_airgap', deviceIds: [id],
      approvalRequestType: 'batch_command',
      approvalDescription: `Disable airgap on ${device.hostname}`,
      approvalPayload: { action: 'disable_airgap', deviceIds: [id] },
    });
    if (!approved) return;

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

    try {
      const { auditService } = await import('../services/audit.service');
      await auditService.logReq(req, 'command.disable_airgap', {
        deviceId: id, resourceType: 'device', resourcePath: String(id),
        details: { hostname: device.hostname },
      });
    } catch {}

    getIO().to(`tenant:${req.tenantId}`).emit(SocketEvents.DEVICE_UPDATED, { id, airgapEnabled: false, airgapEnabledAt: null });
    res.json({ data: { success: true } });
  } catch (err) { next(err); }
});

// POST /api/devices/:id/uninstall — mark as pending_uninstall + send uninstall command to agent.
// Routed through 2-step approval when the tenant has opted in.
router.post('/:id/uninstall', requireRole('admin'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    const existing = await deviceService.getDeviceById(id, req.tenantId!);
    if (!existing) return res.status(404).json({ error: 'Device not found' });

    const name = existing.displayName || existing.hostname || `#${id}`;
    const { applyRestriction } = await import('../services/restriction.service');
    const approved = await applyRestriction(res, {
      req,
      actionKey: 'command.uninstall_agent',
      deviceIds: [id],
      approvalRequestType: 'device_uninstall',
      approvalDescription: `Uninstall agent from ${name}`,
      approvalPayload: { deviceId: id },
    });
    if (!approved) return;

    const device = await deviceService.initiateUninstall(id, req.tenantId!);
    if (!device) return res.status(404).json({ error: 'Device not found' });
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

// GET /api/devices/transfer/candidates — tenant-level list, same body
// shape as the per-device variant below. Used by the bulk transfer UI
// where no single deviceId is relevant.
router.get('/transfer/candidates', requireRole('admin'), async (req, res, next) => {
  try {
    const userId = req.session.userId!;
    const isPlatformAdmin = req.session.role === 'admin';

    let tenantsQ = db('tenants').select('id', 'name', 'slug').orderBy('name');
    if (!isPlatformAdmin) {
      tenantsQ = tenantsQ
        .join('user_tenants', 'user_tenants.tenant_id', 'tenants.id')
        .where({ 'user_tenants.user_id': userId, 'user_tenants.role': 'admin' })
        .select('tenants.id', 'tenants.name', 'tenants.slug');
    }
    const tenants = (await tenantsQ).filter((t: any) => t.id !== req.tenantId!);

    if (tenants.length === 0) return res.json({ data: [] });

    const keys = await db('agent_api_keys')
      .whereIn('tenant_id', tenants.map((t: any) => t.id))
      .select('id', 'tenant_id', 'name', 'default_group_id');
    const keysByTenant = new Map<number, any[]>();
    for (const k of keys) {
      if (!keysByTenant.has(k.tenant_id)) keysByTenant.set(k.tenant_id, []);
      keysByTenant.get(k.tenant_id)!.push({ id: k.id, label: k.name, defaultGroupId: k.default_group_id ?? null });
    }

    res.json({
      data: tenants.map((t: any) => ({
        tenantId: t.id, tenantName: t.name, tenantSlug: t.slug,
        apiKeys: keysByTenant.get(t.id) ?? [],
      })),
    });
  } catch (err) { next(err); }
});

// GET /api/devices/:id/transfer/candidates — list the tenants the caller
// can transfer INTO (must be admin there, or platform admin) along with
// their API keys. Excludes the current tenant.
router.get('/:id/transfer/candidates', requireRole('admin'), async (req, res, next) => {
  try {
    const userId = req.session.userId!;
    const isPlatformAdmin = req.session.role === 'admin';

    let tenantsQ = db('tenants').select('id', 'name', 'slug').orderBy('name');
    if (!isPlatformAdmin) {
      // Only tenants where the user has admin membership.
      tenantsQ = tenantsQ
        .join('user_tenants', 'user_tenants.tenant_id', 'tenants.id')
        .where({ 'user_tenants.user_id': userId, 'user_tenants.role': 'admin' })
        .select('tenants.id', 'tenants.name', 'tenants.slug');
    }
    const tenants = (await tenantsQ).filter((t: any) => t.id !== req.tenantId!);

    if (tenants.length === 0) {
      return res.json({ data: [] });
    }

    const keys = await db('agent_api_keys')
      .whereIn('tenant_id', tenants.map((t: any) => t.id))
      .select('id', 'tenant_id', 'name', 'default_group_id');

    const keysByTenant = new Map<number, any[]>();
    for (const k of keys) {
      if (!keysByTenant.has(k.tenant_id)) keysByTenant.set(k.tenant_id, []);
      keysByTenant.get(k.tenant_id)!.push({
        id: k.id,
        label: k.name,        // client contract is still `label`
        defaultGroupId: k.default_group_id ?? null,
      });
    }

    res.json({
      data: tenants.map((t: any) => ({
        tenantId: t.id,
        tenantName: t.name,
        tenantSlug: t.slug,
        apiKeys: keysByTenant.get(t.id) ?? [],
      })),
    });
  } catch (err) { next(err); }
});

// POST /api/devices/:id/transfer — move a device from the current tenant
// to another tenant. Caller must be admin in BOTH tenants (or platform
// admin). The device's tenant_id + api_key_id are updated, group_id is
// cleared, and a `reconfigure_agent` command is enqueued so the agent
// picks up the new API key on its next push.
//
// Body: { targetTenantId: number, targetApiKeyId: number }
router.post('/:id/transfer', requireRole('admin'), async (req, res, next) => {
  try {
    const deviceId = parseInt(req.params.id);
    const { targetTenantId, targetApiKeyId } = req.body as { targetTenantId: number; targetApiKeyId: number };
    if (!targetTenantId || !targetApiKeyId) {
      return res.status(400).json({ error: 'targetTenantId and targetApiKeyId required' });
    }
    if (targetTenantId === req.tenantId!) {
      return res.status(400).json({ error: 'Target tenant is the same as source' });
    }

    const userId = req.session.userId!;
    const isPlatformAdmin = req.session.role === 'admin';
    // Platform admin bypasses tenant-level admin check. Otherwise the
    // caller must be an admin in BOTH the source and the destination.
    if (!isPlatformAdmin) {
      const [sourceMembership, targetMembership] = await Promise.all([
        db('user_tenants').where({ user_id: userId, tenant_id: req.tenantId!, role: 'admin' }).first(),
        db('user_tenants').where({ user_id: userId, tenant_id: targetTenantId, role: 'admin' }).first(),
      ]);
      if (!sourceMembership || !targetMembership) {
        return res.status(403).json({ error: 'You must be admin of both tenants' });
      }
    }

    const device = await db('devices').where({ id: deviceId, tenant_id: req.tenantId! }).first();
    if (!device) return res.status(404).json({ error: 'Device not found' });

    const targetKey = await db('agent_api_keys').where({ id: targetApiKeyId, tenant_id: targetTenantId }).first();
    if (!targetKey) return res.status(400).json({ error: 'Target API key not found in target tenant' });

    const { applyRestriction } = await import('../services/restriction.service');
    const approved = await applyRestriction(res, {
      req,
      actionKey: 'device.transfer_tenant',
      deviceIds: [deviceId],
      approvalRequestType: 'device_uninstall',
      approvalDescription: `Transfer ${device.hostname} to tenant #${targetTenantId}`,
      approvalPayload: { deviceId, targetTenantId, targetApiKeyId },
    });
    if (!approved) return;

    const serverUrl = `${req.protocol}://${req.get('host')}`;

    await db.transaction(async (trx) => {
      // Enqueue the reconfigure command in the SOURCE tenant's queue so the
      // agent still picks it up on its next push (it's still using the old
      // API key). Payload carries the new key + server URL so the agent can
      // rewrite its config.json and start authenticating against the target.
      await trx('command_queue').insert({
        device_id: deviceId,
        tenant_id: req.tenantId!,
        type: 'reconfigure_agent',
        payload: JSON.stringify({
          apiKey: targetKey.key,
          serverUrl,
          targetTenantId,
        }),
        priority: 'urgent',
        status: 'pending',
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
        created_by: userId,
      });

      // Move the device record.
      await trx('devices').where({ id: deviceId }).update({
        tenant_id: targetTenantId,
        api_key_id: targetApiKeyId,
        group_id: null,
        schedule_alert: null,
        updated_at: new Date(),
      });

      // Clear cross-tenant artefacts that would otherwise point at the
      // old tenant's schedules / compliance lists.
      await trx('device_custom_metrics').where({ device_id: deviceId }).delete();
      await trx('software_compliance_results').where({ device_id: deviceId }).delete();

      // Cancel any still-pending commands from the source tenant.
      await trx('command_queue')
        .where({ device_id: deviceId, tenant_id: req.tenantId! })
        .whereIn('status', ['pending', 'sent'])
        .whereNot({ type: 'reconfigure_agent' })
        .update({ status: 'cancelled', finished_at: new Date() });
    });

    try {
      const { auditService } = await import('../services/audit.service');
      await auditService.logReq(req, 'device.transferred', {
        deviceId,
        resourceType: 'device',
        resourcePath: String(deviceId),
        details: {
          fromTenantId: req.tenantId,
          toTenantId: targetTenantId,
          targetApiKeyId,
          hostname: device.hostname,
        },
      });
    } catch {}

    res.json({ data: { ok: true } });
  } catch (err) { next(err); }
});

// DELETE /api/devices/:id
router.delete('/:id', requireRole('admin'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    const existing = await deviceService.getDeviceById(id, req.tenantId!);
    if (!existing) return res.status(404).json({ error: 'Device not found' });

    const { applyRestriction } = await import('../services/restriction.service');
    const approved = await applyRestriction(res, {
      req,
      actionKey: 'device.delete',
      deviceIds: [id],
      approvalRequestType: 'device_uninstall',
      approvalDescription: `Delete device ${existing.displayName || existing.hostname || `#${id}`}`,
      approvalPayload: { deviceId: id, deleteOnly: true },
    });
    if (!approved) return;

    await deviceService.deleteDevice(id, req.tenantId!);
    try {
      const { auditService } = await import('../services/audit.service');
      await auditService.logReq(req, 'device.deleted', {
        deviceId: id, resourceType: 'device', resourcePath: String(id),
        details: { hostname: existing?.hostname, displayName: existing?.displayName },
      });
    } catch {}
    res.status(204).send();
  } catch (err) { next(err); }
});

export default router;
