import { useState, useEffect, useMemo } from 'react';
import { X, Search, Monitor, Folder, FolderOpen, Check, Wifi, CornerLeftUp } from 'lucide-react';
import { deviceApi } from '@/api/device.api';
import type { Device } from '@obliance/shared';
import toast from 'react-hot-toast';
import { clsx } from 'clsx';
import { useTranslation } from 'react-i18next';

interface Props {
 onClose: () => void;
 onDispatch: (deviceIds: number[]) => Promise<void> | void;
}

type GroupKey = string; // "group:<id>" or "group:none"

interface GroupBucket {
 key: GroupKey;
 groupId: number | null;
 groupName: string;
 devices: Device[];
}

/** Server caps pageSize at 10000 (device.service.ts). The default is 100,
 *  which silently truncated the picker to the first 100 online agents — so a
 *  611-device tenant showed a single machine in most groups. Ask for the cap
 *  explicitly: the picker needs the whole fleet to let an admin pick one
 *  agent per site (each agent only scans its own L2 segment). */
const PAGE_SIZE = 10000;

export function ScanTargetPickerModal({ onClose, onDispatch }: Props) {
 const { t } = useTranslation();

 const [loading, setLoading] = useState(true);
 const [devices, setDevices] = useState<Device[]>([]);
 const [query, setQuery] = useState('');
 const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
 const [dispatching, setDispatching] = useState(false);
 /** null = browsing the group list; otherwise the group being opened. */
 const [openKey, setOpenKey] = useState<GroupKey | null>(null);

 useEffect(() => {
 deviceApi.listPaginated({ status: 'online', page: 1, pageSize: PAGE_SIZE })
 .then((res) => setDevices(res.items))
 .catch(() => toast.error(t('common.error')))
 .finally(() => setLoading(false));
 }, [t]);

 // Bucket every online device by group — built from the FULL fleet, not a page.
 const buckets: GroupBucket[] = useMemo(() => {
 const map = new Map<GroupKey, GroupBucket>();
 for (const d of devices) {
 const key: GroupKey = d.groupId ? `group:${d.groupId}` : 'group:none';
 if (!map.has(key)) {
 map.set(key, {
 key,
 groupId: d.groupId,
 groupName: d.groupName || (t('discovery.picker.ungrouped') || 'Ungrouped'),
 devices: [],
 });
 }
 map.get(key)!.devices.push(d);
 }
 for (const b of map.values()) {
 b.devices.sort((a, c) => (a.hostname || '').localeCompare(c.hostname || ''));
 }
 return Array.from(map.values()).sort((a, b) => {
 if (a.groupId === null) return 1; // Ungrouped last
 if (b.groupId === null) return -1;
 return a.groupName.localeCompare(b.groupName);
 });
 }, [devices, t]);

 // A search flattens across every group — otherwise finding one machine in a
 // 100-group fleet would mean opening 100 folders.
 const searchResults = useMemo(() => {
 const q = query.trim().toLowerCase();
 if (!q) return [];
 return devices.filter((d) => {
 const haystack = [d.hostname, d.displayName, d.groupName, d.ipLocal, d.ipPublic]
 .filter(Boolean).join(' ').toLowerCase();
 return haystack.includes(q);
 }).sort((a, b) => (a.hostname || '').localeCompare(b.hostname || ''));
 }, [devices, query]);

 const searching = query.trim().length > 0;
 const openBucket = openKey ? buckets.find((b) => b.key === openKey) ?? null : null;

 const toggle = (id: number) => {
 setSelectedIds((prev) => {
 const next = new Set(prev);
 if (next.has(id)) next.delete(id); else next.add(id);
 return next;
 });
 };

 const toggleGroup = (bucket: GroupBucket) => {
 const ids = bucket.devices.map((d) => d.id);
 const allSelected = ids.every((id) => selectedIds.has(id));
 setSelectedIds((prev) => {
 const next = new Set(prev);
 if (allSelected) ids.forEach((id) => next.delete(id));
 else ids.forEach((id) => next.add(id));
 return next;
 });
 };

 const clearAll = () => setSelectedIds(new Set());

 const handleDispatch = async () => {
 if (selectedIds.size === 0) return;
 setDispatching(true);
 try {
 await onDispatch(Array.from(selectedIds));
 onClose();
 } finally {
 setDispatching(false);
 }
 };

 // ── Row renderers ────────────────────────────────────────────────────────

 const renderDeviceRow = (d: Device, showGroup = false) => {
 const checked = selectedIds.has(d.id);
 return (
 <button
 key={d.id}
 onClick={() => toggle(d.id)}
 className={clsx(
 'w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left rounded transition-colors',
 checked ? 'bg-accent/15 text-text-primary' : 'text-text-muted hover:bg-bg-secondary hover:text-text-primary',
 )}
 >
 <span
 className={clsx(
 'w-3.5 h-3.5 rounded-sm border flex-shrink-0 flex items-center justify-center',
 checked ? 'bg-accent border-accent' : 'border-text-muted/40',
 )}
 >
 {checked && <Check className="w-2.5 h-2.5 text-white" />}
 </span>
 <Monitor className="w-3.5 h-3.5 flex-shrink-0" />
 <span className="flex-1 truncate">{d.displayName || d.hostname || `#${d.id}`}</span>
 {showGroup && (
 <span className="text-[10px] text-text-muted/70 flex-shrink-0 truncate max-w-[8rem]">
 {d.groupName || (t('discovery.picker.ungrouped') || 'Ungrouped')}
 </span>
 )}
 {d.ipLocal && (
 <span className="text-[10px] text-text-muted/70 font-mono flex-shrink-0">{d.ipLocal}</span>
 )}
 </button>
 );
 };

 const renderGroupRow = (b: GroupBucket) => {
 const ids = b.devices.map((d) => d.id);
 const selectedInGroup = ids.filter((id) => selectedIds.has(id)).length;
 const allInGroup = selectedInGroup === ids.length && ids.length > 0;
 return (
 <div
 key={b.key}
 className="w-full flex items-center gap-2 px-2 py-2 rounded hover:bg-bg-secondary transition-colors group"
 >
 {/* Whole-group checkbox — select a site without opening it */}
 <button
 onClick={(e) => { e.stopPropagation(); toggleGroup(b); }}
 className={clsx(
 'w-3.5 h-3.5 rounded-sm border flex-shrink-0 flex items-center justify-center',
 allInGroup ? 'bg-accent border-accent'
 : selectedInGroup > 0 ? 'bg-accent/30 border-accent'
 : 'border-text-muted/40',
 )}
 title={t('discovery.picker.toggleGroup') || 'Select the whole group'}
 >
 {allInGroup && <Check className="w-2.5 h-2.5 text-white" />}
 </button>
 {/* Open the folder */}
 <button onClick={() => setOpenKey(b.key)} className="flex-1 flex items-center gap-2 min-w-0 text-left">
 <Folder className="w-4 h-4 text-accent flex-shrink-0" />
 <span className="flex-1 truncate text-xs font-medium text-text-primary">{b.groupName}</span>
 {selectedInGroup > 0 && (
 <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent/15 text-accent flex-shrink-0">
 {selectedInGroup}
 </span>
 )}
 <span className="text-[10px] text-text-muted flex-shrink-0">
 {t('discovery.picker.agentsCount', { count: b.devices.length }) || `${b.devices.length} agents`}
 </span>
 </button>
 </div>
 );
 };

 return (
 <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
 <div
 className="bg-bg-primary rounded-xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-xl"
 onClick={(e) => e.stopPropagation()}
 >
 {/* Header */}
 <div className="flex items-center justify-between px-5 py-3 flex-shrink-0">
 <div>
 <h3 className="text-sm font-semibold text-text-primary">
 {t('discovery.picker.title') || 'Select agents to run the scan'}
 </h3>
 <p className="text-xs text-text-muted mt-0.5">
 {t('discovery.picker.subtitle') ||
 'Each selected agent scans its own local subnet. Pick one agent per site.'}
 </p>
 </div>
 <button onClick={onClose} className="p-1 text-text-muted hover:text-text-primary rounded">
 <X className="w-4 h-4" />
 </button>
 </div>

 {/* Search */}
 <div className="flex items-center gap-2 px-5 py-3 flex-shrink-0">
 <div className="relative flex-1">
 <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
 <input
 autoFocus
 type="text"
 value={query}
 onChange={(e) => setQuery(e.target.value)}
 placeholder={t('discovery.picker.searchPlaceholder') || 'Type to filter by agent or group...'}
 className="w-full pl-8 pr-3 py-1.5 text-xs bg-bg-secondary rounded-lg text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
 />
 </div>
 {selectedIds.size > 0 && (
 <button
 onClick={clearAll}
 className="px-2.5 py-1.5 text-xs font-medium bg-bg-secondary rounded-lg text-text-muted hover:text-accent hover:border-accent transition-colors"
 >
 {t('discovery.picker.clearAll') || 'Clear'}
 </button>
 )}
 </div>

 {/* Body */}
 <div className="flex-1 overflow-y-auto px-3 py-2">
 {loading ? (
 <p className="text-xs text-text-muted py-6 text-center">{t('common.loading') || 'Loading...'}</p>
 ) : devices.length === 0 ? (
 <p className="text-xs text-text-muted py-6 text-center">
 {t('discovery.noOnlineAgents') || 'No online agents available'}
 </p>
 ) : searching ? (
 /* ── Search: flat results across every group ── */
 searchResults.length === 0 ? (
 <p className="text-xs text-text-muted py-6 text-center">
 {t('discovery.picker.noMatch') || 'No agent matches the filter'}
 </p>
 ) : (
 <div className="space-y-0.5">
 <p className="px-2 py-1.5 text-[10px] uppercase tracking-wider text-text-muted">
 {t('discovery.picker.searchResults', { count: searchResults.length }) ||
 `${searchResults.length} result(s)`}
 </p>
 {searchResults.map((d) => renderDeviceRow(d, true))}
 </div>
 )
 ) : openBucket ? (
 /* ── Inside a group ── */
 <div className="space-y-0.5">
 <button
 onClick={() => setOpenKey(null)}
 className="w-full flex items-center gap-2 px-2 py-2 rounded hover:bg-bg-secondary transition-colors text-left"
 title={t('discovery.picker.back') || 'Back to all groups'}
 >
 <CornerLeftUp className="w-4 h-4 text-text-muted flex-shrink-0" />
 <span className="text-xs font-medium text-text-muted">...</span>
 <FolderOpen className="w-4 h-4 text-accent flex-shrink-0 ml-1" />
 <span className="text-xs font-semibold text-text-primary truncate">{openBucket.groupName}</span>
 <span className="flex-1" />
 <span
 onClick={(e) => { e.stopPropagation(); toggleGroup(openBucket); }}
 className="text-[10px] text-accent hover:underline flex-shrink-0"
 >
 {openBucket.devices.every((d) => selectedIds.has(d.id))
 ? (t('discovery.picker.unselectGroup') || 'Unselect all')
 : (t('discovery.picker.selectGroup') || 'Select all')}
 </span>
 </button>
 {openBucket.devices.map((d) => renderDeviceRow(d))}
 </div>
 ) : (
 /* ── Group list (root) ── */
 <div className="space-y-0.5">
 <p className="px-2 py-1.5 text-[10px] uppercase tracking-wider text-text-muted">
 {t('discovery.picker.groupsHint', { groups: buckets.length, agents: devices.length }) ||
 `${buckets.length} group(s) · ${devices.length} online agents`}
 </p>
 {buckets.map(renderGroupRow)}
 </div>
 )}
 </div>

 {/* Footer */}
 <div className="flex items-center justify-between px-5 py-3 flex-shrink-0">
 <span className="text-xs text-text-muted">
 {selectedIds.size > 0
 ? (t('discovery.picker.selectedCount', { count: selectedIds.size }) ||
 `${selectedIds.size} selected`)
 : (t('discovery.picker.selectHint') || 'Select one or more agents.')}
 </span>
 <div className="flex items-center gap-2">
 <button
 onClick={onClose}
 className="px-3 py-1.5 text-xs text-text-muted hover:text-text-primary transition-colors"
 >
 {t('common.cancel') || 'Cancel'}
 </button>
 <button
 onClick={handleDispatch}
 disabled={selectedIds.size === 0 || dispatching}
 className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-accent text-white rounded-lg hover:bg-accent/80 disabled:opacity-50 transition-colors"
 >
 <Wifi className={clsx('w-3.5 h-3.5', dispatching && 'animate-pulse')} />
 {t('discovery.picker.launch', { count: selectedIds.size }) ||
 `Launch scan on ${selectedIds.size} agent(s)`}
 </button>
 </div>
 </div>
 </div>
 </div>
 );
}
