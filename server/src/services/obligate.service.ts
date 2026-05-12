import { appConfigService } from './appConfig.service';
import { logger } from '../utils/logger';
import { db } from '../db';

export interface ObligateUserAssertion {
  obligateUserId: number;
  username: string;
  email: string | null;
  displayName: string | null;
  role: string;
  tenants: Array<{ slug: string; role: string; capabilities?: string[] }>;
  teams: string[];
  capabilities?: string[];
  authSource: 'local' | 'ldap';
  linkedLocalUserId: number | null;
  preferences?: {
    preferredTheme?: string;
    toastEnabled?: boolean;
    toastPosition?: string;
    profilePhotoUrl?: string | null;
    preferredLanguage?: string;
    anonymousMode?: boolean;
    appSpecific?: Record<string, string>;
  };
}

export const obligateService = {
  /**
   * Check if Obligate is configured and reachable.
   */
  async getSsoConfig(): Promise<{ obligateUrl: string | null; obligateReachable: boolean; obligateEnabled: boolean }> {
    const cfg = await appConfigService.getObligateConfig();
    if (!cfg.url || !cfg.enabled) {
      return { obligateUrl: cfg.url, obligateReachable: false, obligateEnabled: cfg.enabled };
    }

    // Quick reachability check (2s timeout)
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);
      const res = await fetch(`${cfg.url}/health`, { signal: controller.signal });
      clearTimeout(timeout);
      return { obligateUrl: cfg.url, obligateReachable: res.ok, obligateEnabled: true };
    } catch {
      return { obligateUrl: cfg.url, obligateReachable: false, obligateEnabled: true };
    }
  },

  /**
   * Exchange an authorization code with Obligate for user info.
   */
  /**
   * Step-up authentication: verify a fresh TOTP code against an SSO user's
   * Obligate account. Used by the restriction service when a user flagged
   * as `foreign_source='obligate'` (no local TOTP secret) tries to invoke
   * a sensitive action.
   *
   * Returns true if the code is accepted, false if rejected / Obligate
   * unreachable / SSO user without TOTP configured. Failing closed is
   * deliberate — a sensitive action must never go through on a silent
   * verification failure.
   */
  async verifyTotp(obligateUserId: number, code: string): Promise<boolean> {
    const raw = await appConfigService.getObligateRaw();
    if (!raw.url || !raw.apiKey) {
      logger.warn('[Obligate verifyTotp] not configured — returning false');
      return false;
    }

    const url = `${raw.url}/api/oauth/verify-totp`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${raw.apiKey}`,
        },
        body: JSON.stringify({ userId: obligateUserId, code }),
      });
      if (!res.ok) {
        // Dump the response body for diagnosis — the #1 cause of silent
        // failures here is an outdated Obligate deployment that doesn't
        // know the /verify-totp route yet (returns 404 HTML).
        const text = await res.text().catch(() => '');
        logger.warn(
          { url, status: res.status, body: text.slice(0, 200) },
          '[Obligate verifyTotp] non-2xx — is Obligate rebuilt with the /verify-totp route?',
        );
        return false;
      }
      const data = await res.json() as { success?: boolean; data?: { valid?: boolean } };
      if (!data?.success) {
        logger.warn({ data }, '[Obligate verifyTotp] response success=false');
      }
      return !!(data?.success && data?.data?.valid);
    } catch (err) {
      logger.error({ err, url }, '[Obligate verifyTotp] exception');
      return false;
    }
  },

  async exchangeCode(code: string, redirectUri: string): Promise<ObligateUserAssertion | null> {
    const raw = await appConfigService.getObligateRaw();
    if (!raw.url || !raw.apiKey) {
      logger.warn('Obligate exchange failed: not configured');
      return null;
    }

    try {
      const res = await fetch(`${raw.url}/api/oauth/token/exchange`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${raw.apiKey}`,
        },
        body: JSON.stringify({ code, redirect_uri: redirectUri }),
      });

      if (!res.ok) {
        logger.warn(`Obligate exchange failed: HTTP ${res.status}`);
        return null;
      }

      const data = await res.json() as { success: boolean; data?: ObligateUserAssertion };
      if (!data.success || !data.data) return null;

      return data.data;
    } catch (err) {
      logger.error(err, 'Obligate exchange error');
      return null;
    }
  },

  /**
   * Report a provisioned user back to Obligate.
   */
  async reportProvision(obligateUserId: number, remoteUserId: number): Promise<void> {
    const raw = await appConfigService.getObligateRaw();
    if (!raw.url || !raw.apiKey) return;

    try {
      await fetch(`${raw.url}/api/apps/report-provision`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${raw.apiKey}`,
        },
        body: JSON.stringify({ obligateUserId, remoteUserId }),
      });
    } catch (err) {
      logger.error(err, 'Failed to report provision to Obligate');
    }
  },

  /**
   * Register app-specific preference schemas with Obligate.
   */
  async syncPreferenceSchemas(): Promise<void> {
    const raw = await appConfigService.getObligateRaw();
    if (!raw.url || !raw.apiKey) return;

    const schemas = [
      {
        key: 'preferredCodec',
        label: 'Preferred video codec',
        fieldType: 'select',
        options: ['h264', 'h265', 'vp9', 'av1', 'jpeg'],
        defaultValue: 'h264',
        sortOrder: 0,
      },
    ];

    try {
      const res = await fetch(`${raw.url}/api/apps/sync-preference-schemas`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${raw.apiKey}`,
        },
        body: JSON.stringify({ schemas }),
      });
      if (res.ok) {
        logger.info('Obligate: preference schemas synced');
      } else {
        logger.warn(`Obligate: schema sync failed (HTTP ${res.status})`);
      }
    } catch (err) {
      logger.warn(err, 'Obligate: schema sync failed');
    }
  },

  // syncCapabilitySchemas REMOVED. The capabilities Obliance used to
  // push (monitor / execute / remote / files / power) are row-scoped
  // on team_permissions and never made sense as user-level toggles on
  // an Obligate user-tenant binding. The three legacy
  // `supervision_*` / `manage_reports` keys were renamed to
  // `supervision:read` / `agent_config:*` long ago — pushing them
  // wrote phantom toggles that didn't gate anything.
  //
  // The new model:
  //   - Role (admin / user / viewer / custom) defines WHAT a user can do
  //   - Team membership defines WHERE (which groups / devices)
  //   - Tenant-wide page gates are toggled per-team in Obliance UI
  // Obligate-side schema cleanup is handled separately.

  /**
   * Register a device UUID + path with Obligate for cross-app linking.
   * Throttled: only calls Obligate once every 10 minutes per UUID.
   * Failed attempts don't update the throttle so the next push retries.
   */
  _linkThrottle: new Map<string, number>(),
  async registerDeviceLink(uuid: string, appPath: string): Promise<void> {
    const now = Date.now();
    if (now - (this._linkThrottle.get(uuid) ?? 0) < 10 * 60 * 1000) return;

    const raw = await appConfigService.getObligateRaw();
    if (!raw.url || !raw.apiKey) return;

    try {
      const res = await fetch(`${raw.url}/api/devices/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${raw.apiKey}`,
        },
        body: JSON.stringify({ uuid, path: appPath }),
      });
      if (res.ok) this._linkThrottle.set(uuid, now);
    } catch { /* non-critical — will retry on next push */ }
  },

  /**
   * Get cross-app links for a device UUID from Obligate.
   */
  async getDeviceLinks(uuid: string): Promise<Array<{ appType: string; name: string; url: string; icon: string | null; color: string | null }>> {
    const raw = await appConfigService.getObligateRaw();
    if (!raw.url || !raw.apiKey) return [];

    try {
      const res = await fetch(`${raw.url}/api/devices/links?uuid=${encodeURIComponent(uuid)}`, {
        headers: { 'Authorization': `Bearer ${raw.apiKey}` },
      });
      if (!res.ok) return [];
      const data = await res.json() as { success: boolean; data?: Array<{ appType: string; name: string; url: string; icon: string | null; color: string | null }> };
      return data.data ?? [];
    } catch {
      return [];
    }
  },

  /**
   * Fetch latest preferences from Obligate and sync to local DB.
   * Throttled: once per 60s per user. Runs in background, never throws.
   */
  _prefThrottle: new Map<number, number>(),
  async syncUserPreferences(localUserId: number, obligateUserId: number): Promise<void> {
    const now = Date.now();
    if (now - (this._prefThrottle.get(localUserId) ?? 0) < 60 * 1000) return;

    const raw = await appConfigService.getObligateRaw();
    if (!raw.url || !raw.apiKey) return;

    try {
      const res = await fetch(`${raw.url}/api/apps/user-preferences/${obligateUserId}`, {
        headers: { 'Authorization': `Bearer ${raw.apiKey}` },
      });
      if (!res.ok) return;
      this._prefThrottle.set(localUserId, now);

      const { success, data } = await res.json() as { success: boolean; data?: {
        preferredTheme?: string; toastEnabled?: boolean; toastPosition?: string;
        preferredLanguage?: string; anonymousMode?: boolean; profilePhotoUrl?: string | null;
      } };
      if (!success || !data) return;

      // Sync language + avatar columns
      const colUpdate: Record<string, unknown> = {};
      if (data.preferredLanguage) colUpdate.preferred_language = data.preferredLanguage;
      if (data.profilePhotoUrl !== undefined) colUpdate.avatar = data.profilePhotoUrl;
      if (Object.keys(colUpdate).length > 0) {
        await db('users').where({ id: localUserId }).update(colUpdate);
      }

      // Sync UI prefs into preferences JSON
      const uiPrefs: Record<string, unknown> = {};
      if (data.preferredTheme) uiPrefs.preferredTheme = data.preferredTheme;
      if (data.toastEnabled !== undefined) uiPrefs.toastEnabled = data.toastEnabled;
      if (data.toastPosition) uiPrefs.toastPosition = data.toastPosition;
      if (data.anonymousMode !== undefined) uiPrefs.anonymousMode = data.anonymousMode;
      if (Object.keys(uiPrefs).length > 0) {
        const row = await db('users').where({ id: localUserId }).select('preferences').first() as { preferences: unknown } | undefined;
        const existing = (typeof row?.preferences === 'string' ? JSON.parse(row.preferences) : row?.preferences) ?? {};
        await db('users').where({ id: localUserId }).update({
          preferences: JSON.stringify({ ...existing, ...uiPrefs }),
        });
      }
    } catch { /* non-critical */ }
  },

  /**
   * Get the list of connected apps from Obligate (for cross-app nav buttons).
   */
  async getConnectedApps(): Promise<Array<{ appType: string; name: string; baseUrl: string; icon: string | null; color: string | null }>> {
    const raw = await appConfigService.getObligateRaw();
    if (!raw.url || !raw.apiKey) return [];

    try {
      const res = await fetch(`${raw.url}/api/apps/connected`, {
        headers: { 'Authorization': `Bearer ${raw.apiKey}` },
      });
      if (!res.ok) return [];
      const data = await res.json() as { success: boolean; data?: Array<{ appType: string; name: string; baseUrl: string; icon: string | null; color: string | null }> };
      return data.data ?? [];
    } catch {
      return [];
    }
  },
};
