import { Fragment, useMemo, useState } from 'react';
import { clsx } from 'clsx';
import { useTranslation } from 'react-i18next';
import {
  Play, Square, Power, RotateCcw, Save, Pause, PlayCircle,
  Camera, Trash2, MoreHorizontal, Server, Cpu, ChevronDown, ChevronRight,
  ArrowUp, ArrowDown, Monitor, MonitorPlay, Search, X, Download,
} from 'lucide-react';
import toast from 'react-hot-toast';
import type { VirtualMachine, VmAction, VmState } from '@obliance/shared';
import { hypervApi } from '@/api/hyperv.api';
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
  onAction: (vm: VirtualMachine, action: VmAction) => void;
  onEdit?: (vm: VirtualMachine) => void;
  onCheckpoints?: (vm: VirtualMachine) => void;
  /** Open the live interactive console (Layer B, FreeRDP H.264 stream). */
  onInteractiveConsole?: (vm: VirtualMachine) => void;
}

type SortKey = 'name' | 'state' | 'cpu' | 'mem' | 'uptime';

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

export function HyperVVmTable({ vms, busyVmId, showHost, searchable, hostDeviceId, onAction, onEdit, onCheckpoints, onInteractiveConsole }: Props) {
  const { t } = useTranslation();
  const [menuVmId, setMenuVmId] = useState<string | null>(null);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = async (format: 'csv' | 'xlsx' | 'pdf') => {
    setExportMenuOpen(false);
    setIsExporting(true);
    try {
      const { blob, filename } = await hypervApi.export(format, hostDeviceId);
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

  // Partial, case-insensitive match on the VM name (primary) and host name.
  // e.g. "ows" matches "OVPMK1OWS13". Filtering happens BEFORE grouping so a
  // host stays visible as its group header as long as one of its VMs matches.
  const filteredVms = useMemo(() => {
    if (!searchable) return vms;
    const q = search.trim().toLowerCase();
    if (!q) return vms;
    return vms.filter((vm) =>
      vm.name.toLowerCase().includes(q) || (vm.hostName ?? '').toLowerCase().includes(q),
    );
  }, [vms, search, searchable]);

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

  const colCount = 7;

  return (
    <div className="space-y-3">
      {vms.length > 0 && (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          {searchable ? (
            <div className="relative max-w-sm flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('hyperv.searchPlaceholder') || 'Search VM or host…'}
                className="w-full pl-9 pr-8 py-2 text-sm bg-bg-secondary rounded-lg text-text-primary focus:outline-none focus:border-accent"
              />
              {search && (
                <button type="button" onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-text-muted hover:text-text-primary">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ) : <span />}

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
            <SortHead k="cpu" label="CPU %" cls="hidden md:table-cell" />
            <SortHead k="mem" label={t('hyperv.col.memory') || 'Memory'} cls="hidden lg:table-cell" />
            <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase hidden xl:table-cell">{t('hyperv.col.guestOs') || 'Guest OS'}</th>
            <SortHead k="uptime" label={t('hyperv.col.uptime') || 'Uptime'} cls="hidden xl:table-cell" />
            <th className="px-4 py-3 text-right text-xs font-medium text-text-muted uppercase">{t('hyperv.col.actions') || 'Actions'}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {groups.map((g) => {
            const isCollapsed = collapsed.has(g.host);
            const running = g.vms.filter((v) => v.state === 'running').length;
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
                      <td className="px-4 py-2.5 text-sm text-text-muted hidden md:table-cell">{running && vm.cpuUsagePercent != null ? `${vm.cpuUsagePercent}%` : '—'}</td>
                      <td className="px-4 py-2.5 text-sm text-text-muted hidden lg:table-cell">
                        {fmtMem(vm.memoryBytes)}
                        {vm.dynamicMemory && vm.memoryDemandBytes ? <span className="text-[10px] ml-1" title="Demand">({fmtMem(vm.memoryDemandBytes)})</span> : null}
                      </td>
                      <td className="px-4 py-2.5 text-sm text-text-muted hidden xl:table-cell truncate max-w-[180px]" title={vm.guestOs ?? ''}>{vm.guestOs || '—'}</td>
                      <td className="px-4 py-2.5 text-sm text-text-muted hidden xl:table-cell">{fmtUptime(vm.uptimeSeconds)}</td>
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
