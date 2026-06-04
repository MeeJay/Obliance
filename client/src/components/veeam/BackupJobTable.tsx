import { Fragment, useMemo, useState } from 'react';
import { clsx } from 'clsx';
import { useTranslation } from 'react-i18next';
import {
  Play, Square, RotateCcw, MoreHorizontal, Database, ChevronDown, ChevronRight,
  ArrowUp, ArrowDown, Search, X, CheckCircle2, AlertTriangle, XCircle, MinusCircle,
  CalendarOff, CalendarClock, HardDriveDownload,
} from 'lucide-react';
import type { BackupJob, BackupJobAction, BackupJobState, BackupJobResult } from '@obliance/shared';

interface Props {
  jobs: BackupJob[];
  busyJobId?: string | null;
  /** Group rows by host (tenant-wide grid). */
  showHost?: boolean;
  /** Show a search box filtering jobs by partial name (and host name). */
  searchable?: boolean;
  /** When false, hide the action controls (read-only viewer without control). */
  canControl?: boolean;
  onAction: (job: BackupJob, action: BackupJobAction) => void;
}

type SortKey = 'name' | 'state' | 'result' | 'lastRun' | 'nextRun';

const STATE_BADGE: Record<BackupJobState, string> = {
  running: 'bg-green-400/10 text-green-400 border-green-400/30',
  idle: 'bg-gray-400/10 text-gray-400 border-gray-400/30',
  transitioning: 'bg-orange-400/10 text-orange-400 border-orange-400/30',
  disabled: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/30',
  unknown: 'bg-gray-400/10 text-gray-400 border-gray-400/30',
};
const STATE_ORDER: Record<BackupJobState, number> = { running: 0, transitioning: 1, idle: 2, disabled: 3, unknown: 4 };

const RESULT_META: Record<BackupJobResult, { cls: string; icon: typeof CheckCircle2 }> = {
  success: { cls: 'text-green-400', icon: CheckCircle2 },
  warning: { cls: 'text-amber-400', icon: AlertTriangle },
  failed: { cls: 'text-red-400', icon: XCircle },
  none: { cls: 'text-text-muted', icon: MinusCircle },
};
const RESULT_ORDER: Record<BackupJobResult, number> = { failed: 0, warning: 1, success: 2, none: 3 };

function fmtDuration(sec: number | null): string {
  if (!sec || sec <= 0) return '—';
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function BackupJobTable({ jobs, busyJobId, showHost, searchable, canControl = true, onAction }: Props) {
  const { t } = useTranslation();
  const [menuJobId, setMenuJobId] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');

  const filteredJobs = useMemo(() => {
    if (!searchable) return jobs;
    const q = search.trim().toLowerCase();
    if (!q) return jobs;
    return jobs.filter((j) =>
      j.name.toLowerCase().includes(q) || (j.hostName ?? '').toLowerCase().includes(q),
    );
  }, [jobs, search, searchable]);

  const stateLabel = (s: BackupJobState) => t(`veeam.state.${s}`) || s;
  const resultLabel = (r: BackupJobResult) => t(`veeam.result.${r}`) || r;

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(k); setSortDir('asc'); }
  };

  const cmp = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    return (a: BackupJob, b: BackupJob) => {
      let r = 0;
      switch (sortKey) {
        case 'name': r = a.name.localeCompare(b.name, undefined, { numeric: true }); break;
        case 'state': r = STATE_ORDER[a.state] - STATE_ORDER[b.state]; break;
        case 'result': r = RESULT_ORDER[a.lastResult] - RESULT_ORDER[b.lastResult]; break;
        case 'lastRun': r = (a.lastRunEnd ? Date.parse(a.lastRunEnd) : 0) - (b.lastRunEnd ? Date.parse(b.lastRunEnd) : 0); break;
        case 'nextRun': r = (a.nextRun ? Date.parse(a.nextRun) : Infinity) - (b.nextRun ? Date.parse(b.nextRun) : Infinity); break;
      }
      return r * dir;
    };
  }, [sortKey, sortDir]);

  const groups = useMemo(() => {
    if (!showHost) return [{ host: '', jobs: [...filteredJobs].sort(cmp) }];
    const m = new Map<string, BackupJob[]>();
    for (const j of filteredJobs) {
      const h = j.hostName ?? `#${j.hostDeviceId}`;
      (m.get(h) ?? m.set(h, []).get(h)!).push(j);
    }
    return [...m.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([host, list]) => ({ host, jobs: list.sort(cmp) }));
  }, [filteredJobs, cmp, showHost]);

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
      {searchable && jobs.length > 0 && (
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('veeam.searchPlaceholder') || 'Search job or host…'}
            className="w-full pl-9 pr-8 py-2 text-sm bg-bg-secondary rounded-lg text-text-primary focus:outline-none focus:border-accent"
          />
          {search && (
            <button type="button" onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-text-muted hover:text-text-primary">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}

      {jobs.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-12 text-text-muted">
          <Database className="w-8 h-8 opacity-50" />
          <p className="text-sm">{t('veeam.noJobs') || 'No backup jobs on this host.'}</p>
        </div>
      ) : groups.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-12 text-text-muted">
          <Search className="w-8 h-8 opacity-50" />
          <p className="text-sm">{t('veeam.noMatch') || 'No job matches your search.'}</p>
        </div>
      ) : (
      <div className="bg-bg-secondary rounded-xl overflow-visible">
      <table className="w-full">
        <thead>
          <tr>
            <SortHead k="name" label={t('veeam.col.name') || 'Job'} />
            <SortHead k="state" label={t('veeam.col.state') || 'State'} />
            <SortHead k="result" label={t('veeam.col.lastResult') || 'Last result'} />
            <SortHead k="lastRun" label={t('veeam.col.lastRun') || 'Last run'} cls="hidden md:table-cell" />
            <SortHead k="nextRun" label={t('veeam.col.nextRun') || 'Next run'} cls="hidden lg:table-cell" />
            <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase hidden xl:table-cell">{t('veeam.col.repository') || 'Repository'}</th>
            <th className="px-4 py-3 text-right text-xs font-medium text-text-muted uppercase">{t('veeam.col.actions') || 'Actions'}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {groups.map((g) => {
            const isCollapsed = collapsed.has(g.host);
            const failed = g.jobs.filter((j) => j.lastResult === 'failed').length;
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
                        <Database className="w-3.5 h-3.5 text-text-muted" />
                        {g.host}
                        <span className="text-text-muted font-normal">
                          · {g.jobs.length} {t('veeam.jobs') || 'jobs'}
                          {failed > 0 && <span className="text-red-400"> · {failed} {t('veeam.failed') || 'failed'}</span>}
                        </span>
                      </button>
                    </td>
                  </tr>
                )}
                {!isCollapsed && g.jobs.map((job) => {
                  const busy = busyJobId === job.jobId;
                  const running = job.state === 'running';
                  const transitioning = job.state === 'transitioning';
                  const disabled = job.state === 'disabled' || !job.scheduleEnabled;
                  const result = RESULT_META[job.lastResult];
                  const ResultIcon = result.icon;
                  return (
                    <tr key={job.jobId} className="hover:bg-bg-tertiary/40 transition-colors">
                      <td className="px-4 py-2.5 text-sm text-text-primary font-medium">
                        <span className={clsx('inline-flex items-center gap-1.5', showHost && 'pl-5')} title={job.description ?? undefined}>
                          {job.name}
                        </span>
                        {job.jobType ? <span className="ml-2 text-[10px] text-text-muted">{job.jobType}</span> : null}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={clsx('inline-flex items-center gap-1 px-2 py-0.5 text-[11px] rounded-full border', STATE_BADGE[job.state])} title={job.rawState ?? undefined}>
                          {running && job.progressPercent != null ? `${stateLabel(job.state)} ${job.progressPercent}%` : stateLabel(job.state)}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={clsx('inline-flex items-center gap-1.5 text-xs', result.cls)}>
                          <ResultIcon className="w-3.5 h-3.5" />
                          {resultLabel(job.lastResult)}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-sm text-text-muted hidden md:table-cell">
                        {fmtDate(job.lastRunEnd)}
                        {job.durationSeconds ? <span className="text-[10px] ml-1">({fmtDuration(job.durationSeconds)})</span> : null}
                      </td>
                      <td className="px-4 py-2.5 text-sm text-text-muted hidden lg:table-cell">
                        {disabled
                          ? <span className="inline-flex items-center gap-1 text-zinc-400"><CalendarOff className="w-3.5 h-3.5" />{t('veeam.scheduleDisabled') || 'Disabled'}</span>
                          : fmtDate(job.nextRun)}
                      </td>
                      <td className="px-4 py-2.5 text-sm text-text-muted hidden xl:table-cell truncate max-w-[180px]" title={job.repository ?? ''}>{job.repository || '—'}</td>
                      <td className="px-4 py-2.5">
                        {canControl ? (
                        <div className="flex items-center justify-end gap-1">
                          {running || transitioning ? (
                            <button disabled={busy} onClick={() => onAction(job, 'stop')} title={t('veeam.action.stop') || 'Stop'} className="p-1.5 rounded text-orange-400 hover:bg-orange-400/10 disabled:opacity-40 transition-colors">
                              <Square className="w-4 h-4" />
                            </button>
                          ) : (
                            <button disabled={busy} onClick={() => onAction(job, 'start')} title={t('veeam.action.start') || 'Start'} className="p-1.5 rounded text-green-400 hover:bg-green-400/10 disabled:opacity-40 transition-colors">
                              <Play className="w-4 h-4" />
                            </button>
                          )}
                          <button disabled={busy || running || transitioning} onClick={() => onAction(job, 'retry')} title={t('veeam.action.retry') || 'Retry failed'} className="p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-bg-secondary disabled:opacity-30 transition-colors">
                            <RotateCcw className="w-4 h-4" />
                          </button>
                          <div className="relative">
                            <button disabled={busy} onClick={() => setMenuJobId(menuJobId === job.jobId ? null : job.jobId)} className="p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-bg-secondary disabled:opacity-40 transition-colors">
                              <MoreHorizontal className="w-4 h-4" />
                            </button>
                            {menuJobId === job.jobId && (
                              <>
                                <div className="fixed inset-0 z-40" onClick={() => setMenuJobId(null)} />
                                <div className="absolute right-0 top-full mt-1 z-50 w-56 bg-bg-secondary rounded-lg shadow-2xl overflow-hidden py-1">
                                  {([
                                    { action: 'retry' as BackupJobAction, label: t('veeam.action.retry') || 'Retry failed items', icon: HardDriveDownload, show: true },
                                    { action: 'disable' as BackupJobAction, label: t('veeam.action.disable') || 'Disable schedule', icon: CalendarOff, show: job.scheduleEnabled },
                                    { action: 'enable' as BackupJobAction, label: t('veeam.action.enable') || 'Enable schedule', icon: CalendarClock, show: !job.scheduleEnabled },
                                  ] as const).filter((i) => i.show).map((i) => (
                                    <button
                                      key={i.action}
                                      onClick={() => { setMenuJobId(null); onAction(job, i.action); }}
                                      className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left hover:bg-bg-tertiary transition-colors text-text-primary"
                                    >
                                      <i.icon className="w-3.5 h-3.5" /> {i.label}
                                    </button>
                                  ))}
                                </div>
                              </>
                            )}
                          </div>
                        </div>
                        ) : <span className="text-text-muted">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      </div>
      )}
    </div>
  );
}
