import crypto from 'crypto';
import { db } from '../db';
import { appConfigService } from './appConfig.service';
import { logger } from '../utils/logger';

/**
 * Delegated token verification — the RESOURCE-SERVER half of Obligate's
 * user-scoped delegation.
 *
 * Obligate mints a short-lived Ed25519-signed token that says WHO is asking
 * (an Obligate user id + a tenant SLUG) and deliberately says nothing about
 * what that user may do. This service answers exactly one question:
 *
 *   "is this token genuine, current, addressed to Obliance, and does its
 *    subject map to a real local user?"
 *
 * It does NOT answer "may that user read device 123". That answer lives in
 * permissionService and is re-derived from Obliance's own model on every
 * request (see middleware/delegatedAuth.ts). A permission / role / team claim
 * carried in a token is precisely the bypass this design exists to avoid, so
 * there is no code here that would read one even if one were present.
 *
 * Why a hand-rolled JWS instead of a library: both servers are CommonJS, jose
 * v5 is ESM-only and jsonwebtoken cannot do JWKS on its own. Node signs and
 * verifies Ed25519 natively, so the only thing missing is ~40 lines of compact
 * serialization — written out below rather than pulling a dependency that
 * would break the build.
 */

/**
 * This app's own audience value.
 *
 * Hardcoded on purpose: never read from config, and never read from the token.
 * `aud` is the single claim that pins a token to THIS app. If it were
 * configurable, a token minted for another app in the suite would become
 * replayable here, which is the cross-app confusion the audience exists to
 * prevent.
 */
const THIS_AUDIENCE = 'obliance';

/** The one accepted signature algorithm. Pinned — see verifyToken(). */
const ALLOWED_ALG = 'EdDSA';

/**
 * Clock skew tolerated on nbf/exp, in seconds. The contract says 30 and no
 * more: the whole point of a 120s token is that a leaked one is worthless
 * before anybody can carry it anywhere.
 */
const CLOCK_SKEW_SEC = 30;

/**
 * Upper bound on a token's total lifetime (exp - iat). The mint contract is
 * iat + 120; we allow headroom for a future revision but refuse anything that
 * looks like a standing credential. This is defence in depth against a mistake
 * on the MINT side — a "temporary" longer exp there must not silently become a
 * long-lived key here.
 */
const MAX_LIFETIME_SEC = 300;

/**
 * A compact JWS carrying these claims is well under 1 KB. Anything much bigger
 * is not a token we issued; refuse it before spending CPU on base64 + JSON.
 */
const MAX_TOKEN_BYTES = 4096;

const JWKS_PATH = '/api/delegation/jwks';
/** Positive cache — how long before we go looking for a rotated key. */
const JWKS_TTL_MS = 5 * 60_000;
/** An unknown kid may trigger at most one fetch per this interval. */
const JWKS_MIN_REFETCH_MS = 10_000;
/** How long we remember "Obligate has no such kid". */
const JWKS_NEGATIVE_TTL_MS = 60_000;
const JWKS_FETCH_TIMEOUT_MS = 5_000;
/** Bounds on a hostile or broken JWKS response. */
const JWKS_MAX_KEYS = 20;
const JWKS_MAX_BYTES = 64 * 1024;
/** Cap on the negative cache so random kids cannot grow it without bound. */
const UNKNOWN_KID_MAX = 100;
/**
 * Obligate URL / enabled flag cache. app_config has no cache of its own, so
 * without this every delegated read costs two extra SELECTs. 60s is the same
 * staleness window the agent key cache already accepts: turning the Obligate
 * integration off stops delegated reads within a minute, not instantly.
 */
const CONFIG_TTL_MS = 60_000;

/** Everything that can make us refuse a token. Stable strings — they are the
 *  `reason` field of the HTTP refusal and the audit row, so callers and log
 *  greps can key on them. */
export type DelegationFailureReason =
  | 'not_configured'
  | 'token_malformed'
  | 'header_invalid'
  | 'alg_not_allowed'
  | 'typ_invalid'
  | 'kid_missing'
  | 'kid_unknown'
  | 'jwks_unavailable'
  | 'signature_invalid'
  | 'payload_invalid'
  | 'issuer_mismatch'
  | 'audience_mismatch'
  | 'azp_invalid'
  | 'subject_invalid'
  | 'tenant_slug_invalid'
  | 'jti_invalid'
  | 'token_not_yet_valid'
  | 'token_expired'
  | 'token_lifetime_excessive'
  | 'subject_not_linked'
  | 'subject_inactive'
  /** Our side broke (database down, bug). NOT a verdict on the token. */
  | 'internal_error';

/**
 * The claim set, exactly as minted. Note what is absent: no permission, role,
 * capability, team or scope-list claim. `scp` is a coarse logging hint and is
 * never consulted for authorization.
 */
export interface DelegationClaims {
  iss: string;
  /** Always a plain string. An array is refused outright. */
  aud: string;
  /** The requesting app type, for audit and refusals. */
  azp: string;
  /** The OBLIGATE user id, as a string. */
  sub: string;
  /** The tenant SLUG (HARD RULE 13 — cross-app identity joins on the slug). */
  ost: string;
  scp: string;
  jti: string;
  iat: number;
  nbf: number;
  exp: number;
}

/** The LOCAL Obliance user the token's subject resolves to. */
export interface DelegationSubject {
  localUserId: number;
  username: string;
  /** Obliance's own platform role for this user. Read from the users table,
   *  never from the token. */
  role: string;
}

export type DelegationResult =
  | { ok: true; kid: string; claims: DelegationClaims; subject: DelegationSubject }
  | {
      ok: false;
      reason: DelegationFailureReason;
      kid: string | null;
      /**
       * Present ONLY for failures raised after the signature verified, so the
       * audit row can carry an authentic jti/azp/sub/ost. Before that point the
       * payload is attacker-controlled text and is deliberately not surfaced:
       * an unverified claim must never reach an audit row or a log field that
       * a reader would mistake for fact.
       */
      claims?: DelegationClaims;
      detail?: string;
    };

// ── Obligate origin (cached) ─────────────────────────────────────────────────

interface ObligateOrigin {
  /** Origin we fetch the JWKS from, no trailing slash. */
  base: string;
  /** The exact `iss` value we require. */
  issuer: string;
}

let originCache: { value: ObligateOrigin | null; at: number } | null = null;

/** Normalise a configured URL and refuse anything that is not http(s).
 *  The value comes from app_config, never from a request, but this is the one
 *  place a trust anchor gets fetched, so a scheme check is cheap insurance. */
function safeBase(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`;
  } catch {
    return null;
  }
}

async function getObligateOrigin(): Promise<ObligateOrigin | null> {
  const now = Date.now();
  if (originCache && now - originCache.at < CONFIG_TTL_MS) return originCache.value;

  let value: ObligateOrigin | null = null;
  try {
    const raw = await appConfigService.getObligateRaw();
    const enabled = await appConfigService.get('obligate_enabled');
    const base = safeBase(raw.url);
    // Delegated identity only means anything while the Obligate integration is
    // on: the subjects resolve through sso_foreign_users links that only the
    // SSO flow creates. An operator who switched Obligate off expects
    // cross-app reads to stop too.
    if (base && enabled === 'true') {
      // `iss` normally IS the configured base URL, and keeping them identical
      // is the tightest binding available (we trust the key we fetched from
      // the same origin that claims to have signed). OBLIGATE_ISSUER exists
      // only for split-URL installs where Obliance reaches Obligate on an
      // internal address while Obligate stamps its public one. It must name
      // the same Obligate; when unset we fail closed on any mismatch.
      const override = process.env.OBLIGATE_ISSUER?.trim().replace(/\/+$/, '');
      value = { base, issuer: override || base };
    }
  } catch (err) {
    logger.warn({ err }, '[delegation] could not read Obligate config');
    value = null;
  }

  originCache = { value, at: now };
  return value;
}

// ── JWKS cache ───────────────────────────────────────────────────────────────

type PublicKey = ReturnType<typeof crypto.createPublicKey>;

let keyCache = new Map<string, PublicKey>();
let keysFetchedAt = 0;
let lastFetchAttemptAt = 0;
let inFlight: Promise<void> | null = null;
/** kid → epoch ms until which we treat it as unknown. */
const unknownKids = new Map<string, number>();

async function fetchJwks(base: string): Promise<void> {
  lastFetchAttemptAt = Date.now();
  const url = `${base}${JWKS_PATH}`;

  const res = await fetch(url, {
    method: 'GET',
    // A 30x here means "fetch your trust anchor from somewhere else". Following
    // one is exactly how a misconfigured or hijacked Obligate would hand us an
    // attacker's public key, so we never follow it.
    redirect: 'manual',
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(JWKS_FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`JWKS HTTP ${res.status}`);

  const declared = Number(res.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > JWKS_MAX_BYTES) throw new Error('JWKS too large');

  // Bare JWKS document by contract — no {success,data} envelope — so that an
  // off-the-shelf JWKS client works against the same endpoint unmodified.
  const body = (await res.json()) as { keys?: unknown };
  const entries = Array.isArray(body?.keys) ? body.keys : null;
  if (!entries) throw new Error('JWKS malformed');

  const next = new Map<string, PublicKey>();
  for (const entry of entries.slice(0, JWKS_MAX_KEYS)) {
    const jwk = entry as Record<string, unknown>;
    if (typeof jwk?.kid !== 'string' || jwk.kid.length === 0) continue;
    if (jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519' || typeof jwk.x !== 'string') continue;
    // A JWKS that ships a private component is either broken or hostile. Refuse
    // the entry and shout: nobody should ever be able to mint with what we hold.
    if ('d' in jwk) {
      logger.error({ kid: jwk.kid }, '[delegation] JWKS entry carries private key material — ignored');
      continue;
    }
    if (jwk.alg !== undefined && jwk.alg !== ALLOWED_ALG) continue;
    try {
      next.set(jwk.kid, crypto.createPublicKey({ key: jwk as crypto.JsonWebKey, format: 'jwk' }));
    } catch (err) {
      logger.warn({ err, kid: jwk.kid }, '[delegation] unusable JWKS entry');
    }
  }
  if (next.size === 0) throw new Error('JWKS has no usable Ed25519 key');

  keyCache = next;
  keysFetchedAt = Date.now();
  // A successful refresh invalidates every "no such kid" memo: the kid we
  // refused a minute ago may be the one that just appeared through a rotation.
  unknownKids.clear();
  logger.debug({ count: next.size }, '[delegation] JWKS refreshed');
}

/** Single-flight wrapper — a burst of delegated requests must produce one
 *  fetch, not one per request. */
function refreshJwks(base: string): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = fetchJwks(base).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function resolveKey(
  base: string,
  kid: string,
): Promise<{ key: PublicKey | null; reason?: 'kid_unknown' | 'jwks_unavailable' }> {
  const now = Date.now();

  const cached = keyCache.get(kid);
  if (cached) {
    // A key we already hold stays usable past the TTL. JWKS freshness is about
    // LEARNING new keys, not expiring old ones, so a token that verifies must
    // not be refused because a background refresh happens to be due — that
    // would turn every Obligate hiccup into an outage.
    if (now - keysFetchedAt >= JWKS_TTL_MS && now - lastFetchAttemptAt >= JWKS_MIN_REFETCH_MS) {
      refreshJwks(base).catch((err) => logger.warn({ err }, '[delegation] background JWKS refresh failed'));
    }
    return { key: cached };
  }

  if ((unknownKids.get(kid) ?? 0) > now) return { key: null, reason: 'kid_unknown' };

  if (now - lastFetchAttemptAt < JWKS_MIN_REFETCH_MS) {
    // Rate-limited: replaying random kids must not turn this endpoint into a
    // request amplifier pointed at Obligate.
    return { key: null, reason: keyCache.size > 0 ? 'kid_unknown' : 'jwks_unavailable' };
  }

  try {
    await refreshJwks(base);
  } catch (err) {
    logger.warn({ err, base }, '[delegation] JWKS fetch failed');
    return { key: null, reason: 'jwks_unavailable' };
  }

  const fresh = keyCache.get(kid);
  if (fresh) return { key: fresh };

  if (unknownKids.size >= UNKNOWN_KID_MAX) unknownKids.clear();
  unknownKids.set(kid, Date.now() + JWKS_NEGATIVE_TTL_MS);
  return { key: null, reason: 'kid_unknown' };
}

// ── Compact JWS ──────────────────────────────────────────────────────────────

/** base64url alphabet only — no padding, no '+', no '/'. Validated before
 *  decoding because Buffer's base64url decoder silently skips junk, and
 *  "silently skips" is how two different strings end up verifying the same. */
const B64URL_RE = /^[A-Za-z0-9_-]+$/;

function decodeJson(segment: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

const APP_TYPE_RE = /^[a-z][a-z0-9-]{1,31}$/;
/** Same shape the mint side enforces. */
const TENANT_SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,127}$/i;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v);
}

function fail(
  reason: DelegationFailureReason,
  kid: string | null,
  extra: { claims?: DelegationClaims; detail?: string } = {},
): DelegationResult {
  return { ok: false, reason, kid, ...extra };
}

async function verifyToken(token: string): Promise<DelegationResult> {
  if (typeof token !== 'string' || token.length === 0 || Buffer.byteLength(token, 'utf8') > MAX_TOKEN_BYTES) {
    return fail('token_malformed', null);
  }

  const origin = await getObligateOrigin();
  if (!origin) return fail('not_configured', null);

  // 1. Exactly three segments, base64url only.
  const segments = token.split('.');
  if (segments.length !== 3) return fail('token_malformed', null);
  const [seg0, seg1, seg2] = segments;
  if (!B64URL_RE.test(seg0) || !B64URL_RE.test(seg1) || !B64URL_RE.test(seg2)) {
    return fail('token_malformed', null);
  }

  // 2. Header. The algorithm is PINNED, never read out of the token to choose
  //    a verifier: that is the classic JWS confusion attack (alg 'none' walks
  //    straight in, and an HMAC substitution turns our public key into a shared
  //    secret every holder could sign with). We accept EdDSA and nothing else.
  const header = decodeJson(seg0);
  if (!header) return fail('header_invalid', null);
  if (header.alg !== ALLOWED_ALG) {
    // The offered alg is worth recording (it is how an alg-confusion attempt
    // shows up in the audit trail) but it is unverified attacker text, so only
    // a short algorithm-shaped value is echoed and everything else is flattened.
    const offered = typeof header.alg === 'string' ? header.alg : 'missing';
    return fail('alg_not_allowed', typeof header.kid === 'string' ? header.kid : null, {
      detail: /^[A-Za-z0-9]{1,16}$/.test(offered) ? offered : 'other',
    });
  }
  if (header.typ !== 'JWT') return fail('typ_invalid', typeof header.kid === 'string' ? header.kid : null);
  const kid = header.kid;
  if (typeof kid !== 'string' || kid.length === 0 || kid.length > 200) return fail('kid_missing', null);

  // 3. Key lookup, with one rate-limited refetch on an unknown kid.
  const { key, reason: keyReason } = await resolveKey(origin.base, kid);
  if (!key) return fail(keyReason ?? 'kid_unknown', kid);

  // 4. Signature over the ASCII bytes of "<seg0>.<seg1>" — the SEGMENTS, not
  //    the decoded JSON. null selects EdDSA's built-in hash.
  let signatureOk = false;
  try {
    signatureOk = crypto.verify(
      null,
      Buffer.from(`${seg0}.${seg1}`, 'utf8'),
      key,
      Buffer.from(seg2, 'base64url'),
    );
  } catch (err) {
    logger.warn({ err, kid }, '[delegation] signature check threw');
    signatureOk = false;
  }
  if (!signatureOk) return fail('signature_invalid', kid);

  // 5. ONLY NOW is the payload trustworthy enough to read.
  const p = decodeJson(seg1);
  if (!p) return fail('payload_invalid', kid);

  // aud must be a plain string. An array is refused outright rather than
  // searched: a token addressed to several apps is a token whose blast radius
  // is several apps, and the mint contract never produces one.
  if (Array.isArray(p.aud)) return fail('audience_mismatch', kid, { detail: 'array' });
  if (typeof p.aud !== 'string' || p.aud !== THIS_AUDIENCE) return fail('audience_mismatch', kid);
  if (typeof p.iss !== 'string' || p.iss.replace(/\/+$/, '') !== origin.issuer) {
    return fail('issuer_mismatch', kid);
  }
  if (typeof p.azp !== 'string' || !APP_TYPE_RE.test(p.azp)) return fail('azp_invalid', kid);
  // sub is the Obligate user id AS A STRING (contract). A numeric type is
  // refused rather than coerced — the two sides agreed on one wire shape and
  // quietly accepting a second one is how they drift apart.
  if (typeof p.sub !== 'string' || !/^[0-9]{1,15}$/.test(p.sub) || Number(p.sub) <= 0) {
    return fail('subject_invalid', kid);
  }
  // ost is a SLUG (HARD RULE 3 / 13). An all-digits value is refused exactly as
  // the mint side refuses it: that is a numeric tenant id smuggled into a slug
  // field, and a numeric id from another app means nothing here.
  if (typeof p.ost !== 'string' || !TENANT_SLUG_RE.test(p.ost) || /^[0-9]+$/.test(p.ost)) {
    return fail('tenant_slug_invalid', kid);
  }
  if (typeof p.jti !== 'string' || !UUID_RE.test(p.jti)) return fail('jti_invalid', kid);
  // scp is a coarse hint carried for logging. It is NOT consulted for
  // authorization anywhere — see the file header.
  const scp = typeof p.scp === 'string' ? p.scp : '';
  if (!isInt(p.iat) || !isInt(p.nbf) || !isInt(p.exp)) return fail('payload_invalid', kid);

  const claims: DelegationClaims = {
    iss: p.iss,
    aud: p.aud,
    azp: p.azp,
    sub: p.sub,
    ost: p.ost,
    scp,
    jti: p.jti,
    iat: p.iat,
    nbf: p.nbf,
    exp: p.exp,
  };

  const now = Math.floor(Date.now() / 1000);
  if (claims.nbf > now + CLOCK_SKEW_SEC) return fail('token_not_yet_valid', kid, { claims });
  if (claims.exp <= now - CLOCK_SKEW_SEC) return fail('token_expired', kid, { claims });
  if (claims.exp - claims.iat > MAX_LIFETIME_SEC) return fail('token_lifetime_excessive', kid, { claims });

  // NOTE ON REPLAY: jti is recorded on the audit row for correlation, but a
  // token is NOT burned on first use here. A context rail reads several
  // sections with the one token it was handed, so one-shot semantics would
  // break the caller for no gain: the 120s window plus TLS is the mitigation,
  // and Obligate keeps the authoritative one-row-per-jti grant record.

  // 6. Resolve the Obligate subject to a LOCAL user.
  const subject = await resolveLocalSubject(claims.sub);
  if (subject === 'not_linked') return fail('subject_not_linked', kid, { claims });
  if (subject === 'inactive') return fail('subject_inactive', kid, { claims });

  return { ok: true, kid, claims, subject };
}

/**
 * Map an Obligate user id onto this install's own user through the existing
 * SSO link.
 *
 * NEVER auto-provisions. Creating a user here would let any app that can get a
 * token conjure accounts in Obliance; provisioning is the SSO flow's job
 * (obligateCallback.routes.ts) and stays there. No link means no read.
 */
async function resolveLocalSubject(sub: string): Promise<DelegationSubject | 'not_linked' | 'inactive'> {
  const obligateUserId = Number(sub);
  if (!Number.isSafeInteger(obligateUserId) || obligateUserId <= 0) return 'not_linked';

  const link = (await db('sso_foreign_users')
    .where({ foreign_source: 'obligate', foreign_user_id: obligateUserId })
    .first('local_user_id')) as { local_user_id: number } | undefined;

  let localUserId = link?.local_user_id;
  if (!localUserId) {
    // Fallback to the pre-004 columns on `users`, which provisioning still
    // writes alongside the join table. Same link, older home.
    const legacy = (await db('users')
      .where({ foreign_source: 'obligate', foreign_id: obligateUserId })
      .first('id')) as { id: number } | undefined;
    localUserId = legacy?.id;
  }
  if (!localUserId) return 'not_linked';

  const user = (await db('users')
    .where({ id: localUserId })
    .first('id', 'username', 'role', 'is_active')) as
    | { id: number; username: string; role: string; is_active: boolean }
    | undefined;
  if (!user) return 'not_linked';
  // A disabled user is disabled everywhere, including through a token that was
  // minted while they were still enabled.
  if (user.is_active === false) return 'inactive';

  return { localUserId: user.id, username: user.username, role: user.role };
}

export const delegationVerifyService = {
  /** This app's audience value, exported so the middleware states the same
   *  constant it enforces. */
  audience: THIS_AUDIENCE,

  /**
   * Verify a compact JWS delegation token and resolve its subject to a local
   * user. Fails closed on every step; never throws.
   */
  async verify(token: string): Promise<DelegationResult> {
    try {
      return await verifyToken(token);
    } catch (err) {
      // An unexpected failure is a refusal, not a pass. Loud in the log,
      // opaque on the wire.
      logger.error({ err }, '[delegation] verification threw — refusing');
      // Still a refusal, but the fault is ours. Reporting it as
      // `signature_invalid` sends operators hunting for a key problem when the
      // real cause is an outage, and tells the caller its token is bad when a
      // retry would have succeeded.
      return fail('internal_error', null, { detail: 'internal' });
    }
  },

  /** Test / diagnostic hook: drop every cached key and config read. */
  _resetCaches(): void {
    keyCache = new Map();
    keysFetchedAt = 0;
    lastFetchAttemptAt = 0;
    unknownKids.clear();
    originCache = null;
  },
};
