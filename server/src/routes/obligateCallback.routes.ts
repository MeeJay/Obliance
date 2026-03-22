import { Router } from 'express';
import { db } from '../db';
import { obligateService } from '../services/obligate.service';
import { tenantService } from '../services/tenant.service';
import { appConfigService } from '../services/appConfig.service';
import { logger } from '../utils/logger';

const router = Router();

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

    // Find or create local user
    let localUserId: number;

    if (assertion.linkedLocalUserId) {
      // Obligate already knows our local user ID (previously linked)
      localUserId = assertion.linkedLocalUserId;
      // Sync role/email from Obligate assertion
      await db('users').where({ id: localUserId }).update({
        role: assertion.role === 'admin' ? 'admin' : 'user',
        email: assertion.email,
        display_name: assertion.displayName,
        updated_at: new Date(),
      });
    } else {
      // Check sso_foreign_users for existing link
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
        // Create new local user (foreign_source='obligate', no password)
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

        // Record in sso_foreign_users
        await db('sso_foreign_users').insert({
          foreign_source: 'obligate',
          foreign_user_id: assertion.obligateUserId,
          local_user_id: localUserId,
        });

        // Auto-assign to tenants based on Obligate assertion
        for (const t of assertion.tenants) {
          const tenant = await db('tenants').where({ slug: t.slug }).first() as { id: number } | undefined;
          if (tenant) {
            await db('user_tenants')
              .insert({ user_id: localUserId, tenant_id: tenant.id, role: t.role === 'admin' ? 'admin' : 'member' })
              .onConflict(['user_id', 'tenant_id'])
              .merge({ role: t.role === 'admin' ? 'admin' : 'member' });
          }
        }

        // Report back to Obligate
        obligateService.reportProvision(assertion.obligateUserId, localUserId).catch(() => {});
      }
    }

    // Establish session
    req.session.userId = localUserId;
    const user = await db('users').where({ id: localUserId }).first() as { username: string; role: string } | undefined;
    if (user) {
      req.session.username = user.username;
      req.session.role = user.role;
    }

    // Set tenant
    const tenant = await tenantService.getFirstTenantForUser(localUserId);
    req.session.currentTenantId = tenant?.id ?? 1;

    logger.info(`Obligate SSO: user ${assertion.username} (obligate #${assertion.obligateUserId}) → local #${localUserId}`);

    // Save session, then redirect via HTML meta refresh to ensure Set-Cookie header
    // is fully processed by the browser before navigation occurs.
    req.session.save((err) => {
      if (err) { logger.error(err, 'Session save failed'); res.redirect('/login?error=sso_failed'); return; }
      logger.info({ sessionId: req.sessionID, userId: req.session.userId }, 'Session saved, redirecting to /');
      res.setHeader('Content-Type', 'text/html');
      res.end('<html><head><meta http-equiv="refresh" content="0;url=/"></head><body>Redirecting...</body></html>');
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
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const redirectUri = `${protocol}://${host}/auth/callback`;
    const obligateUrl = `${raw.url}/authorize?client_id=${encodeURIComponent(raw.apiKey)}&redirect_uri=${encodeURIComponent(redirectUri)}`;
    res.redirect(obligateUrl);
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

export default router;
