import { db } from '../db';
import type { AppConfigData, DeviceNotificationTypes } from '@obliance/shared';

const AGENT_GLOBAL_CONFIG_KEY = 'agent_global_config';
const OBLIVIEW_CONFIG_KEY = 'obliview_config';
const OBLIGUARD_CONFIG_KEY = 'obliguard_config';
const OBLIMAP_CONFIG_KEY = 'oblimap_config';

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

  async getAll(): Promise<AppConfigData & {
    obliview_url: string | null;
    obliguard_url: string | null;
    oblimap_url: string | null;
    enable_foreign_sso: boolean;
    enable_obliguard_sso: boolean;
    enable_oblimap_sso: boolean;
  }> {
    const rows = await db('app_config').select('key', 'value');
    const map = Object.fromEntries(rows.map((r: { key: string; value: string }) => [r.key, r.value]));

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
      remote_session_timeout_minutes: map['remote_session_timeout_minutes'] ?? '30',
      catchup_window_days: map['catchup_window_days'] ?? '7',
      inventory_retention_days: map['inventory_retention_days'] ?? '90',
      obliview_url: parseUrl(OBLIVIEW_CONFIG_KEY),
      obliguard_url: parseUrl(OBLIGUARD_CONFIG_KEY),
      oblimap_url: parseUrl(OBLIMAP_CONFIG_KEY),
      enable_foreign_sso: map['enable_foreign_sso'] === 'true',
      enable_obliguard_sso: map['enable_obliguard_sso'] === 'true',
      enable_oblimap_sso: map['enable_oblimap_sso'] === 'true',
    } as AppConfigData & {
      obliview_url: string | null;
      obliguard_url: string | null;
      oblimap_url: string | null;
      enable_foreign_sso: boolean;
      enable_obliguard_sso: boolean;
      enable_oblimap_sso: boolean;
    };
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

  // ── Obliview integration config ────────────────────────────────────────────

  async getObliviewConfig(): Promise<{ url: string | null; apiKeySet: boolean }> {
    const raw = await this.get(OBLIVIEW_CONFIG_KEY);
    if (!raw) return { url: null, apiKeySet: false };
    try {
      const cfg = JSON.parse(raw) as { url?: string; apiKey?: string };
      return { url: cfg.url ?? null, apiKeySet: !!cfg.apiKey };
    } catch { return { url: null, apiKeySet: false }; }
  },

  async getObliviewRaw(): Promise<{ url: string | null; apiKey: string | null }> {
    const raw = await this.get(OBLIVIEW_CONFIG_KEY);
    if (!raw) return { url: null, apiKey: null };
    try {
      const cfg = JSON.parse(raw) as { url?: string; apiKey?: string };
      return { url: cfg.url ?? null, apiKey: cfg.apiKey ?? null };
    } catch { return { url: null, apiKey: null }; }
  },

  async patchObliviewConfig(patch: { url?: string | null; apiKey?: string | null }): Promise<{ url: string | null; apiKeySet: boolean }> {
    const existing = await this.getObliviewRaw();
    const merged = {
      url: 'url' in patch ? (patch.url ?? null) : existing.url,
      apiKey: ('apiKey' in patch && patch.apiKey) ? patch.apiKey : existing.apiKey,
    };
    await this.set(OBLIVIEW_CONFIG_KEY, JSON.stringify(merged));
    return { url: merged.url, apiKeySet: !!merged.apiKey };
  },

  // ── Obliguard integration config ───────────────────────────────────────────

  async getObliguardConfig(): Promise<{ url: string | null; apiKeySet: boolean }> {
    const raw = await this.get(OBLIGUARD_CONFIG_KEY);
    if (!raw) return { url: null, apiKeySet: false };
    try {
      const cfg = JSON.parse(raw) as { url?: string; apiKey?: string };
      return { url: cfg.url ?? null, apiKeySet: !!cfg.apiKey };
    } catch { return { url: null, apiKeySet: false }; }
  },

  async getObliguardRaw(): Promise<{ url: string | null; apiKey: string | null }> {
    const raw = await this.get(OBLIGUARD_CONFIG_KEY);
    if (!raw) return { url: null, apiKey: null };
    try {
      const cfg = JSON.parse(raw) as { url?: string; apiKey?: string };
      return { url: cfg.url ?? null, apiKey: cfg.apiKey ?? null };
    } catch { return { url: null, apiKey: null }; }
  },

  async patchObliguardConfig(patch: { url?: string | null; apiKey?: string | null }): Promise<{ url: string | null; apiKeySet: boolean }> {
    const existing = await this.getObliguardRaw();
    const merged = {
      url: 'url' in patch ? (patch.url ?? null) : existing.url,
      apiKey: ('apiKey' in patch && patch.apiKey) ? patch.apiKey : existing.apiKey,
    };
    await this.set(OBLIGUARD_CONFIG_KEY, JSON.stringify(merged));
    return { url: merged.url, apiKeySet: !!merged.apiKey };
  },

  // ── Oblimap integration config ─────────────────────────────────────────────

  async getOblimapConfig(): Promise<{ url: string | null; apiKeySet: boolean }> {
    const raw = await this.get(OBLIMAP_CONFIG_KEY);
    if (!raw) return { url: null, apiKeySet: false };
    try {
      const cfg = JSON.parse(raw) as { url?: string; apiKey?: string };
      return { url: cfg.url ?? null, apiKeySet: !!cfg.apiKey };
    } catch { return { url: null, apiKeySet: false }; }
  },

  async getOblimapRaw(): Promise<{ url: string | null; apiKey: string | null }> {
    const raw = await this.get(OBLIMAP_CONFIG_KEY);
    if (!raw) return { url: null, apiKey: null };
    try {
      const cfg = JSON.parse(raw) as { url?: string; apiKey?: string };
      return { url: cfg.url ?? null, apiKey: cfg.apiKey ?? null };
    } catch { return { url: null, apiKey: null }; }
  },

  async patchOblimapConfig(patch: { url?: string | null; apiKey?: string | null }): Promise<{ url: string | null; apiKeySet: boolean }> {
    const existing = await this.getOblimapRaw();
    const merged = {
      url: 'url' in patch ? (patch.url ?? null) : existing.url,
      apiKey: ('apiKey' in patch && patch.apiKey) ? patch.apiKey : existing.apiKey,
    };
    await this.set(OBLIMAP_CONFIG_KEY, JSON.stringify(merged));
    return { url: merged.url, apiKeySet: !!merged.apiKey };
  },
};
