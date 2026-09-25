import { Fragment, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
 History, RefreshCw, Terminal, Package, Code2,
 Monitor, Search, Loader2, X, Zap, ChevronRight, ChevronDown,
} from 'lucide-react';
import { clsx } from 'clsx';
import { commandApi } from '@/api/command.api';
import { scriptApi } from '@/api/script.api';
import { updateApi } from '@/api/update.api';
import { scenarioApi } from '@/api/scenario.api';
import { useDeviceStore } from '@/store/deviceStore';
import { getSocket } from '@/socket/socketClient';
import type { Command, ScriptExecution, DeviceUpdate, ScenarioRun } from '@obliance/shared';
import { anonymize } from '@/utils/anonymize';
import { TableScroll } from '@/components/common/TableScroll';
import toast from 'react-hot-toast';

// ─── Unified event model ─────────────────────────────────────────────────────

type EventKind = 'task' | 'script' | 'update';

interface HistoryEvent {
 id: string;
 kind: EventKind;
 date: string;
 deviceId: number;
 label: string;
 /** i18n key of `label` (command types); `label` is the fallback. */
 labelKey?: string;
 sublabel?: string;
 status: string;
 duration?: number;
 createdByName?: string | null;
}

// ─── Converters ──────────────────────────────────────────────────────────────

// English fallbacks of history.cmd.<type>.
const CMD_LABELS: Record<string, string> = {
 run_script: 'Run Script',
 install_update: 'Install Update',
 scan_inventory: 'Scan Inventory',
 scan_updates: 'Scan Updates',
 check_compliance: 'Check Compliance',
 open_remote_tunnel: 'Open Tunnel',
 close_remote_tunnel: 'Close Tunnel',
 reboot: 'Reboot',
 shutdown: 'Shutdown',
 restart_agent: 'Restart Agent',
 list_services: 'List Services',
 restart_service: 'Restart Service',
 install_software: 'Install Software',
 uninstall_software: 'Uninstall Software',
};

function cmdToEvent(c: Command): HistoryEvent {
 return {
 id: `task:${c.id}`,
 kind: 'task',
 date: c.createdAt,
 deviceId: c.deviceId,
 label: CMD_LABELS[c.type] ?? c.type,
 labelKey: CMD_LABELS[c.type] ? `history.cmd.${c.type}` : undefined,
 status: c.status,
 duration: c.durationMs ?? (c.result as any)?.duration,
 createdByName: c.createdByName,
 };
}

function execToEvent(e: ScriptExecution): HistoryEvent {
 return {
 id: `script:${e.id}`,
 kind: 'script',
 date: e.triggeredAt,
 deviceId: e.deviceId,
 label: (e.scriptSnapshot as any)?.name ?? 'Script',
 sublabel: e.triggeredBy,
 status: e.status,
 createdByName: e.triggeredBy,
 };
}

function updateToEvent(u: DeviceUpdate): HistoryEvent {
 return {
 id: `update:${u.id}`,
 kind: 'update',
 date: u.installedAt ?? u.approvedAt ?? u.updatedAt,
 deviceId: u.deviceId,
 label: u.title ?? 'Update',
 sublabel: u.severity,
 status: u.status,
 };
}

// ─── Status config ───────────────────────────────────────────────────────────

// `label` = English fallback of history.status.<status>.
const STATUS_CFG: Record<string, { color: string; bg: string; label: string }> = {
 pending: { color: 'text-yellow-400', bg: 'bg-yellow-400/10', label: 'Pending' },
 sent: { color: 'text-blue-300', bg: 'bg-blue-300/10', label: 'Sent' },
 ack_running: { color: 'text-blue-400', bg: 'bg-blue-400/10', label: 'Running' },
 running: { color: 'text-blue-400', bg: 'bg-blue-400/10', label: 'Running' },
 success: { color: 'text-green-400', bg: 'bg-green-400/10', label: 'Success' },
 failure: { color: 'text-red-400', bg: 'bg-red-400/10', label: 'Failed' },
 failed: { color: 'text-red-400', bg: 'bg-red-400/10', label: 'Failed' },
 timeout: { color: 'text-orange-400', bg: 'bg-orange-400/10', label: 'Timeout' },
 cancelled: { color: 'text-gray-400', bg: 'bg-gray-400/10', label: 'Cancelled' },
 skipped: { color: 'text-gray-400', bg: 'bg-gray-400/10', label: 'Skipped' },
 installed: { color: 'text-green-400', bg: 'bg-green-400/10', label: 'Installed' },
 approved: { color: 'text-blue-400', bg: 'bg-blue-400/10', label: 'Approved' },
 available: { color: 'text-yellow-400', bg: 'bg-yellow-400/10', label: 'Available' },
};

// ─── Kind config ─────────────────────────────────────────────────────────────

// `label` = English fallback of history.kind.<kind>.
const KIND_CFG: Record<EventKind, { color: string; bg: string; label: string; Icon: React.ElementType }> = {
 task: { color: 'text-blue-400', bg: 'bg-blue-400/10', label: 'Task', Icon: Terminal },
 script: { color: 'text-rose-400', bg: 'bg-rose-400/10', label: 'Script', Icon: Code2 },
 update: { color: 'text-emerald-400', bg: 'bg-emerald-400/10', label: 'Update', Icon: Package },
};

type KindFilter = 'all' | EventKind;
const PAGE_SIZE = 50;

const TH = 'px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider';

// ─── Page ─────────────────────────────────────────────────────────────────────

export function HistoryPage({ embedded }: { embedded?: boolean } = {}) {
 const { t } = useTranslation();
 const socket = getSocket();
 const { getDevice, fetchDevices } = useDeviceStore();

 const [mainTab, setMainTab] = useState<'events' | 'scenarios'>('events');
 const [events, setEvents] = useState<HistoryEvent[]>([]);
 const [scenarioRuns, setScenarioRuns] = useState<ScenarioRun[]>([]);
 const [isLoading, setIsLoading] = useState(true);
 const [kindFilter, setKindFilter] = useState<KindFilter>('all');
 const [search, setSearch] = useState('');
 const [shown, setShown] = useState(PAGE_SIZE);
 const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
 const [runDetails, setRunDetails] = useState<Record<string, ScenarioRun>>({});

 const load = useCallback(async () => {
 setIsLoading(true);
 try {
 const [cmdRes, execRes, updRes, runs] = await Promise.all([
 commandApi.list(),
 scriptApi.listExecutions({ pageSize: 200 }),
 updateApi.listUpdates(),
 scenarioApi.listRuns({ limit: 200 }).catch(() => [] as ScenarioRun[]),
 ]);

 const all: HistoryEvent[] = [
 ...cmdRes.items.map(cmdToEvent),
 ...execRes.items.map(execToEvent),
 ...updRes.items.map(updateToEvent),
 ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

 setEvents(all);
 setScenarioRuns(runs);
 } catch {
 toast.error(t('history.loadFailed', 'Failed to load history'));
 } finally {
 setIsLoading(false);
 }
 }, [t]);

 const toggleRun = async (runId: string) => {
 if (expandedRunId === runId) {
 setExpandedRunId(null);
 return;
 }
 setExpandedRunId(runId);
 if (!runDetails[runId]) {
 try {
 const detail = await scenarioApi.getRun(runId);
 setRunDetails((prev) => ({ ...prev, [runId]: detail }));
 } catch {}
 }
 };

 useEffect(() => {
 fetchDevices();
 load();
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, []);

 // Real-time: update task rows live
 useEffect(() => {
 const onCmd = (cmd: Command) => {
 setEvents(prev => {
 const id = `task:${cmd.id}`;
 const updated = cmdToEvent(cmd);
 const idx = prev.findIndex(e => e.id === id);
 if (idx >= 0) {
 const next = [...prev];
 next[idx] = updated;
 return next;
 }
 return [updated, ...prev].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
 });
 };
 const onExec = (exec: ScriptExecution) => {
 setEvents(prev => {
 const id = `script:${exec.id}`;
 const updated = execToEvent(exec);
 const idx = prev.findIndex(e => e.id === id);
 if (idx >= 0) {
 const next = [...prev];
 next[idx] = updated;
 return next;
 }
 return [updated, ...prev].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
 });
 };
 if (!socket) return;
 socket.on('COMMAND_UPDATED', onCmd);
 socket.on('EXECUTION_UPDATED', onExec);
 return () => {
 socket.off('COMMAND_UPDATED', onCmd);
 socket.off('EXECUTION_UPDATED', onExec);
 };
 }, [socket]);

 const deviceName = (id: number) => {
 const d = getDevice(id);
 return anonymize(d?.displayName || d?.hostname) || `#${id}`;
 };

 const eventLabel = (e: HistoryEvent) => (e.labelKey ? t(e.labelKey, e.label) : e.label);

 // Apply filters
 const filtered = events.filter(e => {
 if (kindFilter !== 'all' && e.kind !== kindFilter) return false;
 if (search) {
 const q = search.toLowerCase();
 if (
 !e.label.toLowerCase().includes(q) &&
 !eventLabel(e).toLowerCase().includes(q) &&
 !deviceName(e.deviceId).toLowerCase().includes(q) &&
 !(e.sublabel ?? '').toLowerCase().includes(q)
 ) return false;
 }
 return true;
 });

 const counts: Record<KindFilter, number> = {
 all: events.length,
 task: events.filter(e => e.kind === 'task').length,
 script: events.filter(e => e.kind === 'script').length,
 update: events.filter(e => e.kind === 'update').length,
 };

 const visible = filtered.slice(0, shown);
 const hasMore = filtered.length > shown;

 const FILTERS: { key: KindFilter; label: string }[] = [
 { key: 'all', label: t('history.filter.all', 'All') },
 { key: 'task', label: t('history.filter.task', 'Tasks') },
 { key: 'script', label: t('history.filter.script', 'Scripts') },
 { key: 'update', label: t('history.filter.update', 'Updates') },
 ];

 const SCENARIO_STATUS_CFG: Record<string, { color: string; bg: string; label: string }> = {
 pending: { color: 'text-gray-400', bg: 'bg-gray-400/10', label: t('history.status.pending', 'Pending') },
 running: { color: 'text-blue-400', bg: 'bg-blue-400/10', label: t('history.status.running', 'Running') },
 success: { color: 'text-emerald-400', bg: 'bg-emerald-400/10', label: t('history.status.success', 'Success') },
 failure: { color: 'text-red-400', bg: 'bg-red-400/10', label: t('history.status.failure', 'Failed') },
 cancelled: { color: 'text-text-muted', bg: 'bg-bg-tertiary', label: t('history.status.cancelled', 'Cancelled') },
 timeout: { color: 'text-orange-400', bg: 'bg-orange-400/10', label: t('history.status.timeout', 'Timeout') },
 };

 const statusLabel = (status: string) => {
 const cfg = STATUS_CFG[status];
 return cfg ? t(`history.status.${status}`, cfg.label) : status;
 };
 const kindLabel = (kind: EventKind) => t(`history.kind.${kind}`, KIND_CFG[kind].label);
 const formatMs = (ms: number) => (ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`);

 // `inRunRow`: link inside a clickable scenario-run row (does not toggle it,
 // and keeps that table's historic look: no icon hover tint).
 const deviceLink = (deviceId: number, inRunRow = false) => {
 const device = getDevice(deviceId);
 return device ? (
 <Link
 to={`/devices/${deviceId}`}
 onClick={inRunRow ? (e) => e.stopPropagation() : undefined}
 className={clsx('inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-accent transition-colors min-w-0', !inRunRow && 'group')}
 >
 <Monitor className={clsx('w-3.5 h-3.5 text-text-muted shrink-0', !inRunRow && 'group-hover:text-accent')} />
 <span className="truncate max-w-[140px]">{anonymize(device.displayName || device.hostname)}</span>
 </Link>
 ) : (
 <span className="text-xs text-text-muted">#{deviceId}</span>
 );
 };

 return (
 <div className={embedded ? 'flex flex-col min-h-0 space-y-5' : 'flex flex-col h-full min-h-0 p-3 sm:p-4 lg:p-6 space-y-5'}>

 {/* Header */}
 <div className="flex items-center justify-between gap-4 flex-wrap">
 {!embedded && <div className="flex items-center gap-3">
 <History className="w-5 h-5 text-text-muted" />
 <h1 className="text-xl font-semibold text-text-primary">{t('history.title', 'History')}</h1>
 {!isLoading && mainTab === 'events' && (
 <span className="text-xs text-text-muted bg-bg-secondary border border-transparent px-2 py-0.5 rounded-full">
 {t('history.eventCount', '{{count}} events', { count: filtered.length })}
 </span>
 )}
 </div>}
 <button
 onClick={() => { setShown(PAGE_SIZE); load(); }}
 disabled={isLoading}
 className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-bg-secondary border border-transparent text-sm text-text-muted hover:text-text-primary transition-colors disabled:opacity-50 coarse:min-h-10"
 >
 <RefreshCw className={clsx('w-4 h-4', isLoading && 'animate-spin')} />
 {t('common.refresh', 'Refresh')}
 </button>
 </div>

 {/* Main tabs: Events vs Scenarios (scroll instead of overflowing on phones) */}
 <div className="flex items-center gap-1 rounded-lg bg-bg-secondary p-1 border border-transparent w-fit max-w-full overflow-x-auto overscroll-x-contain scrollbar-none" role="tablist">
 <button
 role="tab"
 aria-selected={mainTab === 'events'}
 onClick={() => setMainTab('events')}
 className={clsx(
 'flex items-center gap-2 px-4 py-1.5 text-sm font-medium rounded-md transition-colors shrink-0 whitespace-nowrap coarse:min-h-10',
 mainTab === 'events' ? 'bg-accent text-white' : 'text-text-muted hover:text-text-primary',
 )}
 >
 <Terminal className="w-4 h-4" />
 {t('history.tabEvents', 'Tasks & Scripts')}
 <span className={clsx('rounded-full px-1.5 py-0.5 text-[10px] font-semibold', mainTab === 'events' ? 'bg-white/20 text-white' : 'bg-bg-tertiary text-text-muted')}>
 {events.length}
 </span>
 </button>
 <button
 role="tab"
 aria-selected={mainTab === 'scenarios'}
 onClick={() => setMainTab('scenarios')}
 className={clsx(
 'flex items-center gap-2 px-4 py-1.5 text-sm font-medium rounded-md transition-colors shrink-0 whitespace-nowrap coarse:min-h-10',
 mainTab === 'scenarios' ? 'bg-accent text-white' : 'text-text-muted hover:text-text-primary',
 )}
 >
 <Zap className="w-4 h-4" />
 {t('history.tabScenarios', 'Scenarios')}
 <span className={clsx('rounded-full px-1.5 py-0.5 text-[10px] font-semibold', mainTab === 'scenarios' ? 'bg-white/20 text-white' : 'bg-bg-tertiary text-text-muted')}>
 {scenarioRuns.length}
 </span>
 </button>
 </div>

 {mainTab === 'events' && <>
 {/* Toolbar: kind filters + search */}
 <div className="flex items-center gap-3 flex-wrap">
 <div className="flex items-center gap-1.5 flex-wrap">
 {FILTERS.map(({ key, label }) => (
 <button
 key={key}
 onClick={() => { setKindFilter(key); setShown(PAGE_SIZE); }}
 aria-pressed={kindFilter === key}
 className={clsx(
 'flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium transition-colors border coarse:min-h-9',
 kindFilter === key
 ? 'bg-accent text-white border-accent'
 : 'bg-bg-secondary text-text-muted hover:text-text-primary border-transparent'
 )}
 >
 {label}
 {counts[key] > 0 && (
 <span className={clsx(
 'rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
 kindFilter === key ? 'bg-white/20 text-white' : 'bg-bg-tertiary text-text-muted'
 )}>
 {counts[key]}
 </span>
 )}
 </button>
 ))}
 </div>

 <div className="relative flex-1 min-w-[180px] max-w-xs ml-auto max-sm:max-w-none max-sm:basis-full">
 <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted pointer-events-none" />
 <input
 value={search}
 onChange={e => { setSearch(e.target.value); setShown(PAGE_SIZE); }}
 placeholder={t('history.searchPlaceholder', 'Search task, device…')}
 aria-label={t('history.searchPlaceholder', 'Search task, device…')}
 autoCapitalize="off"
 autoCorrect="off"
 spellCheck={false}
 className="w-full pl-8 pr-8 py-1.5 bg-bg-secondary rounded-lg text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent coarse:pr-11"
 />
 {search && (
 <button
 onClick={() => setSearch('')}
 aria-label={t('history.clearSearch', 'Clear search')}
 className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary transition-colors coarse:right-0 coarse:min-h-10 coarse:min-w-10 coarse:flex coarse:items-center coarse:justify-center"
 >
 <X className="w-3.5 h-3.5" />
 </button>
 )}
 </div>
 </div>

 {/* Content */}
 {isLoading ? (
 <div className="flex items-center justify-center flex-1 min-h-[240px]">
 <Loader2 className="w-6 h-6 animate-spin text-text-muted" />
 </div>
 ) : filtered.length === 0 ? (
 <div className="flex flex-col items-center justify-center flex-1 min-h-[240px] text-text-muted">
 <History className="w-10 h-10 mb-3 opacity-30" />
 <p className="text-sm">
 {search || kindFilter !== 'all' ? t('history.noResults', 'No results for this filter') : t('history.empty', 'No history yet')}
 </p>
 </div>
 ) : (
 <div className="flex-1 min-h-0 space-y-3">
 {/* Below md: Date / Type / Device move under the action (stacked
 row), so Action and Status keep the width. */}
 <TableScroll className="bg-bg-secondary rounded-xl">
 <table className="w-full">
 <thead>
 <tr className="">
 <th className={clsx(TH, 'whitespace-nowrap hidden md:table-cell')}>{t('history.col.date', 'Date')}</th>
 <th className={clsx(TH, 'hidden md:table-cell')}>{t('history.col.type', 'Type')}</th>
 <th className={clsx(TH, 'max-md:px-3')}>{t('history.col.action', 'Action')}</th>
 <th className={clsx(TH, 'hidden md:table-cell')}>{t('history.col.device', 'Device')}</th>
 <th className={clsx(TH, 'max-md:px-3')}>{t('history.col.status', 'Status')}</th>
 <th className={clsx(TH, 'hidden md:table-cell')}>{t('history.col.user', 'User')}</th>
 <th className={clsx(TH, 'hidden lg:table-cell')}>{t('history.col.duration', 'Duration')}</th>
 </tr>
 </thead>
 <tbody className="divide-y divide-border">
 {visible.map(ev => {
 const kc = KIND_CFG[ev.kind];
 const sc = STATUS_CFG[ev.status] ?? { color: 'text-text-muted', bg: 'bg-bg-tertiary', label: ev.status };
 const isLive = ev.status === 'ack_running' || ev.status === 'running';

 return (
 <tr key={ev.id} className="hover:bg-bg-tertiary transition-colors">

 {/* Date */}
 <td className="px-4 py-2.5 text-xs text-text-muted whitespace-nowrap hidden md:table-cell">
 {new Date(ev.date).toLocaleString()}
 </td>

 {/* Kind badge */}
 <td className="px-4 py-2.5 hidden md:table-cell">
 <span className={clsx('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium', kc.color, kc.bg)}>
 <kc.Icon className="w-3 h-3" />
 {kindLabel(ev.kind)}
 </span>
 </td>

 {/* Label (+ kind · device · date · user on phones) */}
 <td className="px-4 py-2.5 max-w-0 max-md:px-3">
 <span className="text-sm text-text-primary font-medium truncate block">
 {eventLabel(ev)}
 </span>
 {ev.sublabel && (
 <span className="text-xs text-text-muted capitalize">{ev.sublabel}</span>
 )}
 <div className="md:hidden mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-muted">
 <span className={clsx('inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium', kc.color, kc.bg)}>
 <kc.Icon className="w-3 h-3" />
 {kindLabel(ev.kind)}
 </span>
 {deviceLink(ev.deviceId)}
 <span className="whitespace-nowrap">{new Date(ev.date).toLocaleString()}</span>
 {ev.createdByName && <span className="truncate">{anonymize(ev.createdByName)}</span>}
 {ev.duration != null && <span className="whitespace-nowrap">{formatMs(ev.duration)}</span>}
 </div>
 {/* md–lg: the Duration column is hidden, show it here. */}
 {ev.duration != null && (
 <div className="hidden md:block lg:hidden mt-0.5 text-xs text-text-muted">
 {t('history.col.duration', 'Duration')}: {formatMs(ev.duration)}
 </div>
 )}
 </td>

 {/* Device link */}
 <td className="px-4 py-2.5 hidden md:table-cell whitespace-nowrap">
 {deviceLink(ev.deviceId)}
 </td>

 {/* Status badge */}
 <td className="px-4 py-2.5 max-md:px-3 max-md:align-top">
 <span className={clsx('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap', sc.color, sc.bg)}>
 {isLive && <Loader2 className="w-3 h-3 animate-spin" />}
 {statusLabel(ev.status)}
 </span>
 </td>

 {/* User */}
 <td className="px-4 py-2.5 text-xs text-text-muted hidden md:table-cell whitespace-nowrap">
 {anonymize(ev.createdByName) || '—'}
 </td>

 {/* Duration */}
 <td className="px-4 py-2.5 text-xs text-text-muted hidden lg:table-cell whitespace-nowrap">
 {ev.duration != null ? formatMs(ev.duration) : '—'}
 </td>
 </tr>
 );
 })}
 </tbody>
 </table>
 </TableScroll>

 {/* Pagination footer */}
 <div className="flex items-center justify-between gap-3 text-xs text-text-muted px-1">
 <span>{t('history.showingOf', 'Showing {{shown}} of {{total}}', { shown: Math.min(shown, filtered.length), total: filtered.length })}</span>
 {hasMore && (
 <button
 onClick={() => setShown(s => s + PAGE_SIZE)}
 className="px-3 py-1.5 rounded-lg bg-bg-secondary border border-transparent hover:text-text-primary transition-colors coarse:min-h-10"
 >
 {t('history.loadMore', 'Load {{count}} more', { count: Math.min(PAGE_SIZE, filtered.length - shown) })}
 </button>
 )}
 </div>
 </div>
 )}
 </>}

 {mainTab === 'scenarios' && (
 isLoading ? (
 <div className="flex items-center justify-center flex-1 min-h-[240px]">
 <Loader2 className="w-6 h-6 animate-spin text-text-muted" />
 </div>
 ) : scenarioRuns.length === 0 ? (
 <div className="flex flex-col items-center justify-center flex-1 min-h-[240px] text-text-muted">
 <Zap className="w-10 h-10 mb-3 opacity-30" />
 <p className="text-sm">{t('history.noScenarioRuns', 'No scenario runs yet')}</p>
 </div>
 ) : (
 <div className="flex-1 min-h-0 space-y-3">
 {/* Below md, Device and Trigger move under the scenario name. */}
 <TableScroll className="bg-bg-secondary rounded-xl">
 <table className="w-full">
 <thead>
 <tr className="">
 <th className={clsx(TH, 'whitespace-nowrap max-md:px-3')}>{t('history.col.date', 'Date')}</th>
 <th className={clsx(TH, 'max-md:px-3')}>{t('history.col.scenario', 'Scenario')}</th>
 <th className={clsx(TH, 'hidden md:table-cell')}>{t('history.col.device', 'Device')}</th>
 <th className={clsx(TH, 'hidden md:table-cell')}>{t('history.col.trigger', 'Trigger')}</th>
 <th className={clsx(TH, 'max-md:px-3')}>{t('history.col.status', 'Status')}</th>
 <th className={clsx(TH, 'hidden lg:table-cell')}>{t('history.col.duration', 'Duration')}</th>
 <th className="w-8"></th>
 </tr>
 </thead>
 <tbody className="divide-y divide-border">
 {scenarioRuns.map((r) => {
 const sc = SCENARIO_STATUS_CFG[r.status] ?? { color: 'text-text-muted', bg: 'bg-bg-tertiary', label: r.status };
 const isExpanded = expandedRunId === r.id;
 const detail = runDetails[r.id];
 const duration = r.finishedAt && r.startedAt
 ? (new Date(r.finishedAt).getTime() - new Date(r.startedAt).getTime())
 : null;
 return (
 <Fragment key={r.id}>
 <tr
 className="hover:bg-bg-tertiary transition-colors cursor-pointer"
 onClick={() => toggleRun(r.id)}
 aria-expanded={isExpanded}
 >
 <td className="px-4 py-2.5 text-xs text-text-muted whitespace-nowrap max-md:px-3 max-md:whitespace-normal max-md:min-w-[6.5rem]">
 {new Date(r.startedAt || r.createdAt).toLocaleString()}
 </td>
 <td className="px-4 py-2.5 max-md:px-3">
 <span className="text-sm text-text-primary font-medium">{r.scenario?.name ?? `#${r.scenarioId}`}</span>
 <div className="md:hidden mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-muted">
 {deviceLink(r.deviceId, true)}
 <span className="capitalize">{r.triggerType.replace('_', ' ')}</span>
 </div>
 </td>
 <td className="px-4 py-2.5 whitespace-nowrap hidden md:table-cell">
 {deviceLink(r.deviceId, true)}
 </td>
 <td className="px-4 py-2.5 text-xs text-text-muted capitalize hidden md:table-cell">{r.triggerType.replace('_', ' ')}</td>
 <td className="px-4 py-2.5 max-md:px-3">
 <span className={clsx('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap', sc.color, sc.bg)}>
 {r.status === 'running' && <Loader2 className="w-3 h-3 animate-spin" />}
 {sc.label}
 </span>
 </td>
 <td className="px-4 py-2.5 text-xs text-text-muted hidden lg:table-cell whitespace-nowrap">
 {duration != null ? formatMs(duration) : '—'}
 </td>
 <td className="px-2 py-2.5 text-text-muted">
 {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
 </td>
 </tr>
 {isExpanded && (
 <tr className="bg-bg-tertiary/40">
 <td colSpan={7} className="px-6 py-3 max-md:px-3">
 {!detail ? (
 <div className="text-xs text-text-muted">{t('history.loadingSteps', 'Loading steps...')}</div>
 ) : !detail.stepRuns || detail.stepRuns.length === 0 ? (
 <div className="text-xs text-text-muted">{t('history.noSteps', 'No step details')}</div>
 ) : (
 <div className="space-y-1">
 {duration != null && (
 <div className="lg:hidden text-xs text-text-muted">
 {t('history.col.duration', 'Duration')}: {formatMs(duration)}
 </div>
 )}
 {[...detail.stepRuns].sort((a, b) => a.sortOrder - b.sortOrder).map((sr) => (
 <div key={sr.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
 <span className="text-text-muted w-6">#{sr.sortOrder + 1}</span>
 <span className={clsx('px-2 py-0.5 rounded-full text-[10px] font-medium capitalize', (SCENARIO_STATUS_CFG[sr.status] ?? { color: 'text-text-muted', bg: 'bg-bg-tertiary', label: sr.status }).color, (SCENARIO_STATUS_CFG[sr.status] ?? { bg: 'bg-bg-tertiary' }).bg)}>
 {sr.status.replace('_', ' ')}
 </span>
 {sr.checkExitCode != null && <span className="text-text-muted">{t('history.step.check', 'check: exit {{code}}', { code: sr.checkExitCode })}</span>}
 {sr.resolveExitCode != null && <span className="text-text-muted">{t('history.step.resolve', 'resolve: exit {{code}}', { code: sr.resolveExitCode })}</span>}
 {sr.recheckExitCode != null && <span className="text-text-muted">{t('history.step.recheck', 'recheck: exit {{code}}', { code: sr.recheckExitCode })}</span>}
 </div>
 ))}
 {detail.errorMessage && (
 <div className="mt-2 text-xs text-red-400 break-words">{detail.errorMessage}</div>
 )}
 </div>
 )}
 </td>
 </tr>
 )}
 </Fragment>
 );
 })}
 </tbody>
 </table>
 </TableScroll>
 </div>
 )
 )}
 </div>
 );
}
