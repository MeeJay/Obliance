import type { Request, Response, NextFunction } from 'express';
import { AppError } from './errorHandler';

// Extend Express.Request to carry the resolved tenantId
declare global {
  namespace Express {
    interface Request {
      tenantId: number;
    }
  }
}

/**
 * Resolves req.tenantId from the session.
 * Must be applied after requireAuth on all routes that operate on tenant-scoped data.
 */
export function requireTenant(req: Request, _res: Response, next: NextFunction): void {
  const tid = req.session?.currentTenantId;
  if (!tid) {
    next(new AppError(400, 'No tenant selected'));
    return;
  }
  req.tenantId = tid;
  next();
}
