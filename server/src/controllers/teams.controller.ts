import type { Request, Response, NextFunction } from 'express';
import { teamService } from '../services/team.service';
import { AppError } from '../middleware/errorHandler';
import type {
  CreateTeamInput,
  UpdateTeamInput,
  SetTeamMembersInput,
  SetTeamPermissionsInput,
} from '../validators/team.schema';

export const teamsController = {
  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      // Platform admins can request all teams across tenants via ?scope=all
      // Otherwise scope to the current tenant from session
      const isPlatformAdmin = req.session.role === 'admin';
      const scopeAll = isPlatformAdmin && req.query.scope === 'all';
      const teams = await teamService.getAll(scopeAll ? null : req.tenantId);
      res.json({ success: true, data: teams });
    } catch (err) {
      next(err);
    }
  },

  async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = parseInt(req.params.id, 10);
      const team = await teamService.getById(id);
      if (!team) throw new AppError(404, 'Team not found');

      const [members, permissions] = await Promise.all([
        teamService.getMembers(id),
        teamService.getPermissions(id),
      ]);

      res.json({ success: true, data: { ...team, memberIds: members, permissions } });
    } catch (err) {
      next(err);
    }
  },

  async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { applyRestriction } = await import('../services/restriction.service');
      const gated = await applyRestriction(res, {
        req, actionKey: 'tenant.manage_teams',
        approvalRequestType: 'batch_command',
        approvalDescription: `Create team`,
        approvalPayload: { action: 'team_create', body: req.body },
      });
      if (!gated) return;

      const data = req.body as CreateTeamInput & { tenantId?: number };
      // Platform admins can specify the target tenant in the body; others use the session tenant
      const isPlatformAdmin = req.session.role === 'admin';
      const targetTenantId = (isPlatformAdmin && data.tenantId) ? data.tenantId : req.tenantId;
      const team = await teamService.create(data, targetTenantId);
      try {
        const { auditService } = await import('../services/audit.service');
        await auditService.logReq(req, 'team.created', {
          resourceType: 'team', resourcePath: String(team.id),
          details: { name: team.name },
        });
      } catch {}
      res.status(201).json({ success: true, data: team });
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('unique')) {
        next(new AppError(409, 'Team name already exists'));
      } else {
        next(err);
      }
    }
  },

  async update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { applyRestriction } = await import('../services/restriction.service');
      const gated = await applyRestriction(res, {
        req, actionKey: 'tenant.manage_teams',
        approvalRequestType: 'batch_command',
        approvalDescription: `Update team #${req.params.id}`,
        approvalPayload: { action: 'team_update', teamId: parseInt(req.params.id, 10) },
      });
      if (!gated) return;

      const id = parseInt(req.params.id, 10);
      const data = req.body as UpdateTeamInput;
      const team = await teamService.update(id, data);
      if (!team) throw new AppError(404, 'Team not found');
      try {
        const { auditService } = await import('../services/audit.service');
        await auditService.logReq(req, 'team.updated', {
          resourceType: 'team', resourcePath: String(id), details: { name: team.name },
        });
      } catch {}
      res.json({ success: true, data: team });
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('unique')) {
        next(new AppError(409, 'Team name already exists'));
      } else {
        next(err);
      }
    }
  },

  async delete(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { applyRestriction } = await import('../services/restriction.service');
      const gated = await applyRestriction(res, {
        req, actionKey: 'tenant.manage_teams',
        approvalRequestType: 'batch_command',
        approvalDescription: `Delete team #${req.params.id}`,
        approvalPayload: { action: 'team_delete', teamId: parseInt(req.params.id, 10) },
      });
      if (!gated) return;

      const id = parseInt(req.params.id, 10);
      const deleted = await teamService.delete(id);
      if (!deleted) throw new AppError(404, 'Team not found');
      try {
        const { auditService } = await import('../services/audit.service');
        await auditService.logReq(req, 'team.deleted', { resourceType: 'team', resourcePath: String(id) });
      } catch {}
      res.json({ success: true, message: 'Team deleted' });
    } catch (err) {
      next(err);
    }
  },

  // ── Members ──

  async getMembers(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = parseInt(req.params.id, 10);
      const members = await teamService.getMembers(id);
      res.json({ success: true, data: members });
    } catch (err) {
      next(err);
    }
  },

  async setMembers(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { applyRestriction } = await import('../services/restriction.service');
      const gated = await applyRestriction(res, {
        req, actionKey: 'tenant.manage_permissions',
        approvalRequestType: 'batch_command',
        approvalDescription: `Set members of team #${req.params.id}`,
        approvalPayload: { action: 'team_members_set', teamId: parseInt(req.params.id, 10) },
      });
      if (!gated) return;

      const id = parseInt(req.params.id, 10);
      const { userIds } = req.body as SetTeamMembersInput;
      await teamService.setMembers(id, userIds);
      try {
        const { auditService } = await import('../services/audit.service');
        await auditService.logReq(req, 'team.members_changed', {
          resourceType: 'team', resourcePath: String(id),
          details: { userCount: userIds.length, userIds },
        });
      } catch {}
      res.json({ success: true, data: userIds });
    } catch (err) {
      next(err);
    }
  },

  // ── Permissions ──

  async getPermissions(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = parseInt(req.params.id, 10);
      const permissions = await teamService.getPermissions(id);
      res.json({ success: true, data: permissions });
    } catch (err) {
      next(err);
    }
  },

  async setPermissions(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { applyRestriction } = await import('../services/restriction.service');
      const gated = await applyRestriction(res, {
        req, actionKey: 'tenant.manage_permissions',
        approvalRequestType: 'batch_command',
        approvalDescription: `Set permissions on team #${req.params.id}`,
        approvalPayload: { action: 'team_permissions_set', teamId: parseInt(req.params.id, 10) },
      });
      if (!gated) return;

      const id = parseInt(req.params.id, 10);
      const { permissions } = req.body as SetTeamPermissionsInput;
      const result = await teamService.setPermissions(id, permissions);
      try {
        const { auditService } = await import('../services/audit.service');
        await auditService.logReq(req, 'team.permissions_changed', {
          resourceType: 'team', resourcePath: String(id),
          details: { permissionCount: permissions.length },
        });
      } catch {}
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },

  async removePermission(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const permId = parseInt(req.params.permId, 10);
      const deleted = await teamService.removePermission(permId);
      if (!deleted) throw new AppError(404, 'Permission not found');
      res.json({ success: true, message: 'Permission removed' });
    } catch (err) {
      next(err);
    }
  },
};
