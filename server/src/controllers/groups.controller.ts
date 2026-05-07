import type { Request, Response, NextFunction } from 'express';
import { groupService } from '../services/group.service';
import { permissionService } from '../services/permission.service';
import { teamService } from '../services/team.service';
import { groupNotificationService } from '../services/groupNotification.service';
import { AppError } from '../middleware/errorHandler';
import type { CreateGroupInput, UpdateGroupInput, MoveGroupInput } from '../validators/group.schema';

export const groupsController = {
  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const isAdmin = req.session.role === 'admin';
      const allGroups = await groupService.getAll(req.tenantId);

      if (isAdmin) {
        res.json({ success: true, data: allGroups });
        return;
      }

      const visibleIds = await permissionService.getVisibleGroupIds(req.session.userId!, false);
      if (visibleIds === 'all') {
        res.json({ success: true, data: allGroups });
        return;
      }

      const visibleSet = new Set(visibleIds);
      const filtered = allGroups.filter((g) => visibleSet.has(g.id));
      res.json({ success: true, data: filtered });
    } catch (err) {
      next(err);
    }
  },

  async tree(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const isAdmin = req.session.role === 'admin';
      const tree = await groupService.getTree(req.tenantId);

      if (isAdmin) {
        res.json({ success: true, data: tree });
        return;
      }

      const visibleIds = await permissionService.getVisibleGroupIds(req.session.userId!, false);
      if (visibleIds === 'all') {
        res.json({ success: true, data: tree });
        return;
      }

      // Filter tree to only include visible groups
      const visibleSet = new Set(visibleIds);
      function filterTree(nodes: typeof tree): typeof tree {
        return nodes
          .filter((n) => visibleSet.has(n.id))
          .map((n) => ({ ...n, children: filterTree(n.children) }));
      }
      res.json({ success: true, data: filterTree(tree) });
    } catch (err) {
      next(err);
    }
  },

  async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = parseInt(req.params.id, 10);
      const group = await groupService.getById(id);
      if (!group) throw new AppError(404, 'Group not found');

      // Tenant ownership gate. Master tenant (id=1) gets the god view —
      // can read groups owned by any tenant. Every other tenant sees
      // strictly its own groups; cross-tenant ID guessing returns 404
      // (404 over 403 to avoid leaking that the group exists).
      if (req.tenantId !== 1 && group.tenantId !== req.tenantId) {
        throw new AppError(404, 'Group not found');
      }

      const isAdmin = req.session.role === 'admin';
      if (!isAdmin) {
        const canRead = await permissionService.canReadGroup(req.session.userId!, id, false);
        if (!canRead) throw new AppError(403, 'Access denied');
      }

      res.json({ success: true, data: group });
    } catch (err) {
      next(err);
    }
  },

  async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const data = req.body as CreateGroupInput;

      // Validate parent exists if specified
      if (data.parentId) {
        const parent = await groupService.getById(data.parentId);
        if (!parent) throw new AppError(400, 'Parent group not found');
      }

      const group = await groupService.create(data, req.tenantId);

      // Auto-assign RW to creator's teams that have canCreate
      if (req.session.role !== 'admin') {
        const userTeams = await teamService.getUserTeams(req.session.userId!);
        for (const team of userTeams) {
          if (team.canCreate) {
            await teamService.addPermission(team.id, 'group', group.id, 'rw');
          }
        }
      }

      // Broadcast via Socket.io
      const io = req.app.get('io');
      if (io) {
        io.to('role:admin').emit('group:created', { group });
      }

      try {
        const { auditService } = await import('../services/audit.service');
        await auditService.logReq(req, 'group.created', {
          resourceType: 'group', resourcePath: String(group.id),
          details: { name: group.name, parentId: group.parentId ?? null },
        });
      } catch {}

      res.status(201).json({ success: true, data: group });
    } catch (err) {
      next(err);
    }
  },

  async update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = parseInt(req.params.id, 10);
      // Tenant ownership gate before any write — a child-tenant request
      // cannot mutate a group owned by another tenant. Master (id=1)
      // bypasses by design.
      const existing = await groupService.getById(id);
      if (!existing) throw new AppError(404, 'Group not found');
      if (req.tenantId !== 1 && existing.tenantId !== req.tenantId) {
        throw new AppError(404, 'Group not found');
      }
      const data = req.body as UpdateGroupInput;
      const group = await groupService.update(id, data);

      if (!group) throw new AppError(404, 'Group not found');

      if (data.groupNotifications !== undefined) {
        groupNotificationService.removeGroup(id);
      }

      const io = req.app.get('io');
      if (io) {
        io.to('role:admin').emit('group:updated', { group });
      }

      try {
        const { auditService } = await import('../services/audit.service');
        await auditService.logReq(req, 'group.updated', {
          resourceType: 'group', resourcePath: String(id),
          details: { name: group.name },
        });
      } catch {}

      res.json({ success: true, data: group });
    } catch (err) {
      next(err);
    }
  },

  async move(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = parseInt(req.params.id, 10);
      const { newParentId } = req.body as MoveGroupInput;

      // Tenant ownership gate — and verify the target parent belongs to
      // the same tenant so a child-tenant admin cannot reparent a group
      // into another tenant's tree (master bypass).
      const existing = await groupService.getById(id);
      if (!existing) throw new AppError(404, 'Group not found');
      if (req.tenantId !== 1 && existing.tenantId !== req.tenantId) {
        throw new AppError(404, 'Group not found');
      }
      if (newParentId !== null) {
        const parent = await groupService.getById(newParentId);
        if (!parent) throw new AppError(400, 'Parent group not found');
        if (parent.tenantId !== existing.tenantId) {
          throw new AppError(400, 'Parent must be in the same tenant');
        }
      }

      // Also check write permission on target parent if non-admin
      const isAdmin = req.session.role === 'admin';
      if (!isAdmin && newParentId !== null) {
        const canWriteTarget = await permissionService.canWriteGroup(req.session.userId!, newParentId, false);
        if (!canWriteTarget) throw new AppError(403, 'No write permission on target group');
      }

      const group = await groupService.move(id, newParentId);
      if (!group) throw new AppError(404, 'Group not found');

      const io = req.app.get('io');
      if (io) {
        io.to('role:admin').emit('group:moved', { group });
      }

      res.json({ success: true, data: group });
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('circular')) {
        next(new AppError(400, err.message));
      } else {
        next(err);
      }
    }
  },

  async delete(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = parseInt(req.params.id, 10);

      // Same tenant gate as update — only the group's owner tenant
      // (or master) may delete it.
      const existing = await groupService.getById(id);
      if (!existing) throw new AppError(404, 'Group not found');
      if (req.tenantId !== 1 && existing.tenantId !== req.tenantId) {
        throw new AppError(404, 'Group not found');
      }

      groupNotificationService.removeGroup(id);

      const deleted = await groupService.delete(id);
      if (!deleted) throw new AppError(404, 'Group not found');

      const io = req.app.get('io');
      if (io) {
        io.to('role:admin').emit('group:deleted', { groupId: id });
      }

      try {
        const { auditService } = await import('../services/audit.service');
        await auditService.logReq(req, 'group.deleted', {
          resourceType: 'group', resourcePath: String(id),
        });
      } catch {}

      res.json({ success: true, message: 'Group deleted' });
    } catch (err) {
      next(err);
    }
  },

  async stats(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      res.json({ success: true, data: {} });
    } catch (err) {
      next(err);
    }
  },

  async reorder(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const items = req.body.items as { id: number; sortOrder: number }[];
      if (!Array.isArray(items) || items.length === 0) {
        throw new AppError(400, 'items array is required');
      }
      await groupService.reorder(items);

      const io = req.app.get('io');
      if (io) {
        io.to('role:admin').emit('group:reordered', { items });
      }

      res.json({ success: true, message: 'Groups reordered' });
    } catch (err) {
      next(err);
    }
  },

  /** PATCH /groups/:id/agent-config — update group config */
  async updateAgentGroupConfig(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const groupId = parseInt(req.params.id, 10);
      if (req.session.role !== 'admin') throw new AppError(403, 'Admin only');

      const group = await groupService.getById(groupId);
      if (!group) throw new AppError(404, 'Group not found');

      const { groupConfig } = req.body as {
        groupConfig?: { pushIntervalSeconds?: number; maxMissedPushes?: number; autoApprove?: boolean };
      };

      const updated = groupConfig !== undefined
        ? await groupService.update(groupId, { groupConfig })
        : group;

      res.json({ success: true, data: updated });
    } catch (err) {
      next(err);
    }
  },
};
