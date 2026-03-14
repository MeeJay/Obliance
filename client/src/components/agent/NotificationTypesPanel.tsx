import { useState } from 'react';
import { RotateCcw, Bell } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/utils/cn';
import type { DeviceNotificationTypes } from '@obliance/shared';

const DEFAULT_NOTIFICATION_TYPES: Required<DeviceNotificationTypes> = {
  online: true,
  offline: true,
  warning: true,
  critical: true,
  update: false,
};



// ─────────────────────────────────────────────────────────────────────────────
// Toggle switch helper
// ─────────────────────────────────────────────────────────────────────────────

function Switch({ on, onChange, disabled = false }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!on)}
      disabled={disabled}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors',
        on ? 'bg-accent' : 'bg-bg-tertiary border border-border',
        disabled && 'opacity-40 cursor-not-allowed',
      )}
    >
      <span className={cn(
        'inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform',
        on ? 'translate-x-4' : 'translate-x-0.5',
      )} />
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface NotifRow {
  key: keyof DeviceNotificationTypes;
  labelKey: string;
  descKey: string;
}

const NOTIF_ROWS: NotifRow[] = [
  { key: 'online', labelKey: 'agents.notifType.online', descKey: 'agents.notifType.onlineDesc' },
  { key: 'offline', labelKey: 'agents.notifType.offline', descKey: 'agents.notifType.offlineDesc' },
  { key: 'warning', labelKey: 'agents.notifType.warning', descKey: 'agents.notifType.warningDesc' },
  { key: 'critical', labelKey: 'agents.notifType.critical', descKey: 'agents.notifType.criticalDesc' },
  { key: 'update', labelKey: 'agents.notifType.update', descKey: 'agents.notifType.updateDesc' },
];

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

interface NotificationTypesPanelProps {
  /**
   * Current locally-stored config.
   * null = no overrides at this level (all fields inherit).
   * For 'global' scope, pass a fully-populated object (null fields become DEFAULT_NOTIFICATION_TYPES values).
   */
  config: DeviceNotificationTypes | null;
  /**
   * Called whenever a field is toggled / overridden / reset.
   * The panel auto-saves immediately on each interaction.
   */
  onSave: (config: DeviceNotificationTypes | null) => Promise<void>;
  /**
   * 'global' = no Override/Reset buttons, switches always active.
   * 'group'/'device' = per-row Override/Reset buttons, switches disabled when not overriding.
   */
  scope: 'global' | 'group' | 'device';
  title?: string;
  className?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function NotificationTypesPanel({
  config,
  onSave,
  scope,
  title,
  className,
}: NotificationTypesPanelProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<DeviceNotificationTypes | null>(config);
  const [saving, setSaving] = useState<Partial<Record<keyof DeviceNotificationTypes, boolean>>>({});

  const isGlobal = scope === 'global';

  /** Helper: check if a field is locally overriding (non-null) */
  const isFieldOverriding = (key: keyof DeviceNotificationTypes): boolean => {
    if (isGlobal) return true;
    return draft !== null && draft[key] !== null && draft[key] !== undefined;
  };

  /** Get the effective display value for a field */
  const effectiveValue = (key: keyof DeviceNotificationTypes): boolean => {
    if (isGlobal) {
      // At global scope, config has all fields populated
      return (config?.[key] as boolean | null) ?? DEFAULT_NOTIFICATION_TYPES[key];
    }
    return draft?.[key] ?? DEFAULT_NOTIFICATION_TYPES[key];
  };

  const doSave = async (newDraft: DeviceNotificationTypes | null, key: keyof DeviceNotificationTypes) => {
    setSaving(s => ({ ...s, [key]: true }));
    try {
      await onSave(newDraft);
      setDraft(newDraft);
    } finally {
      setSaving(s => ({ ...s, [key]: false }));
    }
  };

  /** Override: enable local override for this field, starting with the system default value */
  const handleOverride = async (key: keyof DeviceNotificationTypes) => {
    const base: DeviceNotificationTypes = draft ?? {};
    const newDraft: DeviceNotificationTypes = { ...base, [key]: DEFAULT_NOTIFICATION_TYPES[key] };
    await doSave(newDraft, key);
  };

  /** Reset: remove local override for this field (set to null → inherit) */
  const handleReset = async (key: keyof DeviceNotificationTypes) => {
    const base: DeviceNotificationTypes = draft ?? {};
    const newDraft: DeviceNotificationTypes = { ...base, [key]: null };
    // If all fields are null after reset, simplify to null (no overrides at all)
    const allNull = Object.values(newDraft).every(v => v === null);
    await doSave(allNull ? null : newDraft, key);
  };

  /** Toggle switch when already overriding */
  const handleToggle = async (key: keyof DeviceNotificationTypes, value: boolean) => {
    if (!isGlobal && !isFieldOverriding(key)) return; // shouldn't happen

    if (isGlobal) {
      // At global scope, operate directly on config with all fields always set
      const base: DeviceNotificationTypes = config ?? {
        ...DEFAULT_NOTIFICATION_TYPES,
      };
      const newDraft: DeviceNotificationTypes = { ...base, [key]: value };
      await doSave(newDraft, key);
    } else {
      const newDraft: DeviceNotificationTypes = { ...draft!, [key]: value };
      await doSave(newDraft, key);
    }
  };

  const displayTitle = title ?? t('agents.notifType.title');

  return (
    <div className={cn('rounded-lg border border-border bg-bg-secondary p-5', className)}>
      {/* Header */}
      <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-wide mb-1 flex items-center gap-1.5">
        <Bell size={13} />
        {displayTitle}
      </h3>
      <p className="text-xs text-text-muted mb-4">{t('agents.notifType.desc')}</p>

      {/* Rows */}
      <div>
        {NOTIF_ROWS.map(({ key, labelKey, descKey }) => {
          const overriding = isFieldOverriding(key);
          const val = effectiveValue(key);
          const isSaving = saving[key] ?? false;

          return (
            <div
              key={key}
              className="flex items-center gap-4 py-3 border-b border-border last:border-b-0"
            >
              {/* Label + description + source badge */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-text-primary">{t(labelKey)}</span>
                  {!isGlobal && (
                    overriding ? (
                      <span className="inline-flex items-center rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-500">
                        Override
                      </span>
                    ) : (
                      <span className="text-xs text-text-muted">
                        Default
                      </span>
                    )
                  )}
                </div>
                <p className="text-xs text-text-muted mt-0.5">{t(descKey)}</p>
              </div>

              {/* Switch */}
              <Switch
                on={val}
                onChange={v => handleToggle(key, v)}
                disabled={!isGlobal && !overriding}
              />

              {/* Override / Reset button (not shown for global scope) */}
              {!isGlobal && (
                <button
                  onClick={overriding ? () => handleReset(key) : () => handleOverride(key)}
                  disabled={isSaving}
                  className={cn(
                    'shrink-0 rounded-md px-2 py-1 text-xs font-medium transition-colors disabled:opacity-50',
                    overriding
                      ? 'text-amber-500 hover:bg-amber-500/10'
                      : 'text-text-muted hover:bg-bg-hover hover:text-text-primary',
                  )}
                  title={overriding ? t('common.reset') : t('common.override')}
                >
                  {overriding ? (
                    <span className="flex items-center gap-1">
                      <RotateCcw size={12} />
                      {t('common.reset')}
                    </span>
                  ) : (
                    t('common.override')
                  )}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
