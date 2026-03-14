import type { ResolvedSettingValue } from '@/api/settings.api';

interface InheritanceBadgeProps {
  setting: ResolvedSettingValue;
}

export function InheritanceBadge({ setting }: InheritanceBadgeProps) {
  if (setting.source === 'default') {
    return (
      <span className="text-xs text-text-muted">
        Default
      </span>
    );
  }

  if (setting.source === 'global') {
    return (
      <span className="text-xs text-accent">
        Global
      </span>
    );
  }

  if (setting.source === 'group') {
    return (
      <span className="text-xs text-accent">
        {setting.sourceName}
      </span>
    );
  }

  if (setting.source === 'device') {
    return (
      <span className="inline-flex items-center rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-500">
        Override
      </span>
    );
  }

  return null;
}
