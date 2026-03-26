import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Wifi, Monitor, Printer, Router, Cpu, HelpCircle, Trash2, Search, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { networkDiscoveryApi } from '@/api/networkDiscovery.api';
import { commandApi } from '@/api/command.api';
import { deviceApi } from '@/api/device.api';
import type { DiscoveredDevice, Device } from '@obliance/shared';
import toast from 'react-hot-toast';
import { clsx } from 'clsx';
import { useTranslation } from 'react-i18next';

const PAGE_SIZE = 50;

const TYPE_ICONS: Record<string, React.FC<{ className?: string }>> = {
  pc: Monitor,
  server: Monitor,
  printer: Printer,
  network: Router,
  iot: Cpu,
  unknown: HelpCircle,
};

const TYPE_OPTIONS = ['all', 'pc', 'server', 'printer', 'iot', 'network', 'unknown'] as const;

type ManagedFilter = 'all' | 'managed' | 'unmanaged';

export function NetworkDiscoveryPage({ embedded }: { embedded?: boolean }) {
  const { t } = useTranslation();

  // Data
  const [items, setItems] = useState<DiscoveredDevice[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<{ total: number; managed: number; unmanaged: number; byType: Record<string, number> }>({ total: 0, managed: 0, unmanaged: 0, byType: {} });
  const [loading, setLoading] = useState(true);

  // Filters
  const [managedFilter, setManagedFilter] = useState<ManagedFilter>('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [subnetFilter, setSubnetFilter] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  // Scan
  const [onlineDevices, setOnlineDevices] = useState<Device[]>([]);
  const [showScanPicker, setShowScanPicker] = useState(false);
  const [scanning, setScanning] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, any> = { page, limit: PAGE_SIZE };
      if (managedFilter !== 'all') params.isManaged = managedFilter === 'managed';
      if (typeFilter !== 'all') params.deviceType = typeFilter;
      if (subnetFilter.trim()) params.subnet = subnetFilter.trim();
      const [listRes, statsRes] = await Promise.all([
        networkDiscoveryApi.list(params),
        networkDiscoveryApi.getStats(),
      ]);
      setItems(listRes.items);
      setTotal(listRes.total);
      setStats(statsRes);
    } catch {
      toast.error(t('common.error'));
    } finally {
      setLoading(false);
    }
  }, [page, managedFilter, typeFilter, subnetFilter, t]);

  useEffect(() => { loadData(); }, [loadData]);

  // Reset page when filters change
  useEffect(() => { setPage(1); }, [managedFilter, typeFilter, subnetFilter]);

  const handleDelete = async (id: number) => {
    if (!confirm(t('common.confirmDelete') || 'Delete this entry?')) return;
    try {
      await networkDiscoveryApi.remove(id);
      toast.success(t('common.deleted') || 'Deleted');
      loadData();
    } catch {
      toast.error(t('common.error'));
    }
  };

  const handleScanNow = async () => {
    try {
      const devices = await deviceApi.list({ status: 'online' });
      setOnlineDevices(devices);
      setShowScanPicker(true);
    } catch {
      toast.error(t('common.error'));
    }
  };

  const dispatchScan = async (deviceId: number) => {
    setScanning(true);
    setShowScanPicker(false);
    try {
      await commandApi.enqueue(deviceId, 'scan_network' as any, {}, 'normal');
      toast.success(t('discovery.scanDispatched') || 'Network scan dispatched');
    } catch {
      toast.error(t('common.error'));
    } finally {
      setScanning(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const filteredItems = search.trim()
    ? items.filter(d =>
        (d.hostname ?? '').toLowerCase().includes(search.toLowerCase()) ||
        d.ip.toLowerCase().includes(search.toLowerCase()))
    : items;

  const formatDate = (s: string) => {
    try { return new Date(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
    catch { return s; }
  };

  const TypeIcon = ({ type }: { type: string }) => {
    const Icon = TYPE_ICONS[type] ?? HelpCircle;
    return <Icon className="w-4 h-4 text-text-muted" />;
  };

  return (
    <div className={clsx('space-y-5', !embedded && 'p-6')}>
      {!embedded && (
        <div>
          <h1 className="text-2xl font-bold text-text-primary">{t('discovery.title') || 'Network Discovery'}</h1>
          <p className="text-sm text-text-muted mt-0.5">{t('discovery.subtitle') || 'Devices discovered via network scans'}</p>
        </div>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="p-3 bg-bg-secondary border border-border rounded-lg">
          <p className="text-xs text-text-muted">{t('discovery.totalDiscovered') || 'Discovered'}</p>
          <p className="text-xl font-bold text-text-primary mt-1">{stats.total}</p>
        </div>
        <div className="p-3 bg-bg-secondary border border-border rounded-lg">
          <p className="text-xs text-text-muted">{t('discovery.managed') || 'Managed'}</p>
          <p className="text-xl font-bold text-green-400 mt-1">{stats.managed}</p>
        </div>
        <div className="p-3 bg-bg-secondary border border-border rounded-lg">
          <p className="text-xs text-text-muted">{t('discovery.unmanaged') || 'Unmanaged'}</p>
          <p className="text-xl font-bold text-orange-400 mt-1">{stats.unmanaged}</p>
        </div>
        <div className="p-3 bg-bg-secondary border border-border rounded-lg">
          <p className="text-xs text-text-muted">{t('discovery.byType') || 'By Type'}</p>
          <div className="flex flex-wrap gap-2 mt-1">
            {Object.entries(stats.byType).map(([type, count]) => (
              <span key={type} className="inline-flex items-center gap-1 text-xs text-text-muted">
                <TypeIcon type={type} />
                {count}
              </span>
            ))}
            {Object.keys(stats.byType).length === 0 && <span className="text-xs text-text-muted">--</span>}
          </div>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Managed/Unmanaged/All chips */}
        {(['all', 'managed', 'unmanaged'] as ManagedFilter[]).map(f => (
          <button
            key={f}
            onClick={() => setManagedFilter(f)}
            className={clsx(
              'px-3 py-1.5 text-xs font-medium rounded-full border transition-colors',
              managedFilter === f
                ? 'bg-accent text-white border-accent'
                : 'bg-bg-secondary text-text-muted border-border hover:text-text-primary',
            )}
          >
            {f === 'all' ? (t('common.all') || 'All') : f === 'managed' ? (t('discovery.managed') || 'Managed') : (t('discovery.unmanaged') || 'Unmanaged')}
          </button>
        ))}

        {/* Type dropdown */}
        <select
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value)}
          className="px-3 py-1.5 text-xs bg-bg-secondary border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent"
        >
          {TYPE_OPTIONS.map(o => (
            <option key={o} value={o}>{o === 'all' ? (t('common.all') || 'All Types') : o.charAt(0).toUpperCase() + o.slice(1)}</option>
          ))}
        </select>

        {/* Subnet filter */}
        <input
          type="text"
          value={subnetFilter}
          onChange={e => setSubnetFilter(e.target.value)}
          placeholder={t('discovery.subnetPlaceholder') || 'Subnet (e.g. 192.168.1)'}
          className="px-3 py-1.5 text-xs bg-bg-secondary border border-border rounded-lg text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent w-44"
        />

        {/* Search */}
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t('discovery.searchPlaceholder') || 'Search IP or hostname...'}
            className="w-full pl-8 pr-7 py-1.5 text-xs bg-bg-secondary border border-border rounded-lg text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Scan Now */}
        <button
          onClick={handleScanNow}
          disabled={scanning}
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-accent text-white rounded-lg hover:bg-accent/80 disabled:opacity-50 transition-colors"
        >
          <Wifi className={clsx('w-3.5 h-3.5', scanning && 'animate-pulse')} />
          {t('discovery.scanNow') || 'Scan Now'}
        </button>
      </div>

      {/* Scan Picker Modal */}
      {showScanPicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowScanPicker(false)}>
          <div className="bg-bg-primary border border-border rounded-xl p-5 w-full max-w-md shadow-xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-text-primary mb-3">{t('discovery.selectAgent') || 'Select an online agent to run the scan'}</h3>
            {onlineDevices.length === 0 ? (
              <p className="text-xs text-text-muted py-4 text-center">{t('discovery.noOnlineAgents') || 'No online agents available'}</p>
            ) : (
              <div className="max-h-60 overflow-y-auto space-y-1">
                {onlineDevices.map(d => (
                  <button
                    key={d.id}
                    onClick={() => dispatchScan(d.id)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-text-primary hover:bg-accent/10 rounded-lg transition-colors text-left"
                  >
                    <Monitor className="w-4 h-4 text-text-muted flex-shrink-0" />
                    <span className="truncate">{d.hostname || d.ip || `#${d.id}`}</span>
                    {d.ip && <span className="text-xs text-text-muted ml-auto flex-shrink-0">{d.ip}</span>}
                  </button>
                ))}
              </div>
            )}
            <button onClick={() => setShowScanPicker(false)} className="mt-3 w-full text-xs text-text-muted hover:text-text-primary text-center py-1">{t('common.cancel') || 'Cancel'}</button>
          </div>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <RefreshCw className="w-5 h-5 animate-spin text-text-muted" />
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-text-muted">
          <Wifi className="w-8 h-8 mb-2 opacity-40" />
          <p className="text-sm">{t('discovery.noResults') || 'No discovered devices found'}</p>
        </div>
      ) : (
        <div className="overflow-x-auto border border-border rounded-lg">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-bg-secondary border-b border-border text-left">
                <th className="px-4 py-2.5 text-xs font-medium text-text-muted">IP</th>
                <th className="px-4 py-2.5 text-xs font-medium text-text-muted">{t('discovery.hostname') || 'Hostname'}</th>
                <th className="px-4 py-2.5 text-xs font-medium text-text-muted hidden lg:table-cell">MAC</th>
                <th className="px-4 py-2.5 text-xs font-medium text-text-muted hidden lg:table-cell">{t('discovery.vendor') || 'Vendor'}</th>
                <th className="px-4 py-2.5 text-xs font-medium text-text-muted">{t('discovery.type') || 'Type'}</th>
                <th className="px-4 py-2.5 text-xs font-medium text-text-muted hidden md:table-cell">{t('discovery.ports') || 'Ports'}</th>
                <th className="px-4 py-2.5 text-xs font-medium text-text-muted hidden xl:table-cell">{t('discovery.firstSeen') || 'First Seen'}</th>
                <th className="px-4 py-2.5 text-xs font-medium text-text-muted">{t('discovery.lastSeen') || 'Last Seen'}</th>
                <th className="px-4 py-2.5 text-xs font-medium text-text-muted">{t('discovery.status') || 'Status'}</th>
                <th className="px-4 py-2.5 text-xs font-medium text-text-muted w-10"></th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.map(d => {
                const portsStr = d.ports?.length
                  ? d.ports.length > 5
                    ? d.ports.slice(0, 5).join(', ') + ` +${d.ports.length - 5}`
                    : d.ports.join(', ')
                  : '--';
                return (
                  <tr key={d.id} className="border-b border-border/50 hover:bg-bg-secondary/50 transition-colors">
                    <td className="px-4 py-2.5 text-text-primary font-mono text-xs">{d.ip}</td>
                    <td className="px-4 py-2.5 text-text-primary text-xs truncate max-w-[200px]">{d.hostname || '--'}</td>
                    <td className="px-4 py-2.5 text-text-muted text-xs font-mono hidden lg:table-cell">{d.mac || '--'}</td>
                    <td className="px-4 py-2.5 text-text-muted text-xs hidden lg:table-cell truncate max-w-[150px]">{d.ouiVendor || '--'}</td>
                    <td className="px-4 py-2.5">
                      <span className="inline-flex items-center gap-1.5 text-xs text-text-muted">
                        <TypeIcon type={d.deviceType} />
                        {d.deviceType}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-text-muted text-xs font-mono hidden md:table-cell">{portsStr}</td>
                    <td className="px-4 py-2.5 text-text-muted text-xs hidden xl:table-cell">{formatDate(d.firstSeen)}</td>
                    <td className="px-4 py-2.5 text-text-muted text-xs">{formatDate(d.lastSeen)}</td>
                    <td className="px-4 py-2.5">
                      {d.isManaged ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-green-400/10 text-green-400">
                          {t('discovery.managed') || 'Managed'}
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-orange-400/10 text-orange-400">
                          {t('discovery.unmanaged') || 'Unmanaged'}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <button
                        onClick={() => handleDelete(d.id)}
                        className="p-1 text-text-muted hover:text-red-400 hover:bg-red-400/10 rounded transition-colors"
                        title={t('common.delete') || 'Delete'}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between text-xs text-text-muted">
          <span>{t('common.page') || 'Page'} {page} / {totalPages} ({total} {t('common.results') || 'results'})</span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="p-1.5 rounded hover:bg-bg-secondary disabled:opacity-30 transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="p-1.5 rounded hover:bg-bg-secondary disabled:opacity-30 transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
