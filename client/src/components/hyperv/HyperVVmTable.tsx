import { Fragment, useMemo, useState } from 'react';
import { clsx } from 'clsx';
import { useTranslation } from 'react-i18next';
import {
  Play, Square, Power, RotateCcw, Save, Pause, PlayCircle,
  Camera, Trash2, MoreHorizontal, Server, Cpu, ChevronDown, ChevronRight,
  ArrowUp, ArrowDown, Monitor, MonitorPlay, Search, X, Download, Tag, RefreshCw,
  Columns, Check,
} from 'lucide-react';
import toast from 'react-hot-toast';
import type { VirtualMachine, VmAction, VmState, DeviceStatus } from '@obliance/shared';
import { vmMatchesSearch } from '@obliance/shared';
import { hypervApi } from '@/api/hyperv.api';
import { DeviceStatusBadge } from '@/components/devices/DeviceStatusBadge';
import { HyperVConsolePreview, HyperVConsoleModal } from './HyperVConsole';

interface Props {
  vms: VirtualMachine[];
  busyVmId?: string | null;
  /** Group rows by host (tenant-wide grid) — host acts like a /devices group. */
  showHost?: boolean;
  /** Show a search box that filters VMs by partial name (and host name),
   *  case-insensitive. The host group header stays visible for any host
   *  that still has a matching VM. */
  searchable?: boolean;
  /** Host device id for a single-host view — scopes the export to that host.
   *  Omit for the tenant-wide grid (export covers every visible host). */
  hostDeviceId?: number;
  /** Real-time host status by host device id (from the device store) — renders
   *  an online/offline badge in each host's drawer header (tenant-wide grid). */
  hostStatusById?: Map<number, DeviceStatus>;
  /** When set, shows a Refresh button that re-enumerates the host(s). */
  onRefresh?: () => void;
  refreshing?: boolean;
  onAction: (vm: VirtualMachine, action: VmAction) => void;
  onEdit?: (vm: VirtualMachine) => void;
  onCheckpoints?: (vm: VirtualMachine) => void;
  /** Open the live interactive console (Layer B, FreeRDP H.264 stream). */
  onInteractiveConsole?: (vm: VirtualMachine) => void;
}

type SortKey = 'name' | 'state' | 'cpu' | 'mem' | 'uptime';

/** Columns the user can toggle. `name`, `state` and the action buttons are
 *  structural and always rendered, so they aren't listed here. */
type ColKey = 'cpu' | 'mem' | 'guestOs' | 'uptime' | 'mac' | 'ip';

const OPTIONAL_COLUMNS: ReadonlyArray<{ key: ColKey; labelKey: string; fallback: string }> = [
  { key: 'cpu',     labelKey: 'hyperv.col.cpu',     fallback: 'CPU %' },
  { key: 'mem',     labelKey: 'hyperv.col.memory',  fallback: 'Memory' },
  { key: 'guestOs', labelKey: 'hyperv.col.guestOs', fallback: 'Guest OS' },
  { key: 'uptime',  labelKey: 'hyperv.col.uptime',  fallback: 'Uptime' },
  { key: 'mac',     labelKey: 'hyperv.col.mac',     fallback: 'MAC' },
  { key: 'ip',      labelKey: 'hyperv.col.ip',      fallback: 'IP' },
];

const DEFAULT_COLS: ColKey[] = ['cpu', 'mem', 'guestOs', 'uptime', 'mac', 'ip'];
const COLS_STORAGE_KEY = 'obliance.hyperv.vmColumns';

function loadCols(): Set<ColKey> {
  try {
    const raw = localStorage.getItem(COLS_STORAGE_KEY);
    if (!raw) return new Set(DEFAULT_COLS);
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set(DEFAULT_COLS);
    const valid = parsed.filter((k): k is ColKey => OPTIONAL_COLUMNS.some((c) => c.key === k));
    return new Set(valid);
  } catch {
    return new Set(DEFAULT_COLS);
  }
}

const STATE_BADGE: Record<VmState, string> = {
  running: 'bg-green-400/10 text-green-400 border-green-400/30',
  off: 'bg-gray-400/10 text-gray-400 border-gray-400/30',
  saved: 'bg-blue-400/10 text-blue-400 border-blue-400/30',
  paused: 'bg-yellow-400/10 text-yellow-400 border-yellow-400/30',
  transitioning: 'bg-orange-400/10 text-orange-400 border-orange-400/30',
  unknown: 'bg-gray-400/10 text-gray-400 border-gray-400/30',
};
const STATE_ORDER: Record<VmState, number> = { running: 0, paused: 1, saved: 2, transitioning: 3, off: 4, unknown: 5 };

function fmtMem(bytes: number | null): string {
  if (!bytes || bytes <= 0) return '—';
  const gb = bytes / (1024 ** 3);
  return gb >= 1 ? `${gb.toFixed(gb < 10 ? 1 : 0)} GB` : `${Math.round(bytes / (1024 ** 2))} MB`;
}
function fmtUptime(sec: number | null): string {
  if (!sec || sec <= 0) return '—';
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/** Renders the 0..n addresses of a VM (a VM has one MAC per virtual NIC, and
 *  may report several IPs — IPv4 + IPv6 + one per NIC). Stacked rather than
 *  comma-joined so multi-NIC VMs stay readable; capped with a "+n" so a VM with
 *  a dozen IPv6 addresses can't blow up the row height. */
function AddrList({ values }: { values: string[] | undefined }) {
  const list = values ?? [];
  if (list.length === 0) return <span className="text-sm text-text-muted">—</span>;
  const shown = list.slice(0, 2);
  const rest = list.length - shown.length;
  return (
    <span className="flex flex-col gap-0.5" title={list.join('\n')}>
      {shown.map((v) => (
        <span key={v} className="text-[11px] font-mono text-text-muted leading-tight">{v}</span>
      ))}
      {rest > 0 && <span className="text-[10px] text-text-muted/60 leading-tight">+{rest}</span>}
    </span>
  );
}

export function HyperVVmTable({ vms, busyVmId, showHost, searchable, hostDeviceId, hostStatusById, onRefresh, refreshing, onAction, onEdit, onCheckpoints, onInteractiveConsole }: Props) {
  const { t } = useTranslation();
  const [menuVmId, setMenuVmId] = useState<string | null>(null);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = async (format: 'csv' | 'xlsx' | 'pdf') => {
    setExportMenuOpen(false);
    setIsExporting(true);
    try {
      // Export exactly what the grid currently shows — honour the active host
      // tag filter and the search box (same criteria as filteredVms).
      const { blob, filename } = await hypervApi.export(format, {
        deviceId: hostDeviceId,
        tags: tagFilters.size ? [...tagFilters] : undefined,
        search: search.trim() || undefined,
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
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [expandedVmId, setExpandedVmId] = useState<string | null>(null);
  const [consoleVm, setConsoleVm] = useState<VirtualMachine | null>(null);
  const [search, setSearch] = useState('');
  const [tagFilters, setTagFilters] = useState<Set<string>>(new Set());
  const [cols, setCols] = useState<Set<ColKey>>(loadCols);
  const [colMenuOpen, setColMenuOpen] = useState(false);

  const showCol = (k: ColKey) => cols.has(k);
  const toggleCol = (k: ColKey) => setCols((prev) => {
    const next = new Set(prev);
    next.has(k) ? next.delete(k) : next.add(k);
    try { localStorage.setItem(COLS_STORAGE_KEY, JSON.stringify([...next])); } catch { /* private mode */ }
    return next;
  });

  const toggleTag = (tag: string) => setTagFilters((prev) => {
    const next = new Set(prev);
    next.has(tag) ? next.delete(tag) : next.add(tag);
    return next;
  });

  // Tags present on the displayed hosts (tenant-wide grid only), with the
  // number of distinct hosts carrying each — drives the host tag filter.
  const availableTags = useMemo(() => {
    if (!showHost) return [] as Array<{ tag: string; count: number }>;
    const hostsByTag = new Map<string, Set<number>>();
    for (const vm of vms) {
      for (const tg of vm.hostTags ?? []) {
        if (!hostsByTag.has(tg)) hostsByTag.set(tg, new Set());
        hostsByTag.get(tg)!.add(vm.hostDeviceId);
      }
    }
    return [...hostsByTag.entries()]
      .map(([tag, hosts]) => ({ tag, count: hosts.size }))
      .sort((a, b) => a.tag.localeCompare(b.tag));
  }, [vms, showHost]);

  // Partial, case-insensitive match on the VM name (primary) and host name.
  // e.g. "ows" matches "OVPMK1OWS13". Filtering happens BEFORE grouping so a
  // host stays visible as its group header as long as one of its VMs matches.
  // Host tag filter (OR semantics, matching the /devices chip filter) runs
  // first: keep only VMs whose host carries at least one selected tag.
  const filteredVms = useMemo(() => {
    let list = vms;
    if (tagFilters.size > 0) {
      list = list.filter((vm) => (vm.hostTags ?? []).some((tg) => tagFilters.has(tg)));
    }
    if (searchable) {
      // Shared matcher (name / host / IP / MAC, MAC separator-insensitive) —
      // the server export route runs the exact same function, so a CSV can't
      // drift from what's on screen.
      const q = search.trim();
      if (q) list = list.filter((vm) => vmMatchesSearch(vm, q));
    }
    return list;
  }, [vms, search, searchable, tagFilters]);

  const stateLabel = (s: VmState) => t(`hyperv.state.${s}`) || s;

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(k); setSortDir('asc'); }
  };

  const cmp = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    return (a: VirtualMachine, b: VirtualMachine) => {
      let r = 0;
      switch (sortKey) {
        case 'name': r = a.name.localeCompare(b.name, undefined, { numeric: true }); break;
        case 'state': r = STATE_ORDER[a.state] - STATE_ORDER[b.state]; break;
        case 'cpu': r = (a.cpuUsagePercent ?? -1) - (b.cpuUsagePercent ?? -1); break;
        case 'mem': r = (a.memoryBytes ?? -1) - (b.memoryBytes ?? -1); break;
        case 'uptime': r = (a.uptimeSeconds ?? -1) - (b.uptimeSeconds ?? -1); break;
      }
      return r * dir;
    };
  }, [sortKey, sortDir]);

  // Group by host name when showHost; otherwise one flat group. Uses the
  // search-filtered set so hosts with no matching VM drop out entirely.
  const groups = useMemo(() => {
    if (!showHost) return [{ host: '', vms: [...filteredVms].sort(cmp) }];
    const m = new Map<string, VirtualMachine[]>();
    for (const vm of filteredVms) {
      const h = vm.hostName ?? `#${vm.hostDeviceId}`;
      (m.get(h) ?? m.set(h, []).get(h)!).push(vm);
    }
    return [...m.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([host, list]) => ({ host, vms: list.sort(cmp) }));
  }, [filteredVms, cmp, showHost]);

  const SortHead = ({ k, label, cls }: { k: SortKey; label: string; cls?: string }) => (
    <th className={clsx('px-4 py-3 text-left text-xs font-medium text-text-muted uppercase cursor-pointer select-none hover:text-text-primary', cls)} onClick={() => toggleSort(k)}>
      <span className="inline-flex items-center gap-1">
        {label}
        {sortKey === k && (sortDir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
      </span>
    </th>
  );

  // name + state + actions are structural; the rest is user-toggled. Drives the
  // colSpan of the host group header and the console-preview row.
  const colCount = 3 + OPTIONAL_COLUMNS.filter((c) => cols.has(c.key)).length;

  return (
    <div className="space-y-3">
      {availableTags.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="flex items-center gap-1 text-xs text-text-muted">
            <Tag className="w-3.5 h-3.5" /> {t('hyperv.filterByTag') || 'Hosts by tag:'}
          </span>
          {availableTags.map(({ tag, count }) => {
            const active = tagFilters.has(tag);
            return (
              <button
                key={tag}
                type="button"
                onClick={() => toggleTag(tag)}
                className={clsx(
                  'px-2.5 py-1 text-xs rounded-full border transition-colors',
                  active
                    ? 'bg-accent/15 text-accent border-accent/40'
                    : 'bg-bg-secondary text-text-muted border-transparent hover:text-text-primary hover:bg-bg-tertiary',
                )}
              >
                {tag} <span className="opacity-60">{count}</span>
              </button>
            );
          })}
          {tagFilters.size > 0 && (
            <button type="button" onClick={() => setTagFilters(new Set())} className="flex items-center gap-1 text-xs text-text-muted hover:text-text-primary">
              <X className="w-3.5 h-3.5" /> {t('common.clear') || 'Clear'}
            </button>
          )}
        </div>
      )}

      {vms.length > 0 && (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          {searchable ? (
            <div className="relative max-w-sm flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('hyperv.searchPlaceholder') || 'Search VM, host, IP or MAC…'}
                className="w-full pl-9 pr-8 py-2 text-sm bg-bg-secondary rounded-lg text-text-primary focus:outline-none focus:border-accent"
              />
              {search && (
                <button type="button" onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-text-muted hover:text-text-primary">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ) : <span />}

          <div className="flex items-center gap-2">
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              disabled={refreshing}
              className="flex items-center gap-1.5 px-3 py-2 text-sm bg-bg-secondary rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-tertiary transition-colors disabled:opacity-50"
            >
              <RefreshCw className={clsx('w-4 h-4', refreshing && 'animate-spin')} />
              {t('hyperv.refresh') || 'Refresh'}
            </button>
          )}
          <div className="relative">
            <button
              type="button"
              onClick={() => setColMenuOpen((o) => !o)}
              className="flex items-center gap-1.5 px-3 py-2 text-sm bg-bg-secondary rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-tertiary transition-colors"
            >
              <Columns className="w-4 h-4" />
              {t('hyperv.columns') || 'Columns'}
              <ChevronDown className="w-3.5 h-3.5 opacity-60" />
            </button>
            {colMenuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setColMenuOpen(false)} />
                <div className="absolute right-0 top-full mt-1 z-50 w-52 bg-bg-secondary rounded-lg shadow-2xl overflow-hidden py-1">
                  {OPTIONAL_COLUMNS.map((c) => {
                    const on = cols.has(c.key);
                    return (
                      <button
                        key={c.key}
                        type="button"
                        onClick={() => toggleCol(c.key)}
                        className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left text-text-primary hover:bg-bg-tertiary transition-colors"
                      >
                        <span className={clsx(
                          'w-3.5 h-3.5 rounded-sm border flex items-center justify-center flex-shrink-0',
                          on ? 'bg-accent border-accent' : 'border-text-muted/40',
                        )}>
                          {on && <Check className="w-2.5 h-2.5 text-white" />}
                        </span>
                        {t(c.labelKey) || c.fallback}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
          <div className="relative">
            <button
              type="button"
              onClick={() => setExportMenuOpen((o) => !o)}
              disabled={isExporting}
              className="flex items-center gap-1.5 px-3 py-2 text-sm bg-bg-secondary rounded-lg text-text-primary hover:bg-bg-tertiary transition-colors disabled:opacity-50"
            >
              <Download className="w-4 h-4" />
              {t('hyperv.export') || 'Export'}
              <ChevronDown className="w-3.5 h-3.5 opacity-60" />
            </button>
            {exportMenuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setExportMenuOpen(false)} />
                <div className="absolute right-0 top-full mt-1 z-50 w-44 bg-bg-secondary rounded-lg shadow-2xl overflow-hidden py-1">
                  <button type="button" onClick={() => handleExport('csv')} className="w-full text-left px-3 py-2 text-sm text-text-primary hover:bg-bg-tertiary">CSV</button>
                  <button type="button" onClick={() => handleExport('xlsx')} className="w-full text-left px-3 py-2 text-sm text-text-primary hover:bg-bg-tertiary">Excel (XLSX)</button>
                  <button type="button" onClick={() => handleExport('pdf')} className="w-full text-left px-3 py-2 text-sm text-text-primary hover:bg-bg-tertiary">PDF</button>
                </div>
              </>
            )}
          </div>
          </div>
        </div>
      )}

      {vms.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-12 text-text-muted">
          <Server className="w-8 h-8 opacity-50" />
          <p className="text-sm">{t('hyperv.noVms') || 'No virtual machines on this host.'}</p>
        </div>
      ) : groups.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-12 text-text-muted">
          <Search className="w-8 h-8 opacity-50" />
          <p className="text-sm">{t('hyperv.noMatch') || 'No VM matches your search.'}</p>
        </div>
      ) : (
      <div className="bg-bg-secondary rounded-xl overflow-visible">
      <table className="w-full">
        <thead>
          <tr>
            <SortHead k="name" label={t('hyperv.col.name') || 'Name'} />
            <SortHead k="state" label={t('hyperv.col.state') || 'State'} />
            {showCol('cpu') && <SortHead k="cpu" label={t('hyperv.col.cpu') || 'CPU %'} />}
            {showCol('mem') && <SortHead k="mem" label={t('hyperv.col.memory') || 'Memory'} />}
            {showCol('guestOs') && <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase">{t('hyperv.col.guestOs') || 'Guest OS'}</th>}
            {showCol('uptime') && <SortHead k="uptime" label={t('hyperv.col.uptime') || 'Uptime'} />}
            {showCol('mac') && <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase">{t('hyperv.col.mac') || 'MAC'}</th>}
            {showCol('ip') && <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase">{t('hyperv.col.ip') || 'IP'}</th>}
            <th className="px-4 py-3 text-right text-xs font-medium text-text-muted uppercase">{t('hyperv.col.actions') || 'Actions'}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {groups.map((g) => {
            const isCollapsed = collapsed.has(g.host);
            const running = g.vms.filter((v) => v.state === 'running').length;
            const hostId = g.vms[0]?.hostDeviceId;
            const hostStatus = hostId != null ? hostStatusById?.get(hostId) : undefined;
            return (
              <Fragment key={g.host || '__flat'}>
                {showHost && (
                  <tr key={`h:${g.host}`} className="bg-bg-tertiary/40">
                    <td colSpan={colCount} className="px-3 py-1.5">
                      <button
                        onClick={() => setCollapsed((prev) => { const n = new Set(prev); n.has(g.host) ? n.delete(g.host) : n.add(g.host); return n; })}
                        className="flex items-center gap-2 text-xs font-semibold text-text-primary"
                      >
                        {isCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        <Server className="w-3.5 h-3.5 text-text-muted" />
                        {g.host}
                        {hostStatus && <DeviceStatusBadge status={hostStatus} size="sm" />}
                        <span className="text-text-muted font-normal">· {g.vms.length} VM · {running} {t('hyperv.running') || 'running'}</span>
                      </button>
                    </td>
                  </tr>
                )}
                {!isCollapsed && g.vms.map((vm) => {
                  const busy = busyVmId === vm.vmId;
                  const running = vm.state === 'running';
                  const off = vm.state === 'off';
                  const paused = vm.state === 'paused';
                  return (
                    <Fragment key={vm.vmId}>
                    <tr className="hover:bg-bg-tertiary/40 transition-colors">
                      <td className="px-4 py-2.5 text-sm text-text-primary font-medium">
                        <span className={clsx('inline-flex items-center gap-1.5', showHost && 'pl-5')}>
                          <button
                            onClick={() => setExpandedVmId(expandedVmId === vm.vmId ? null : vm.vmId)}
                            title={t('hyperv.consolePreview') || 'Console preview'}
                            className="text-text-muted hover:text-text-primary"
                          >
                            {expandedVmId === vm.vmId ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                          </button>
                          {vm.name}
                        </span>
                        {vm.checkpointCount ? <span className="ml-2 text-[10px] text-text-muted">({vm.checkpointCount} cp)</span> : null}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={clsx('inline-block px-2 py-0.5 text-[11px] rounded-full border', STATE_BADGE[vm.state])} title={vm.statusText ?? undefined}>
                          {stateLabel(vm.state)}
                        </span>
                      </td>
                      {showCol('cpu') && <td className="px-4 py-2.5 text-sm text-text-muted">{running && vm.cpuUsagePercent != null ? `${vm.cpuUsagePercent}%` : '—'}</td>}
                      {showCol('mem') && (
                        <td className="px-4 py-2.5 text-sm text-text-muted">
                          {fmtMem(vm.memoryBytes)}
                          {vm.dynamicMemory && vm.memoryDemandBytes ? <span className="text-[10px] ml-1" title="Demand">({fmtMem(vm.memoryDemandBytes)})</span> : null}
                        </td>
                      )}
                      {showCol('guestOs') && <td className="px-4 py-2.5 text-sm text-text-muted truncate max-w-[180px]" title={vm.guestOs ?? ''}>{vm.guestOs || '—'}</td>}
                      {showCol('uptime') && <td className="px-4 py-2.5 text-sm text-text-muted">{fmtUptime(vm.uptimeSeconds)}</td>}
                      {showCol('mac') && <td className="px-4 py-2.5"><AddrList values={vm.macAddresses} /></td>}
                      {showCol('ip') && <td className="px-4 py-2.5"><AddrList values={vm.ipAddresses} /></td>}
                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-end gap-1">
                          {off || vm.state === 'saved' || paused ? (
                            <button disabled={busy} onClick={() => onAction(vm, paused ? 'resume' : 'start')} title={paused ? (t('hyperv.action.resume') || 'Resume') : (t('hyperv.action.start') || 'Start')} className="p-1.5 rounded text-green-400 hover:bg-green-400/10 disabled:opacity-40 transition-colors">
                              {paused ? <PlayCircle className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                            </button>
                          ) : (
                            <button disabled={busy} onClick={() => onAction(vm, 'shutdown')} title={t('hyperv.action.shutdown') || 'Shut down (graceful)'} className="p-1.5 rounded text-orange-400 hover:bg-orange-400/10 disabled:opacity-40 transition-colors">
                              <Power className="w-4 h-4" />
                            </button>
                          )}
                          <button disabled={busy || !running} onClick={() => onAction(vm, 'restart')} title={t('hyperv.action.restart') || 'Restart'} className="p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-bg-secondary disabled:opacity-30 transition-colors">
                            <RotateCcw className="w-4 h-4" />
                          </button>
                          <div className="relative">
                            <button disabled={busy} onClick={() => setMenuVmId(menuVmId === vm.vmId ? null : vm.vmId)} className="p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-bg-secondary disabled:opacity-40 transition-colors">
                              <MoreHorizontal className="w-4 h-4" />
                            </button>
                            {menuVmId === vm.vmId && (
                              <>
                                <div className="fixed inset-0 z-40" onClick={() => setMenuVmId(null)} />
                                <div className="absolute right-0 top-full mt-1 z-50 w-56 bg-bg-secondary rounded-lg shadow-2xl overflow-hidden py-1">
                                  {([
                                    { kind: 'liveconsole', label: t('hyperv.interactiveConsole') || 'Interactive console', icon: MonitorPlay, danger: false, show: !!onInteractiveConsole && (running || paused) },
                                    { kind: 'console', label: t('hyperv.openConsole') || 'Console preview…', icon: Monitor, danger: false, show: true },
                                    { kind: 'action', action: 'stop' as VmAction, label: t('hyperv.action.stop') || 'Power off (hard)', icon: Square, danger: false, show: !off },
                                    { kind: 'action', action: 'save' as VmAction, label: t('hyperv.action.save') || 'Save state', icon: Save, danger: false, show: running },
                                    { kind: 'action', action: 'pause' as VmAction, label: t('hyperv.action.pause') || 'Pause', icon: Pause, danger: false, show: running },
                                    { kind: 'checkpoints', label: t('hyperv.manageCheckpoints') || 'Checkpoints…', icon: Camera, danger: false, show: !!onCheckpoints },
                                    { kind: 'edit', label: t('hyperv.editSettings') || 'Edit settings…', icon: Cpu, danger: false, show: !!onEdit },
                                    { kind: 'action', action: 'delete' as VmAction, label: t('hyperv.action.delete') || 'Delete VM', icon: Trash2, danger: true, show: true },
                                  ] as const).filter((i) => i.show).map((i) => (
                                    <button
                                      key={i.kind === 'action' ? i.action : i.kind}
                                      onClick={() => {
                                        setMenuVmId(null);
                                        if (i.kind === 'edit') onEdit?.(vm);
                                        else if (i.kind === 'checkpoints') onCheckpoints?.(vm);
                                        else if (i.kind === 'console') setConsoleVm(vm);
                                        else if (i.kind === 'liveconsole') onInteractiveConsole?.(vm);
                                        else onAction(vm, i.action);
                                      }}
                                      className={clsx('w-full flex items-center gap-2 px-3 py-2 text-xs text-left hover:bg-bg-tertiary transition-colors', i.danger ? 'text-red-400' : 'text-text-primary')}
                                    >
                                      <i.icon className="w-3.5 h-3.5" /> {i.label}
                                    </button>
                                  ))}
                                </div>
                              </>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                    {expandedVmId === vm.vmId && (
                      <tr key={`preview:${vm.vmId}`}>
                        <td colSpan={colCount} className="px-4 pb-4 pt-1 bg-bg-tertiary/20">
                          <HyperVConsolePreview hostDeviceId={vm.hostDeviceId} vmId={vm.vmId} onOpenFull={() => setConsoleVm(vm)} />
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  );
                })}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      </div>
      )}

      {consoleVm && (
        <HyperVConsoleModal
          hostDeviceId={consoleVm.hostDeviceId}
          vmId={consoleVm.vmId}
          vmName={consoleVm.name}
          onClose={() => setConsoleVm(null)}
        />
      )}
    </div>
  );
}
