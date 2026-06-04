import { Router } from 'express';
import { requireDeviceRead } from '../middleware/rbac';
import { permissionService } from '../services/permission.service';
import { veeamService } from '../services/veeam.service';
import { commandService } from '../services/command.service';
import { applyRestriction } from '../services/restriction.service';
import type { BackupJobAction } from '@obliance/shared';

const router = Router();

// Map each job action to its restriction key. All control actions need the
// veeam:control capability; the restriction key drives the per-tenant 2FA /
// double-admin gate (stop + disable default to 'sensitive', the rest 'none').
const ACTION_META: Record<BackupJobAction, { restrictionKey: string }> = {
  start:   { restrictionKey: 'veeam.job_start' },
  stop:    { restrictionKey: 'veeam.job_stop' },
  retry:   { restrictionKey: 'veeam.job_retry' },
  enable:  { restrictionKey: 'veeam.job_enable' },
  disable: { restrictionKey: 'veeam.job_disable' },
};

// GET /api/veeam/devices/:id/jobs — job list for one host.
router.get('/devices/:id/jobs', requireDeviceRead('id'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const isAdmin = req.session.role === 'admin';
    if (!isAdmin && !(await permissionService.canUseCapability(req.session.userId!, id, false, 'veeam:view'))) {
      return res.status(403).json({ error: 'veeam:view capability required' });
    }
    const jobs = await veeamService.listForDevice(id);
    res.json({ data: jobs });
  } catch (err) { next(err); }
});

// POST /api/veeam/devices/:id/refresh — ask the host agent to re-enumerate.
// Manual one-shot (button) — goes through the durable command queue so it
// shows in task history.
router.post('/devices/:id/refresh', requireDeviceRead('id'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const isAdmin = req.session.role === 'admin';
    if (!isAdmin && !(await permissionService.canUseCapability(req.session.userId!, id, false, 'veeam:view'))) {
      return res.status(403).json({ error: 'veeam:view capability required' });
    }
    const cmd = await commandService.enqueue({
      deviceId: id, tenantId: req.tenantId!, type: 'veeam_list_jobs' as any,
      priority: 'high', expiresInSeconds: 120, createdBy: req.session.userId,
    });
    res.json({ data: cmd });
  } catch (err) { next(err); }
});

// POST /api/veeam/devices/:id/live — live heartbeat from an open Backups view.
// Pushes an EPHEMERAL enumerate over the WS command channel (instant, no
// command-queue row → no task-history spam; `veeam_list_jobs` is on the
// noisy-ephemeral denylist in command.service). The client calls this on a
// short interval while the view is open so external changes (a job started
// directly in the Veeam console) surface within a few seconds.
router.post('/devices/:id/live', requireDeviceRead('id'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const isAdmin = req.session.role === 'admin';
    if (!isAdmin && !(await permissionService.canUseCapability(req.session.userId!, id, false, 'veeam:view'))) {
      return res.status(403).json({ error: 'veeam:view capability required' });
    }
    const { agentHub } = await import('../services/agentHub.service');
    const { randomUUID } = await import('crypto');
    const delivered = agentHub.push(id, {
      type: 'command', id: randomUUID(), commandType: 'veeam_list_jobs', payload: {},
    });
    res.json({ data: { delivered } });
  } catch (err) { next(err); }
});

// GET /api/veeam/jobs — tenant-wide grid (Dashboard tab). Non-admins are
// scoped to the host devices they can see.
router.get('/jobs', async (req, res, next) => {
  try {
    const isAdmin = req.session.role === 'admin';
    let hostIds: number[] | undefined;
    if (!isAdmin) {
      const visible = await permissionService.getVisibleDeviceIds(req.session.userId!, false);
      hostIds = Array.isArray(visible) ? visible : [];
    }
    const jobs = await veeamService.listForTenant(req.tenantId!, hostIds);
    res.json({ data: jobs });
  } catch (err) { next(err); }
});

// POST /api/veeam/devices/:id/jobs/:jobId/action — run an action on a job.
// Gated by (veeam:control capability) + (per-tenant restriction matrix), then
// enqueued as a single veeam_control command the host agent executes.
router.post('/devices/:id/jobs/:jobId/action', requireDeviceRead('id'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const jobId = String(req.params.jobId);
    const action = String(req.body?.action) as BackupJobAction;

    const meta = ACTION_META[action];
    if (!meta) return res.status(400).json({ error: `Unknown backup job action: ${action}` });

    const isAdmin = req.session.role === 'admin';
    if (!isAdmin && !(await permissionService.canUseCapability(req.session.userId!, id, false, 'veeam:control'))) {
      return res.status(403).json({ error: 'veeam:control capability required' });
    }

    // Ownership: the job must exist on this host within the caller's tenant.
    const job = await veeamService.getJob(id, jobId, req.tenantId!);
    if (!job) return res.status(404).json({ error: 'Backup job not found on this host' });

    // Restriction gate (2FA / double-admin per the tenant matrix).
    const approved = await applyRestriction(res, {
      req,
      actionKey: meta.restrictionKey,
      deviceIds: [id],
      approvalRequestType: 'batch_command',
      approvalDescription: `Veeam ${action} on job "${job.name}"`,
      approvalPayload: { action: 'veeam_control', deviceIds: [id], params: { action, jobId } },
    });
    if (!approved) return;

    const cmd = await commandService.enqueue({
      deviceId: id, tenantId: req.tenantId!, type: 'veeam_control' as any,
      payload: { action, jobId },
      priority: 'high', expiresInSeconds: 300, createdBy: req.session.userId,
    });

    try {
      const { auditService } = await import('../services/audit.service');
      await auditService.logReq(req, `veeam.${action}`, {
        deviceId: id, resourceType: 'command', resourcePath: cmd.id,
        details: { jobId, jobName: job.name, action },
      });
    } catch {}

    res.json({ data: cmd });
  } catch (err) { next(err); }
});

export default router;
