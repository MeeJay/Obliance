// =============================================================================
// Obliance RMM — Settings Keys & Defaults
// =============================================================================

export const SETTINGS_KEYS = {
  PUSH_INTERVAL:            'pushInterval',           // seconds between agent pushes
  FAST_POLL_INTERVAL:       'fastPollInterval',       // seconds when commands pending
  MAX_MISSED_PUSHES:        'maxMissedPushes',        // offline detection threshold
  NOTIFICATION_COOLDOWN:    'notificationCooldown',   // min seconds between alerts
  INVENTORY_RETENTION_DAYS: 'inventoryRetentionDays', // how long to keep inventory snapshots
  AUTO_APPROVE_DEVICES:     'autoApproveDevices',     // auto-approve new agents
} as const;

export type SettingKey = typeof SETTINGS_KEYS[keyof typeof SETTINGS_KEYS];

export interface SettingDefinition {
  key: SettingKey;
  label: string;
  description: string;
  type: 'number' | 'boolean';
  unit?: string;
  min?: number;
  max?: number;
  defaultValue: number | boolean;
}

export const SETTINGS_DEFINITIONS: SettingDefinition[] = [
  {
    key: SETTINGS_KEYS.PUSH_INTERVAL,
    label: 'Push Interval',
    description: 'How often the agent sends metrics to the server',
    type: 'number',
    unit: 'seconds',
    min: 10,
    max: 3600,
    defaultValue: 60,
  },
  {
    key: SETTINGS_KEYS.FAST_POLL_INTERVAL,
    label: 'Fast Poll Interval',
    description: 'How often the agent polls when commands are pending',
    type: 'number',
    unit: 'seconds',
    min: 3,
    max: 30,
    defaultValue: 5,
  },
  {
    key: SETTINGS_KEYS.MAX_MISSED_PUSHES,
    label: 'Max Missed Pushes',
    description: 'Number of missed pushes before marking device offline',
    type: 'number',
    unit: 'pushes',
    min: 1,
    max: 20,
    defaultValue: 3,
  },
  {
    key: SETTINGS_KEYS.NOTIFICATION_COOLDOWN,
    label: 'Notification Cooldown',
    description: 'Minimum time between repeated alerts for the same device',
    type: 'number',
    unit: 'seconds',
    min: 0,
    max: 86400,
    defaultValue: 300,
  },
  {
    key: SETTINGS_KEYS.INVENTORY_RETENTION_DAYS,
    label: 'Inventory Retention',
    description: 'How long to keep historical inventory snapshots',
    type: 'number',
    unit: 'days',
    min: 7,
    max: 365,
    defaultValue: 90,
  },
  {
    key: SETTINGS_KEYS.AUTO_APPROVE_DEVICES,
    label: 'Auto-Approve Devices',
    description: 'Automatically approve new devices when they register',
    type: 'boolean',
    defaultValue: false,
  },
];

export const HARDCODED_DEFAULTS: Record<SettingKey, number | boolean> = {
  [SETTINGS_KEYS.PUSH_INTERVAL]:            60,
  [SETTINGS_KEYS.FAST_POLL_INTERVAL]:       5,
  [SETTINGS_KEYS.MAX_MISSED_PUSHES]:        3,
  [SETTINGS_KEYS.NOTIFICATION_COOLDOWN]:    300,
  [SETTINGS_KEYS.INVENTORY_RETENTION_DAYS]: 90,
  [SETTINGS_KEYS.AUTO_APPROVE_DEVICES]:     false,
};
