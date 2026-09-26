import type { Request, Response, NextFunction } from 'express';
import { userService } from '../services/user.service';
import { teamService } from '../services/team.service';
import { AppError } from '../middleware/errorHandler';
import { userScope, actorFromReq, resetSecondFactors } from '../services/userScope.service';
import type {
  CreateUserInput,
  UpdateUserInput,
  ChangePasswordInput,
} from '../validators/user.schema';

// ── P1: scope of `users.manage` ─────────────────────────────────────────────
// (docs/mobile/device-bound-2fa.md §6.0). The rules live in
// services/userScope.service.ts (shared with the approval executor): a holder
// that is not a platform admin (req.session.role !== 'admin') may only act on
// an account it fully dominates — never a platform admin, a member of the
// current tenant, and in EVERY tenant of the account: tenant admin only if
// the caller is tenant admin there, otherwise `users.manage` + every
// capability of the account's permission set there. It may never change a
// platform role, and may only change the current tenant's membership row.
// Password and 2FA resets of one's own account go through the profile
// (current password / current code), never through here.

function isPlatformAdmin(req: Request): boolean {
  return req.session.role === 'admin';
}

async function auditUserAction(req: Request, action: string, targetId: number, details: Record<string, unknown>): Promise<void> {
  try {
    const { auditService } = await import('../services/audit.service');
    await auditService.logReq(req, action, { resourceType: 'user', resourcePath: String(targetId), details });
  } catch {}
}

export const usersController = {
  // GET /api/users
  //
  // Default tenant (id=1) is the platform-admin "god view": admins on
  // that tenant see every user across the install — they need it to
  // bootstrap memberships, audit access, etc. Any other tenant is a
  // customer workspace, so we scope the listing to users that actually
  // have access to it (i.e. own a row in `user_tenants` for it). This
  // makes the /admin/users page double as a "who can see this tenant?"
  // glance card and stops a Contoso admin from accidentally browsing
  // ACME users.
  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const tenantId = (req as any).tenantId as number | undefined;
      const scopeAll = tenantId === 1;
      const users = await userService.getAll(scopeAll ? null : tenantId ?? null);
      res.json({ success: true, data: users });
    } catch (err) {
      next(err);
    }
  },

  // GET /api/users/:id
  async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = parseInt(req.params.id, 10);
      // Same population as GET /users (members of the current tenant; every
      // account from the master tenant or for a platform admin).
      await userScope.assertReadableTarget(actorFromReq(req), id);
      const user = await userService.getById(id);
      if (!user) throw new AppError(404, 'User not found');
      res.json({ success: true, data: user });
    } catch (err) {
      next(err);
    }
  },

  // POST /api/users
  async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      // P1: creating a platform admin is a platform-role change.
      if ((req.body as CreateUserInput)?.role === 'admin' && !isPlatformAdmin(req)) {
        throw new AppError(403, 'Only a platform administrator can create an administrator account');
      }
      const { applyRestriction } = await import('../services/restriction.service');
      const gated = await applyRestriction(res, {
        req, actionKey: 'tenant.manage_users',
        approvalRequestType: 'batch_command',
        approvalDescription: `Create user ${(req.body as any)?.username ?? ''}`,
        approvalPayload: { action: 'user_create', body: req.body },
      });
      if (!gated) return;

      const data = req.body as CreateUserInput;
      const user = await userService.create(data);
      try {
        const { auditService } = await import('../services/audit.service');
        await auditService.logReq(req, 'user.created', {
          resourceType: 'user',
          resourcePath: String(user.id),
          details: { username: user.username, role: user.role },
        });
      } catch {}
      res.status(201).json({ success: true, data: user });
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('unique')) {
        next(new AppError(409, 'Username already exists'));
      } else {
        next(err);
      }
    }
  },

  // PUT /api/users/:id
  async update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = parseInt(req.params.id, 10);
      const data = req.body as UpdateUserInput;
      // P1: target scope, then platform role changes are admin-only (the
      // edit form always sends the current role: only a CHANGE is refused).
      const scoped = await userScope.assertManageableTarget(actorFromReq(req), id);
      if (data.role !== undefined && data.role !== scoped.role && !isPlatformAdmin(req)) {
        throw new AppError(403, 'Only a platform administrator can change a user role');
      }

      const { applyRestriction } = await import('../services/restriction.service');
      const gated = await applyRestriction(res, {
        req, actionKey: 'tenant.manage_users',
        approvalRequestType: 'batch_command',
        approvalDescription: `Update user #${req.params.id}`,
        approvalPayload: { action: 'user_update', userId: parseInt(req.params.id, 10), body: req.body },
      });
      if (!gated) return;

      // Block modifications for SSO users
      const targetUser = await userService.getById(id);
      if (!targetUser) throw new AppError(404, 'User not found');
      if (targetUser.foreignSource === 'obligate') {
        throw new AppError(400, 'Cannot modify SSO user — manage from Obligate');
      }

      // Prevent demoting the last admin
      if (data.role === 'user' || data.isActive === false) {
        if (targetUser.role === 'admin') {
          const allUsers = await userService.getAll();
          const activeAdmins = allUsers.filter((u) => u.role === 'admin' && u.isActive && u.id !== id);
          if (activeAdmins.length === 0) {
            throw new AppError(400, 'Cannot remove the last active admin');
          }
        }
      }

      const user = await userService.update(id, data);
      if (!user) throw new AppError(404, 'User not found');
      // P6: requireAuth does not re-read the user — a deactivated user's
      // sessions (and a demoted admin's, whose session still says 'admin')
      // must die now, not in up to 7 days.
      // The session guard caches is_active / role for a few seconds.
      const { forgetSessionUser } = await import('../middleware/sessionUserGuard');
      forgetSessionUser(id);
      const demoted = targetUser.role === 'admin' && user.role !== 'admin';
      if (data.isActive === false || demoted) {
        const { killSessionsForUser } = await import('../services/userSessions.service');
        await killSessionsForUser(id, data.isActive === false ? 'user_disabled' : 'role_demoted');
        if (data.isActive === false) {
          const { tfaTrustService } = await import('../services/tfaTrust.service');
          await tfaTrustService.revokeAllForUser(id);
        }
      }
      try {
        const { auditService } = await import('../services/audit.service');
        const roleChanged = data.role !== undefined && data.role !== targetUser.role;
        await auditService.logReq(req, roleChanged ? 'user.role_changed' : 'user.updated', {
          resourceType: 'user',
          resourcePath: String(id),
          details: { username: user.username, before: { role: targetUser.role, isActive: targetUser.isActive }, after: { role: user.role, isActive: user.isActive } },
        });
      } catch {}
      res.json({ success: true, data: user });
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('unique')) {
        next(new AppError(409, 'Username already exists'));
      } else {
        next(err);
      }
    }
  },

  // PUT /api/users/:id/password
  async changePassword(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = parseInt(req.params.id, 10);
      // One's own password changes through the profile (current password).
      if (id === req.session.userId) {
        throw new AppError(400, 'Use your profile to change your own password');
      }
      // P1: a non-admin manager may only reset an account it dominates.
      const target = await userScope.assertManageableTarget(actorFromReq(req), id);

      // Block password changes for SSO users
      if (target.foreign_source === 'obligate') {
        throw new AppError(400, 'Cannot modify SSO user — manage from Obligate');
      }

      // P1: through the tenant.manage_users envelope. A password must never
      // sit in an approval payload, and nothing could execute such an
      // approval: at the 'restricted' level a fresh step-up (the 'sensitive'
      // behaviour) is asked instead of a second administrator.
      const { restrictionService, applyRestriction } = await import('../services/restriction.service');
      const level = await restrictionService.getLevelFor({ tenantId: req.tenantId!, actionKey: 'tenant.manage_users' });
      if (level === 'restricted') {
        const { checkSecondFactor, sendStepUpFailure } = await import('../services/deviceKey/stepUpProof');
        const step = await checkSecondFactor(req, { actionKey: 'tenant.manage_users', allowTrustedIp: true, allowDevice: true });
        if (!step.ok) { sendStepUpFailure(res, step); return; }
      } else {
        const gated = await applyRestriction(res, { req, actionKey: 'tenant.manage_users' });
        if (!gated) return;
      }

      const data = req.body as ChangePasswordInput;
      const success = await userService.changePassword(id, data.password);
      if (!success) throw new AppError(404, 'User not found');
      await auditUserAction(req, 'user.password_reset_admin', id, { username: target.username });
      res.json({ success: true, message: 'Password changed' });
    } catch (err) {
      next(err);
    }
  },

  // DELETE /api/users/:id
  async delete(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      // P1: a non-admin manager may only delete an account it dominates.
      await userScope.assertManageableTarget(actorFromReq(req), parseInt(req.params.id, 10));
      const { applyRestriction } = await import('../services/restriction.service');
      const gated = await applyRestriction(res, {
        req, actionKey: 'tenant.manage_users',
        approvalRequestType: 'batch_command',
        approvalDescription: `Delete user #${req.params.id}`,
        approvalPayload: { action: 'user_delete', userId: parseInt(req.params.id, 10) },
      });
      if (!gated) return;

      const id = parseInt(req.params.id, 10);

      if (id === req.session.userId) {
        throw new AppError(400, 'Cannot delete your own account');
      }

      // Block deletion for SSO users
      const user = await userService.getById(id);
      if (user?.foreignSource === 'obligate') {
        throw new AppError(400, 'Cannot delete SSO user — manage from Obligate');
      }

      if (user?.role === 'admin') {
        const allUsers = await userService.getAll();
        const activeAdmins = allUsers.filter((u) => u.role === 'admin' && u.isActive && u.id !== id);
        if (activeAdmins.length === 0) {
          throw new AppError(400, 'Cannot delete the last admin');
        }
      }

      const deleted = await userService.delete(id);
      if (!deleted) throw new AppError(404, 'User not found');
      // P6: a deleted user's sessions would keep their role (admin bypasses).
      const { killSessionsForUser } = await import('../services/userSessions.service');
      await killSessionsForUser(id, 'user_deleted');
      try {
        const { auditService } = await import('../services/audit.service');
        await auditService.logReq(req, 'user.deleted', {
          resourceType: 'user',
          resourcePath: String(id),
          details: { username: user?.username },
        });
      } catch {}
      res.json({ success: true, message: 'User deleted' });
    } catch (err) {
      next(err);
    }
  },

  // GET /api/users/:id/teams
  async getTeams(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = parseInt(req.params.id, 10);
      const actor = actorFromReq(req);
      await userScope.assertReadableTarget(actor, id);
      let teams = await teamService.getUserTeams(id);
      // Outside the god view, only the current tenant's teams are shown.
      if (!actor.isPlatformAdmin && actor.tenantId !== 1) {
        teams = teams.filter((tm) => Number(tm.tenantId) === actor.tenantId);
      }
      res.json({ success: true, data: teams });
    } catch (err) {
      next(err);
    }
  },

  // GET /api/users/:id/tenants
  async getTenants(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = parseInt(req.params.id, 10);
      const actor = actorFromReq(req);
      await userScope.assertReadableTarget(actor, id);
      let assignments = await userService.getUserTenantAssignments(id);
      // A manager that is not a platform admin sees (and may change) only
      // the current tenant's row: other tenants are neither listed nor
      // named. PUT /:id/tenants keeps the rows it does not send.
      if (!actor.isPlatformAdmin) {
        assignments = assignments.filter((a) => Number(a.tenantId) === actor.tenantId);
      }
      res.json({ success: true, data: assignments });
    } catch (err) {
      next(err);
    }
  },

  // DELETE /api/users/:id/2fa  — admin resets all MFA for a locked-out user
  async resetMfa(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = parseInt(req.params.id, 10);
      // One's own 2FA is managed from the profile with a current code (P2):
      // this route must not be a way around it.
      if (id === req.session.userId) {
        throw new AppError(400, 'Use your profile to manage your own two-factor authentication');
      }
      // P1: a non-admin manager may only reset an account it dominates.
      const target = await userScope.assertManageableTarget(actorFromReq(req), id);

      // At the 'restricted' level the approval is EXECUTED once a second
      // administrator approves it (approval.service _executeUserAction,
      // which re-checks this scope as the requester).
      const { applyRestriction } = await import('../services/restriction.service');
      const gated = await applyRestriction(res, {
        req, actionKey: 'tenant.manage_users',
        approvalRequestType: 'batch_command',
        approvalDescription: `Reset the two-factor authentication of user ${target.username} (#${id})`,
        approvalPayload: { action: 'user_2fa_reset', userId: id },
      });
      if (!gated) return;

      // Removes the factors, lifts the code lock (§6.8) and the IP trusts
      // that rested on the removed factor.
      if (!(await resetSecondFactors(id))) throw new AppError(404, 'User not found');
      await auditUserAction(req, 'user.2fa_reset', id, { username: target.username });
      res.json({ success: true, message: 'MFA reset successfully' });
    } catch (err) {
      next(err);
    }
  },

  // PUT /api/users/:id/tenants
  // Body: { assignments: [{ tenantId: number, role: 'admin' | <permission set slug> }] }
  // ('member', the pre-091 name of the 'user' set, is read as 'user'.)
  async setTenants(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = parseInt(req.params.id, 10);
      const targetUser = await userService.getById(id);
      if (!targetUser) throw new AppError(404, 'User not found');
      if (targetUser.foreignSource === 'obligate') {
        throw new AppError(400, 'Cannot modify SSO user tenant access — manage from Obligate');
      }
      // P1: tenant memberships are the tenant-level role. A manager that is
      // not a platform admin may only change the CURRENT tenant's row, of an
      // account it dominates other than itself (tenant admin rows only as a
      // tenant admin), and may only grant a role whose permissions it holds.
      // Rows of other tenants are kept as they are.
      const actor = actorFromReq(req);
      const assignments = await userScope.resolveTenantAssignments(actor, id, (req.body as { assignments?: unknown })?.assignments);

      const { applyRestriction } = await import('../services/restriction.service');
      const gated = await applyRestriction(res, {
        req, actionKey: 'tenant.manage_users',
        approvalRequestType: 'batch_command',
        approvalDescription: `Change the tenant access of user ${targetUser.username} (#${id})`,
        // The requested rows as sent: the executor re-resolves them as the
        // requester when the request is approved.
        approvalPayload: { action: 'user_tenants_set', userId: id, assignments: (req.body as { assignments?: unknown }).assignments },
      });
      if (!gated) return;

      await userService.setUserTenantAssignments(id, assignments);
      await auditUserAction(req, 'user.tenants_changed', id, { username: targetUser.username, assignments });
      res.json({ success: true, message: 'Tenant assignments updated' });
    } catch (err) {
      next(err);
    }
  },
};
