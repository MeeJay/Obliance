import type { Request, Response, NextFunction } from 'express';
import { AppError } from './errorHandler';

// Extend express-session types
declare module 'express-session' {
  interface SessionData {
    userId: number;
    username: string;
    role: string;
    currentTenantId: number;
    oauthState: string;
    pendingMfaLinkToken?: string;
    pendingEmailOtp?: { codeHash: string; email: string; expires: number };
    // Cross-app tenant handoff: captured by /auth/sso-redirect when the source
    // Obli* app appends ?tenant=<slug> to the redirect URL, applied by
    // /auth/callback after the user comes back from Obligate, then cleared.
    requestedTenantSlug?: string;
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  if (!req.session?.userId) {
    next(new AppError(401, 'Authentication required'));
    return;
  }
  next();
}
