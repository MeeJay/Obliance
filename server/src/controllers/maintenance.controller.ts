import type { Request, Response } from 'express';
import { maintenanceService, isWindowActive } from '../services/maintenance.service';
import type { CreateMaintenanceWindowRequest, UpdateMaintenanceWindowRequest, MaintenanceScopeType } from '@obliance/shared';
import { isMasterTenant } from '@obliance/shared';
import { db } from '../db';

// Tenant ownership gate. `maintenanceService.getById` is intentionally
// tenant-agnostic (background scheduler uses it cross-tenant), so any
// request-handler exposing / mutating a window MUST run this check
// first. 404 on cross-tenant — same shape as "doesn't exist" so a
// foreign window's existence isn't leaked.
async function loadOwnedWindow(id: number, req: Request): Promise<Awaited<ReturnType<typeof maintenanceService.getById>> | null> {
  const w = await maintenanceService.getById(id);
  if (!w) return null;
  if (!isMasterTenant(req.tenantId) && w.tenantId !== req.tenantId) return null;
  return w;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function enrichWindow(w: Awaited<ReturnType<typeof maintenanceService.getById>>) {
  if (!w) return null;
  const now = new Date();
  const isActiveNow = isWindowActive(w, now);

  // Resolve scope name
  let scopeName: string;
  if (w.scopeType === 'global') {
    scopeName = 'Global';
  } else {
    scopeName = `#${w.scopeId}`;
    try {
      if (w.scopeType === 'group') {
        const row = await db('device_groups').where({ id: w.scopeId }).select('name').first();
        if (row) scopeName = row.name;
      } else if (w.scopeType === 'device') {
        const row = await db('devices').where({ id: w.scopeId }).select('display_name', 'hostname').first();
        if (row) scopeName = row.display_name ?? row.hostname;
      }
    } catch { /* ignore */ }
  }

  return { ...w, isActiveNow, scopeName };
}

// ── Controllers ───────────────────────────────────────────────────────────────

export const maintenanceController = {
  async list(req: Request, res: Response) {
    try {
      const { scopeType, scopeId } = req.query;
      const filters: { scopeType?: string; scopeId?: number } = {};
      if (typeof scopeType === 'string') filters.scopeType = scopeType;
      if (typeof scopeId === 'string') filters.scopeId = Number(scopeId);

      const windows = await maintenanceService.list(req.tenantId, filters);
      const enriched = await Promise.all(windows.map(enrichWindow));
      return res.json({ success: true, data: enriched });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }
  },

  async getById(req: Request, res: Response) {
    try {
      const id = Number(req.params.id);
      const window = await loadOwnedWindow(id, req);
      if (!window) return res.status(404).json({ success: false, error: 'Not found' });
      const enriched = await enrichWindow(window);
      return res.json({ success: true, data: enriched });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }
  },

  async create(req: Request, res: Response) {
    try {
      const body: CreateMaintenanceWindowRequest = req.body;

      if (!body.name || !body.scopeType || !body.scheduleType) {
        return res.status(400).json({ success: false, error: 'name, scopeType and scheduleType are required' });
      }
      // scopeId is required for non-global scope types
      if (body.scopeType !== 'global' && !body.scopeId) {
        return res.status(400).json({ success: false, error: 'scopeId is required for non-global windows' });
      }
      if (body.scheduleType === 'one_time' && (!body.startAt || !body.endAt)) {
        return res.status(400).json({ success: false, error: 'startAt and endAt are required for one-time windows' });
      }
      if (body.scheduleType === 'recurring' && (!body.startTime || !body.endTime || !body.recurrenceType)) {
        return res.status(400).json({ success: false, error: 'startTime, endTime and recurrenceType are required for recurring windows' });
      }

      const created = await maintenanceService.create({
        tenantId: req.tenantId,
        name: body.name,
        scopeType: body.scopeType,
        scopeId: body.scopeType === 'global' ? null : (body.scopeId ?? null),
        scheduleType: body.scheduleType,
        startsAt: body.startsAt ?? body.startAt ?? '',
        endsAt: body.endsAt ?? body.endAt ?? '',
        recurrenceRule: body.recurrenceRule ?? undefined,
        timezone: body.timezone ?? 'UTC',
        notificationChannels: body.notificationChannels ?? body.notifyChannelIds ?? [],
        createdBy: req.session?.userId ?? null,
      });

      const enriched = await enrichWindow(created);
      return res.status(201).json({ success: true, data: enriched });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }
  },

  async update(req: Request, res: Response) {
    try {
      const id = Number(req.params.id);
      const owned = await loadOwnedWindow(id, req);
      if (!owned) return res.status(404).json({ success: false, error: 'Not found' });
      const body: UpdateMaintenanceWindowRequest = req.body;

      const updated = await maintenanceService.update(id, {
        name: body.name,
        scopeType: body.scopeType,
        scopeId: body.scopeId,
        scheduleType: body.scheduleType,
        startsAt: body.startsAt ?? body.startAt ?? undefined,
        endsAt: body.endsAt ?? body.endAt ?? undefined,
        recurrenceRule: body.recurrenceRule ?? undefined,
        timezone: body.timezone,
        notificationChannels: body.notificationChannels ?? body.notifyChannelIds,
      });
      if (!updated) return res.status(404).json({ success: false, error: 'Not found' });

      const enriched = await enrichWindow(updated);
      return res.json({ success: true, data: enriched });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }
  },

  async delete(req: Request, res: Response) {
    try {
      const id = Number(req.params.id);
      const existing = await loadOwnedWindow(id, req);
      if (!existing) return res.status(404).json({ success: false, error: 'Not found' });
      await maintenanceService.delete(id);
      return res.json({ success: true });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }
  },

  /**
   * GET /maintenance/effective/:type/:id
   * Returns all effective windows (local + inherited) for a device or group.
   * Enriches each window with source, sourceName, isDisabledHere, canEdit, etc.
   */
  async getEffective(req: Request, res: Response) {
    try {
      const scopeType = req.params.type as 'device' | 'group';
      const scopeId = Number(req.params.id);

      if (!['device', 'group'].includes(scopeType)) {
        return res.status(400).json({ success: false, error: 'type must be device or group' });
      }

      // Resolve groupId for devices
      let groupId: number | null = null;
      if (scopeType === 'device') {
        const row = await db('devices').where({ id: scopeId }).select('group_id').first();
        groupId = row?.group_id ?? null;
      } else {
        // group: groupId = scopeId itself (used to find parent groups)
        groupId = scopeId;
      }

      const windows = await maintenanceService.getEffectiveWindows(scopeType, scopeId, groupId);

      // Enrich sourceName for local windows (we know the scope name since we're on the detail page,
      // but keep it undefined to let the client use its own label — consistent with plan)
      const now = new Date();
      const enriched = windows.map((w) => ({
        ...w,
        isActiveNow: w.isActiveNow ?? isWindowActive(w, now),
      }));

      return res.json({ success: true, data: enriched });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }
  },

  /**
   * POST /maintenance/:id/disable
   * Body: { scopeType: 'group'|'device', scopeId: number }
   * Disables an inherited window at the given scope.
   */
  async disable(req: Request, res: Response) {
    try {
      const windowId = Number(req.params.id);
      const { scopeType, scopeId } = req.body as { scopeType: 'group' | 'device'; scopeId: number };

      if (!scopeType || !scopeId) {
        return res.status(400).json({ success: false, error: 'scopeType and scopeId are required' });
      }
      if (!['group', 'device'].includes(scopeType)) {
        return res.status(400).json({ success: false, error: 'scopeType must be group or device' });
      }

      const existing = await loadOwnedWindow(windowId, req);
      if (!existing) return res.status(404).json({ success: false, error: 'Maintenance window not found' });
      // Validate the SCOPE side too — caller must own the group /
      // device they're trying to disable the inherited window on.
      // Without this, a tenant admin could disable a global window's
      // effect on another tenant's group. (Reads against a foreign
      // tenant's group fall through 404 because the WHERE clause
      // misses.)
      if (!await scopeBelongsToCallerTenant(scopeType, Number(scopeId), req)) {
        return res.status(404).json({ success: false, error: 'Scope not found' });
      }

      await maintenanceService.disableWindowForScope(windowId, scopeType, Number(scopeId));
      return res.json({ success: true });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }
  },

  /**
   * DELETE /maintenance/:id/disable
   * Body: { scopeType: 'group'|'device', scopeId: number }
   * Re-enables a previously disabled inherited window at the given scope.
   */
  async enable(req: Request, res: Response) {
    try {
      const windowId = Number(req.params.id);
      const { scopeType, scopeId } = req.body as { scopeType: 'group' | 'device'; scopeId: number };

      if (!scopeType || !scopeId) {
        return res.status(400).json({ success: false, error: 'scopeType and scopeId are required' });
      }
      if (!['group', 'device'].includes(scopeType)) {
        return res.status(400).json({ success: false, error: 'scopeType must be group or device' });
      }

      const existing = await loadOwnedWindow(windowId, req);
      if (!existing) return res.status(404).json({ success: false, error: 'Maintenance window not found' });
      if (!await scopeBelongsToCallerTenant(scopeType, Number(scopeId), req)) {
        return res.status(404).json({ success: false, error: 'Scope not found' });
      }

      await maintenanceService.enableWindowForScope(windowId, scopeType, Number(scopeId));
      return res.json({ success: true });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }
  },
};

async function scopeBelongsToCallerTenant(scopeType: 'group' | 'device', scopeId: number, req: Request): Promise<boolean> {
  if (isMasterTenant(req.tenantId)) return true; // god view sees all
  const table = scopeType === 'group' ? 'device_groups' : 'devices';
  const row = await db(table).where({ id: scopeId }).first('tenant_id') as { tenant_id: number } | undefined;
  return !!row && row.tenant_id === req.tenantId;
}
