import { useState, useEffect, useCallback } from 'react';
import { Plus, Pencil, Trash2, CalendarClock, Clock, RefreshCw, CheckCircle2, Globe, Users, Ban } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { MaintenanceWindow, MaintenanceScopeType, NotificationChannel } from '@obliance/shared';
import { maintenanceApi } from '@/api/maintenance.api';
import { MaintenanceWindowModal } from './MaintenanceWindowModal';
import { cn } from '@/utils/cn';

// ScopeOption kept only for the optional backward-compat prop
interface ScopeOption {
  id: number;
  name: string;
  type: MaintenanceScopeType;
}

interface Props {
  /**
   * When set, the list fetches effective windows for this scope (local + inherited).
   * When not set (admin page), all windows are listed flat.
   */
  scopeType?: 'monitor' | 'agent' | 'group';
  scopeId?: number;
  /**
   * scopeOptions is no longer used — the modal fetches its own data.
   * Kept optional for backward-compat with existing callers.
   */
  scopeOptions?: ScopeOption[];
  channels: NotificationChannel[];
  title?: string;
  /** Pre-fill modal when opening "Add window" (for embedded usage on detail pages) */
  defaultScopeType?: MaintenanceScopeType;
  defaultScopeId?: number;
}

function formatSchedule(w: MaintenanceWindow, t: (k: string, opts?: Record<string, unknown>) => string): string {
  if (w.scheduleType === 'one_time') {
    const start = w.startAt ? new Date(w.startAt).toLocaleString() : '?';
    const end = w.endAt ? new Date(w.endAt).toLocaleString() : '?';
    return `${start} → ${end}`;
  }
  const dayKeys = ['dayMon', 'dayTue', 'dayWed', 'dayThu', 'dayFri', 'daySat', 'daySun'];
  const days = w.daysOfWeek && w.daysOfWeek.length > 0
    ? dayKeys.filter((_, i) => w.daysOfWeek!.includes(i)).map((k) => t(`maintenance.${k}`)).join(', ')
    : null;

  const recurrence = w.recurrenceType === 'daily'
    ? t('maintenance.scheduleEveryDay')
    : days ? t('maintenance.scheduleEveryDays', { days }) : t('maintenance.scheduleWeekly');

  return `${recurrence} · ${w.startTime ?? '?'} – ${w.endTime ?? '?'} (${w.timezone})`;
}

function StatusPip({ active, isActiveNow, expired }: { active: boolean; isActiveNow?: boolean; expired?: boolean }) {
  const { t } = useTranslation();
  if (expired) return <span className="text-xs text-text-muted">{t('maintenance.statusExpired')}</span>;
  if (!active) return <span className="text-xs text-text-muted">{t('maintenance.statusInactive')}</span>;
  if (isActiveNow) return (
    <span className="flex items-center gap-1 text-xs text-status-maintenance font-medium">
      <CheckCircle2 size={11} />
      {t('maintenance.statusActiveNow')}
    </span>
  );
  return <span className="text-xs text-status-up">{t('maintenance.statusScheduled')}</span>;
}

function SourceBadge({ source, sourceName }: { source: MaintenanceWindow['source']; sourceName?: string }) {
  if (source === 'global') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-purple-500/15 text-purple-400 border border-purple-500/20 shrink-0">
        <Globe size={9} />
        GLOBAL
      </span>
    );
  }
  if (source === 'group') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-blue-500/15 text-blue-400 border border-blue-500/20 shrink-0" title={sourceName}>
        <Users size={9} />
        {sourceName ? sourceName.length > 16 ? `${sourceName.slice(0, 14)}…` : sourceName : 'GROUP'}
      </span>
    );
  }
  return null;
}

/** A single window row — used in all three sections */
function WindowRow({
  w,
  onEdit,
  onDelete,
  onDisable,
  onEnable,
  deleting,
  disabling,
  expired,
}: {
  w: MaintenanceWindow;
  onEdit?: (w: MaintenanceWindow) => void;
  onDelete?: (id: number) => void;
  onDisable?: (id: number) => void;
  onEnable?: (id: number) => void;
  deleting: number | null;
  disabling: number | null;
  expired?: boolean;
}) {
  const { t } = useTranslation();
  const isDisabled = w.isDisabledHere;
  return (
    <div
      className={cn(
        'flex items-start justify-between gap-3 rounded-lg border px-3 py-2.5 transition-colors',
        expired
          ? 'border-border bg-bg-tertiary opacity-40'
          : isDisabled
            ? 'border-border bg-bg-tertiary opacity-50'
            : w.isActiveNow
              ? 'border-status-maintenance/40 bg-status-maintenance/5'
              : 'border-border bg-bg-tertiary',
      )}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={cn('text-sm font-medium truncate', isDisabled || expired ? 'text-text-muted line-through' : 'text-text-primary')}>
            {w.name}
          </span>
          {isDisabled && (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-red-500/15 text-red-400 border border-red-500/20 shrink-0">
              <Ban size={9} />
              DISABLED
            </span>
          )}
          {!isDisabled && <StatusPip active={w.active ?? true} isActiveNow={w.isActiveNow} expired={expired} />}
          {w.source && w.source !== 'local' && (
            <SourceBadge source={w.source} sourceName={w.sourceName} />
          )}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-text-muted">
          {w.scheduleType === 'one_time' ? <Clock size={11} /> : <RefreshCw size={11} />}
          <span className="truncate">{formatSchedule(w, t)}</span>
        </div>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        {/* Local window actions */}
        {w.canEdit && onEdit && !expired && (
          <button
            onClick={() => onEdit(w)}
            className="p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
            title={t('common.edit')}
          >
            <Pencil size={13} />
          </button>
        )}
        {w.canDelete && onDelete && (
          <button
            onClick={() => onDelete(w.id)}
            disabled={deleting === w.id}
            className="p-1.5 rounded text-text-muted hover:text-red-400 hover:bg-bg-hover transition-colors disabled:opacity-50"
            title={t('common.delete')}
          >
            <Trash2 size={13} />
          </button>
        )}
        {/* Inherited window actions */}
        {w.canDisable && onDisable && (
          <button
            onClick={() => onDisable(w.id)}
            disabled={disabling === w.id}
            className="px-2 py-1 rounded text-xs font-medium text-text-muted hover:text-red-400 hover:bg-bg-hover border border-border transition-colors disabled:opacity-50"
          >
            {t('maintenance.disableBtn')}
          </button>
        )}
        {w.canEnable && onEnable && (
          <button
            onClick={() => onEnable(w.id)}
            disabled={disabling === w.id}
            className="px-2 py-1 rounded text-xs font-medium text-text-muted hover:text-status-up hover:bg-bg-hover border border-border transition-colors disabled:opacity-50"
          >
            {t('maintenance.enableBtn')}
          </button>
        )}
      </div>
    </div>
  );
}

/** ─── Effective view (for detail pages) ──────────────────────────────────── */
function EffectiveList({
  scopeType,
  scopeId,
  channels,
  defaultScopeType,
  defaultScopeId,
}: Required<Pick<Props, 'scopeType' | 'scopeId'>> & Omit<Props, 'scopeType' | 'scopeId' | 'title' | 'scopeOptions'>) {
  const [windows, setWindows] = useState<MaintenanceWindow[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<MaintenanceWindow | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [disabling, setDisabling] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await maintenanceApi.getEffective(scopeType, scopeId);
      setWindows(data);
    } finally {
      setLoading(false);
    }
  }, [scopeType, scopeId]);

  useEffect(() => { load(); }, [load]);

  /** Edit mode: update existing window */
  async function handleSave(data: Parameters<typeof maintenanceApi.create>[0]) {
    if (!editing) return;
    await maintenanceApi.update(editing.id, data);
    await load();
    setEditing(null);
  }

  /** Create mode: modal handled all API calls, just reload */
  function handleSaved() {
    load();
  }

  async function handleDelete(id: number) {
    setDeleting(id);
    try {
      await maintenanceApi.delete(id);
      await load();
    } finally {
      setDeleting(null);
    }
  }

  async function handleDisable(id: number) {
    setDisabling(id);
    try {
      await maintenanceApi.disableForScope(id, scopeType, scopeId);
      await load();
    } finally {
      setDisabling(null);
    }
  }

  async function handleEnable(id: number) {
    setDisabling(id);
    try {
      await maintenanceApi.enableForScope(id, scopeType, scopeId);
      await load();
    } finally {
      setDisabling(null);
    }
  }

  const { t } = useTranslation();
  const local = windows.filter((w) => w.source === 'local');
  const fromGlobal = windows.filter((w) => w.source === 'global');

  // Group "from group" windows by their source group name
  const fromGroupMap = new Map<string, MaintenanceWindow[]>();
  for (const w of windows.filter((w) => w.source === 'group')) {
    const key = w.sourceName ?? 'Group';
    if (!fromGroupMap.has(key)) fromGroupMap.set(key, []);
    fromGroupMap.get(key)!.push(w);
  }

  const channelOptions = channels.map((ch) => ({ id: ch.id, name: ch.name, type: ch.type }));

  function renderSection(title: string, items: MaintenanceWindow[], showAdd?: boolean) {
    if (items.length === 0 && !showAdd) return null;
    return (
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">{title}</span>
          {showAdd && (
            <button
              onClick={() => { setEditing(null); setModalOpen(true); }}
              className="flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium bg-accent text-white hover:bg-accent-hover transition-colors"
            >
              <Plus size={11} />
              {t('maintenance.add')}
            </button>
          )}
        </div>
        {items.length === 0 ? (
          <p className="text-xs text-text-muted py-1 pl-1">{t('maintenance.sectionNone')}</p>
        ) : (
          <div className="space-y-1.5">
            {items.map((w) => (
              <WindowRow
                key={w.id}
                w={w}
                onEdit={w.canEdit ? (win) => { setEditing(win); setModalOpen(true); } : undefined}
                onDelete={w.canDelete ? handleDelete : undefined}
                onDisable={w.canDisable ? handleDisable : undefined}
                onEnable={w.canEnable ? handleEnable : undefined}
                deleting={deleting}
                disabling={disabling}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-text-muted py-3">
          <RefreshCw size={14} className="animate-spin" />
          {t('common.loading')}
        </div>
      ) : (
        <>
          {/* Local windows */}
          {renderSection(t('maintenance.sectionLocal'), local, true)}

          {/* From group(s) */}
          {[...fromGroupMap.entries()].map(([groupName, items]) =>
            renderSection(t('maintenance.sectionFromGroup', { name: groupName }), items)
          )}

          {/* From global */}
          {renderSection(t('maintenance.sectionFromGlobal'), fromGlobal)}
        </>
      )}

      <MaintenanceWindowModal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setEditing(null); }}
        onSave={handleSave}
        onSaved={handleSaved}
        initial={editing}
        channelOptions={channelOptions}
        defaultScopeType={(defaultScopeType ?? scopeType) as import('@obliance/shared').MaintenanceScopeType | undefined}
        defaultScopeId={defaultScopeId ?? scopeId}
      />
    </div>
  );
}

/** ─── Flat list view (for admin page) ──────────────────────────────────────── */
function FlatList({
  channels,
  defaultScopeType,
  defaultScopeId,
}: Omit<Props, 'scopeType' | 'scopeId' | 'title' | 'scopeOptions'>) {
  const [windows, setWindows] = useState<MaintenanceWindow[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<MaintenanceWindow | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [filterScope, setFilterScope] = useState<string>('all');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = filterScope !== 'all' ? { scopeType: filterScope } : undefined;
      const data = await maintenanceApi.list(params);
      setWindows(data);
    } finally {
      setLoading(false);
    }
  }, [filterScope]);

  useEffect(() => { load(); }, [load]);

  /** Edit mode */
  async function handleSave(data: Parameters<typeof maintenanceApi.create>[0]) {
    if (!editing) return;
    await maintenanceApi.update(editing.id, data);
    await load();
    setEditing(null);
  }

  /** Create mode: modal handled API calls */
  function handleSaved() {
    load();
  }

  async function handleDelete(id: number) {
    setDeleting(id);
    try {
      await maintenanceApi.delete(id);
      setWindows((prev) => prev.filter((w) => w.id !== id));
    } finally {
      setDeleting(null);
    }
  }

  const { t } = useTranslation();
  const channelOptions = channels.map((ch) => ({ id: ch.id, name: ch.name, type: ch.type }));

  const scopeFilterLabels: Record<string, string> = {
    all: t('maintenance.filterAll'),
    global: t('maintenance.filterGlobal'),
    group: t('maintenance.filterGroups'),
    monitor: t('maintenance.filterMonitors'),
    agent: t('maintenance.filterAgents'),
  };

  const now = new Date();
  const isExpired = (w: MaintenanceWindow) =>
    w.scheduleType === 'one_time' && w.endAt != null && new Date(w.endAt) < now;

  const activeWindows = windows.filter((w) => !isExpired(w));
  const expiredWindows = windows.filter(isExpired);

  function renderFlatRow(w: MaintenanceWindow, exp?: boolean) {
    return (
      <div
        key={w.id}
        className={cn(
          'flex items-start justify-between gap-3 rounded-lg border px-3 py-2.5 transition-colors',
          exp
            ? 'border-border bg-bg-tertiary opacity-40'
            : w.isActiveNow
              ? 'border-status-maintenance/40 bg-status-maintenance/5'
              : 'border-border bg-bg-tertiary',
        )}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={cn('text-sm font-medium truncate', exp ? 'text-text-muted line-through' : 'text-text-primary')}>
              {w.name}
            </span>
            <StatusPip active={w.active ?? true} isActiveNow={w.isActiveNow} expired={exp} />
            {w.scopeType === 'global' && (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-purple-500/15 text-purple-400 border border-purple-500/20 shrink-0">
                <Globe size={9} />
                GLOBAL
              </span>
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-xs text-text-muted">
            {w.scheduleType === 'one_time' ? <Clock size={11} /> : <RefreshCw size={11} />}
            <span className="truncate">{formatSchedule(w, t)}</span>
          </div>
          {w.scopeName && w.scopeType !== 'global' && (
            <div className="mt-0.5 text-xs text-text-muted">
              {w.scopeType.charAt(0).toUpperCase() + w.scopeType.slice(1)}: <span className="text-text-secondary">{w.scopeName}</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => { setEditing(w); setModalOpen(true); }}
            className="p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
            title={t('common.edit')}
          >
            <Pencil size={13} />
          </button>
          <button
            onClick={() => handleDelete(w.id)}
            disabled={deleting === w.id}
            className="p-1.5 rounded text-text-muted hover:text-red-400 hover:bg-bg-hover transition-colors disabled:opacity-50"
            title={t('common.delete')}
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Filter chips */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {['all', 'global', 'group', 'monitor', 'agent'].map((s) => (
          <button
            key={s}
            onClick={() => setFilterScope(s)}
            className={cn(
              'px-3 py-1 rounded-full text-xs font-medium border transition-colors',
              filterScope === s
                ? 'bg-accent border-accent text-white'
                : 'border-border text-text-secondary hover:border-accent',
            )}
          >
            {scopeFilterLabels[s]}
          </button>
        ))}
        <button
          onClick={() => { setEditing(null); setModalOpen(true); }}
          className="ml-auto flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium bg-accent text-white hover:bg-accent-hover transition-colors"
        >
          <Plus size={12} />
          {t('maintenance.addWindow')}
        </button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-text-muted py-3">
          <RefreshCw size={14} className="animate-spin" />
          {t('common.loading')}
        </div>
      ) : windows.length === 0 ? (
        <p className="text-sm text-text-muted py-2">{t('maintenance.noWindows')}</p>
      ) : (
        <div className="space-y-4">
          {/* Active / upcoming windows */}
          {activeWindows.length > 0 && (
            <div className="space-y-2">
              {activeWindows.map((w) => renderFlatRow(w, false))}
            </div>
          )}

          {/* Expired one-time windows */}
          {expiredWindows.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">
                {t('maintenance.sectionExpired')}
              </p>
              <div className="space-y-2">
                {expiredWindows.map((w) => renderFlatRow(w, true))}
              </div>
            </div>
          )}
        </div>
      )}

      <MaintenanceWindowModal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setEditing(null); }}
        onSave={handleSave}
        onSaved={handleSaved}
        initial={editing}
        channelOptions={channelOptions}
        defaultScopeType={defaultScopeType}
        defaultScopeId={defaultScopeId}
      />
    </div>
  );
}

// ── Public component ─────────────────────────────────────────────────────────

export function MaintenanceWindowList({ scopeType, scopeId, channels, title, defaultScopeType, defaultScopeId }: Props) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-3">
        <CalendarClock size={12} className="text-text-muted" />
        <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wide">
          {title ?? 'Maintenance Windows'}
        </h3>
      </div>

      {scopeType !== undefined && scopeId !== undefined ? (
        <EffectiveList
          scopeType={scopeType}
          scopeId={scopeId}
          channels={channels}
          defaultScopeType={defaultScopeType}
          defaultScopeId={defaultScopeId}
        />
      ) : (
        <FlatList
          channels={channels}
          defaultScopeType={defaultScopeType}
          defaultScopeId={defaultScopeId}
        />
      )}
    </div>
  );
}
