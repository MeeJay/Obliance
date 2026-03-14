import type { Request, Response, NextFunction } from 'express';
import { notificationService } from '../services/notification.service';
import { deviceService } from '../services/device.service';
import { getPluginMetas } from '../notifications/registry';
import { AppError } from '../middleware/errorHandler';
import type {
  CreateChannelInput,
  UpdateChannelInput,
  AddBindingInput,
  RemoveBindingInput,
} from '../validators/notification.schema';

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
      const channel = await notificationService.getChannelById(id);
      if (!channel) throw new AppError(404, 'Channel not found');
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
      await notificationService.testChannel(id);
      res.json({ success: true, message: 'Test notification sent' });
    } catch (err: unknown) {
      if (err instanceof Error) {
        next(new AppError(400, `Test failed: ${err.message}`));
      } else {
        next(err);
      }
    }
  },

  // GET /api/notifications/channels/:id/tenants — list tenant IDs the channel is shared to
  async getChannelTenants(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = parseInt(req.params.id, 10);
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
      const binding = await notificationService.addBinding(
        data.channelId,
        data.scope,
        data.scopeId,
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
