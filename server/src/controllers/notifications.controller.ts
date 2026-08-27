import type { Request, Response, NextFunction } from 'express';
import { notificationService } from '../services/notification.service';
import { deviceService } from '../services/device.service';
import { getPluginMetas } from '../notifications/registry';
import { AppError } from '../middleware/errorHandler';
import { isMasterTenant } from '@obliance/shared';
import type {
  CreateChannelInput,
  UpdateChannelInput,
  AddBindingInput,
  RemoveBindingInput,
} from '../validators/notification.schema';

// Tenant ownership gate for any operation on a notification channel.
// `notificationService.getChannelById` is intentionally tenant-agnostic
// (used by background jobs that fan out across tenants), so EVERY
// request-handler that exposes / mutates a channel MUST run this check
// first. A child tenant calling with an id owned by another tenant
// gets a 404 — same shape as "doesn't exist", so we don't leak the
// existence of foreign channels.
//
// Two flavours:
//   - assertChannelVisible: caller must own the channel OR be on the
//     master tenant (master sees all channels). Used for read endpoints.
//   - assertChannelOwnedByCaller: STRICT — caller must be the channel
//     owner, no master pass-through. Used for ANY mutation that affects
//     where the channel lights up: edit, delete, bindings. Master is
//     the owner of master-fan-out channels (it created them) so it
//     passes naturally; conversely a child tenant CANNOT attach a
//     master channel to its own scope, which is the rule:
//     "FreeMobile API key vit chez le master, le DSI client n'a pas le
//      droit de la rebrancher où il veut".
async function assertChannelVisible(channelId: number, req: Request): Promise<void> {
  const channel = await notificationService.getChannelById(channelId);
  if (!channel) throw new AppError(404, 'Channel not found');
  if (!isMasterTenant(req.tenantId) && channel.tenantId !== req.tenantId) {
    throw new AppError(404, 'Channel not found');
  }
}

async function assertChannelOwnedByCaller(channelId: number, req: Request): Promise<void> {
  const channel = await notificationService.getChannelById(channelId);
  if (!channel) throw new AppError(404, 'Channel not found');
  if (channel.tenantId !== req.tenantId) {
    // 403, not 404, on this stricter path. The caller already KNOWS
    // the channel exists (otherwise they couldn't have selected it
    // in the picker) — pretending it doesn't is just confusing UX.
    throw new AppError(403, 'Cannot mutate a channel you do not own');
  }
}

// Backwards-compat alias for the call sites I haven't converted yet.
const assertChannelOwnership = assertChannelVisible;

export const notificationsController = {
  // GET /api/notifications/plugins — list available plugin types
  async plugins(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const metas = getPluginMetas();
      res.json({ success: true, data: metas });
    } catch (err) {
      next(err);
    }
  },

  // GET /api/notifications/channels
  async listChannels(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const channels = await notificationService.getAllChannels(req.tenantId);
      res.json({ success: true, data: channels });
    } catch (err) {
      next(err);
    }
  },

  // GET /api/notifications/channels/:id
  async getChannel(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = parseInt(req.params.id, 10);
      await assertChannelOwnership(id, req);
      const channel = await notificationService.getChannelById(id);
      res.json({ success: true, data: channel });
    } catch (err) {
      next(err);
    }
  },

  // POST /api/notifications/channels
  async createChannel(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const data = req.body as CreateChannelInput;
      const channel = await notificationService.createChannel({
        ...data,
        createdBy: req.session.userId!,
      }, req.tenantId);
      res.status(201).json({ success: true, data: channel });
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('Unknown notification')) {
        next(new AppError(400, err.message));
      } else {
        next(err);
      }
    }
  },

  // PUT /api/notifications/channels/:id
  async updateChannel(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = parseInt(req.params.id, 10);
      // STRICT: only the channel's own tenant may edit. Master cannot
      // edit a child tenant's channel, and a child tenant cannot edit
      // a master-shared channel (read-only on its side).
      await assertChannelOwnedByCaller(id, req);
      const data = req.body as UpdateChannelInput;
      const channel = await notificationService.updateChannel(id, data);
      if (!channel) throw new AppError(404, 'Channel not found');
      res.json({ success: true, data: channel });
    } catch (err) {
      next(err);
    }
  },

  // DELETE /api/notifications/channels/:id
  async deleteChannel(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = parseInt(req.params.id, 10);
      await assertChannelOwnedByCaller(id, req);
      const deleted = await notificationService.deleteChannel(id);
      if (!deleted) throw new AppError(404, 'Channel not found');
      res.json({ success: true, message: 'Channel deleted' });
    } catch (err) {
      next(err);
    }
  },

  // POST /api/notifications/channels/:id/test
  async testChannel(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = parseInt(req.params.id, 10);
      await assertChannelOwnership(id, req);
      await notificationService.testChannel(id);
      res.json({ success: true, message: 'Test notification sent' });
    } catch (err: unknown) {
      if (err instanceof Error && !(err instanceof AppError)) {
        next(new AppError(400, `Test failed: ${err.message}`));
      } else {
        next(err);
      }
    }
  },

  // GET /api/notifications/channels/:id/tenants — list tenant IDs the channel is shared to
  // Sharing is a master-only concept (only the master tenant can fan
  // a channel out to multiple tenants). A child tenant should never
  // see this list, regardless of whether it owns the channel.
  async getChannelTenants(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = parseInt(req.params.id, 10);
      if (!isMasterTenant(req.tenantId)) throw new AppError(403, 'Channel sharing is master-tenant only');
      await assertChannelOwnership(id, req);
      const tenantIds = await notificationService.getChannelTenants(id);
      res.json({ success: true, data: tenantIds });
    } catch (err) {
      next(err);
    }
  },

  // PUT /api/notifications/channels/:id/tenants — replace sharing list
  async setChannelTenants(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = parseInt(req.params.id, 10);
      if (!isMasterTenant(req.tenantId)) throw new AppError(403, 'Channel sharing is master-tenant only');
      await assertChannelOwnership(id, req);
      const tenantIds: number[] = req.body.tenantIds ?? [];
      if (!Array.isArray(tenantIds)) {
        throw new AppError(400, 'tenantIds must be an array');
      }
      await notificationService.setChannelTenants(id, tenantIds);
      res.json({ success: true, message: 'Channel tenants updated' });
    } catch (err) {
      next(err);
    }
  },

  // ── Bindings ──

  // GET /api/notifications/bindings?scope=...&scopeId=...
  async listBindings(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const scope = req.query.scope as string;
      const rawScopeId = req.query.scopeId as string | undefined;
      const scopeId = rawScopeId && rawScopeId !== 'null' ? parseInt(rawScopeId, 10) : null;
      const bindings = await notificationService.getBindings(scope, scopeId);
      res.json({ success: true, data: bindings });
    } catch (err) {
      next(err);
    }
  },

  // POST /api/notifications/bindings
  async addBinding(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const data = req.body as AddBindingInput;
      // STRICT ownership — a child tenant cannot bind a master-shared
      // channel to its own scope (the master controls where its
      // FreeMobile / generic webhook is allowed to fire). Master can
      // only bind master-owned channels (it owns them), which means a
      // child-tenant scope receiving a master-owned binding is the
      // result of a master admin explicitly attaching it.
      await assertChannelOwnedByCaller(data.channelId, req);
      const binding = await notificationService.addBinding(
        data.channelId,
        data.scope,
        data.scopeId,
        req.tenantId!,
        data.overrideMode,
      );
      res.status(201).json({ success: true, data: binding });
    } catch (err) {
      next(err);
    }
  },

  // DELETE /api/notifications/bindings
  async removeBinding(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const data = req.body as RemoveBindingInput;
      await assertChannelOwnedByCaller(data.channelId, req);
      const removed = await notificationService.removeBinding(data.channelId, data.scope, data.scopeId);
      res.json({ success: true, message: removed ? 'Binding removed' : 'Binding not found' });
    } catch (err) {
      next(err);
    }
  },

  // GET /api/notifications/bindings/resolved?scope=monitor|group|agent&scopeId=N
  async resolvedBindings(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const scope = req.query.scope as 'group' | 'device' | 'agent';
      const scopeId = parseInt(req.query.scopeId as string, 10);

      if (!scope || isNaN(scopeId)) {
        throw new AppError(400, 'Missing scope or scopeId');
      }

      // Agent scope uses its own resolution method (global → agent group hierarchy → agent)
      if (scope === 'agent') {
        const resolved = await notificationService.resolveBindingsWithSourcesForAgent(scopeId);
        res.json({ success: true, data: resolved });
        return;
      }

      // For device scope, we need the device's groupId for resolution
      let groupId: number | null = null;
      if (scope === 'device') {
        const device = await deviceService.getDeviceById(scopeId, req.tenantId);
        if (!device) throw new AppError(404, 'Device not found');
        groupId = device.groupId;
      }

      const resolved = await notificationService.resolveBindingsWithSources(scope, scopeId, groupId);
      res.json({ success: true, data: resolved });
    } catch (err) {
      next(err);
    }
  },
};
