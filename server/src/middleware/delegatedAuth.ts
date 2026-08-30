import type { Request, Response, NextFunction } from 'express';
import { MASTER_TENANT_ID } from '@obliance/shared';
import { auditService } from '../services/audit.service';
import { tenantService } from '../services/tenant.service';
import {
  delegationVerifyService,
  type DelegationClaims,
  type DelegationFailureReason,
} from '../services/delegationVerify.service';
import { logger } from '../utils/logger';

/**
 * Delegated authentication — an ADDITIONAL way to authenticate, never a way to
 * skip authorization.
 *
 * A sibling app (Oblidesk today) asks Obligate for a short-lived token that
 * says "user 42, audience obliance, tenant acme", then calls Obliance directly
 * with it. This middleware verifies that token, resolves it to the LOCAL
 * Obliance user, and then puts that user on the request in exactly the shape a
 * browser session would have.
 *
 * That last property is the entire point. Once the identity is in place,
 * requireAuth, requireTenant, requireDeviceRead, permissionService and every
 * tenant-scoped query run UNCHANGED and unaware that the credential was a
 * token. Nothing downstream is skipped "because the token already said so" —
 * the token says WHO, and Obliance re-derives WHAT THEY MAY DO from its own
 * model, every time. The old behaviour (read with the calling app's static
 * key, i.e. with the calling app's authority) is what this replaces.
 *
 * Wire format:
 *   X-Obli-Delegation: <compact JWS>
 * The bare token, no "Bearer " prefix. `Authorization: Bearer` already carries
 * the calling app's STATIC key on cross-app routes, and the two credentials
 * mean opposite things: one is an app, one is a user. They get separate
 * headers so neither can ever be mistaken for the other.
 */

/** The header carrying the delegated token. */
export const DELEGATION_HEADER = 'x-obli-delegation';

/**
 * Routes that accept a delegated token, matched against the path RELATIVE to
 * the /devices mount (see routes/index.ts). Absolute forms:
 *
 *   GET /api/devices/:id
 *   GET /api/devices/:id/change-events
 *   GET /api/devices/:id/change-events/summary
 *   GET /api/devices/:id/rewind/range
 *   GET /api/devices/:id/rewind/series
 *   GET /api/devices/:id/rewind/at
 *
 * An allowlist, not a denylist: a route that has not been reviewed for
 * delegated access does not get it, and a route added later stays closed until
 * somebody adds it here on purpose. Every entry is a read.
 */
const DELEGATED_ROUTES: RegExp[] = [
  /^\/\d+$/,
  /^\/\d+\/change-events$/,
  /^\/\d+\/change-events\/summary$/,
  /^\/\d+\/rewind\/(range|series|at)$/,
];

/** Reasons this middleware can add on top of the verifier's own. */
type MiddlewareFailureReason =
  | DelegationFailureReason
  | 'route_not_allowed'
  | 'tenant_unknown'
  | 'tenant_not_permitted';

/** What was accepted, kept on the request for handlers and for logging. */
export interface DelegationContext {
  jti: string;
  /** Requesting app type, from the signed `azp` claim. */
  azp: string;
  /** Obligate user id (string form, as minted). */
  sub: string;
  /** Tenant SLUG the token was minted for. */
  ost: string;
  kid: string;
  /** Coarse scope hint. Recorded, never used to authorize. */
  scp: string;
}

declare global {
  namespace Express {
    interface Request {
      delegation?: DelegationContext;
    }
  }
}

/** HTTP status for each refusal.
 *  401 — something is wrong with the token itself.
 *  403 — the token is genuine, the subject may not have this.
 *  503 — we cannot verify right now (config off, JWKS unreachable). Callers
 *        distinguish "not authorised" from "source temporarily unavailable",
 *        so an Obligate outage must not render as a permission denial. */
const STATUS_BY_REASON: Record<MiddlewareFailureReason, number> = {
  not_configured: 503,
  jwks_unavailable: 503,
  internal_error: 503,
  token_malformed: 401,
  header_invalid: 401,
  alg_not_allowed: 401,
  typ_invalid: 401,
  kid_missing: 401,
  kid_unknown: 401,
  signature_invalid: 401,
  payload_invalid: 401,
  issuer_mismatch: 401,
  audience_mismatch: 401,
  azp_invalid: 401,
  subject_invalid: 401,
  tenant_slug_invalid: 401,
  jti_invalid: 401,
  token_not_yet_valid: 401,
  token_expired: 401,
  token_lifetime_excessive: 401,
  subject_not_linked: 403,
  subject_inactive: 403,
  route_not_allowed: 403,
  tenant_unknown: 403,
  tenant_not_permitted: 403,
};

/** Deliberately coarse. The `reason` code is precise enough for the caller to
 *  act on; the message never states which half of a check failed in a way that
 *  helps probing (whether a user exists, whether a tenant exists). */
const MESSAGE_BY_REASON: Record<MiddlewareFailureReason, string> = {
  not_configured: 'Delegated access is not available',
  jwks_unavailable: 'Delegated access is temporarily unavailable',
  internal_error: 'Delegated access is temporarily unavailable',
  token_malformed: 'Invalid delegation token',
  header_invalid: 'Invalid delegation token',
  alg_not_allowed: 'Invalid delegation token',
  typ_invalid: 'Invalid delegation token',
  kid_missing: 'Invalid delegation token',
  kid_unknown: 'Invalid delegation token',
  signature_invalid: 'Invalid delegation token',
  payload_invalid: 'Invalid delegation token',
  issuer_mismatch: 'Invalid delegation token',
  audience_mismatch: 'Invalid delegation token',
  azp_invalid: 'Invalid delegation token',
  subject_invalid: 'Invalid delegation token',
  tenant_slug_invalid: 'Invalid delegation token',
  jti_invalid: 'Invalid delegation token',
  token_not_yet_valid: 'Delegation token is not valid yet',
  token_expired: 'Delegation token has expired',
  token_lifetime_excessive: 'Invalid delegation token',
  subject_not_linked: 'Delegated user has no access to this app',
  subject_inactive: 'Delegated user has no access to this app',
  route_not_allowed: 'This route does not accept a delegated token',
  tenant_unknown: 'Delegated tenant is not available here',
  tenant_not_permitted: 'Delegated user has no access to this tenant',
};

function clientIp(req: Request): string | undefined {
  const fwd = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim();
  return fwd || req.socket?.remoteAddress || undefined;
}

/** Device id from the request path, for audit correlation only. Never used to
 *  decide anything — requireDeviceRead re-parses it and checks it properly. */
function deviceIdFromPath(path: string): string | null {
  const m = /^\/(\d+)(?:\/|$)/.exec(path);
  return m ? m[1] : null;
}

/**
 * One audit row per verification, accepted or rejected, on this side of the
 * exchange (Obligate writes its own on the mint side).
 *
 * Rows refused before the signature verified carry null identity fields on
 * purpose: everything in an unverified payload is attacker-controlled text,
 * and an audit trail that quotes it would be recording fiction as fact.
 */
async function auditDelegation(
  req: Request,
  outcome: 'accepted' | 'rejected',
  opts: {
    tenantId: number | null;
    localUserId?: number | null;
    claims?: DelegationClaims | null;
    kid?: string | null;
    reason?: MiddlewareFailureReason;
    detail?: string;
  },
): Promise<void> {
  const deviceId = deviceIdFromPath(req.path);
  await auditService.log({
    // A refusal we could not attribute to a tenant still has to be visible
    // somewhere: the master tenant is the install-wide god view, which is
    // exactly where a platform admin investigates a cross-app auth failure.
    tenantId: opts.tenantId ?? MASTER_TENANT_ID,
    userId: opts.localUserId ?? undefined,
    action: outcome === 'accepted' ? 'delegation.accept' : 'delegation.reject',
    resourceType: deviceId ? 'device' : undefined,
    resourcePath: deviceId ?? undefined,
    ipAddress: clientIp(req),
    details: {
      outcome,
      reason: opts.reason ?? null,
      detail: opts.detail ?? null,
      jti: opts.claims?.jti ?? null,
      azp: opts.claims?.azp ?? null,
      sub: opts.claims?.sub ?? null,
      ost: opts.claims?.ost ?? null,
      scp: opts.claims?.scp ?? null,
      kid: opts.kid ?? null,
      method: req.method,
      route: `${req.baseUrl}${req.path}`,
    },
  });
}

async function refuse(
  req: Request,
  res: Response,
  reason: MiddlewareFailureReason,
  opts: { tenantId?: number | null; localUserId?: number | null; claims?: DelegationClaims | null; kid?: string | null; detail?: string } = {},
): Promise<void> {
  await auditDelegation(req, 'rejected', {
    tenantId: opts.tenantId ?? null,
    localUserId: opts.localUserId ?? null,
    claims: opts.claims ?? null,
    kid: opts.kid ?? null,
    reason,
    detail: opts.detail,
  });
  logger.warn(
    { reason, detail: opts.detail, azp: opts.claims?.azp, jti: opts.claims?.jti, route: `${req.baseUrl}${req.path}` },
    '[delegation] refused',
  );
  // Answered here rather than through AppError so the refusal can carry the
  // machine-readable `reason` alongside the repo's usual {success,error} shape.
  res.status(STATUS_BY_REASON[reason]).json({
    success: false,
    error: MESSAGE_BY_REASON[reason],
    reason,
  });
}

/**
 * Accept EITHER the existing session OR a delegated token.
 *
 * No header means no change at all: the request falls through to requireAuth
 * and the session path behaves exactly as before.
 */
export async function delegatedAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const raw = req.headers[DELEGATION_HEADER];
  const token = typeof raw === 'string' ? raw.trim() : '';
  if (!token) {
    next();
    return;
  }

  try {
    // Route gate first: cheap, and it means an unreviewed route can never
    // drive a JWKS fetch, let alone a read. Delegated access is read-only, so
    // the method is part of the allowlist.
    if (req.method !== 'GET' || !DELEGATED_ROUTES.some((re) => re.test(req.path))) {
      await refuse(req, res, 'route_not_allowed');
      return;
    }

    const result = await delegationVerifyService.verify(token);
    if (!result.ok) {
      await refuse(req, res, result.reason, {
        claims: result.claims ?? null,
        kid: result.kid,
        detail: result.detail,
      });
      return;
    }

    const { claims, subject, kid } = result;

    // Tenant comes from the SIGNED slug, never from X-Obli-Tenant-Slug or any
    // other unsigned header: an unsigned tenant hint is a tenant of the
    // caller's choosing. Compared byte-exactly (Postgres text equality), case
    // included, because the slug is the join key between apps (HARD RULE 13).
    const tenant = await tenantService.getBySlug(claims.ost);
    if (!tenant) {
      await refuse(req, res, 'tenant_unknown', { claims, kid, localUserId: subject.localUserId });
      return;
    }

    // Membership check, mirroring the SSO login path exactly (see
    // obligateCallback.routes.ts): a platform admin has implicit access to
    // every tenant and gets no user_tenants row materialised, everyone else
    // must hold one. Being stricter here would deny a delegated read that the
    // same person can do in the UI; being looser is not possible, since a
    // non-admin still needs the row.
    const isPlatformAdmin = subject.role === 'admin';
    if (!isPlatformAdmin && !(await tenantService.userHasAccess(subject.localUserId, tenant.id))) {
      await refuse(req, res, 'tenant_not_permitted', { claims, kid, tenantId: tenant.id, localUserId: subject.localUserId });
      return;
    }

    // Install the LOCAL identity in the shape every downstream guard reads.
    // Nothing here grants anything: role and tenant come from Obliance's own
    // tables, and requireDeviceRead / getVisibleDeviceIds run next, unchanged.
    //
    // req.session is replaced with a detached stand-in and req.sessionID is
    // dropped, so express-session neither writes a session row nor sets a
    // cookie for a machine-to-machine call: both of its end-of-response hooks
    // (shouldSave, shouldSetCookie) bail out when sessionID is not a string.
    // A delegated request must leave no login behind it. Dropping any cookie
    // session the caller also happened to send is deliberate: one request, one
    // identity, and it is the signed one.
    //
    // The no-op methods are not optional: express-session calls
    // req.session.touch() unconditionally while ending EVERY response, and a
    // handler may call save()/destroy(). For a token-authenticated request
    // there is nothing to persist, so doing nothing is the correct answer
    // rather than an omission.
    const noop = (cb?: (err?: unknown) => void) => {
      if (typeof cb === 'function') cb(null);
    };
    const carrier = req as unknown as { session: unknown; sessionID?: string };
    carrier.session = {
      userId: subject.localUserId,
      username: subject.username,
      role: subject.role,
      currentTenantId: tenant.id,
      touch: noop,
      save: noop,
      reload: noop,
      destroy: noop,
      regenerate: noop,
    };
    delete carrier.sessionID;

    req.delegation = {
      jti: claims.jti,
      azp: claims.azp,
      sub: claims.sub,
      ost: claims.ost,
      kid,
      scp: claims.scp,
    };

    await auditDelegation(req, 'accepted', {
      tenantId: tenant.id,
      localUserId: subject.localUserId,
      claims,
      kid,
    });
    logger.debug(
      { azp: claims.azp, jti: claims.jti, sub: claims.sub, ost: claims.ost, localUserId: subject.localUserId },
      '[delegation] accepted',
    );

    next();
  } catch (err) {
    // Fail closed. An unexpected error here must never fall through to the
    // session path, where a request carrying a token nobody verified would
    // continue as whatever cookie it happened to bring.
    logger.error({ err }, '[delegation] middleware error — refusing');
    res.status(401).json({ success: false, error: 'Invalid delegation token', reason: 'signature_invalid' });
  }
}
