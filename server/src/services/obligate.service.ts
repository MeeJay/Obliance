import { appConfigService } from './appConfig.service';
import { logger } from '../utils/logger';

export interface ObligateUserAssertion {
  obligateUserId: number;
  username: string;
  email: string | null;
  displayName: string | null;
  role: string;
  tenants: Array<{ slug: string; role: string }>;
  teams: string[];
  authSource: 'local' | 'ldap';
  linkedLocalUserId: number | null;
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
