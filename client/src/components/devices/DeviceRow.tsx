import { memo, type MouseEvent } from 'react';
import { Eye, FolderOpen, User, RotateCcw, ShieldOff, MapPin, WifiOff, Wifi, Network, Calendar, ShieldCheck, History, Building2, Copy } from 'lucide-react';
import type { Device } from '@obliance/shared';
import { DeviceStatusBadge } from './DeviceStatusBadge';
import { OsIcon } from './OsIcon';
import { clsx } from 'clsx';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/store/authStore';
import { anonymize, anonymizeIp } from '@/utils/anonymize';
import { shortenOsName } from '@/utils/osLabel';

interface DeviceRowProps {
  device: Device;
  mode: 'monitoring' | 'admin';
  isSelected: boolean;
  onSelect: (id: number) => void;
  onNavigate: (id: number) => void;
  onGroupClick?: (groupId: number) => void;
  /** When true, the entire row becomes a selection target (no navigation) and
   *  a dark checkbox is always visible on the left. Enabled by the "Select"
   *  toggle in DeviceTable. */
  selectionMode?: boolean;
  /** Lot D.1 — set of optional line-2 field keys that should be rendered.
   *  When undefined, the catalog defaults are used (so existing call sites
   *  not yet wired to the popover keep working). */
  visibleFields?: Set<string>;
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
  selectionMode = false,
  visibleFields,
}: DeviceRowProps) {
  const { t } = useTranslation();
  const { isAdmin } = useAuthStore();
  // When the parent doesn't pass a visibleFields set, fall back to "show
  // everything that was visible before D.1 landed" so legacy callers keep
  // their previous look.
  const fieldOn = (key: string): boolean =>
    visibleFields ? visibleFields.has(key) : ['ipLocal', 'os', 'agentVersion', 'group', 'lastUser'].includes(key);
  const metrics = device.latestMetrics;
  const cpuPct = metrics?.cpu?.percent;
  const ramPct = metrics?.memory?.percent;
  const diskPct = metrics?.disks?.length ? metrics.disks[0].percent : undefined;

  const lastSeen = formatLastSeen(device.lastSeenAt);
  const displayLabel = device.displayName || device.hostname;
  const tags = device.tags ?? [];
  const visibleTags = tags.slice(0, 2);
  const overflowCount = tags.length - 2;

  // Display: shortened OS label fits the narrow column ("Microsoft Windows 10
  // IoT Enterprise LTSC 2021" → "MS Win 10 IoT Ent LTSC 21"). The original
  // full name is preserved in osFullTextRaw and shown via tooltip.
  const osFullText = [
    shortenOsName(device.osName) || device.osType,
    device.osVersion,
    device.osArch,
  ].filter(Boolean).join(' ');
  const osFullTextRaw = [
    device.osName || device.osType,
    device.osVersion,
    device.osArch,
  ].filter(Boolean).join(' ');

  // Checkbox shows whenever the user has bulk-action capability:
  // explicit selection mode (any role can pick rows), or admin role
  // (so they always get the persistent column for batch admin
  // actions). `mode` is no longer used as a gate — both /devices and
  // /admin/devices route through the same role-gated table.
  const showCheckbox = selectionMode || isAdmin();
  // Reference `mode` to keep the prop alive for future cosmetic
  // tweaks without TypeScript complaining about an unused arg.
  void mode;
  const line2Offset = showCheckbox ? 'pl-[68px]' : 'pl-[40px]';

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

  // Middle-click opens the device in a new tab. We have to preventDefault
  // on mousedown too — otherwise Windows kicks the auto-scroll cursor up
  // before our auxclick handler runs and the user sees a flash of
  // pan-mode UI. Selection mode short-circuits the open (a multi-select
  // session shouldn't surprise-spawn tabs).
  const handleMouseDown = (e: MouseEvent) => {
    if (e.button === 1) e.preventDefault();
  };
  const handleAuxClick = (e: MouseEvent) => {
    if (e.button !== 1 || selectionMode) return;
    e.preventDefault();
    window.open(`/devices/${device.id}`, '_blank', 'noopener,noreferrer');
  };

  return (
    <div
      className={clsx(
        'h-[72px] px-4 py-2 hover:bg-bg-tertiary cursor-pointer transition-colors flex flex-col justify-center',
        isSelected && 'bg-accent/10',
        selectionMode && isSelected && 'bg-accent/15',
      )}
      onClick={() => selectionMode ? onSelect(device.id) : onNavigate(device.id)}
      onMouseDown={handleMouseDown}
      onAuxClick={handleAuxClick}
    >
      {/* Line 1 */}
      <div className="flex items-center gap-3">
        {showCheckbox && (
          <button
            onClick={handleCheckbox}
            className={clsx(
              'w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center transition-colors',
              // Dark-theme checkbox when in selection mode (user-requested visual)
              selectionMode
                ? (isSelected
                    ? 'bg-accent border-accent text-white'
                    : 'bg-bg-primary/80 border-text-muted/40 hover:border-accent/50')
                : (isSelected
                    ? 'bg-accent border-accent text-white'
                    : 'border-transparent hover:border-accent/50'),
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
        {device.airgapEnabled && (
          <span title="Airgap"><WifiOff className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" /></span>
        )}
        {device.duplicateAgentIdSuspected && (
          <span title={t('duplicateAgentId.rowBadgeTitle') || 'Duplicate agent ID suspected — multiple machines may share this UUID'}>
            <Copy className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
          </span>
        )}
        {device.agentFlavor === 'legacy' && (
          <span
            title="Legacy Go 1.20 agent — no remote shell, ObliReach, software compliance, or auto-update"
            className="text-[9px] px-1 rounded border border-amber-400/40 bg-amber-400/10 text-amber-400 font-semibold uppercase tracking-wider flex-shrink-0"
          >
            Legacy
          </span>
        )}

        <div className="flex-1" />

        {/* Metrics row — CPU / RAM / Disk + custom metrics. This block
            used to be gated on `mode === 'monitoring'` (the original
            split between /devices and /admin/devices), but the two
            pages were unified so the device row should ALWAYS surface
            health at a glance. Without this fix, custom metrics —
            which the user explicitly drives via script schedules —
            silently disappeared from every list view. */}
        {(
          <div className="flex items-center gap-3 flex-shrink-0">
            <MiniBar label="CPU" value={cpuPct} />
            <MiniBar label="RAM" value={ramPct} />
            <MiniBar label="Disk" value={diskPct} />
            {device.customMetrics && device.customMetrics.length > 0 && (
              <div className="flex items-center gap-1 flex-shrink-0">
                {device.customMetrics.slice(0, 3).map((m) => {
                  const color =
                    m.status === 'critical' ? 'border-red-400/40 text-red-400' :
                    m.status === 'warning'  ? 'border-yellow-400/40 text-yellow-400' :
                    m.status === 'error'    ? 'border-gray-400/40 text-gray-400' :
                                               'border-cyan-400/40 text-cyan-400';
                  return (
                    <span
                      key={m.scheduleId}
                      title={`${m.name}: ${m.value}${m.unit ? ' ' + m.unit : ''}`}
                      className={clsx('inline-flex items-center gap-1 px-1.5 py-0.5 rounded border bg-bg-tertiary/60 text-[10px] font-mono', color)}
                    >
                      <span className="font-semibold">{m.value}</span>
                      {m.unit && <span className="opacity-70">{m.unit}</span>}
                    </span>
                  );
                })}
                {device.customMetrics.length > 3 && (
                  <span className="text-[10px] text-text-muted" title={device.customMetrics.slice(3).map((m) => `${m.name}: ${m.value}${m.unit ? ' ' + m.unit : ''}`).join('\n')}>
                    +{device.customMetrics.length - 3}
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        <DeviceStatusBadge status={device.status} approvalStatus={device.approvalStatus} scheduleAlert={device.scheduleAlert} size="sm" updateAvailable={device.updateAvailable} />

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

      {/* Line 2 — composed dynamically from the user's column toggles
          (Lot D.1). A small helper builds the array of nodes and inserts
          a middot between each, so empty/disabled entries don't leave a
          stray separator behind. */}
      <Line2Fields className={clsx('flex items-center gap-1.5 text-xs text-text-muted mt-0.5', line2Offset)}
        nodes={[
          // Tenant chip — only meaningful when the row originates from
          // the master/god view (otherwise tenantName is null and the
          // whole node collapses out of the line). Off by default in
          // the catalog so a single-tenant install never sees clutter.
          fieldOn('tenant') && device.tenantName && (
            <span key="tenant" className="inline-flex items-center gap-1 text-accent" title={`Tenant: ${device.tenantName}`}>
              <Building2 className="w-3 h-3" />
              <span className="truncate max-w-[100px]">{device.tenantName}</span>
            </span>
          ),
          fieldOn('ipLocal') && (
            <span key="ipLocal" className="font-mono truncate max-w-[120px]" title="IP LAN">
              <Wifi className="w-3 h-3 inline mr-1 opacity-60" />
              {anonymizeIp(device.ipLocal) || '\u2014'}
            </span>
          ),
          fieldOn('ipPublic') && (
            <span key="ipPublic" className="font-mono truncate max-w-[120px]" title="IP WAN">
              <Network className="w-3 h-3 inline mr-1 opacity-60" />
              {anonymizeIp(device.ipPublic) || '\u2014'}
            </span>
          ),
          fieldOn('macAddress') && (
            <span key="mac" className="font-mono truncate max-w-[140px]" title="MAC">
              {device.macAddress || '\u2014'}
            </span>
          ),
          fieldOn('os') && (
            <span key="os" className="truncate max-w-[180px]" title={osFullTextRaw}>{osFullText || '\u2014'}</span>
          ),
          fieldOn('agentVersion') && (
            <span key="agent" className="inline-flex items-center gap-1">
              v{device.agentVersion || '?'}
              {device.updateAvailable && (
                <span
                  className="text-[9px] px-1 rounded border border-blue-400/40 bg-blue-400/10 text-blue-400 font-semibold uppercase tracking-wider"
                  title={t('deviceStatus.updateAvailable') || 'Update available'}
                >
                  {t('devices.majPill') || 'MAJ'}
                </span>
              )}
            </span>
          ),
          fieldOn('group') && (
            <span key="group" className="inline-flex items-center gap-1">
              <FolderOpen className="w-3 h-3" />
              {device.groupId && device.groupName ? (
                <button onClick={handleGroupClick} className="hover:text-accent transition-colors">
                  {anonymize(device.groupName)}
                </button>
              ) : (
                <span>{'\u2014'}</span>
              )}
            </span>
          ),
          fieldOn('lastUser') && (
            <span key="lastUser" className="inline-flex items-center gap-1">
              <User className="w-3 h-3" />
              <span className="truncate max-w-[100px]">{anonymize(device.lastLoggedInUser) || '\u2014'}</span>
            </span>
          ),
          fieldOn('geoCity') && device.geoCity && (
            <span key="geo" className="inline-flex items-center gap-1">
              <MapPin className="w-3 h-3" />
              <span className="truncate max-w-[120px]">{anonymize(device.geoCity)}{device.geoCountry ? `, ${anonymize(device.geoCountry)}` : ''}</span>
            </span>
          ),
          fieldOn('lastReboot') && device.lastRebootAt && (
            <span key="lastReboot" className="inline-flex items-center gap-1" title={t('devices.lastReboot', 'Dernier reboot')}>
              <History className="w-3 h-3" />
              <span>{formatRelative(device.lastRebootAt)}</span>
            </span>
          ),
          fieldOn('lifecycle') && device.lifecycleStatus && device.lifecycleStatus !== 'unknown' && (
            <span key="lifecycle" className="inline-flex items-center gap-1" title="Lifecycle">
              <Calendar className="w-3 h-3" />
              <span className="capitalize">{device.lifecycleStatus.replace(/_/g, ' ')}</span>
            </span>
          ),
          fieldOn('warranty') && device.warrantyStatus && device.warrantyStatus !== 'unknown' && (
            <span key="warranty" className={clsx('inline-flex items-center gap-1', device.warrantyStatus === 'expired' && 'text-amber-400')} title="Garantie">
              <ShieldCheck className="w-3 h-3" />
              <span className="capitalize">{device.warrantyStatus}</span>
            </span>
          ),
          // Tags — rendered as a row of small chips when the user has
          // opted into the "Tags" column. Empty array → render nothing
          // so the line2 separator pipeline doesn't drop a stray dot.
          fieldOn('tags') && Array.isArray(device.tags) && device.tags.length > 0 && (
            <span key="tags" className="inline-flex items-center gap-1 flex-wrap" title={`Tags: ${device.tags.join(', ')}`}>
              {device.tags.slice(0, 5).map((t) => (
                <span key={t} className="px-1.5 py-0 rounded-full bg-bg-tertiary text-text-muted text-[10px]">
                  {t}
                </span>
              ))}
              {device.tags.length > 5 && (
                <span className="text-[10px] text-text-muted/60">+{device.tags.length - 5}</span>
              )}
            </span>
          ),
        ]}
      />
    </div>
  );
});

// ── Helpers (kept colocated with DeviceRow since they are not used elsewhere) ─

/** Render a list of nodes joined by middot separators, skipping any falsy
 *  entries so toggled-off Lot D.1 fields don't leave a stray "·" behind. */
function Line2Fields({ nodes, className }: { nodes: Array<React.ReactNode | false>; className?: string }) {
  const visible = nodes.filter(Boolean) as React.ReactNode[];
  return (
    <div className={className}>
      {visible.map((node, i) => (
        <span key={i} className="inline-flex items-center gap-1.5">
          {i > 0 && <span className="text-text-muted/50">&middot;</span>}
          {node}
        </span>
      ))}
    </div>
  );
}

function formatRelative(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  if (diffMs < 0) return 'soon';
  const days = Math.floor(diffMs / 86_400_000);
  if (days >= 1) return `${days}d`;
  const hours = Math.floor(diffMs / 3_600_000);
  if (hours >= 1) return `${hours}h`;
  const mins = Math.max(1, Math.floor(diffMs / 60_000));
  return `${mins}m`;
}
