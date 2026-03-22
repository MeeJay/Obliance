import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  History, RefreshCw, Terminal, Package, Code2,
  Monitor, Search, Loader2, X,
} from 'lucide-react';
import { clsx } from 'clsx';
import { commandApi } from '@/api/command.api';
import { scriptApi } from '@/api/script.api';
import { updateApi } from '@/api/update.api';
import { useDeviceStore } from '@/store/deviceStore';
import { getSocket } from '@/socket/socketClient';
import type { Command, ScriptExecution, DeviceUpdate } from '@obliance/shared';
import toast from 'react-hot-toast';

// ─── Unified event model ─────────────────────────────────────────────────────

type EventKind = 'task' | 'script' | 'update';

interface HistoryEvent {
  id: string;
  kind: EventKind;
  date: string;
  deviceId: number;
  label: string;
  sublabel?: string;
  status: string;
  duration?: number;
}

// ─── Converters ──────────────────────────────────────────────────────────────

const CMD_LABELS: Record<string, string> = {
  run_script:          'Run Script',
  install_update:      'Install Update',
  scan_inventory:      'Scan Inventory',
  scan_updates:        'Scan Updates',
  check_compliance:    'Check Compliance',
  open_remote_tunnel:  'Open Tunnel',
  close_remote_tunnel: 'Close Tunnel',
  reboot:              'Reboot',
  shutdown:            'Shutdown',
  restart_agent:       'Restart Agent',
  list_services:       'List Services',
  restart_service:     'Restart Service',
  install_software:    'Install Software',
  uninstall_software:  'Uninstall Software',
};

function cmdToEvent(c: Command): HistoryEvent {
  return {
    id: `task:${c.id}`,
    kind: 'task',
    date: c.createdAt,
    deviceId: c.deviceId,
    label: CMD_LABELS[c.type] ?? c.type,
    status: c.status,
    duration: (c.result as any)?.duration,
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

const STATUS_CFG: Record<string, { color: string; bg: string; label: string }> = {
  pending:     { color: 'text-yellow-400', bg: 'bg-yellow-400/10', label: 'Pending' },
  sent:        { color: 'text-blue-300',   bg: 'bg-blue-300/10',   label: 'Sent' },
  ack_running: { color: 'text-blue-400',   bg: 'bg-blue-400/10',   label: 'Running' },
  running:     { color: 'text-blue-400',   bg: 'bg-blue-400/10',   label: 'Running' },
  success:     { color: 'text-green-400',  bg: 'bg-green-400/10',  label: 'Success' },
  failure:     { color: 'text-red-400',    bg: 'bg-red-400/10',    label: 'Failed' },
  failed:      { color: 'text-red-400',    bg: 'bg-red-400/10',    label: 'Failed' },
  timeout:     { color: 'text-orange-400', bg: 'bg-orange-400/10', label: 'Timeout' },
  cancelled:   { color: 'text-gray-400',   bg: 'bg-gray-400/10',   label: 'Cancelled' },
  skipped:     { color: 'text-gray-400',   bg: 'bg-gray-400/10',   label: 'Skipped' },
  installed:   { color: 'text-green-400',  bg: 'bg-green-400/10',  label: 'Installed' },
  approved:    { color: 'text-blue-400',   bg: 'bg-blue-400/10',   label: 'Approved' },
  available:   { color: 'text-yellow-400', bg: 'bg-yellow-400/10', label: 'Available' },
};

// ─── Kind config ─────────────────────────────────────────────────────────────

const KIND_CFG: Record<EventKind, { color: string; bg: string; label: string; Icon: React.ElementType }> = {
  task:   { color: 'text-blue-400',    bg: 'bg-blue-400/10',    label: 'Task',   Icon: Terminal },
  script: { color: 'text-purple-400',  bg: 'bg-purple-400/10',  label: 'Script', Icon: Code2 },
  update: { color: 'text-emerald-400', bg: 'bg-emerald-400/10', label: 'Update', Icon: Package },
};

type KindFilter = 'all' | EventKind;
const PAGE_SIZE = 50;

// ─── Page ─────────────────────────────────────────────────────────────────────

export function HistoryPage({ embedded }: { embedded?: boolean } = {}) {
  const socket = getSocket();
  const { getDevice, fetchDevices } = useDeviceStore();

  const [events, setEvents] = useState<HistoryEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [kindFilter, setKindFilter] = useState<KindFilter>('all');
  const [search, setSearch] = useState('');
  const [shown, setShown] = useState(PAGE_SIZE);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const [cmdRes, execRes, updRes] = await Promise.all([
        commandApi.list(),
        scriptApi.listExecutions({ pageSize: 200 }),
        updateApi.listUpdates(),
      ]);

      const all: HistoryEvent[] = [
        ...cmdRes.items.map(cmdToEvent),
        ...execRes.items.map(execToEvent),
        ...updRes.items.map(updateToEvent),
      ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

      setEvents(all);
    } catch {
      toast.error('Failed to load history');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDevices();
    load();
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
    socket.on('COMMAND_RESULT', onCmd);
    socket.on('EXECUTION_UPDATED', onExec);
    return () => {
      socket.off('COMMAND_UPDATED', onCmd);
      socket.off('COMMAND_RESULT', onCmd);
      socket.off('EXECUTION_UPDATED', onExec);
    };
  }, [socket]);

  const deviceName = (id: number) => {
    const d = getDevice(id);
    return d?.displayName || d?.hostname || `#${id}`;
  };

  // Apply filters
  const filtered = events.filter(e => {
    if (kindFilter !== 'all' && e.kind !== kindFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      if (
        !e.label.toLowerCase().includes(q) &&
        !deviceName(e.deviceId).toLowerCase().includes(q) &&
        !(e.sublabel ?? '').toLowerCase().includes(q)
      ) return false;
    }
    return true;
  });

  const counts: Record<KindFilter, number> = {
    all:    events.length,
    task:   events.filter(e => e.kind === 'task').length,
    script: events.filter(e => e.kind === 'script').length,
    update: events.filter(e => e.kind === 'update').length,
  };

  const visible = filtered.slice(0, shown);
  const hasMore = filtered.length > shown;

  const FILTERS: { key: KindFilter; label: string }[] = [
    { key: 'all',    label: 'All' },
    { key: 'task',   label: 'Tasks' },
    { key: 'script', label: 'Scripts' },
    { key: 'update', label: 'Updates' },
  ];

  return (
    <div className={embedded ? 'flex flex-col min-h-0 space-y-5' : 'flex flex-col h-full min-h-0 p-6 space-y-5'}>

      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        {!embedded && <div className="flex items-center gap-3">
          <History className="w-5 h-5 text-text-muted" />
          <h1 className="text-xl font-semibold text-text-primary">History</h1>
          {!isLoading && (
            <span className="text-xs text-text-muted bg-bg-secondary border border-border px-2 py-0.5 rounded-full">
              {filtered.length} events
            </span>
          )}
        </div>}
        <button
          onClick={() => { setShown(PAGE_SIZE); load(); }}
          disabled={isLoading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-bg-secondary border border-border text-sm text-text-muted hover:text-text-primary transition-colors disabled:opacity-50"
        >
          <RefreshCw className={clsx('w-4 h-4', isLoading && 'animate-spin')} />
          Refresh
        </button>
      </div>

      {/* Toolbar: kind filters + search */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1.5 flex-wrap">
          {FILTERS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => { setKindFilter(key); setShown(PAGE_SIZE); }}
              className={clsx(
                'flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium transition-colors border',
                kindFilter === key
                  ? 'bg-accent text-white border-accent'
                  : 'bg-bg-secondary text-text-muted hover:text-text-primary border-border'
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

        <div className="relative flex-1 min-w-[180px] max-w-xs ml-auto">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted pointer-events-none" />
          <input
            value={search}
            onChange={e => { setSearch(e.target.value); setShown(PAGE_SIZE); }}
            placeholder="Search task, device…"
            className="w-full pl-8 pr-8 py-1.5 bg-bg-secondary border border-border rounded-lg text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary transition-colors"
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
            {search || kindFilter !== 'all' ? 'No results for this filter' : 'No history yet'}
          </p>
        </div>
      ) : (
        <div className="flex-1 min-h-0 space-y-3">
          <div className="bg-bg-secondary border border-border rounded-xl overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider whitespace-nowrap">Date</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider">Type</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider">Action</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider hidden md:table-cell">Device</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider hidden lg:table-cell">Duration</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {visible.map(ev => {
                  const kc = KIND_CFG[ev.kind];
                  const sc = STATUS_CFG[ev.status] ?? { color: 'text-text-muted', bg: 'bg-bg-tertiary', label: ev.status };
                  const device = getDevice(ev.deviceId);
                  const isLive = ev.status === 'ack_running' || ev.status === 'running';

                  return (
                    <tr key={ev.id} className="hover:bg-bg-tertiary transition-colors">

                      {/* Date */}
                      <td className="px-4 py-2.5 text-xs text-text-muted whitespace-nowrap">
                        {new Date(ev.date).toLocaleString()}
                      </td>

                      {/* Kind badge */}
                      <td className="px-4 py-2.5">
                        <span className={clsx('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium', kc.color, kc.bg)}>
                          <kc.Icon className="w-3 h-3" />
                          {kc.label}
                        </span>
                      </td>

                      {/* Label */}
                      <td className="px-4 py-2.5 max-w-0">
                        <span className="text-sm text-text-primary font-medium truncate block">
                          {ev.label}
                        </span>
                        {ev.sublabel && (
                          <span className="text-xs text-text-muted capitalize">{ev.sublabel}</span>
                        )}
                      </td>

                      {/* Device link */}
                      <td className="px-4 py-2.5 hidden md:table-cell whitespace-nowrap">
                        {device ? (
                          <Link
                            to={`/devices/${ev.deviceId}`}
                            className="inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-accent transition-colors group"
                          >
                            <Monitor className="w-3.5 h-3.5 text-text-muted group-hover:text-accent shrink-0" />
                            <span className="truncate max-w-[140px]">{device.displayName || device.hostname}</span>
                          </Link>
                        ) : (
                          <span className="text-xs text-text-muted">#{ev.deviceId}</span>
                        )}
                      </td>

                      {/* Status badge */}
                      <td className="px-4 py-2.5">
                        <span className={clsx('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium', sc.color, sc.bg)}>
                          {isLive && <Loader2 className="w-3 h-3 animate-spin" />}
                          {sc.label}
                        </span>
                      </td>

                      {/* Duration */}
                      <td className="px-4 py-2.5 text-xs text-text-muted hidden lg:table-cell whitespace-nowrap">
                        {ev.duration != null
                          ? ev.duration < 1000 ? `${ev.duration}ms` : `${(ev.duration / 1000).toFixed(1)}s`
                          : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination footer */}
          <div className="flex items-center justify-between text-xs text-text-muted px-1">
            <span>Showing {Math.min(shown, filtered.length)} of {filtered.length}</span>
            {hasMore && (
              <button
                onClick={() => setShown(s => s + PAGE_SIZE)}
                className="px-3 py-1.5 rounded-lg bg-bg-secondary border border-border hover:text-text-primary transition-colors"
              >
                Load {Math.min(PAGE_SIZE, filtered.length - shown)} more
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
