import { memo, type MouseEvent } from 'react';
import { Eye, FolderOpen, User, RotateCcw, ShieldOff, MapPin } from 'lucide-react';
import type { Device } from '@obliance/shared';
import { DeviceStatusBadge } from './DeviceStatusBadge';
import { OsIcon } from './OsIcon';
import { clsx } from 'clsx';
import { useTranslation } from 'react-i18next';
import { anonymize, anonymizeIp } from '@/utils/anonymize';

interface DeviceRowProps {
  device: Device;
  mode: 'monitoring' | 'admin';
  isSelected: boolean;
  onSelect: (id: number) => void;
  onNavigate: (id: number) => void;
  onGroupClick?: (groupId: number) => void;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatLastSeen(lastSeenAt: string | null): { text: string; color: string } {
  if (!lastSeenAt) return { text: '\u2014', color: 'text-text-muted' };

  const diffMs = Date.now() - new Date(lastSeenAt).getTime();
  const mins = Math.floor(diffMs / 60_000);
  const hours = Math.floor(diffMs / 3_600_000);
  const days = Math.floor(diffMs / 86_400_000);

  if (mins < 5) return { text: `${Math.max(mins, 1)}m`, color: 'text-green-400' };
  if (mins < 60) return { text: `${mins}m`, color: 'text-yellow-400' };
  if (hours < 24) return { text: `${hours}h`, color: 'text-orange-400' };
  return { text: `${days}d`, color: 'text-red-400' };
}

function metricColor(pct: number): string {
  if (pct > 80) return 'bg-red-400';
  if (pct >= 50) return 'bg-yellow-400';
  return 'bg-green-400';
}

function MiniBar({ label, value }: { label: string; value: number | undefined }) {
  const pct = value ?? 0;
  const hasValue = value != null;
  return (
    <div className="flex items-center gap-1">
      <span className="text-[10px] text-text-muted/60 w-6 text-right">{label}</span>
      <span className="text-[10px] text-text-muted w-6 text-right tabular-nums">
        {hasValue ? `${Math.round(pct)}%` : '\u2014'}
      </span>
      <div className="w-12 h-1.5 rounded-full bg-bg-tertiary overflow-hidden" title={`${label}: ${hasValue ? Math.round(pct) + '%' : 'N/A'}`}>
        {hasValue && (
          <div
            className={clsx('h-full rounded-full transition-all', metricColor(pct))}
            style={{ width: `${Math.min(pct, 100)}%` }}
          />
        )}
      </div>
    </div>
  );
}

// ── Component ────────────────────────────────────────────────────────────────

export const DeviceRow = memo(function DeviceRow({
  device,
  mode,
  isSelected,
  onSelect,
  onNavigate,
  onGroupClick,
}: DeviceRowProps) {
  const { t } = useTranslation();
  const metrics = device.latestMetrics;
  const cpuPct = metrics?.cpu?.percent;
  const ramPct = metrics?.memory?.percent;
  const diskPct = metrics?.disks?.length ? metrics.disks[0].percent : undefined;

  const lastSeen = formatLastSeen(device.lastSeenAt);
  const displayLabel = device.displayName || device.hostname;
  const tags = device.tags ?? [];
  const visibleTags = tags.slice(0, 2);
  const overflowCount = tags.length - 2;

  const osFullText = [
    device.osName || device.osType,
    device.osVersion,
    device.osArch,
  ].filter(Boolean).join(' ');

  const line2Offset = mode === 'admin' ? 'pl-[68px]' : 'pl-[40px]';

  const handleCheckbox = (e: MouseEvent) => {
    e.stopPropagation();
    onSelect(device.id);
  };

  const handleEye = (e: MouseEvent) => {
    e.stopPropagation();
    onNavigate(device.id);
  };

  const handleGroupClick = (e: MouseEvent) => {
    e.stopPropagation();
    if (device.groupId && onGroupClick) {
      onGroupClick(device.groupId);
    }
  };

  return (
    <div
      className={clsx(
        'h-[72px] px-4 py-2 border-b border-border hover:bg-bg-tertiary cursor-pointer transition-colors flex flex-col justify-center',
        isSelected && 'bg-accent/5',
      )}
      onClick={() => onNavigate(device.id)}
    >
      {/* Line 1 */}
      <div className="flex items-center gap-3">
        {mode === 'admin' && (
          <button
            onClick={handleCheckbox}
            className={clsx(
              'w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center transition-colors',
              isSelected
                ? 'bg-accent border-accent text-white'
                : 'border-border hover:border-accent/50',
            )}
          >
            {isSelected && (
              <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none">
                <path d="M2.5 6L5 8.5L9.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </button>
        )}

        <OsIcon osType={device.osType} className="w-4 h-4 text-text-muted flex-shrink-0" />

        <span className="text-sm font-semibold text-text-primary truncate max-w-[200px]" title={anonymize(displayLabel)}>
          {anonymize(displayLabel)}
        </span>

        {visibleTags.map((tag) => (
          <span
            key={tag}
            className="text-[10px] px-1.5 rounded-full bg-accent/10 text-accent flex-shrink-0"
          >
            {tag}
          </span>
        ))}
        {overflowCount > 0 && (
          <span className="text-[10px] px-1.5 rounded-full bg-accent/10 text-accent flex-shrink-0">
            +{overflowCount}
          </span>
        )}

        {device.rebootPending && (
          <span title="Reboot pending"><RotateCcw className="w-3.5 h-3.5 text-orange-400 flex-shrink-0" /></span>
        )}
        {device.privacyModeEnabled && (
          <span title="Privacy mode"><ShieldOff className="w-3.5 h-3.5 text-rose-400 flex-shrink-0" /></span>
        )}

        <div className="flex-1" />

        {mode === 'monitoring' && (
          <div className="flex items-center gap-3 flex-shrink-0">
            <MiniBar label="CPU" value={cpuPct} />
            <MiniBar label="RAM" value={ramPct} />
            <MiniBar label="Disk" value={diskPct} />
          </div>
        )}

        <DeviceStatusBadge status={device.status} approvalStatus={device.approvalStatus} size="sm" />

        <span className={clsx('text-xs flex-shrink-0 tabular-nums w-8 text-right', lastSeen.color)}>
          {lastSeen.text}
        </span>

        <button
          onClick={handleEye}
          className="p-1 rounded hover:bg-bg-tertiary text-text-muted hover:text-text-primary transition-colors flex-shrink-0"
          title={t('chat.viewDevice')}
        >
          <Eye className="w-4 h-4" />
        </button>
      </div>

      {/* Line 2 */}
      <div className={clsx('flex items-center gap-1.5 text-xs text-text-muted mt-0.5', line2Offset)}>
        <span className="font-mono truncate max-w-[120px]">{anonymizeIp(device.ipLocal || device.ipPublic) || '\u2014'}</span>
        <span className="text-text-muted/50">&middot;</span>
        <span className="truncate max-w-[180px]">{osFullText || '\u2014'}</span>
        <span className="text-text-muted/50">&middot;</span>
        <span>v{device.agentVersion || '?'}</span>
        <span className="text-text-muted/50">&middot;</span>
        <span className="inline-flex items-center gap-1">
          <FolderOpen className="w-3 h-3" />
          {device.groupId && device.groupName ? (
            <button
              onClick={handleGroupClick}
              className="hover:text-accent transition-colors"
            >
              {anonymize(device.groupName)}
            </button>
          ) : (
            <span>{'\u2014'}</span>
          )}
        </span>
        <span className="text-text-muted/50">&middot;</span>
        <span className="inline-flex items-center gap-1">
          <User className="w-3 h-3" />
          <span className="truncate max-w-[100px]">{anonymize(device.lastLoggedInUser) || '\u2014'}</span>
        </span>
        {device.geoCity && (
          <>
            <span className="text-text-muted/50">&middot;</span>
            <span className="inline-flex items-center gap-1">
              <MapPin className="w-3 h-3" />
              <span className="truncate max-w-[120px]">{anonymize(device.geoCity)}{device.geoCountry ? `, ${anonymize(device.geoCountry)}` : ''}</span>
            </span>
          </>
        )}
      </div>
    </div>
  );
});
