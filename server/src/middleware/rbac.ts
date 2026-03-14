import type { Request, Response, NextFunction } from 'express';
import type { UserRole } from '@obliance/shared';
import { AppError } from './errorHandler';
import { permissionService } from '../services/permission.service';

export function requireRole(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.session?.userId) {
      next(new AppError(401, 'Authentication required'));
      return;
    }

    if (!roles.includes(req.session.role as UserRole)) {
      next(new AppError(403, 'Insufficient permissions'));
      return;
    }

    next();
  };
}

/**
 * Require write permission on a device (id from req.params.id).
 * Admins always pass. Non-admins need RW via their teams.
 */
export function requireDeviceWrite() {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      if (req.session.role === 'admin') return next();
      const deviceId = parseInt(req.params.id, 10);
      if (isNaN(deviceId)) return next(new AppError(400, 'Invalid device ID'));
      const canWrite = await permissionService.canWriteDevice(req.session.userId!, deviceId, false);
      if (!canWrite) return next(new AppError(403, 'Insufficient permissions'));
      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Require write permission on a group (id from req.params.id).
 */
export function requireGroupWrite() {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      if (req.session.role === 'admin') return next();
      const groupId = parseInt(req.params.id, 10);
      if (isNaN(groupId)) return next(new AppError(400, 'Invalid group ID'));
      const canWrite = await permissionService.canWriteGroup(req.session.userId!, groupId, false);
      if (!canWrite) return next(new AppError(403, 'Insufficient permissions'));
      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Require canCreate permission (for creating new devices/groups).
 */
export function requireCanCreate() {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      if (req.session.role === 'admin') return next();
      const canCreate = await permissionService.canCreate(req.session.userId!, false);
      if (!canCreate) return next(new AppError(403, 'Insufficient permissions'));
      next();
    } catch (err) {
      next(err);
    }
  };
}
