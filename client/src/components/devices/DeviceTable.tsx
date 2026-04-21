import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search, RefreshCw, ChevronLeft, ChevronRight, X, RotateCcw, PowerOff, Trash2, Download,
  ShieldCheck, Loader2, MoreHorizontal, UserX, SortAsc, SortDesc, FolderOpen, MousePointerClick, Check,
} from 'lucide-react';
import { deviceApi } from '@/api/device.api';
import { DeviceRow } from '@/components/devices/DeviceRow';
import { StyledCheckbox } from '@/components/devices/StyledCheckbox';
import { GroupTreePicker } from '@/components/devices/GroupTreePicker';
import type { Device } from '@obliance/shared';
import { useAuthStore } from '@/store/authStore';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { clsx } from 'clsx';
import { anonymize } from '@/utils/anonymize';

type ApprovalFilter = '' | 'approved' | 'pending' | 'refused' | 'suspended';
type SortField = 'name' | 'status' | 'os' | 'lastSeen' | 'version' | 'group' | 'cpu' | 'ram' | 'disk';

interface DeviceTableProps {
  mode: 'monitoring' | 'admin';
  initialStatusFilter?: string;
  groupId?: number | null;
  onGroupChange?: (id: number | null) => void;
}

const PAGE_SIZES = [50, 100, 200, 500];

export function DeviceTable({ mode, initialStatusFilter, groupId: externalGroupId, onGroupChange }: DeviceTableProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { isAdmin } = useAuthStore();

  // Filters
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilters, setStatusFilters] = useState<Set<string>>(() => {
    if (initialStatusFilter) return new Set([initialStatusFilter]);
    return new Set();
  });
  const [osFilters, setOsFilters] = useState<Set<string>>(new Set());
  const [approvalFilter, setApprovalFilter] = useState<ApprovalFilter>(mode === 'admin' ? '' : 'approved');
  const [sortBy, setSortBy] = useState<SortField>('name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [pageSize, setPageSize] = useState(100);

  // Data
  const [devices, setDevices] = useState<Device[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);

  // Selection
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [selectAllGroup, setSelectAllGroup] = useState(false);
  // When enabled, a dark checkbox is shown on every row AND the whole row
  // becomes a selection toggle (no navigation). Lets the user pick devices
  // without having to aim a tiny checkbox target.
  const [selectionMode, setSelectionMode] = useState(false);
  // Change-group modal state
  const [changeGroupOpen, setChangeGroupOpen] = useState(false);

  // Approval counts (admin mode)
  const [counts, setCounts] = useState({ all: 0, approved: 0, pending: 0, refused: 0, suspended: 0 });

  // Batch actions
  const [batchMenuOpen, setBatchMenuOpen] = useState(false);
  const [isBatchRunning, setIsBatchRunning] = useState(false);

  // Export
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const handleExport = async (format: 'csv' | 'xlsx' | 'pdf') => {
    setExportMenuOpen(false);
    setIsExporting(true);
    try {
      const { blob, filename } = await deviceApi.export(format, {
        search: debouncedSearch || undefined,
        status: statusFilters.size === 1 ? [...statusFilters][0] : undefined,
        osType: osFilters.size === 1 ? [...osFilters][0] : undefined,
        groupId: groupId === -1 ? undefined : (groupId ?? undefined),
        includeSubgroups: groupId === -1 ? undefined : (groupId ? true : undefined),
        ungrouped: groupId === -1 ? true : undefined,
        approvalStatus: approvalFilter || undefined,
        sortBy,
        sortOrder,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error(t('common.error'));
    } finally {
      setIsExporting(false);
    }
  };

  // Debounce search
  const searchTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    searchTimer.current = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(searchTimer.current);
  }, [search]);

  const groupId = externalGroupId ?? null;
  // -1 is the sentinel the GroupSidePanel emits for "Ungrouped" — devices
  // with NULL group_id. We translate it into the dedicated `ungrouped`
  // query flag and skip the normal group / sub-group filter.
  const ungroupedOnly = groupId === -1;

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await deviceApi.listPaginated({
        search: debouncedSearch || undefined,
        status: statusFilters.size === 1 ? [...statusFilters][0] : undefined,
        osType: osFilters.size === 1 ? [...osFilters][0] : undefined,
        groupId: ungroupedOnly ? undefined : (groupId ?? undefined),
        includeSubgroups: ungroupedOnly ? undefined : (groupId ? true : undefined),
        ungrouped: ungroupedOnly ? true : undefined,
        approvalStatus: approvalFilter || undefined,
        page,
        pageSize,
        sortBy,
        sortOrder,
      });
      setDevices(result.items);
      setTotal(result.total);
    } catch {
      toast.error(t('common.error'));
    } finally {
      setIsLoading(false);
    }
  }, [debouncedSearch, statusFilters, osFilters, groupId, approvalFilter, page, pageSize, sortBy, sortOrder, t]);

  useEffect(() => { load(); }, [load]);

  // Load counts for admin mode
  useEffect(() => {
    if (mode !== 'admin') return;
    deviceApi.getSummary().then((s) => {
      setCounts({
        all: (s.online ?? 0) + (s.offline ?? 0) + (s.warning ?? 0) + (s.critical ?? 0) + (s.pending ?? 0) + (s.suspended ?? 0),
        approved: (s.online ?? 0) + (s.offline ?? 0) + (s.warning ?? 0) + (s.critical ?? 0),
        pending: s.pending ?? 0,
        refused: 0,
        suspended: s.suspended ?? 0,
      });
    }).catch(() => {});
  }, [mode, devices]);

  const totalPages = Math.ceil(total / pageSize);

  // Reset page when filters change
  useEffect(() => { setPage(1); setSelectedIds(new Set()); setSelectAllGroup(false); }, [debouncedSearch, statusFilters, osFilters, groupId, approvalFilter, sortBy, sortOrder, pageSize]);

  // Toggle filter chips
  const toggleStatus = (s: string) => {
    setStatusFilters(prev => {
      const next = new Set(prev);
      next.has(s) ? next.delete(s) : (next.clear(), next.add(s)); // single-select for now (server supports one)
      return next;
    });
  };
  const toggleOs = (os: string) => {
    setOsFilters(prev => {
      const next = new Set(prev);
      next.has(os) ? next.delete(os) : (next.clear(), next.add(os));
      return next;
    });
  };

  const toggleSelect = (id: number) => {
    setSelectedIds(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
    setSelectAllGroup(false);
  };
  const toggleAll = () => {
    if (selectedIds.size === devices.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(devices.map(d => d.id)));
    setSelectAllGroup(false);
  };
  const handleSelectAllGroup = () => { setSelectAllGroup(true); setSelectedIds(new Set(devices.map(d => d.id))); };

  const handleBatchAction = async (action: string) => {
    setBatchMenuOpen(false);
    setIsBatchRunning(true);
    try {
      if (action === 'approve') {
        const ids = selectAllGroup && groupId ? undefined : Array.from(selectedIds);
        if (ids) { await Promise.all(ids.map(id => deviceApi.approve(id))); toast.success(t('devices.batch.approved', { count: ids.length })); }
      } else if (action === 'delete') {
        if (!confirm(t('devices.batch.confirmDelete'))) { setIsBatchRunning(false); return; }
        const ids = Array.from(selectedIds);
        await Promise.all(ids.map(id => deviceApi.delete(id)));
        toast.success(t('devices.batch.deleted', { count: ids.length }));
      } else {
        const result = await deviceApi.batch({
          groupId: selectAllGroup && groupId ? groupId : undefined,
          deviceIds: selectAllGroup && groupId ? undefined : Array.from(selectedIds),
          action,
        });
        toast.success(t('devices.batch.dispatched', { count: result.dispatched }));
      }
      setSelectedIds(new Set()); setSelectAllGroup(false); await load();
    } catch { toast.error(t('common.error')); } finally { setIsBatchRunning(false); }
  };

  const hasSelection = selectedIds.size > 0;
  const allChecked = devices.length > 0 && devices.every(d => selectedIds.has(d.id));
  const someChecked = selectedIds.size > 0 && !allChecked;

  const hasFilters = debouncedSearch || statusFilters.size > 0 || osFilters.size > 0;

  const handleSort = (field: SortField) => {
    if (sortBy === field) setSortOrder(o => o === 'asc' ? 'desc' : 'asc');
    else {
      setSortBy(field);
      // Metric sorts default to desc (highest first) — that's the useful
      // direction (see which machines are busiest). Alpha fields default asc.
      setSortOrder(['cpu', 'ram', 'disk', 'lastSeen', 'status'].includes(field) ? 'desc' : 'asc');
    }
  };

  const STATUS_CHIPS = [
    { key: 'online', label: t('deviceStatus.online'), color: 'bg-green-400' },
    { key: 'offline', label: t('deviceStatus.offline'), color: 'bg-gray-400' },
    { key: 'warning', label: t('deviceStatus.warning'), color: 'bg-yellow-400' },
    { key: 'critical', label: t('deviceStatus.critical'), color: 'bg-red-400' },
    { key: 'updating', label: t('deviceStatus.updating', 'Updating'), color: 'bg-blue-400' },
    { key: 'update_error', label: t('deviceStatus.update_error', 'Update error'), color: 'bg-orange-500' },
  ];
  const OS_CHIPS = [
    { key: 'windows', label: 'Windows' },
    { key: 'linux', label: 'Linux' },
    { key: 'macos', label: 'macOS' },
  ];

  return (
    <div className="space-y-3">
      {/* Approval quick filters (admin mode) */}
      {mode === 'admin' && (
        <div className="flex items-center gap-2 flex-wrap mb-3">
          {([
            { key: '' as ApprovalFilter, label: t('devices.filters.all'), count: counts.all },
            { key: 'approved' as ApprovalFilter, label: t('devices.filters.approved'), count: counts.approved },
            { key: 'pending' as ApprovalFilter, label: t('devices.filters.pending'), count: counts.pending },
            { key: 'refused' as ApprovalFilter, label: t('devices.filters.refused'), count: counts.refused },
            { key: 'suspended' as ApprovalFilter, label: t('devices.filters.suspended'), count: counts.suspended },
          ]).map(({ key, label, count }) => (
            <button key={key} onClick={() => setApprovalFilter(key)}
              className={clsx('px-3 py-1.5 text-sm font-medium rounded-lg border transition-colors',
                approvalFilter === key ? 'bg-accent text-white border-accent' : 'bg-bg-secondary text-text-muted border-border hover:text-text-primary hover:border-accent/50',
              )}>
              {label} <span className="opacity-60">({count})</span>
            </button>
          ))}
        </div>
      )}

      {/* Filter bar */}
      <div className="space-y-2 mb-3">
        {/* Search + sort + pagesize + refresh */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none" />
            <input type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder={t('devices.filters.search')}
              className="w-full pl-9 pr-3 py-2 text-sm bg-bg-secondary border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent" />
          </div>
          <select value={pageSize} onChange={e => setPageSize(parseInt(e.target.value))}
            className="px-2 py-2 text-xs bg-bg-secondary border border-border rounded-lg text-text-muted focus:outline-none">
            {PAGE_SIZES.map(n => <option key={n} value={n}>{n}/page</option>)}
          </select>
          {hasFilters && (
            <button onClick={() => { setSearch(''); setStatusFilters(new Set()); setOsFilters(new Set()); }}
              className="p-2 text-text-muted hover:text-text-primary"><X className="w-3.5 h-3.5" /></button>
          )}
          <div className="relative">
            <button
              onClick={() => setExportMenuOpen((v) => !v)}
              disabled={isExporting}
              className="p-2 text-text-muted hover:text-text-primary rounded-lg hover:bg-bg-secondary transition-colors disabled:opacity-50"
              title="Export filtered devices"
            >
              <Download className={clsx('w-4 h-4', isExporting && 'animate-pulse')} />
            </button>
            {exportMenuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setExportMenuOpen(false)} />
                <div className="absolute right-0 top-full mt-1 w-32 bg-bg-secondary border border-border rounded-lg shadow-xl z-20 overflow-hidden">
                  <button onClick={() => handleExport('csv')} className="w-full text-left px-3 py-2 text-sm text-text-primary hover:bg-bg-tertiary">CSV</button>
                  <button onClick={() => handleExport('xlsx')} className="w-full text-left px-3 py-2 text-sm text-text-primary hover:bg-bg-tertiary">Excel (xlsx)</button>
                  <button onClick={() => handleExport('pdf')} className="w-full text-left px-3 py-2 text-sm text-text-primary hover:bg-bg-tertiary">PDF</button>
                </div>
              </>
            )}
          </div>
          <button
            onClick={() => {
              const next = !selectionMode;
              setSelectionMode(next);
              if (!next) { setSelectedIds(new Set()); setSelectAllGroup(false); }
            }}
            className={clsx(
              'flex items-center gap-1.5 px-2.5 py-2 text-xs rounded-lg border transition-colors',
              selectionMode
                ? 'bg-accent text-white border-accent'
                : 'bg-bg-secondary border-border text-text-muted hover:text-text-primary hover:border-accent/40',
            )}
            title={selectionMode ? t('devices.selection.exit', 'Exit selection mode') : t('devices.selection.enter', 'Enter selection mode — click any row to select')}
          >
            {selectionMode ? <Check className="w-3.5 h-3.5" /> : <MousePointerClick className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">{selectionMode ? t('devices.selection.active', 'Selecting') : t('devices.selection.select', 'Select')}</span>
          </button>
          <button onClick={load} className="p-2 text-text-muted hover:text-text-primary rounded-lg hover:bg-bg-secondary transition-colors">
            <RefreshCw className={clsx('w-4 h-4', isLoading && 'animate-spin')} />
          </button>
        </div>

        {/* Status + OS chips */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {STATUS_CHIPS.map(({ key, label, color }) => (
            <button key={key} onClick={() => toggleStatus(key)}
              className={clsx('flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full border transition-colors',
                statusFilters.has(key) ? 'bg-accent/10 border-accent text-accent' : 'border-border text-text-muted hover:border-accent/30',
              )}>
              <div className={clsx('w-2 h-2 rounded-full', color)} />
              {label}
            </button>
          ))}
          <div className="w-px h-4 bg-border mx-1" />
          {OS_CHIPS.map(({ key, label }) => (
            <button key={key} onClick={() => toggleOs(key)}
              className={clsx('px-2.5 py-1 text-xs font-medium rounded-full border transition-colors',
                osFilters.has(key) ? 'bg-accent/10 border-accent text-accent' : 'border-border text-text-muted hover:border-accent/30',
              )}>
              {label}
            </button>
          ))}
          <span className="ml-auto text-xs text-text-muted">{total} device{total !== 1 ? 's' : ''}</span>
        </div>
      </div>

      {/* Batch action bar */}
      {hasSelection && (
        <div className="flex items-center gap-3 p-2.5 mb-3 bg-accent/5 border border-accent/20 rounded-lg">
          <StyledCheckbox checked={allChecked} indeterminate={someChecked} onChange={toggleAll} />
          <span className="text-sm font-medium text-text-primary">
            {selectAllGroup ? t('devices.batch.allGroupSelected', { count: total }) : t('devices.batch.selected', { count: selectedIds.size })}
          </span>
          {!selectAllGroup && groupId && total > devices.length && (
            <button onClick={handleSelectAllGroup} className="text-xs text-accent hover:underline">
              {t('devices.batch.selectAllGroup', { count: total })}
            </button>
          )}
          <div className="relative ml-auto">
            <button onClick={() => setBatchMenuOpen(!batchMenuOpen)} disabled={isBatchRunning}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-accent text-white rounded-lg hover:bg-accent/80 disabled:opacity-50 transition-colors">
              {isBatchRunning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MoreHorizontal className="w-3.5 h-3.5" />}
              {t('devices.batch.actions')}
            </button>
            {batchMenuOpen && (
              <div className="absolute right-0 top-full mt-1 z-50 bg-bg-secondary border border-border rounded-lg shadow-lg overflow-hidden min-w-[180px]">
                {mode === 'admin' && approvalFilter === 'pending' && (
                  <button onClick={() => handleBatchAction('approve')} className="w-full flex items-center gap-2 px-3 py-2 text-xs text-text-primary hover:bg-bg-tertiary text-left">
                    <ShieldCheck className="w-3.5 h-3.5 text-green-400" /> {t('devices.batch.approve')}
                  </button>
                )}
                <button onClick={() => handleBatchAction('restart_agent')} className="w-full flex items-center gap-2 px-3 py-2 text-xs text-text-primary hover:bg-bg-tertiary text-left">
                  <RotateCcw className="w-3.5 h-3.5 text-blue-400" /> {t('devices.batch.restartAgent')}
                </button>
                <button onClick={() => handleBatchAction('reboot')} className="w-full flex items-center gap-2 px-3 py-2 text-xs text-text-primary hover:bg-bg-tertiary text-left">
                  <RotateCcw className="w-3.5 h-3.5 text-orange-400" /> {t('devices.batch.reboot')}
                </button>
                <button onClick={() => handleBatchAction('shutdown')} className="w-full flex items-center gap-2 px-3 py-2 text-xs text-text-primary hover:bg-bg-tertiary text-left">
                  <PowerOff className="w-3.5 h-3.5 text-red-400" /> {t('devices.batch.shutdown')}
                </button>
                <button onClick={() => handleBatchAction('scan_inventory')} className="w-full flex items-center gap-2 px-3 py-2 text-xs text-text-primary hover:bg-bg-tertiary text-left">
                  <Search className="w-3.5 h-3.5 text-text-muted" /> {t('devices.batch.scanInventory')}
                </button>
                <div className="border-t border-border" />
                <button
                  onClick={() => { setBatchMenuOpen(false); setChangeGroupOpen(true); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-text-primary hover:bg-bg-tertiary text-left"
                >
                  <FolderOpen className="w-3.5 h-3.5 text-accent" />
                  {t('devices.batch.changeGroup', 'Change group')}
                </button>
                {mode === 'admin' && (<>
                  <div className="border-t border-border" />
                  <button onClick={() => handleBatchAction('delete')} className="w-full flex items-center gap-2 px-3 py-2 text-xs text-red-400 hover:bg-red-400/10 text-left">
                    <Trash2 className="w-3.5 h-3.5" /> {t('devices.batch.delete')}
                  </button>
                  <button onClick={() => handleBatchAction('uninstall_agent')} className="w-full flex items-center gap-2 px-3 py-2 text-xs text-red-400 hover:bg-red-400/10 text-left">
                    <UserX className="w-3.5 h-3.5" /> {t('devices.batch.uninstall')}
                  </button>
                </>)}
              </div>
            )}
          </div>
          <button onClick={() => { setSelectedIds(new Set()); setSelectAllGroup(false); }}
            className="text-xs text-text-muted hover:text-text-primary flex items-center gap-1">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Device list */}
      {isLoading ? (
        <div className="flex items-center justify-center h-48">
          <RefreshCw className="w-5 h-5 animate-spin text-text-muted" />
        </div>
      ) : devices.length === 0 ? (
        <div className="p-12 text-center text-text-muted bg-bg-secondary border border-border rounded-xl">
          <p className="font-medium text-text-primary mb-1">{t('devices.noDevices')}</p>
        </div>
      ) : (
        <div className="bg-bg-secondary border border-border rounded-xl overflow-hidden">
          {/* Column header row with click-to-sort. The layout isn't a true
              HTML table — DeviceRow is a "rich row" with 2 lines per device —
              but this header approximates the column positions so the user
              can click the label closest to the data they want to sort by. */}
          <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-bg-tertiary/50 text-[10px] uppercase tracking-wider font-medium text-text-muted">
            {(isAdmin() || selectionMode) && (
              <StyledCheckbox checked={allChecked} indeterminate={someChecked} onChange={toggleAll} />
            )}
            <SortLabel label={t('sort.name', 'Name')} field="name" sortBy={sortBy} sortOrder={sortOrder} onClick={handleSort} />
            <div className="flex-1" />
            {mode === 'monitoring' && (
              <>
                <SortLabel label="CPU" field="cpu" sortBy={sortBy} sortOrder={sortOrder} onClick={handleSort} className="w-14 justify-center" />
                <SortLabel label="RAM" field="ram" sortBy={sortBy} sortOrder={sortOrder} onClick={handleSort} className="w-14 justify-center" />
                <SortLabel label={t('sort.disk', 'Disk')} field="disk" sortBy={sortBy} sortOrder={sortOrder} onClick={handleSort} className="w-14 justify-center" />
              </>
            )}
            <SortLabel label={t('sort.status', 'Status')} field="status" sortBy={sortBy} sortOrder={sortOrder} onClick={handleSort} className="w-20 justify-center" />
            <SortLabel label={t('sort.lastSeen', 'Last seen')} field="lastSeen" sortBy={sortBy} sortOrder={sortOrder} onClick={handleSort} className="w-12 justify-end" />
            <span className="w-6" />
            {selectionMode && (
              <span className="ml-2 text-accent">
                {t('devices.selection.modeLabel', 'Selection mode')}
              </span>
            )}
          </div>
          <div>
            {(() => {
              // Group devices by groupName when filtering by a parent group
              if (groupId && devices.some(d => d.groupId !== groupId)) {
                const grouped = new Map<string, Device[]>();
                for (const d of devices) {
                  const key = (d as any).groupName ?? 'Ungrouped';
                  if (!grouped.has(key)) grouped.set(key, []);
                  grouped.get(key)!.push(d);
                }
                return [...grouped.entries()].map(([gName, gDevices]) => (
                  <div key={gName}>
                    <div className="flex items-center gap-2 px-4 py-1.5 bg-bg-tertiary/70 border-b border-border sticky top-0 z-10">
                      <FolderOpen className="w-3.5 h-3.5 text-accent" />
                      <span className="text-xs font-semibold text-text-primary">{anonymize(gName)}</span>
                      <span className="text-[10px] text-text-muted">({gDevices.length})</span>
                    </div>
                    {gDevices.map(device => (
                      <DeviceRow key={device.id} device={device} mode={mode}
                        isSelected={selectedIds.has(device.id)} onSelect={toggleSelect}
                        onNavigate={id => navigate(`/devices/${id}`)} onGroupClick={onGroupChange}
                        selectionMode={selectionMode} />
                    ))}
                  </div>
                ));
              }
              // Flat list (no group filter or single group)
              return devices.map(device => (
                <DeviceRow key={device.id} device={device} mode={mode}
                  isSelected={selectedIds.has(device.id)} onSelect={toggleSelect}
                  onNavigate={id => navigate(`/devices/${id}`)} onGroupClick={onGroupChange}
                  selectionMode={selectionMode} />
              ));
            })()}
          </div>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-3 text-xs text-text-muted">
          <span>{total} device{total !== 1 ? 's' : ''}</span>
          <div className="flex items-center gap-1">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
              className="p-1.5 rounded hover:bg-bg-secondary disabled:opacity-30 transition-colors">
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
              let p: number;
              if (totalPages <= 7) p = i + 1;
              else if (page <= 4) p = i + 1;
              else if (page >= totalPages - 3) p = totalPages - 6 + i;
              else p = page - 3 + i;
              return (
                <button key={p} onClick={() => setPage(p)}
                  className={clsx('w-7 h-7 rounded text-xs transition-colors',
                    p === page ? 'bg-accent text-white' : 'hover:bg-bg-secondary text-text-muted',
                  )}>
                  {p}
                </button>
              );
            })}
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
              className="p-1.5 rounded hover:bg-bg-secondary disabled:opacity-30 transition-colors">
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
          <span>{t('devices.pagination.page', { page, total: totalPages })}</span>
        </div>
      )}

      {/* ── Bulk change-group modal ──────────────────────────────────── */}
      {changeGroupOpen && (
        <ChangeGroupModal
          count={selectedIds.size}
          onCancel={() => setChangeGroupOpen(false)}
          onConfirm={async (newGroupId) => {
            setChangeGroupOpen(false);
            setIsBatchRunning(true);
            try {
              const ids = Array.from(selectedIds);
              const r = await deviceApi.batchChangeGroup(ids, newGroupId);
              toast.success(t('devices.batch.groupChanged', { count: r.changed, defaultValue: `Moved ${r.changed} device${r.changed > 1 ? 's' : ''}` }));
              setSelectedIds(new Set());
              setSelectAllGroup(false);
              await load();
            } catch {
              toast.error(t('common.error'));
            } finally {
              setIsBatchRunning(false);
            }
          }}
        />
      )}
    </div>
  );
}

// ── Change-group modal ─────────────────────────────────────────────────────
function ChangeGroupModal({
  count, onCancel, onConfirm,
}: {
  count: number;
  onCancel: () => void;
  onConfirm: (groupId: number | null) => void;
}) {
  const { t } = useTranslation();
  const [groupId, setGroupId] = useState<number | null>(null);
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onCancel}>
      <div
        className="bg-bg-secondary border border-border rounded-xl shadow-2xl w-full max-w-md mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-border flex items-center gap-2">
          <FolderOpen className="w-4 h-4 text-accent" />
          <span className="text-sm font-semibold text-text-primary">
            {t('devices.batch.changeGroupTitle', { count, defaultValue: `Change group for ${count} device${count > 1 ? 's' : ''}` })}
          </span>
          <button onClick={onCancel} className="ml-auto p-1 text-text-muted hover:text-text-primary rounded">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-4 py-4 space-y-3">
          <p className="text-xs text-text-muted">
            {t('devices.batch.changeGroupHint', 'Pick a target group, or leave blank to move to "Ungrouped".')}
          </p>
          <GroupTreePicker value={groupId} onChange={(id) => setGroupId(id)} />
        </div>
        <div className="px-4 py-3 border-t border-border flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-xs border border-border rounded text-text-muted hover:text-text-primary"
          >
            {t('common.cancel', 'Cancel')}
          </button>
          <button
            onClick={() => onConfirm(groupId)}
            className="px-3 py-1.5 text-xs bg-accent text-white rounded hover:bg-accent/90"
          >
            {t('devices.batch.moveHere', 'Move')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Column header sort label ──────────────────────────────────────────────
function SortLabel({
  label, field, sortBy, sortOrder, onClick, className,
}: {
  label: string;
  field: SortField;
  sortBy: SortField;
  sortOrder: 'asc' | 'desc';
  onClick: (f: SortField) => void;
  className?: string;
}) {
  const active = sortBy === field;
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(field); }}
      className={clsx(
        'flex items-center gap-0.5 transition-colors shrink-0',
        active ? 'text-accent' : 'hover:text-text-primary',
        className,
      )}
      title={`Sort by ${label}`}
    >
      <span>{label}</span>
      {active ? (
        sortOrder === 'asc'
          ? <SortAsc className="w-3 h-3" />
          : <SortDesc className="w-3 h-3" />
      ) : (
        <span className="w-3 h-3 opacity-30">↕</span>
      )}
    </button>
  );
}
