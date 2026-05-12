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
 * Require read permission on a device.
 * @param paramName — name of the route param containing the device ID (default: 'id')
 *
 * Scope resolution lives in permissionService.getDevicePermission and
 * now covers pre-approval devices through their API key's default
 * group claim + the dedicated `ungrouped` scope. No special-case for
 * the approval cap here — if the team scope doesn't reach the device,
 * the approver shouldn't see it either (consistent with the user's
 * "if no scope on Ungrouped, don't see ungrouped devices" rule).
 */
export function requireDeviceRead(paramName = 'id') {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      if (req.session.role === 'admin') return next();
      const deviceId = parseInt(req.params[paramName], 10);
      if (isNaN(deviceId)) return next(new AppError(400, 'Invalid device ID'));
      const canRead = await permissionService.canReadDevice(req.session.userId!, deviceId, false);
      if (!canRead) return next(new AppError(403, 'Insufficient permissions'));
      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Require write permission on a device.
 * @param paramName — name of the route param containing the device ID (default: 'id')
 */
export function requireDeviceWriteParam(paramName = 'id') {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      if (req.session.role === 'admin') return next();
      const deviceId = parseInt(req.params[paramName], 10);
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
 * Tenant-scoped capability check — admin always passes; non-admin must
 * have the named capability on at least one of their team_permissions
 * rows. Used by /admin/supervision tab routes (reports, history,
 * remote-sessions list) where access is page-level, not device-level.
 */
export function requireTenantCapability(capability: string) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      if (req.session.role === 'admin') return next();
      const tenantId = (req as any).tenantId as number | undefined;
      if (!tenantId) return next(new AppError(403, 'Insufficient permissions'));
      const ok = await permissionService.userHasTenantCapability(req.session.userId!, tenantId, capability);
      if (!ok) return next(new AppError(403, 'Insufficient permissions'));
      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Like requireTenantCapability, but passes if the user has ANY of the
 * listed capabilities (or is admin). Useful when a route should be
 * unlocked by either of two overlapping caps — e.g. GET /agent/keys
 * works for both `agent_config:keys` (manage) and
 * `agent_config:approval` (enroll), since both flows need to list the
 * available keys.
 */
export function requireAnyTenantCapability(...capabilities: string[]) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      if (req.session.role === 'admin') return next();
      const tenantId = (req as any).tenantId as number | undefined;
      if (!tenantId) return next(new AppError(403, 'Insufficient permissions'));
      for (const cap of capabilities) {
        if (await permissionService.userHasTenantCapability(req.session.userId!, tenantId, cap)) {
          return next();
        }
      }
      return next(new AppError(403, 'Insufficient permissions'));
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
