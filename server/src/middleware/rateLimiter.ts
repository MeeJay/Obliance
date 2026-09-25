import rateLimit from 'express-rate-limit';

// Global API limiter — protects unauthenticated / public endpoints only.
//
// IMPORTANT: This limiter runs AFTER session middleware (see app.ts) so that
// req.session.userId is populated and we can skip authenticated users.
//
// Why skip authenticated sessions?
//   - Behind a reverse proxy (e.g. Nginx Proxy Manager) ALL users share the
//     same apparent IP.  A limit of N req/window would be shared by every user
//     simultaneously, causing false positives on normal dashboard usage.
//   - Authenticated requests are already protected by the session cookie; the
//     rate limiter adds no meaningful security benefit for them.
//   - Unauthenticated requests (login page, public health endpoint, etc.) still
//     get rate-limited to defend against enumeration / DDoS.
export const apiLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes (shorter window = faster recovery)
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) =>
    // ── Authenticated dashboard users ──────────────────────────────────────
    // Session is populated by the time this limiter runs (middleware order in app.ts).
    !!req.session?.userId ||
    // ── Public informational endpoints ─────────────────────────────────────
    // Health check is polled by the login page to show the server version;
    // rate-limiting it would block the login page's UI, not improve security.
    req.path === '/health' ||
    // Auth state probe — returns 401 for unauthenticated callers, no info leak.
    req.path === '/api/auth/me' ||
    // ── Machine-to-machine endpoints ───────────────────────────────────────
    // All /api/agent/* paths are API-key authenticated (X-API-Key header).
    // Rate-limiting them would cause false positives when agents post inventory,
    // compliance results, scan data, and metrics at their natural cadence.
    // Security is provided by the API key itself; rate-limiting adds no value here.
    req.path.startsWith('/api/agent/') ||
    // Oblireach agent pushes (same auth, same frequency).
    req.path.startsWith('/api/oblireach/') ||
    // Passive heartbeats (token authenticated, triggered by external systems).
    req.path.startsWith('/api/heartbeat/') ||
    // Android app update check + APK download (public, docs/obli-mobile.md §6).
    // Shells poll without a session, often from shared carrier-NAT IPs; counting
    // them would eat the shared 500/5 min budget of the login page. Read-only,
    // served from disk, no user input.
    req.path.startsWith('/api/mobile/android/') ||
    // Login is already protected by the dedicated authLimiter (IP+username keyed,
    // brute-force focused). Skipping it here avoids false positives when many
    // unauthenticated requests arrive from the same apparent IP (shared proxy).
    req.path === '/api/auth/login' ||
    req.path === '/api/auth/logout',
  message: {
    success: false,
    error: 'Too many requests, please try again later',
  },
});

// MFA verify limiter — applied to /profile/2fa/verify and /profile/2fa/resend-email.
// Keyed by IP only (no username in the body at that point).
// More generous than the login limiter: the attacker must first have a valid
// username+password AND a live pendingMfaUserId session to even reach this endpoint.
// 50 attempts / 15 minutes is enough to survive testing while still blocking automation.
export const mfaLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15-minute window
  max: 50,                   // 50 failed attempts per 15 minutes per IP
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many verification attempts, please try again later',
  },
});

// MFA verify limiter keyed on the ACCOUNT (the pending 2FA user), not the IP.
// An IP-keyed limit alone does not bound a TOTP / email-code brute force: the
// attacker already knows the password and can open a new pending session at
// will, from as many addresses as they have. 10 wrong codes per 15 minutes
// per account keeps a 6-digit code out of reach; the worst an attacker can do
// with it is delay that one account's sign-in (and they hold its password).
// Applied to /profile/2fa/verify only, after mfaLimiter.
export const mfaAccountLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  // No pending 2FA user: the controller answers 400, nothing to guess.
  skip: (req) => !req.session?.pendingMfaUserId,
  keyGenerator: (req) => `mfa-user:${req.session?.pendingMfaUserId}`,
  message: {
    success: false,
    error: 'Too many verification attempts, please try again later',
  },
});

// Login-specific limiter — stricter window to slow down brute-force attempts.
//
// Key = IP + username so that:
//   a) A shared proxy IP does NOT cause all users to share one rate-limit bucket.
//      User A hitting the limit doesn't lock out User B.
//   b) An attacker cannot brute-force a single account faster than the limit allows.
//   c) req.body is available here because authLimiter is applied per-route in
//      auth.routes.ts, after express.json() has already run globally.
//
// skipSuccessfulRequests: successful logins (HTTP 200) do not count toward the
// limit, so a legitimate user who eventually gets their password right is not
// penalised for earlier typos.  Only failed attempts (4xx) accumulate.
export const authLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes — resets quickly after an accidental lock-out
  max: 20,                  // 20 failed attempts per 5-minute window per IP+username
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const ip       = req.ip ?? 'unknown';
    const username = (req.body as { username?: string })?.username?.toLowerCase() ?? '';
    // Combine both so shared-IP users each get their own bucket per account.
    return `${ip}:${username}`;
  },
  message: {
    success: false,
    error: 'Too many login attempts, please try again in 5 minutes',
  },
});
