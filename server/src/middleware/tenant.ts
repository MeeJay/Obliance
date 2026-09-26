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

/**
 * For routers that are NOT mounted under the tenant router (/api/profile,
 * /api/profile/2fa): exposes the session's current tenant as req.tenantId,
 * so the restriction envelope (`tenant.manage_profile`), the "Trust this IP"
 * duration and the audit log all see a tenant (P4). Never refuses: a session
 * without a tenant (pre-tenant sessions) is repaired the way /auth/me does,
 * with the user's first tenant.
 */
export async function attachSessionTenant(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.session?.userId;
    if (userId) {
      if (!req.session.currentTenantId) {
        const { tenantService } = await import('../services/tenant.service');
        const tenant = await tenantService.getFirstTenantForUser(userId);
        req.session.currentTenantId = tenant?.id ?? 1;
      }
      req.tenantId = req.session.currentTenantId;
    }
    next();
  } catch (err) {
    next(err);
  }
}
