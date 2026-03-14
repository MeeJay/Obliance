import type { Request, Response } from 'express';
import { maintenanceService, isWindowActive } from '../services/maintenance.service';
import type { CreateMaintenanceWindowRequest, UpdateMaintenanceWindowRequest, MaintenanceScopeType } from '@obliance/shared';
import { db } from '../db';

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
      const window = await maintenanceService.getById(id);
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
      const existing = await maintenanceService.getById(id);
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

      const existing = await maintenanceService.getById(windowId);
      if (!existing) return res.status(404).json({ success: false, error: 'Maintenance window not found' });

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

      await maintenanceService.enableWindowForScope(windowId, scopeType, Number(scopeId));
      return res.json({ success: true });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }
  },
};
