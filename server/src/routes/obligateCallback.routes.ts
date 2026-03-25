import { Router } from 'express';
import crypto from 'crypto';
import { db } from '../db';
import { obligateService } from '../services/obligate.service';
import { tenantService } from '../services/tenant.service';
import { appConfigService } from '../services/appConfig.service';
import { logger } from '../utils/logger';

const router = Router();

// ── Desktop SSO flow (for Oblireach client-app) ──────────────────────────────
// In-memory store for pending desktop SSO requests (5-min TTL).
const desktopSsoRequests = new Map<string, {
  state: string;
  callbackUrl: string;
  createdAt: number;
}>();
setInterval(() => {
  const now = Date.now();
  for (const [id, r] of desktopSsoRequests) {
    if (now - r.createdAt > 5 * 60 * 1000) desktopSsoRequests.delete(id);
  }
}, 5 * 60 * 1000).unref();

/**
 * Shared: provision or sync a user from an Obligate assertion.
 * Creates session fields on req.session.
 * Returns the local user ID.
 */
async function provisionObligateUser(assertion: import('../services/obligate.service').ObligateUserAssertion, req: any): Promise<number> {
  let localUserId: number;

  if (assertion.linkedLocalUserId) {
    localUserId = assertion.linkedLocalUserId;
    await db('users').where({ id: localUserId }).update({
      role: assertion.role === 'admin' ? 'admin' : 'user',
      email: assertion.email,
      display_name: assertion.displayName,
      updated_at: new Date(),
    });
  } else {
    const existingLink = await db('sso_foreign_users')
      .where({ foreign_source: 'obligate', foreign_user_id: assertion.obligateUserId })
      .first() as { local_user_id: number } | undefined;

    if (existingLink) {
      localUserId = existingLink.local_user_id;
      await db('users').where({ id: localUserId }).update({
        role: assertion.role === 'admin' ? 'admin' : 'user',
        email: assertion.email,
        display_name: assertion.displayName,
        updated_at: new Date(),
      });
    } else {
      const [newUser] = await db('users')
        .insert({
          username: `og_${assertion.username}`,
          display_name: assertion.displayName || assertion.username,
          email: assertion.email,
          role: assertion.role === 'admin' ? 'admin' : 'user',
          is_active: true,
          foreign_source: 'obligate',
          foreign_id: assertion.obligateUserId,
        })
        .returning('id') as Array<{ id: number }>;
      localUserId = newUser.id;

      await db('sso_foreign_users').insert({
        foreign_source: 'obligate',
        foreign_user_id: assertion.obligateUserId,
        local_user_id: localUserId,
      });

      for (const t of assertion.tenants) {
        const tenant = await db('tenants').where({ slug: t.slug }).first() as { id: number } | undefined;
        if (tenant) {
          await db('user_tenants')
            .insert({ user_id: localUserId, tenant_id: tenant.id, role: t.role === 'admin' ? 'admin' : 'member' })
            .onConflict(['user_id', 'tenant_id'])
            .merge({ role: t.role === 'admin' ? 'admin' : 'member' });
        }
      }

      obligateService.reportProvision(assertion.obligateUserId, localUserId).catch(() => {});
    }
  }

  // Sync preferences
  if (assertion.preferences) {
    const prefUpdate: Record<string, unknown> = {};
    if (assertion.preferences.preferredLanguage) prefUpdate.preferred_language = assertion.preferences.preferredLanguage;
    if (Object.keys(prefUpdate).length > 0) {
      await db('users').where({ id: localUserId }).update(prefUpdate);
    }
    const uiPrefs: Record<string, unknown> = {};
    if (assertion.preferences.preferredTheme) uiPrefs.preferredTheme = assertion.preferences.preferredTheme;
    if (assertion.preferences.toastEnabled !== undefined) uiPrefs.toastEnabled = assertion.preferences.toastEnabled;
    if (assertion.preferences.toastPosition) uiPrefs.toastPosition = assertion.preferences.toastPosition;
    if (assertion.preferences.anonymousMode !== undefined) uiPrefs.anonymousMode = assertion.preferences.anonymousMode;
    if (Object.keys(uiPrefs).length > 0) {
      const existingRow = await db('users').where({ id: localUserId }).select('preferences').first() as { preferences: unknown } | undefined;
      const existing = (typeof existingRow?.preferences === 'string' ? JSON.parse(existingRow.preferences) : existingRow?.preferences) ?? {};
      await db('users').where({ id: localUserId }).update({
        preferences: JSON.stringify({ ...existing, ...uiPrefs }),
      });
    }
  }

  // Set session
  req.session.userId = localUserId;
  const user = await db('users').where({ id: localUserId }).first() as { username: string; role: string } | undefined;
  if (user) {
    req.session.username = user.username;
    req.session.role = user.role;
  }
  const tenant = await tenantService.getFirstTenantForUser(localUserId);
  req.session.currentTenantId = tenant?.id ?? 1;

  return localUserId;
}

/**
 * GET /auth/callback?code=xxx&state=xxx
 * Called by Obligate after successful authentication.
 * Exchanges the code for user info, auto-provisions, creates session, redirects.
 */
router.get('/callback', async (req, res) => {
  try {
    const { code, state } = req.query as { code?: string; state?: string };
    if (!code) {
      res.status(400).json({ success: false, error: 'Missing code' });
      return;
    }

    // Validate OAuth state parameter to prevent Login CSRF (RFC 6749 §10.12)
    const expectedState = (req.session as any)?.oauthState as string | undefined;
    if (!expectedState || !state || state !== expectedState) {
      logger.warn({ state, expectedState: !!expectedState }, 'Obligate callback: state mismatch — possible CSRF');
      res.redirect('/login?error=sso_failed');
      return;
    }
    // Clear state after validation (single-use)
    delete (req.session as any).oauthState;

    // Build the redirect_uri that was used in the authorize request
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const redirectUri = `${protocol}://${host}/auth/callback`;

    // Exchange code with Obligate
    logger.info({ redirectUri }, 'Obligate callback: exchanging code');
    const assertion = await obligateService.exchangeCode(code, redirectUri);
    if (!assertion) {
      logger.warn('Obligate callback: exchange returned null — code invalid/expired or redirect_uri mismatch');
      res.redirect('/login?error=sso_failed');
      return;
    }
    logger.info({ obligateUserId: assertion.obligateUserId, username: assertion.username }, 'Obligate callback: exchange OK');

    // Provision user and create session
    const localUserId = await provisionObligateUser(assertion, req);
    logger.info(`Obligate SSO: user ${assertion.username} (obligate #${assertion.obligateUserId}) → local #${localUserId}`);

    // Save session, then redirect via HTML meta refresh to ensure Set-Cookie header
    // is fully processed by the browser before navigation occurs.
    req.session.save((err) => {
      if (err) { logger.error(err, 'Session save failed'); res.redirect('/login?error=sso_failed'); return; }
      logger.info({ sessionId: req.sessionID, userId: req.session.userId }, 'Session saved, redirecting to /');
      res.setHeader('Content-Type', 'text/html');
      res.end(`<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0;url=/"><style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0d1117;color:#8b949e;font-family:-apple-system,BlinkMacSystemFont,sans-serif}.s{text-align:center}.d{width:28px;height:28px;border:2.5px solid #30363d;border-top-color:#58a6ff;border-radius:50%;animation:r .6s linear infinite;margin:0 auto 14px}@keyframes r{to{transform:rotate(360deg)}}</style></head><body><div class="s"><div class="d"></div><div>Signing in...</div></div></body></html>`);
    });
  } catch (err) {
    logger.error(err, 'Obligate callback error');
    res.redirect('/login?error=sso_failed');
  }
});

/**
 * GET /auth/sso-redirect
 * Server-side redirect to Obligate authorize endpoint (browser redirect).
 * The server knows the API key — the client never sees it.
 */
router.get('/sso-redirect', async (req, res) => {
  try {
    const raw = await (await import('../services/appConfig.service')).appConfigService.getObligateRaw();
    if (!raw.url || !raw.apiKey) {
      res.redirect('/login');
      return;
    }
    // Verify Obligate is reachable before redirecting (prevents redirect loop when Gate is down)
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);
      const healthRes = await fetch(`${raw.url}/health`, { signal: controller.signal });
      clearTimeout(timeout);
      if (!healthRes.ok) { res.redirect('/login?error=sso_failed'); return; }
    } catch {
      res.redirect('/login?error=sso_failed');
      return;
    }
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const selfUrl = `${protocol}://${host}`;
    // Safety: never redirect to ourselves (misconfigured obligate_url pointing to this app)
    if (raw.url.replace(/\/$/, '') === selfUrl.replace(/\/$/, '')) {
      logger.error({ obligateUrl: raw.url, selfUrl }, 'sso-redirect: obligate_url points to this app — aborting to prevent loop');
      res.redirect('/login?error=sso_misconfigured');
      return;
    }
    const redirectUri = `${selfUrl}/auth/callback`;

    // Generate cryptographic state for CSRF protection (RFC 6749 §10.12)
    const oauthState = crypto.randomBytes(32).toString('hex');
    (req.session as any).oauthState = oauthState;

    const obligateUrl = `${raw.url}/authorize?client_id=${encodeURIComponent(raw.apiKey)}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(oauthState)}`;
    logger.info({ obligateUrl: raw.url, redirectUri }, 'sso-redirect: redirecting to Obligate');

    // Save session before redirecting to ensure state is persisted
    req.session.save((err) => {
      if (err) { logger.error(err, 'sso-redirect: session save failed'); res.redirect('/login?error=sso_failed'); return; }
      res.redirect(obligateUrl);
    });
  } catch {
    res.redirect('/login');
  }
});

/**
 * GET /api/auth/app-info
 * Called by Obligate (Bearer auth) to discover teams + tenants for mapping UI.
 */
router.get('/app-info', async (req, res) => {
  try {
    // Validate Bearer token = our Obligate API key (reverse auth: Obligate calls us)
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      res.status(401).json({ success: false, error: 'Missing Bearer token' });
      return;
    }
    const raw = await appConfigService.getObligateRaw();
    if (!raw.apiKey || authHeader.slice(7) !== raw.apiKey) {
      res.status(401).json({ success: false, error: 'Invalid API key' });
      return;
    }

    // Fetch all teams across all tenants
    const teams = await db('user_teams')
      .join('tenants', 'user_teams.tenant_id', 'tenants.id')
      .select('user_teams.id', 'user_teams.name', 'tenants.slug as tenant_slug', 'tenants.name as tenant_name')
      .orderBy('tenants.name')
      .orderBy('user_teams.name') as Array<{ id: number; name: string; tenant_slug: string; tenant_name: string }>;

    // Fetch all tenants
    const tenants = await db('tenants')
      .select('id', 'name', 'slug')
      .orderBy('name') as Array<{ id: number; name: string; slug: string }>;

    res.json({
      success: true,
      data: {
        roles: ['admin', 'user'],
        teams: teams.map(t => ({ id: t.id, name: t.name, tenantSlug: t.tenant_slug, tenantName: t.tenant_name })),
        tenants: tenants.map(t => ({ slug: t.slug, name: t.name })),
      },
    });
  } catch (err) {
    logger.error(err, 'app-info error');
    res.status(500).json({ success: false, error: 'Failed to fetch app info' });
  }
});

/**
 * GET /api/auth/dashboard-stats
 * Called by Obligate (Bearer auth) to display stats on the Obligate dashboard.
 */
router.get('/dashboard-stats', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) { res.status(401).json({ success: false }); return; }
    const raw = await appConfigService.getObligateRaw();
    if (!raw.apiKey || authHeader.slice(7) !== raw.apiKey) { res.status(401).json({ success: false }); return; }

    const [totalDevices, onlineDevices, pendingCommands] = await Promise.all([
      db('devices').where({ approval_status: 'approved' }).count('id as c').first(),
      db('devices').where({ approval_status: 'approved', status: 'online' }).count('id as c').first(),
      db('command_queue').where({ status: 'pending' }).count('id as c').first(),
    ]);
    res.json({ success: true, data: { stats: [
      { label: 'Devices', value: Number((totalDevices as any)?.c ?? 0), color: '#58a6ff' },
      { label: 'Online', value: Number((onlineDevices as any)?.c ?? 0), color: '#2ea043' },
      { label: 'Pending Commands', value: Number((pendingCommands as any)?.c ?? 0), color: '#d29922' },
    ] } });
  } catch { res.json({ success: true, data: null }); }
});

/**
 * GET /api/auth/sso-config
 * Returns Obligate SSO config for the LoginPage (public, no auth required).
 */
router.get('/sso-config', async (_req, res) => {
  try {
    const config = await obligateService.getSsoConfig();
    res.json({ success: true, data: config });
  } catch (err) {
    res.json({ success: true, data: { obligateUrl: null, obligateReachable: false, obligateEnabled: false } });
  }
});

/**
 * GET /api/auth/sso-logout-url
 * Returns Obligate logout URL so the client can redirect after local logout.
 */
router.get('/sso-logout-url', async (req, res) => {
  try {
    const cfg = await appConfigService.getObligateRaw();
    if (!cfg.url) {
      res.json({ success: true, data: null });
      return;
    }
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const redirectUri = `${protocol}://${host}/login`;
    const logoutUrl = `${cfg.url}/logout?redirect_uri=${encodeURIComponent(redirectUri)}`;
    res.json({ success: true, data: logoutUrl });
  } catch {
    res.json({ success: true, data: null });
  }
});

/**
 * GET /api/auth/connected-apps
 * Returns list of connected apps from Obligate (for cross-app nav buttons).
 */
router.get('/connected-apps', async (req, res) => {
  try {
    if (!req.session?.userId) {
      res.status(401).json({ success: false, error: 'Authentication required' });
      return;
    }
    const apps = await obligateService.getConnectedApps();
    res.json({ success: true, data: apps });
  } catch (err) {
    res.json({ success: true, data: [] });
  }
});

/**
 * POST /api/auth/set-password  { password: string }
 * Called after first SSO login if the user wants a local password.
 * Only works for foreign users who currently have no local password.
 */
router.post('/set-password', async (req, res) => {
  try {
    if (!req.session?.userId) {
      res.status(401).json({ success: false, error: 'Authentication required' });
      return;
    }
    const userId = req.session.userId;
    const { password } = req.body as { password?: string };
    if (!password || password.length < 8) {
      res.status(400).json({ success: false, error: 'Password must be at least 8 characters' });
      return;
    }

    const row = await db('users').where({ id: userId }).first() as { password_hash: string | null } | undefined;
    if (!row) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }
    if (row.password_hash) {
      res.status(409).json({ success: false, error: 'User already has a local password' });
      return;
    }

    const { hashPassword } = await import('../utils/crypto');
    const hash = await hashPassword(password);
    await db('users').where({ id: userId }).update({ password_hash: hash, updated_at: new Date() });

    res.json({ success: true });
  } catch (err) {
    logger.error(err, 'set-password error');
    res.status(500).json({ success: false, error: 'Failed to set password' });
  }
});

/**
 * GET /api/auth/device-links?uuid=xxx
 * Returns cross-app links for a device UUID via Obligate.
 */
router.get('/device-links', async (req, res) => {
  try {
    if (!req.session?.userId) { res.status(401).json({ success: false }); return; }
    const uuid = req.query.uuid as string;
    if (!uuid) { res.json({ success: true, data: [] }); return; }
    const links = await obligateService.getDeviceLinks(uuid);
    res.json({ success: true, data: links });
  } catch {
    res.json({ success: true, data: [] });
  }
});

// ── Desktop SSO endpoints (for Oblireach client-app) ─────────────────────────

/**
 * POST /api/auth/sso-desktop-init
 * Initiates the desktop OAuth flow.
 * Body: { localCallbackUrl: "http://127.0.0.1:{port}/sso/callback" }
 * Returns: { requestId, authorizeUrl }
 */
router.post('/sso-desktop-init', async (req, res) => {
  try {
    const { localCallbackUrl } = req.body as { localCallbackUrl?: string };
    if (!localCallbackUrl) {
      res.status(400).json({ success: false, error: 'Missing localCallbackUrl' });
      return;
    }

    const raw = await appConfigService.getObligateRaw();
    if (!raw.url || !raw.apiKey) {
      res.status(503).json({ success: false, error: 'SSO not configured' });
      return;
    }

    // Verify Obligate is reachable
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);
      const healthRes = await fetch(`${raw.url}/health`, { signal: controller.signal });
      clearTimeout(timeout);
      if (!healthRes.ok) { res.status(503).json({ success: false, error: 'Obligate unreachable' }); return; }
    } catch {
      res.status(503).json({ success: false, error: 'Obligate unreachable' });
      return;
    }

    const requestId = crypto.randomUUID();
    const state = crypto.randomBytes(32).toString('hex');

    desktopSsoRequests.set(requestId, { state, callbackUrl: localCallbackUrl, createdAt: Date.now() });

    const authorizeUrl = `${raw.url}/authorize?client_id=${encodeURIComponent(raw.apiKey)}&redirect_uri=${encodeURIComponent(localCallbackUrl)}&state=${encodeURIComponent(state)}`;

    logger.info({ requestId, localCallbackUrl }, 'Desktop SSO: init');
    res.json({ success: true, data: { requestId, authorizeUrl } });
  } catch (err) {
    logger.error(err, 'sso-desktop-init error');
    res.status(500).json({ success: false, error: 'Internal error' });
  }
});

/**
 * POST /api/auth/sso-desktop-complete
 * Completes the desktop OAuth flow: exchanges code, provisions user, creates session.
 * Body: { requestId, code, state }
 * Returns: { success: true } with session cookie set.
 */
router.post('/sso-desktop-complete', async (req, res) => {
  try {
    const { requestId, code, state } = req.body as { requestId?: string; code?: string; state?: string };
    if (!requestId || !code || !state) {
      res.status(400).json({ success: false, error: 'Missing required fields' });
      return;
    }

    const pending = desktopSsoRequests.get(requestId);
    if (!pending) {
      res.status(400).json({ success: false, error: 'Invalid or expired request' });
      return;
    }

    if (state !== pending.state) {
      desktopSsoRequests.delete(requestId);
      res.status(400).json({ success: false, error: 'State mismatch' });
      return;
    }

    desktopSsoRequests.delete(requestId);

    if (Date.now() - pending.createdAt > 5 * 60 * 1000) {
      res.status(400).json({ success: false, error: 'Request expired' });
      return;
    }

    // Exchange code with Obligate using the stored callback URL as redirect_uri
    const assertion = await obligateService.exchangeCode(code, pending.callbackUrl);
    if (!assertion) {
      res.status(400).json({ success: false, error: 'Code exchange failed' });
      return;
    }

    const localUserId = await provisionObligateUser(assertion, req);
    logger.info(`Desktop SSO: user ${assertion.username} (obligate #${assertion.obligateUserId}) → local #${localUserId}`);

    req.session.save((err) => {
      if (err) {
        logger.error(err, 'Desktop SSO: session save failed');
        res.status(500).json({ success: false, error: 'Session save failed' });
        return;
      }
      res.json({ success: true });
    });
  } catch (err) {
    logger.error(err, 'sso-desktop-complete error');
    res.status(500).json({ success: false, error: 'Internal error' });
  }
});

export default router;
