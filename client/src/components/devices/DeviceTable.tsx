import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, RefreshCw, ChevronLeft, ChevronRight, X, Eye, RotateCcw, PowerOff, Trash2, ShieldCheck, Loader2, MoreHorizontal } from 'lucide-react';
import { deviceApi } from '@/api/device.api';
import { DeviceStatusBadge } from '@/components/devices/DeviceStatusBadge';
import { DeviceMetricsBar } from '@/components/devices/DeviceMetricsBar';
import { OsIcon } from '@/components/devices/OsIcon';
import { StyledCheckbox } from '@/components/devices/StyledCheckbox';
import { GroupTreePicker } from '@/components/devices/GroupTreePicker';
import type { Device } from '@obliance/shared';
import { useAuthStore } from '@/store/authStore';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { clsx } from 'clsx';

type ApprovalFilter = '' | 'approved' | 'pending' | 'refused' | 'suspended';

interface DeviceTableProps {
  mode: 'monitoring' | 'admin';
}

const PAGE_SIZE = 100;

export function DeviceTable({ mode }: DeviceTableProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { isAdmin } = useAuthStore();

  // Filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [osFilter, setOsFilter] = useState('');
  const [groupId, setGroupId] = useState<number | null>(null);
  const [groupBreadcrumb, setGroupBreadcrumb] = useState<string[]>([]);
  const [approvalFilter, setApprovalFilter] = useState<ApprovalFilter>(mode === 'admin' ? '' : 'approved');

  // Data
  const [devices, setDevices] = useState<Device[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);

  // Selection
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [selectAllGroup, setSelectAllGroup] = useState(false);

  // Approval counts (admin mode)
  const [counts, setCounts] = useState({ all: 0, approved: 0, pending: 0, refused: 0, suspended: 0 });

  // Batch actions
  const [batchMenuOpen, setBatchMenuOpen] = useState(false);
  const [isBatchRunning, setIsBatchRunning] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await deviceApi.listPaginated({
        search: search || undefined,
        status: statusFilter || undefined,
        osType: osFilter || undefined,
        groupId: groupId ?? undefined,
        approvalStatus: approvalFilter || undefined,
        page,
        pageSize: PAGE_SIZE,
      });
      setDevices(result.items);
      setTotal(result.total);
    } catch {
      toast.error(t('common.error'));
    } finally {
      setIsLoading(false);
    }
  }, [search, statusFilter, osFilter, groupId, approvalFilter, page, t]);

  useEffect(() => { load(); }, [load]);

  // Load counts for admin mode
  useEffect(() => {
    if (mode !== 'admin') return;
    deviceApi.getSummary().then((s) => {
      setCounts({
        all: (s.online ?? 0) + (s.offline ?? 0) + (s.warning ?? 0) + (s.critical ?? 0) + (s.pending ?? 0) + (s.suspended ?? 0),
        approved: (s.online ?? 0) + (s.offline ?? 0) + (s.warning ?? 0) + (s.critical ?? 0),
        pending: s.pending ?? 0,
        refused: 0, // summary doesn't track refused separately
        suspended: s.suspended ?? 0,
      });
    }).catch(() => {});
  }, [mode, devices]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  // Reset page when filters change
  useEffect(() => { setPage(1); setSelectedIds(new Set()); setSelectAllGroup(false); }, [search, statusFilter, osFilter, groupId, approvalFilter]);

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
    setSelectAllGroup(false);
  };

  const toggleAll = () => {
    if (selectedIds.size === devices.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(devices.map((d) => d.id)));
    }
    setSelectAllGroup(false);
  };

  const handleSelectAllGroup = () => {
    setSelectAllGroup(true);
    setSelectedIds(new Set(devices.map((d) => d.id)));
  };

  const handleBatchAction = async (action: string) => {
    setBatchMenuOpen(false);
    setIsBatchRunning(true);
    try {
      if (action === 'approve') {
        const ids = selectAllGroup && groupId ? undefined : Array.from(selectedIds);
        if (ids) {
          await Promise.all(ids.map((id) => deviceApi.approve(id)));
          toast.success(t('devices.batch.approved', { count: ids.length }));
        }
      } else if (action === 'delete') {
        if (!confirm(t('devices.batch.confirmDelete'))) { setIsBatchRunning(false); return; }
        const ids = Array.from(selectedIds);
        await Promise.all(ids.map((id) => deviceApi.delete(id)));
        toast.success(t('devices.batch.deleted', { count: ids.length }));
      } else {
        // Command-based batch actions
        const result = await deviceApi.batch({
          groupId: selectAllGroup && groupId ? groupId : undefined,
          deviceIds: selectAllGroup && groupId ? undefined : Array.from(selectedIds),
          action,
        });
        toast.success(t('devices.batch.dispatched', { count: result.dispatched }));
      }
      setSelectedIds(new Set());
      setSelectAllGroup(false);
      await load();
    } catch {
      toast.error(t('common.error'));
    } finally {
      setIsBatchRunning(false);
    }
  };

  const hasSelection = selectedIds.size > 0;
  const allChecked = devices.length > 0 && devices.every((d) => selectedIds.has(d.id));
  const someChecked = selectedIds.size > 0 && !allChecked;

  return (
    <div className="space-y-4">
      {/* Approval quick filters (admin mode) */}
      {mode === 'admin' && (
        <div className="flex items-center gap-2 flex-wrap">
          {([
            { key: '' as ApprovalFilter, label: t('devices.filters.all'), count: counts.all },
            { key: 'approved' as ApprovalFilter, label: t('devices.filters.approved'), count: counts.approved },
            { key: 'pending' as ApprovalFilter, label: t('devices.filters.pending'), count: counts.pending },
            { key: 'refused' as ApprovalFilter, label: t('devices.filters.refused'), count: counts.refused },
            { key: 'suspended' as ApprovalFilter, label: t('devices.filters.suspended'), count: counts.suspended },
          ]).map(({ key, label, count }) => (
            <button
              key={key}
              onClick={() => setApprovalFilter(key)}
              className={clsx(
                'px-3 py-1.5 text-sm font-medium rounded-lg border transition-colors',
                approvalFilter === key
                  ? 'bg-accent text-white border-accent'
                  : 'bg-bg-secondary text-text-muted border-border hover:text-text-primary hover:border-accent/50',
              )}
            >
              {label} <span className="opacity-60">({count})</span>
            </button>
          ))}
        </div>
      )}

      {/* Filter bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('devices.filters.search')}
            className="w-full pl-9 pr-3 py-1.5 text-sm bg-bg-secondary border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-1.5 text-sm bg-bg-secondary border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent"
        >
          <option value="">{t('devices.filters.allStatus')}</option>
          <option value="online">Online</option>
          <option value="offline">Offline</option>
          <option value="warning">Warning</option>
          <option value="critical">Critical</option>
          <option value="maintenance">Maintenance</option>
        </select>
        <select
          value={osFilter}
          onChange={(e) => setOsFilter(e.target.value)}
          className="px-3 py-1.5 text-sm bg-bg-secondary border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent"
        >
          <option value="">{t('devices.filters.allOs')}</option>
          <option value="windows">Windows</option>
          <option value="linux">Linux</option>
          <option value="macos">macOS</option>
        </select>
        <GroupTreePicker
          value={groupId}
          onChange={(id, breadcrumb) => { setGroupId(id); setGroupBreadcrumb(breadcrumb); }}
        />
        {(search || statusFilter || osFilter || groupId) && (
          <button
            onClick={() => { setSearch(''); setStatusFilter(''); setOsFilter(''); setGroupId(null); setGroupBreadcrumb([]); }}
            className="flex items-center gap-1 px-2 py-1.5 text-xs text-text-muted hover:text-text-primary"
          >
            <X className="w-3.5 h-3.5" />
            {t('devices.filters.reset')}
          </button>
        )}
        <button onClick={load} className="p-1.5 text-text-muted hover:text-text-primary rounded-lg hover:bg-bg-secondary transition-colors">
          <RefreshCw className={clsx('w-4 h-4', isLoading && 'animate-spin')} />
        </button>
      </div>

      {/* Group breadcrumb + select all */}
      {groupId && groupBreadcrumb.length > 0 && (
        <div className="flex items-center gap-3 p-2.5 bg-accent/5 border border-accent/20 rounded-lg text-sm">
          <span className="text-text-muted">{groupBreadcrumb.join(' > ')}</span>
          <span className="text-text-muted">({total})</span>
          <button
            onClick={() => { setGroupId(null); setGroupBreadcrumb([]); }}
            className="ml-1 text-text-muted hover:text-text-primary"
          >
            <X className="w-3.5 h-3.5" />
          </button>
          {!selectAllGroup && total > devices.length && (
            <button
              onClick={handleSelectAllGroup}
              className="ml-auto text-xs text-accent hover:underline"
            >
              {t('devices.batch.selectAllGroup', { count: total })}
            </button>
          )}
        </div>
      )}

      {/* Batch action bar */}
      {hasSelection && (
        <div className="flex items-center gap-3 p-2.5 bg-accent/5 border border-accent/20 rounded-lg">
          <span className="text-sm font-medium text-text-primary">
            {selectAllGroup ? t('devices.batch.allGroupSelected', { count: total }) : t('devices.batch.selected', { count: selectedIds.size })}
          </span>
          <div className="relative ml-auto">
            <button
              onClick={() => setBatchMenuOpen(!batchMenuOpen)}
              disabled={isBatchRunning}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-accent text-white rounded-lg hover:bg-accent/80 disabled:opacity-50 transition-colors"
            >
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
                <button onClick={() => handleBatchAction('delete')} className="w-full flex items-center gap-2 px-3 py-2 text-xs text-red-400 hover:bg-red-400/10 text-left">
                  <Trash2 className="w-3.5 h-3.5" /> {t('devices.batch.delete')}
                </button>
              </div>
            )}
          </div>
          <button
            onClick={() => { setSelectedIds(new Set()); setSelectAllGroup(false); }}
            className="text-xs text-text-muted hover:text-text-primary flex items-center gap-1"
          >
            <X className="w-3.5 h-3.5" /> {t('devices.filters.reset')}
          </button>
        </div>
      )}

      {/* Table */}
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
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-bg-tertiary/50">
                {isAdmin() && (
                  <th className="w-10 px-4 py-3">
                    <StyledCheckbox checked={allChecked} indeterminate={someChecked} onChange={toggleAll} />
                  </th>
                )}
                <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase">{t('devices.table.device')}</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase hidden sm:table-cell">{t('devices.table.os')}</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase hidden md:table-cell">{t('devices.table.agent')}</th>
                {mode === 'monitoring' && (
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase hidden lg:table-cell">{t('devices.table.metrics')}</th>
                )}
                <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase">{t('devices.table.status')}</th>
                <th className="w-16 px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {devices.map((device) => (
                <tr
                  key={device.id}
                  className={clsx('transition-colors cursor-pointer', selectedIds.has(device.id) ? 'bg-accent/5' : 'hover:bg-bg-tertiary')}
                  onClick={() => navigate(`/devices/${device.id}`)}
                >
                  {isAdmin() && (
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <StyledCheckbox checked={selectedIds.has(device.id)} onChange={() => toggleSelect(device.id)} />
                    </td>
                  )}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <OsIcon osType={device.osType} className="w-4 h-4 text-text-muted shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-text-primary truncate">{device.displayName || device.hostname}</p>
                        <p className="text-xs text-text-muted truncate">{device.ipLocal ?? device.ipPublic ?? ''}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 hidden sm:table-cell">
                    <span className="text-xs text-text-muted">{device.osName ?? device.osType}</span>
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    <span className="text-xs text-text-muted">v{device.agentVersion ?? '?'}</span>
                  </td>
                  {mode === 'monitoring' && (
                    <td className="px-4 py-3 hidden lg:table-cell">
                      <DeviceMetricsBar metrics={device.latestMetrics} compact />
                    </td>
                  )}
                  <td className="px-4 py-3">
                    <DeviceStatusBadge status={device.status} />
                  </td>
                  <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => navigate(`/devices/${device.id}`)}
                      className="p-1.5 text-text-muted hover:text-accent rounded transition-colors"
                    >
                      <Eye className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="p-1.5 text-text-muted hover:text-text-primary disabled:opacity-30 disabled:cursor-not-allowed rounded transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-sm text-text-muted">
            {t('devices.pagination.page', { page, total: totalPages })}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="p-1.5 text-text-muted hover:text-text-primary disabled:opacity-30 disabled:cursor-not-allowed rounded transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          <span className="text-xs text-text-muted ml-2">
            ({total} {t('devices.pagination.total')})
          </span>
        </div>
      )}
    </div>
  );
}
