import { Router } from 'express';
import { db } from '../db';
import { requireDeviceRead } from '../middleware/rbac';
import { permissionService } from '../services/permission.service';
import { hyperVService } from '../services/hyperV.service';
import { commandService } from '../services/command.service';
import { applyRestriction } from '../services/restriction.service';
import type { VmAction } from '@obliance/shared';

const router = Router();

// Map each VM action to (capability tier, restriction key). Power actions
// need hyperv:power; everything heavier needs hyperv:manage. The restriction
// key drives the per-tenant 2FA / double-admin gate.
const ACTION_META: Record<VmAction, { cap: 'hyperv:power' | 'hyperv:manage'; restrictionKey: string }> = {
  start:              { cap: 'hyperv:power',  restrictionKey: 'hyperv.vm_start' },
  stop:               { cap: 'hyperv:power',  restrictionKey: 'hyperv.vm_stop' },
  shutdown:           { cap: 'hyperv:power',  restrictionKey: 'hyperv.vm_shutdown' },
  restart:            { cap: 'hyperv:power',  restrictionKey: 'hyperv.vm_restart' },
  save:               { cap: 'hyperv:power',  restrictionKey: 'hyperv.vm_save' },
  pause:              { cap: 'hyperv:power',  restrictionKey: 'hyperv.vm_save' },
  resume:             { cap: 'hyperv:power',  restrictionKey: 'hyperv.vm_save' },
  checkpoint_create:  { cap: 'hyperv:manage', restrictionKey: 'hyperv.vm_checkpoint' },
  checkpoint_apply:   { cap: 'hyperv:manage', restrictionKey: 'hyperv.vm_checkpoint_apply' },
  checkpoint_delete:  { cap: 'hyperv:manage', restrictionKey: 'hyperv.vm_checkpoint_delete' },
  edit:               { cap: 'hyperv:manage', restrictionKey: 'hyperv.vm_edit' },
  create:             { cap: 'hyperv:manage', restrictionKey: 'hyperv.vm_create' },
  delete:             { cap: 'hyperv:manage', restrictionKey: 'hyperv.vm_delete' },
};

// GET /api/hyperv/devices/:id/vms — VM list for one host.
router.get('/devices/:id/vms', requireDeviceRead('id'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const isAdmin = req.session.role === 'admin';
    if (!isAdmin && !(await permissionService.canUseCapability(req.session.userId!, id, false, 'hyperv:view'))) {
      return res.status(403).json({ error: 'hyperv:view capability required' });
    }
    const vms = await hyperVService.listForDevice(id);
    res.json({ data: vms });
  } catch (err) { next(err); }
});

// POST /api/hyperv/devices/:id/refresh — ask the host agent to re-enumerate.
// Manual one-shot (button) — goes through the durable command queue so it
// shows in task history.
router.post('/devices/:id/refresh', requireDeviceRead('id'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const isAdmin = req.session.role === 'admin';
    if (!isAdmin && !(await permissionService.canUseCapability(req.session.userId!, id, false, 'hyperv:view'))) {
      return res.status(403).json({ error: 'hyperv:view capability required' });
    }
    const cmd = await commandService.enqueue({
      deviceId: id, tenantId: req.tenantId!, type: 'hyperv_list_vms' as any,
      priority: 'high', expiresInSeconds: 120, createdBy: req.session.userId,
    });
    res.json({ data: cmd });
  } catch (err) { next(err); }
});

// POST /api/hyperv/devices/:id/live — live heartbeat from an open Hyper-V
// view. Pushes an EPHEMERAL enumerate over the WS command channel (instant,
// no command-queue row → no task-history spam; `hyperv_list_vms` is on the
// noisy-ephemeral denylist in command.service). The client calls this on a
// short interval while the view is open so external changes (a VM started
// directly on the host) surface within a few seconds. Falls back to nothing
// when the agent isn't connected on the WS channel — the periodic GET still
// shows the last-known state.
router.post('/devices/:id/live', requireDeviceRead('id'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const isAdmin = req.session.role === 'admin';
    if (!isAdmin && !(await permissionService.canUseCapability(req.session.userId!, id, false, 'hyperv:view'))) {
      return res.status(403).json({ error: 'hyperv:view capability required' });
    }
    const { agentHub } = await import('../services/agentHub.service');
    const { randomUUID } = await import('crypto');
    const delivered = agentHub.push(id, {
      type: 'command', id: randomUUID(), commandType: 'hyperv_list_vms', payload: {},
    });
    res.json({ data: { delivered } });
  } catch (err) { next(err); }
});

// GET /api/hyperv/vms — tenant-wide grid (Dashboard tab). Non-admins are
// scoped to the host devices they can see.
router.get('/vms', async (req, res, next) => {
  try {
    const isAdmin = req.session.role === 'admin';
    let hostIds: number[] | undefined;
    if (!isAdmin) {
      const visible = await permissionService.getVisibleDeviceIds(req.session.userId!, false);
      hostIds = Array.isArray(visible) ? visible : [];
    }
    const vms = await hyperVService.listForTenant(req.tenantId!, hostIds);
    res.json({ data: vms });
  } catch (err) { next(err); }
});

// POST /api/hyperv/devices/:id/vms/:vmId/action — run an action on a VM.
// Gated by (capability tier) + (per-tenant restriction matrix), then enqueued
// as a single hyperv_control command the host agent executes.
router.post('/devices/:id/vms/:vmId/action', requireDeviceRead('id'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const vmId = String(req.params.vmId);
    const action = String(req.body?.action) as VmAction;
    const params = (req.body?.params && typeof req.body.params === 'object') ? req.body.params : {};

    const meta = ACTION_META[action];
    if (!meta) return res.status(400).json({ error: `Unknown VM action: ${action}` });

    const isAdmin = req.session.role === 'admin';
    if (!isAdmin && !(await permissionService.canUseCapability(req.session.userId!, id, false, meta.cap))) {
      return res.status(403).json({ error: `${meta.cap} capability required` });
    }

    // Ownership: the VM must exist on this host within the caller's tenant
    // (except 'create' which has no existing VM yet).
    let vmName = vmId;
    if (action !== 'create') {
      const vm = await hyperVService.getVM(id, vmId, req.tenantId!);
      if (!vm) return res.status(404).json({ error: 'VM not found on this host' });
      vmName = vm.name;
    }

    // Restriction gate (2FA / double-admin per the tenant matrix).
    const approved = await applyRestriction(res, {
      req,
      actionKey: meta.restrictionKey,
      deviceIds: [id],
      approvalRequestType: 'batch_command',
      approvalDescription: `Hyper-V ${action} on VM "${vmName}"`,
      approvalPayload: { action: 'hyperv_control', deviceIds: [id], params: { action, vmId, params } },
    });
    if (!approved) return;

    const cmd = await commandService.enqueue({
      deviceId: id, tenantId: req.tenantId!, type: 'hyperv_control' as any,
      payload: { action, vmId, params },
      priority: 'high', expiresInSeconds: 300, createdBy: req.session.userId,
    });

    try {
      const { auditService } = await import('../services/audit.service');
      await auditService.logReq(req, `hyperv.${action}`, {
        deviceId: id, resourceType: 'command', resourcePath: cmd.id,
        details: { vmId, vmName, action },
      });
    } catch {}

    res.json({ data: cmd });
  } catch (err) { next(err); }
});

export default router;
