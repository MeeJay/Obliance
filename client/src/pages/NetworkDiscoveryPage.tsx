import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { RefreshCw, Wifi, Monitor, Printer, Router, Cpu, HelpCircle, Trash2, Search, X, ChevronLeft, ChevronRight, FileCode, Download, Sparkles } from 'lucide-react';
import { networkDiscoveryApi } from '@/api/networkDiscovery.api';
import { commandApi } from '@/api/command.api';
import type { DiscoveredDevice } from '@obliance/shared';
import toast from 'react-hot-toast';
import { clsx } from 'clsx';
import { useTranslation } from 'react-i18next';
import { GenerateDeployScriptModal } from '@/components/networkDiscovery/GenerateDeployScriptModal';
import { ScanTargetPickerModal } from '@/components/networkDiscovery/ScanTargetPickerModal';
import { ExportDiscoveryModal } from '@/components/networkDiscovery/ExportDiscoveryModal';
import { StyledCheckbox } from '@/components/devices/StyledCheckbox';

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
 // OS family filter — mirrors the deploy-script target split so the
 // admin can narrow the list to exactly what will go into a given
 // script. "unix" bundles linux/macos/freebsd (all SSH targets); "other"
 // = non-null + non-known; "unknown" = NULL os_guess.
 const [osFilter, setOsFilter] = useState<'all' | 'windows' | 'unix' | 'other' | 'unknown'>('all');
 const [subnetFilter, setSubnetFilter] = useState('');
 const [search, setSearch] = useState('');
 const [page, setPage] = useState(1);

 // Scan
 const [showScanPicker, setShowScanPicker] = useState(false);
 const [scanning, setScanning] = useState(false);

 // Deploy script + export modals — work on unmanaged selection
 const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
 const [showDeployModal, setShowDeployModal] = useState(false);
 const [showExportModal, setShowExportModal] = useState(false);

 // "New since last viewed" tracking — we remember the highest lastSeen
 // the user has ever observed (persisted in localStorage) and badge any
 // row that's newer than that. Updated when the user clicks "Mark as
 // seen" or navigates away from the page.
 const [seenAt, setSeenAt] = useState<string>(() =>
 localStorage.getItem('discovery.seenAt') ?? '1970-01-01T00:00:00Z',
 );
 const firstLoadRef = useRef(true);

 const loadData = useCallback(async () => {
 setLoading(true);
 try {
 const params: Record<string, any> = { page, limit: PAGE_SIZE };
 if (managedFilter !== 'all') params.isManaged = managedFilter === 'managed';
 if (typeFilter !== 'all') params.deviceType = typeFilter;
 if (osFilter !== 'all') params.osFamily = osFilter;
 if (subnetFilter.trim()) params.subnet = subnetFilter.trim();
 const [listRes, statsRes] = await Promise.all([
 networkDiscoveryApi.list(params),
 networkDiscoveryApi.getStats(),
 ]);
 setItems(listRes.items ?? []);
 setTotal(listRes.total ?? 0);
 setStats(statsRes ?? { total: 0, managed: 0, unmanaged: 0, byType: {} });
 } catch {
 toast.error(t('common.error'));
 } finally {
 setLoading(false);
 }
 }, [page, managedFilter, typeFilter, osFilter, subnetFilter, t]);

 useEffect(() => { loadData(); }, [loadData]);

 // Reset page when filters change
 useEffect(() => { setPage(1); }, [managedFilter, typeFilter, osFilter, subnetFilter]);

 // Clear selection whenever the visible set changes — selections are
 // page-local in this iteration (the full cross-page selection will come
 // with the broader Discovery rework).
 useEffect(() => { setSelectedIds(new Set()); }, [page, managedFilter, typeFilter, osFilter, subnetFilter]);

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

 const handleScanNow = () => setShowScanPicker(true);

 const dispatchScan = async (deviceIds: number[]) => {
 if (deviceIds.length === 0) return;
 setScanning(true);
 try {
 const results = await Promise.allSettled(
 deviceIds.map((id) => commandApi.enqueue(id, 'scan_network' as any, {}, 'normal')),
 );
 const ok = results.filter((r) => r.status === 'fulfilled').length;
 const failed = results.length - ok;
 if (failed === 0) {
 toast.success(
 t('discovery.scanDispatchedN', { count: ok }) ||
 (ok === 1 ? 'Network scan dispatched' : `Network scan dispatched on ${ok} agents`),
 );
 } else {
 toast.error(
 t('discovery.scanDispatchedPartial', { ok, failed }) ||
 `${ok} scan(s) dispatched, ${failed} failed`,
 );
 }
 } finally {
 setScanning(false);
 }
 };

 const markAllAsSeen = () => {
 const now = new Date().toISOString();
 setSeenAt(now);
 localStorage.setItem('discovery.seenAt', now);
 };

 const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

 const filteredItems = search.trim()
 ? (items ?? []).filter(d =>
 (d.hostname ?? '').toLowerCase().includes(search.toLowerCase()) ||
 (d.ip ?? '').toLowerCase().includes(search.toLowerCase()))
 : (items ?? []);

 // Unmanaged rows currently visible (after all filters + text search) — the
 // "Select all unmanaged" button targets this set.
 const unmanagedVisible = useMemo(
 () => filteredItems.filter((d) => !d.isManaged),
 [filteredItems],
 );
 const selectedHosts = useMemo(
 () => filteredItems.filter((d) => selectedIds.has(d.id) && !d.isManaged),
 [filteredItems, selectedIds],
 );

 const toggleSelect = (id: number) => {
 setSelectedIds((prev) => {
 const next = new Set(prev);
 if (next.has(id)) next.delete(id); else next.add(id);
 return next;
 });
 };

 const selectAllUnmanaged = () => {
 setSelectedIds(new Set(unmanagedVisible.map((d) => d.id)));
 };

 const clearSelection = () => setSelectedIds(new Set());

 // "New" = firstSeen stored on the server is strictly after the user's
 // last-seen marker. Counted against the CURRENT page's visible rows so
 // the stats card matches what the admin is actually looking at.
 const newCount = useMemo(
 () => (items ?? []).filter((d) => d.firstSeen > seenAt).length,
 [items, seenAt],
 );

 // Auto-advance the seen marker on leaving the page so the badge clears
 // without a manual "mark seen" click. Runs once on unmount.
 useEffect(() => {
 if (firstLoadRef.current) { firstLoadRef.current = false; return; }
 return () => {
 if (items.length > 0) {
 const max = items.reduce(
 (acc, d) => (d.lastSeen > acc ? d.lastSeen : acc),
 seenAt,
 );
 localStorage.setItem('discovery.seenAt', max);
 }
 };
 }, [items, seenAt]);

 const formatDate = (s: string) => {
 try { return new Date(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
 catch { return s; }
 };

 const TypeIcon = ({ type }: { type: string }) => {
 const Icon = TYPE_ICONS[type] ?? HelpCircle;
 return <Icon className="w-4 h-4 text-text-muted" />;
 };

 const OsBadge = ({ os }: { os: string | null }) => {
 if (!os) return <span className="text-xs text-text-muted">--</span>;
 const normalised = os.toLowerCase();
 const config: Record<string, { label: string; color: string }> = {
 windows: { label: 'Windows', color: 'bg-blue-400/10 text-blue-400 border-blue-400/30' },
 linux: { label: 'Linux', color: 'bg-green-400/10 text-green-400 border-green-400/30' },
 macos: { label: 'macOS', color: 'bg-gray-400/10 text-gray-300 border-gray-400/30' },
 freebsd: { label: 'FreeBSD', color: 'bg-red-400/10 text-red-400 border-red-400/30' },
 };
 const c = config[normalised] ?? {
 label: os,
 color: 'bg-bg-tertiary text-text-muted border-transparent',
 };
 return (
 <span className={clsx('inline-flex items-center px-2 py-0.5 rounded border text-[10px] font-medium', c.color)}>
 {c.label}
 </span>
 );
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
 <div className="p-3 bg-bg-secondary rounded-lg">
 <p className="text-xs text-text-muted">{t('discovery.totalDiscovered') || 'Discovered'}</p>
 <p className="text-xl font-bold text-text-primary mt-1">{stats.total}</p>
 </div>
 <div className="p-3 bg-bg-secondary rounded-lg">
 <p className="text-xs text-text-muted">{t('discovery.managed') || 'Managed'}</p>
 <p className="text-xl font-bold text-green-400 mt-1">{stats.managed}</p>
 </div>
 <div className="p-3 bg-bg-secondary rounded-lg">
 <p className="text-xs text-text-muted">{t('discovery.unmanaged') || 'Unmanaged'}</p>
 <p className="text-xl font-bold text-orange-400 mt-1">{stats.unmanaged}</p>
 </div>
 <div className="p-3 bg-bg-secondary rounded-lg">
 <p className="text-xs text-text-muted">{t('discovery.byType') || 'By Type'}</p>
 <div className="flex flex-wrap gap-2 mt-1">
 {Object.entries(stats.byType ?? {}).map(([type, count]) => (
 <span key={type} className="inline-flex items-center gap-1 text-xs text-text-muted">
 <TypeIcon type={type} />
 {count}
 </span>
 ))}
 {Object.keys(stats.byType ?? {}).length === 0 && <span className="text-xs text-text-muted">--</span>}
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
 : 'bg-bg-secondary text-text-muted border-transparent hover:text-text-primary',
 )}
 >
 {f === 'all' ? (t('common.all') || 'All') : f === 'managed' ? (t('discovery.managed') || 'Managed') : (t('discovery.unmanaged') || 'Unmanaged')}
 </button>
 ))}

 {/* Type dropdown */}
 <select
 value={typeFilter}
 onChange={e => setTypeFilter(e.target.value)}
 className="px-3 py-1.5 text-xs bg-bg-secondary rounded-lg text-text-primary focus:outline-none focus:border-accent"
 >
 {TYPE_OPTIONS.map(o => (
 <option key={o} value={o}>{o === 'all' ? (t('common.all') || 'All Types') : o.charAt(0).toUpperCase() + o.slice(1)}</option>
 ))}
 </select>

 {/* OS family dropdown — four buckets mirroring the deploy-script
 target split: Windows, Linux/macOS (all SSH targets), Other,
 Unknown (os_guess is NULL). */}
 <select
 value={osFilter}
 onChange={e => setOsFilter(e.target.value as typeof osFilter)}
 className="px-3 py-1.5 text-xs bg-bg-secondary rounded-lg text-text-primary focus:outline-none focus:border-accent"
 >
 <option value="all">{t('discovery.osFilter.all') || 'All OS'}</option>
 <option value="windows">Windows</option>
 <option value="unix">{t('discovery.osFilter.unix') || 'Linux / macOS'}</option>
 <option value="other">{t('discovery.osFilter.other') || 'Other'}</option>
 <option value="unknown">{t('discovery.osFilter.unknown') || 'Unknown'}</option>
 </select>

 {/* Subnet filter */}
 <input
 type="text"
 value={subnetFilter}
 onChange={e => setSubnetFilter(e.target.value)}
 placeholder={t('discovery.subnetPlaceholder') || 'Subnet (e.g. 192.168.1)'}
 className="px-3 py-1.5 text-xs bg-bg-secondary rounded-lg text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent w-44"
 />

 {/* Search */}
 <div className="relative flex-1 min-w-[180px] max-w-xs">
 <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
 <input
 type="text"
 value={search}
 onChange={e => setSearch(e.target.value)}
 placeholder={t('discovery.searchPlaceholder') || 'Search IP or hostname...'}
 className="w-full pl-8 pr-7 py-1.5 text-xs bg-bg-secondary rounded-lg text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
 />
 {search && (
 <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary">
 <X className="w-3.5 h-3.5" />
 </button>
 )}
 </div>

 {/* "New since last visit" badge + mark-seen shortcut */}
 {newCount > 0 && (
 <button
 onClick={markAllAsSeen}
 className="ml-auto flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium bg-accent/10 border border-accent/30 text-accent rounded-lg hover:bg-accent/15 transition-colors"
 title={t('discovery.markAllSeen') || 'Mark as seen'}
 >
 <Sparkles className="w-3.5 h-3.5" />
 {t('discovery.newSinceLastVisit', { count: newCount }) ||
 `${newCount} new since last visit`}
 </button>
 )}

 {/* Deploy script */}
 {selectedHosts.length > 0 && (
 <button
 onClick={() => setShowDeployModal(true)}
 className={clsx(
 'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-bg-secondary border border-transparent text-text-primary rounded-lg hover:border-accent hover:text-accent transition-colors',
 newCount === 0 && 'ml-auto',
 )}
 >
 <FileCode className="w-3.5 h-3.5" />
 {t('discovery.deployScript.button', { count: selectedHosts.length }) ||
 `Generate deploy script (${selectedHosts.length})`}
 </button>
 )}

 {/* Export */}
 <button
 onClick={() => setShowExportModal(true)}
 disabled={filteredItems.length === 0}
 className={clsx(
 'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-bg-secondary border border-transparent text-text-primary rounded-lg hover:border-accent hover:text-accent disabled:opacity-50 transition-colors',
 newCount === 0 && selectedHosts.length === 0 && 'ml-auto',
 )}
 >
 <Download className="w-3.5 h-3.5" />
 {t('discovery.export.button') || 'Export'}
 </button>

 {/* Scan Now */}
 <button
 onClick={handleScanNow}
 disabled={scanning}
 className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-accent text-white rounded-lg hover:bg-accent/80 disabled:opacity-50 transition-colors"
 >
 <Wifi className={clsx('w-3.5 h-3.5', scanning && 'animate-pulse')} />
 {t('discovery.scanNow') || 'Scan Now'}
 </button>
 </div>

 {/* Selection toolbar — appears when unmanaged rows are selectable */}
 {unmanagedVisible.length > 0 && (
 <div className="flex items-center gap-3 px-3 py-1.5 bg-bg-secondary rounded-lg text-xs text-text-muted">
 <button
 onClick={selectedIds.size > 0 ? clearSelection : selectAllUnmanaged}
 className="text-accent hover:underline"
 >
 {selectedIds.size > 0
 ? (t('discovery.clearSelection') || 'Clear selection')
 : (t('discovery.selectAllUnmanaged', { count: unmanagedVisible.length }) ||
 `Select all unmanaged (${unmanagedVisible.length})`)}
 </button>
 {selectedHosts.length > 0 && (
 <span>
 {t('discovery.selectedCount', { count: selectedHosts.length }) ||
 `${selectedHosts.length} selected`}
 </span>
 )}
 </div>
 )}

 {/* Scan Picker Modal */}
 {showScanPicker && (
 <ScanTargetPickerModal
 onClose={() => setShowScanPicker(false)}
 onDispatch={dispatchScan}
 />
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
 <div className="overflow-x-auto rounded-lg">
 <table className="w-full text-sm">
 <thead>
 <tr className="bg-bg-secondary text-left">
 <th className="px-2 py-2.5 w-8">
 <div title={t('discovery.selectAllUnmanaged', { count: unmanagedVisible.length }) || 'Select all unmanaged'}>
 <StyledCheckbox
 checked={
 unmanagedVisible.length > 0 &&
 unmanagedVisible.every((d) => selectedIds.has(d.id))
 }
 onChange={(v) => (v ? selectAllUnmanaged() : clearSelection())}
 disabled={unmanagedVisible.length === 0}
 />
 </div>
 </th>
 <th className="px-4 py-2.5 text-xs font-medium text-text-muted">IP</th>
 <th className="px-4 py-2.5 text-xs font-medium text-text-muted">{t('discovery.hostname') || 'Hostname'}</th>
 <th className="px-4 py-2.5 text-xs font-medium text-text-muted hidden lg:table-cell">MAC</th>
 <th className="px-4 py-2.5 text-xs font-medium text-text-muted hidden lg:table-cell">{t('discovery.vendor') || 'Vendor'}</th>
 <th className="px-4 py-2.5 text-xs font-medium text-text-muted">{t('discovery.os') || 'OS'}</th>
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
 <tr key={d.id} className="/50 hover:bg-bg-secondary/50 transition-colors">
 <td className="px-2 py-2.5">
 <div title={d.isManaged ? (t('discovery.alreadyManaged') || 'Already managed') : undefined}>
 <StyledCheckbox
 checked={selectedIds.has(d.id)}
 onChange={() => toggleSelect(d.id)}
 disabled={d.isManaged}
 />
 </div>
 </td>
 <td className="px-4 py-2.5 text-text-primary font-mono text-xs">
 <span className="inline-flex items-center gap-1.5">
 {d.firstSeen > seenAt && (
 <span
 className="w-1.5 h-1.5 rounded-full bg-accent flex-shrink-0"
 title={t('discovery.newSince') || 'New since your last visit'}
 />
 )}
 {d.ip}
 </span>
 </td>
 <td className="px-4 py-2.5 text-text-primary text-xs truncate max-w-[200px]">{d.hostname || '--'}</td>
 <td className="px-4 py-2.5 text-text-muted text-xs font-mono hidden lg:table-cell">{d.mac || '--'}</td>
 <td className="px-4 py-2.5 text-text-muted text-xs hidden lg:table-cell truncate max-w-[150px]">{d.ouiVendor || '--'}</td>
 <td className="px-4 py-2.5">
 <OsBadge os={d.osGuess} />
 </td>
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

 {/* Deploy script modal */}
 {showDeployModal && selectedHosts.length > 0 && (
 <GenerateDeployScriptModal
 hosts={selectedHosts}
 onClose={() => setShowDeployModal(false)}
 />
 )}

 {/* Export modal */}
 {showExportModal && (
 <ExportDiscoveryModal
 rows={filteredItems}
 onClose={() => setShowExportModal(false)}
 />
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
