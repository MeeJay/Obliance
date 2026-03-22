import { db } from '../db';
import type { AppConfigData, DeviceNotificationTypes, ObligateConfig } from '@obliance/shared';

const AGENT_GLOBAL_CONFIG_KEY = 'agent_global_config';
const OBLIGATE_CONFIG_KEY     = 'obligate_config';

export interface AgentGlobalConfig {
  checkIntervalSeconds: number | null;
  scanIntervalSeconds: number | null;  // 0 = disabled, >0 = run all scans every N seconds
  heartbeatMonitoring: boolean | null;
  maxMissedPushes: number | null;
  notificationTypes: DeviceNotificationTypes | null;
}

const DEFAULT_NOTIFICATION_TYPES: Required<DeviceNotificationTypes> = {
  online: true,
  offline: true,
  warning: true,
  critical: true,
  update: false,
};

export const appConfigService = {
  async get(key: string): Promise<string | null> {
    const row = await db('app_config').where({ key }).first('value');
    return row?.value ?? null;
  },

  async set(key: string, value: string): Promise<void> {
    await db('app_config')
      .insert({ key, value })
      .onConflict('key')
      .merge({ value });
  },

  async getAll(): Promise<AppConfigData> {
    const rows = await db('app_config').select('key', 'value');
    const map = Object.fromEntries(rows.map((r: { key: string; value: string }) => [r.key, r.value]));

    /** Extract only the URL from a JSON config blob (never expose apiKey) */
    const parseUrl = (key: string): string | null => {
      if (!map[key]) return null;
      try { return (JSON.parse(map[key]) as { url?: string }).url || null; } catch { return null; }
    };

    return {
      allow_2fa: map['allow_2fa'] ?? 'false',
      force_2fa: map['force_2fa'] ?? 'false',
      otp_smtp_server_id: map['otp_smtp_server_id'] ?? null,
      agent_auto_approve: map['agent_auto_approve'] ?? 'false',
      default_push_interval: map['default_push_interval'] ?? '60',
      fast_poll_interval: map['fast_poll_interval'] ?? '5',
      remote_fast_poll_interval: map['remote_fast_poll_interval'] ?? '3',
      task_retrieve_delay_seconds: map['task_retrieve_delay_seconds'] ?? '10',
      remote_session_timeout_minutes: map['remote_session_timeout_minutes'] ?? '30',
      catchup_window_days: map['catchup_window_days'] ?? '7',
      inventory_retention_days: map['inventory_retention_days'] ?? '90',
      app_name: map['app_name'] ?? 'Obliance',
      default_language: map['default_language'] ?? 'en',
      obligate_url:     parseUrl(OBLIGATE_CONFIG_KEY),
      obligate_enabled: map['obligate_enabled'] ?? 'false',
    };
  },

  // ── Obligate SSO gateway ────────────────────────────────────────────────

  async getObligateConfig(): Promise<ObligateConfig> {
    const raw = await this.get(OBLIGATE_CONFIG_KEY);
    const enabled = await this.get('obligate_enabled');
    if (!raw) return { url: null, apiKeySet: false, enabled: enabled === 'true' };
    try {
      const cfg = JSON.parse(raw) as { url?: string; apiKey?: string };
      return { url: cfg.url ?? null, apiKeySet: !!cfg.apiKey, enabled: enabled === 'true' };
    } catch { return { url: null, apiKeySet: false, enabled: enabled === 'true' }; }
  },

  async getObligateRaw(): Promise<{ url: string | null; apiKey: string | null }> {
    const raw = await this.get(OBLIGATE_CONFIG_KEY);
    if (!raw) return { url: null, apiKey: null };
    try {
      const cfg = JSON.parse(raw) as { url?: string; apiKey?: string };
      return { url: cfg.url ?? null, apiKey: cfg.apiKey ?? null };
    } catch { return { url: null, apiKey: null }; }
  },

  async patchObligateConfig(patch: { url?: string | null; apiKey?: string | null; enabled?: boolean }): Promise<ObligateConfig> {
    const existing = await this.getObligateRaw();
    const merged = {
      url: 'url' in patch ? (patch.url ?? null) : existing.url,
      apiKey: ('apiKey' in patch && patch.apiKey) ? patch.apiKey : existing.apiKey,
    };
    await this.set(OBLIGATE_CONFIG_KEY, JSON.stringify(merged));
    if ('enabled' in patch) {
      await this.set('obligate_enabled', patch.enabled ? 'true' : 'false');
    }
    const enabled = await this.get('obligate_enabled');
    return { url: merged.url, apiKeySet: !!merged.apiKey, enabled: enabled === 'true' };
  },

  /** Get global agent defaults from app_config */
  async getAgentGlobal(): Promise<AgentGlobalConfig> {
    const raw = await this.get(AGENT_GLOBAL_CONFIG_KEY);
    if (!raw) {
      return {
        checkIntervalSeconds: null,
        scanIntervalSeconds: null,
        heartbeatMonitoring: null,
        maxMissedPushes: null,
        notificationTypes: null,
      };
    }
    try {
      return JSON.parse(raw) as AgentGlobalConfig;
    } catch {
      return {
        checkIntervalSeconds: null,
        scanIntervalSeconds: null,
        heartbeatMonitoring: null,
        maxMissedPushes: null,
        notificationTypes: null,
      };
    }
  },

  /** Merge-patch global agent defaults */
  async setAgentGlobal(patch: Partial<AgentGlobalConfig>): Promise<AgentGlobalConfig> {
    const current = await this.getAgentGlobal();
    const updated: AgentGlobalConfig = { ...current, ...patch };
    await this.set(AGENT_GLOBAL_CONFIG_KEY, JSON.stringify(updated));
    return updated;
  },

  /**
   * Read the global notification types (fully resolved -- each field falls back to
   * DEFAULT_NOTIFICATION_TYPES when null).
   */
  async getResolvedAgentNotificationTypes(): Promise<Required<DeviceNotificationTypes>> {
    const cfg = await this.getAgentGlobal();
    const nt: DeviceNotificationTypes | null = cfg.notificationTypes ?? null;
    return {
      online:   nt?.online   ?? DEFAULT_NOTIFICATION_TYPES.online,
      offline:  nt?.offline  ?? DEFAULT_NOTIFICATION_TYPES.offline,
      warning:  nt?.warning  ?? DEFAULT_NOTIFICATION_TYPES.warning,
      critical: nt?.critical ?? DEFAULT_NOTIFICATION_TYPES.critical,
      update:   nt?.update   ?? DEFAULT_NOTIFICATION_TYPES.update,
    };
  },
};
