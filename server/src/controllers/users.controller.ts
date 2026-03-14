import type { Request, Response, NextFunction } from 'express';
import { userService } from '../services/user.service';
import { teamService } from '../services/team.service';
import { AppError } from '../middleware/errorHandler';
import type {
  CreateUserInput,
  UpdateUserInput,
  ChangePasswordInput,
} from '../validators/user.schema';

export const usersController = {
  // GET /api/users
  async list(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const users = await userService.getAll();
      res.json({ success: true, data: users });
    } catch (err) {
      next(err);
    }
  },

  // GET /api/users/:id
  async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = parseInt(req.params.id, 10);
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
      const data = req.body as CreateUserInput;
      const user = await userService.create(data);
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

      // Prevent demoting the last admin
      if (data.role === 'user' || data.isActive === false) {
        const currentUser = await userService.getById(id);
        if (currentUser?.role === 'admin') {
          const allUsers = await userService.getAll();
          const activeAdmins = allUsers.filter((u) => u.role === 'admin' && u.isActive && u.id !== id);
          if (activeAdmins.length === 0) {
            throw new AppError(400, 'Cannot remove the last active admin');
          }
        }
      }

      const user = await userService.update(id, data);
      if (!user) throw new AppError(404, 'User not found');
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
      const data = req.body as ChangePasswordInput;
      const success = await userService.changePassword(id, data.password);
      if (!success) throw new AppError(404, 'User not found');
      res.json({ success: true, message: 'Password changed' });
    } catch (err) {
      next(err);
    }
  },

  // DELETE /api/users/:id
  async delete(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = parseInt(req.params.id, 10);

      if (id === req.session.userId) {
        throw new AppError(400, 'Cannot delete your own account');
      }

      const user = await userService.getById(id);
      if (user?.role === 'admin') {
        const allUsers = await userService.getAll();
        const activeAdmins = allUsers.filter((u) => u.role === 'admin' && u.isActive && u.id !== id);
        if (activeAdmins.length === 0) {
          throw new AppError(400, 'Cannot delete the last admin');
        }
      }

      const deleted = await userService.delete(id);
      if (!deleted) throw new AppError(404, 'User not found');
      res.json({ success: true, message: 'User deleted' });
    } catch (err) {
      next(err);
    }
  },

  // GET /api/users/:id/teams
  async getTeams(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = parseInt(req.params.id, 10);
      const teams = await teamService.getUserTeams(id);
      res.json({ success: true, data: teams });
    } catch (err) {
      next(err);
    }
  },

  // GET /api/users/:id/tenants
  async getTenants(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = parseInt(req.params.id, 10);
      const assignments = await userService.getUserTenantAssignments(id);
      res.json({ success: true, data: assignments });
    } catch (err) {
      next(err);
    }
  },

  // PUT /api/users/:id/tenants
  // Body: { assignments: [{ tenantId: number, role: 'admin' | 'member' }] }
  async setTenants(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = parseInt(req.params.id, 10);
      const { assignments } = req.body as {
        assignments: { tenantId: number; role: 'admin' | 'member' }[];
      };
      if (!Array.isArray(assignments)) {
        throw new AppError(400, 'assignments must be an array');
      }
      await userService.setUserTenantAssignments(id, assignments);
      res.json({ success: true, message: 'Tenant assignments updated' });
    } catch (err) {
      next(err);
    }
  },
};
