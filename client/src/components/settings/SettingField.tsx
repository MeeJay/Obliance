import { useState } from 'react';
import { RotateCcw } from 'lucide-react';
import type { SettingScope, SettingKey, SettingDefinition } from '@obliance/shared';
import type { ResolvedSettingValue } from '@/api/settings.api';
import { InheritanceBadge } from './InheritanceBadge';

interface SettingFieldProps {
  definition: SettingDefinition;
  inheritedValue: ResolvedSettingValue;
  overrideValue: number | undefined;
  scope: SettingScope;
  onSave: (key: SettingKey, value: number) => Promise<void>;
  onReset: (key: SettingKey) => Promise<void>;
}

export function SettingField({
  definition,
  inheritedValue,
  overrideValue,
  scope,
  onSave,
  onReset,
}: SettingFieldProps) {
  const hasOverride = overrideValue !== undefined;
  const [isOverriding, setIsOverriding] = useState(hasOverride);
  const numericInherited = typeof inheritedValue.value === 'boolean'
    ? (inheritedValue.value ? 1 : 0)
    : inheritedValue.value;
  const [localValue, setLocalValue] = useState<number>(overrideValue ?? numericInherited);
  const [saving, setSaving] = useState(false);

  const handleToggleOverride = async () => {
    if (isOverriding) {
      setSaving(true);
      try {
        await onReset(definition.key);
        setIsOverriding(false);
        setLocalValue(numericInherited);
      } finally {
        setSaving(false);
      }
    } else {
      setIsOverriding(true);
      setLocalValue(numericInherited);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(definition.key, localValue);
    } finally {
      setSaving(false);
    }
  };

  const handleBlur = () => {
    if ((scope === 'global' || isOverriding) && localValue !== (overrideValue ?? numericInherited)) {
      handleSave();
    }
  };

  return (
    <div className="flex items-center gap-4 py-3 border-b border-border last:border-b-0">
      {/* Label and description */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-text-primary">{definition.label}</span>
          {scope !== 'global' && (
            isOverriding ? (
              <span className="inline-flex items-center rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-500">
                Override
              </span>
            ) : (
              <InheritanceBadge setting={inheritedValue} />
            )
          )}
        </div>
        <p className="text-xs text-text-muted mt-0.5">{definition.description}</p>
      </div>

      {/* Value input */}
      <div className="flex items-center gap-2">
        {definition.type === 'boolean' ? (
          <button
            role="switch"
            aria-checked={!!(isOverriding ? localValue : numericInherited)}
            disabled={scope !== 'global' && !isOverriding}
            onClick={async () => {
              if (scope !== 'global' && !isOverriding) return;
              const next = (isOverriding ? localValue : numericInherited) ? 0 : 1;
              setLocalValue(next);
              setSaving(true);
              try { await onSave(definition.key, next); } finally { setSaving(false); }
            }}
            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none disabled:opacity-50 disabled:cursor-not-allowed ${
              (isOverriding ? localValue : numericInherited) ? 'bg-accent' : 'bg-bg-tertiary'
            }`}
          >
            <span className={`pointer-events-none inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${
              (isOverriding ? localValue : numericInherited) ? 'translate-x-4' : 'translate-x-0.5'
            }`} />
          </button>
        ) : (
          <>
            <input
              type="number"
              value={scope === 'global' || isOverriding ? localValue : numericInherited}
              onChange={(e) => setLocalValue(parseInt(e.target.value, 10) || 0)}
              onBlur={handleBlur}
              onKeyDown={(e) => { if (e.key === 'Enter') handleBlur(); }}
              disabled={scope !== 'global' && !isOverriding}
              min={definition.min}
              max={definition.max}
              className={`w-24 rounded-md border px-2 py-1 text-sm text-right focus:outline-none focus:ring-2 focus:ring-accent ${
                scope !== 'global' && !isOverriding
                  ? 'border-border bg-bg-tertiary text-text-muted cursor-not-allowed'
                  : 'border-border bg-bg-tertiary text-text-primary'
              }`}
            />
            <span className="text-xs text-text-muted w-12">{definition.unit}</span>
          </>
        )}
      </div>

      {/* Override toggle / reset button (not shown for global scope) */}
      {scope !== 'global' && (
        <button
          onClick={handleToggleOverride}
          disabled={saving}
          className={`shrink-0 rounded-md px-2 py-1 text-xs font-medium transition-colors ${
            isOverriding
              ? 'text-amber-500 hover:bg-amber-500/10'
              : 'text-text-muted hover:bg-bg-hover hover:text-text-primary'
          }`}
          title={isOverriding ? 'Reset to inherited' : 'Override locally'}
        >
          {isOverriding ? (
            <span className="flex items-center gap-1">
              <RotateCcw size={12} />
              Reset
            </span>
          ) : (
            'Override'
          )}
        </button>
      )}
    </div>
  );
}
