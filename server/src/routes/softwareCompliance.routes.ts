import { Router } from 'express';
import { softwareComplianceService } from '../services/softwareCompliance.service';
import { requireRole, requireDeviceWriteParam, requireDeviceRead } from '../middleware/rbac';
import { permissionService } from '../services/permission.service';
import { AppError } from '../middleware/errorHandler';
import { db } from '../db';

const router = Router();

// GET /software-compliance/known-apps?osType=windows
router.get('/known-apps', async (req, res, next) => {
  try {
    const osType = req.query.osType as string | undefined;
    const apps = await softwareComplianceService.getKnownApps(req.tenantId!, osType);
    res.json({ data: apps });
  } catch (err) { next(err); }
});

// GET /software-compliance/lists — all lists for tenant
router.get('/lists', async (req, res, next) => {
  try {
    const lists = await softwareComplianceService.getLists(req.tenantId!);
    res.json({ data: lists });
  } catch (err) { next(err); }
});

// POST /software-compliance/lists — create (admin)
router.post('/lists', requireRole('admin'), async (req, res, next) => {
  try {
    const list = await softwareComplianceService.createList(req.tenantId!, {
      ...req.body, createdBy: req.session.userId,
    });
    try {
      const { auditService } = await import('../services/audit.service');
      await auditService.logReq(req, 'software_policy.created', {
        resourceType: 'software_policy', resourcePath: String(list.id),
        details: { name: list.name, listType: list.listType },
      });
    } catch {}
    res.status(201).json({ data: list });
  } catch (err) { next(err); }
});

// PUT /software-compliance/lists/:id — update (admin)
router.put('/lists/:id', requireRole('admin'), async (req, res, next) => {
  try {
    const list = await softwareComplianceService.updateList(parseInt(req.params.id), req.tenantId!, req.body);
    try {
      const { auditService } = await import('../services/audit.service');
      await auditService.logReq(req, 'software_policy.updated', {
        resourceType: 'software_policy', resourcePath: req.params.id,
        details: { name: list?.name },
      });
    } catch {}
    res.json({ data: list });
  } catch (err) { next(err); }
});

// DELETE /software-compliance/lists/:id — delete (admin)
router.delete('/lists/:id', requireRole('admin'), async (req, res, next) => {
  try {
    await softwareComplianceService.deleteList(parseInt(req.params.id), req.tenantId!);
    try {
      const { auditService } = await import('../services/audit.service');
      await auditService.logReq(req, 'software_policy.deleted', {
        resourceType: 'software_policy', resourcePath: req.params.id,
      });
    } catch {}
    res.status(204).send();
  } catch (err) { next(err); }
});

// GET /software-compliance/results — paginated results (?deviceId=&page=)
router.get('/results', async (req, res, next) => {
  try {
    const { deviceId, page } = req.query as any;
    if (deviceId) {
      // Permission check: user must have read access to the device
      if (req.session.role !== 'admin') {
        const canRead = await permissionService.canReadDevice(req.session.userId!, parseInt(deviceId), false);
        if (!canRead) throw new AppError(403, 'Insufficient permissions');
      }
      const items = await softwareComplianceService.getLatestResults(parseInt(deviceId), req.tenantId!);
      res.json({ data: { items, total: items.length } });
    } else {
      const items = await softwareComplianceService.getAllResults(req.tenantId!, page ? parseInt(page) : 1);
      // Filter by visible devices for non-admins
      if (req.session.role !== 'admin') {
        const visibleIds = await permissionService.getVisibleDeviceIds(req.session.userId!, false);
        if (Array.isArray(visibleIds)) {
          const filtered = items.filter((item: any) => visibleIds.includes(item.deviceId));
          return res.json({ data: { items: filtered, total: filtered.length } });
        }
      }
      res.json({ data: { items, total: items.length } });
    }
  } catch (err) { next(err); }
});

// GET /software-compliance/results/device/:deviceId — latest for device
router.get('/results/device/:deviceId', requireDeviceRead('deviceId'), async (req, res, next) => {
  try {
    const items = await softwareComplianceService.getLatestResults(parseInt(req.params.deviceId), req.tenantId!);
    res.json({ data: { items, total: items.length } });
  } catch (err) { next(err); }
});

// GET /software-compliance/history — last N compliance-related commands
// (check_software_compliance, install_software, uninstall_software), grouped
// into "batches" by (listId, minute-truncated timestamp) so the UI can show
// each scan-run as a single row, drill down per device with stdout/stderr.
router.get('/history', async (req, res, next) => {
  try {
    const limitBatches = Math.min(50, parseInt((req.query.limit as string) || '10'));
    const listIdFilter = req.query.listId ? parseInt(req.query.listId as string) : null;

    // Step 1: candidate commands (take a generous slice — we group after).
    const qBase = db('command_queue as c')
      .leftJoin('devices as d', 'd.id', 'c.device_id')
      .where({ 'c.tenant_id': req.tenantId! })
      .whereIn('c.type', ['check_software_compliance', 'install_software', 'uninstall_software']);

    if (listIdFilter) {
      qBase.whereRaw("(c.payload->>'listId')::int = ?", [listIdFilter]);
    }

    const rows = await qBase
      .select(
        'c.id', 'c.device_id', 'c.type', 'c.status', 'c.payload', 'c.result',
        'c.created_at', 'c.sent_at', 'c.finished_at',
        db.raw("(c.payload->>'listId')::int as list_id"),
        db.raw("c.payload->>'entryName' as entry_name"),
        'd.hostname', 'd.display_name as device_display_name', 'd.os_type',
      )
      .orderBy('c.created_at', 'desc')
      .limit(limitBatches * 200);

    // Step 2: resolve list names.
    const listIds = [...new Set(rows.map((r: any) => r.list_id).filter(Boolean))];
    const listsById: Record<number, string> = {};
    if (listIds.length) {
      const listRows = await db('software_compliance_lists')
        .where({ tenant_id: req.tenantId! })
        .whereIn('id', listIds)
        .select('id', 'name');
      for (const l of listRows) listsById[l.id] = l.name;
    }

    // Step 3: group into batches. Batch key = listId + minute bucket + type.
    const batches = new Map<string, any>();
    for (const r of rows) {
      const dt = new Date(r.created_at);
      const bucket = Math.floor(dt.getTime() / 60_000); // 1-minute granularity
      const key = `${r.list_id}|${bucket}|${r.type}`;
      if (!batches.has(key)) {
        batches.set(key, {
          batchId: key,
          triggeredAt: r.created_at,
          listId: r.list_id,
          listName: listsById[r.list_id] || `List #${r.list_id}`,
          type: r.type,
          total: 0, ok: 0, fail: 0, pending: 0,
          items: [],
        });
      }
      const b = batches.get(key);
      const result = typeof r.result === 'string' ? JSON.parse(r.result) : (r.result || {});
      const item = {
        id: r.id,
        status: r.status,
        deviceId: r.device_id,
        deviceName: r.device_display_name || r.hostname || `#${r.device_id}`,
        deviceOsType: r.os_type,
        entryName: r.entry_name,
        exitCode: result.exitCode ?? null,
        stdout: (result.stdout ?? '').toString().slice(0, 4000) || null,
        stderr: (result.stderr ?? result.error ?? '').toString().slice(0, 4000) || null,
        triggeredAt: r.created_at,
        startedAt: r.sent_at,
        finishedAt: r.finished_at,
      };
      b.items.push(item);
      b.total++;
      if (r.status === 'success') b.ok++;
      else if (r.status === 'failure' || r.status === 'timeout') b.fail++;
      else b.pending++;
    }

    const data = Array.from(batches.values())
      .sort((a, b) => new Date(b.triggeredAt).getTime() - new Date(a.triggeredAt).getTime())
      .slice(0, limitBatches);

    res.json({ data });
  } catch (err) { next(err); }
});

// POST /software-compliance/:id/scan — trigger a compliance check for an
// entire list across every target device. Admin-only. Returns { enqueued }.
router.post('/:id/scan', async (req, res, next) => {
  try {
    if (req.session.role !== 'admin') throw new AppError(403, 'Admin only');
    const id = parseInt(req.params.id);
    const count = await softwareComplianceService.triggerCheckForList(
      id, req.tenantId!, req.session.userId!,
    );
    res.json({ data: { enqueued: count } });
  } catch (err) { next(err); }
});

// POST /software-compliance/check — trigger check { deviceId, listId? }
router.post('/check', async (req, res, next) => {
  try {
    const { deviceId, listId } = req.body;
    if (!deviceId) return res.status(400).json({ error: 'deviceId required' });

    // Permission check: user must have write access to the device
    if (req.session.role !== 'admin') {
      const canWrite = await permissionService.canWriteDevice(req.session.userId!, parseInt(deviceId), false);
      if (!canWrite) throw new AppError(403, 'Insufficient permissions');
    }

    if (listId) {
      const cmd = await softwareComplianceService.triggerCheck(
        parseInt(deviceId), parseInt(listId),
        req.tenantId!, req.session.userId!
      );
      res.json({ data: cmd });
    } else {
      // Check against all enabled lists for this device
      const lists = await softwareComplianceService.getLists(req.tenantId!);
      const enabled = lists.filter(l => l.enabled);
      const cmds = await Promise.all(
        enabled.map(l => softwareComplianceService.triggerCheck(
          parseInt(deviceId), l.id, req.tenantId!, req.session.userId!
        ))
      );
      res.json({ data: cmds });
    }
  } catch (err) { next(err); }
});

// POST /software-compliance/remediate — trigger remediation { deviceId, listId, entryIds }
router.post('/remediate', async (req, res, next) => {
  try {
    const { deviceId, listId, entryIds } = req.body;
    if (!deviceId || !listId || !entryIds?.length) {
      return res.status(400).json({ error: 'deviceId, listId, entryIds required' });
    }
    if (req.session.role !== 'admin') {
      const canWrite = await permissionService.canWriteDevice(req.session.userId!, parseInt(deviceId), false);
      if (!canWrite) throw new AppError(403, 'Insufficient permissions');
    }
    const list = await softwareComplianceService.getListById(parseInt(listId), req.tenantId!);
    const { applyRestriction } = await import('../services/restriction.service');
    const approved = await applyRestriction(res, {
      req,
      actionKey: list?.listType === 'whitelist' ? 'software.remediate_install' : 'software.remediate_uninstall',
      deviceIds: [parseInt(deviceId)],
      approvalRequestType: 'batch_command',
      approvalDescription: `${list?.listType === 'whitelist' ? 'Install' : 'Uninstall'} ${entryIds.length} entry(ies) on device #${deviceId}`,
      approvalPayload: { action: list?.listType === 'whitelist' ? 'install_software' : 'uninstall_software', deviceIds: [parseInt(deviceId)], params: { listId, entryIds } },
    });
    if (!approved) return;

    const cmds = await softwareComplianceService.triggerRemediation(
      parseInt(deviceId), parseInt(listId), entryIds,
      req.tenantId!, req.session.userId!
    );
    res.json({ data: cmds });
  } catch (err) { next(err); }
});

export default router;
