import { useEffect, useState, useCallback } from 'react';
import { Plus, Calendar, Clock, Play, Edit, Trash2, RefreshCw, ToggleLeft, ToggleRight, Terminal, ChevronDown, ChevronUp, ChevronRight, FolderOpen, Check, Minus, User, ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';
import { scriptApi } from '@/api/script.api';
import { scenarioApi } from '@/api/scenario.api';
import { groupsApi } from '@/api/groups.api';
import { useGroupStore } from '@/store/groupStore';
import type { Script, ScriptSchedule, ScheduleTargetType, DeviceGroupTreeNode, Scenario, AutomationNotificationBinding } from '@obliance/shared';
import { NotificationChannelBindings } from '@/components/automation/NotificationChannelBindings';
import { ToggleSwitch } from '@/components/common/ToggleSwitch';
import toast from 'react-hot-toast';
import { clsx } from 'clsx';

/** Convert an ISO/UTC date string to a local datetime-local input value */
function toLocalDatetimeString(isoString: string): string {
  const d = new Date(isoString);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

interface ScheduleFormData {
  name: string;
  description: string;
  scriptId: number | null;
  targetType: ScheduleTargetType;
  targetIds: number[];
  scheduleMode: 'cron' | 'once' | 'now';
  cronExpression: string;
  fireOnceAt: string;
  timezone: string;
  catchupEnabled: boolean;
  catchupMax: number;
  assertPass: boolean;
  notifyOnce: boolean;
  onFailureScenarioId: number | null;
  notificationChannels: AutomationNotificationBinding[];
  /** Optional override for the script's default timeout. Empty = use script default. */
  timeoutSeconds: number | null;
  skipIfInFlight: boolean;
  enabled: boolean;
}

const defaultForm: ScheduleFormData = {
  name: '',
  description: '',
  scriptId: null,
  targetType: 'all',
  targetIds: [],
  scheduleMode: 'cron',
  cronExpression: '0 2 * * *',
  fireOnceAt: '',
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  catchupEnabled: false,
  catchupMax: 3,
  assertPass: false,
  notifyOnce: false,
  onFailureScenarioId: null,
  notificationChannels: [],
  timeoutSeconds: null,
  skipIfInFlight: true,
  enabled: true,
};

const COMMON_CRONS = [
  { label: 'Every hour', value: '0 * * * *' },
  { label: 'Every day at 2am', value: '0 2 * * *' },
  { label: 'Every Monday at 9am', value: '0 9 * * 1' },
  { label: 'Every Sunday at midnight', value: '0 0 * * 0' },
  { label: 'Every 15 minutes', value: '*/15 * * * *' },
];

function StatusBadge({ enabled }: { enabled: boolean }) {
  return (
    <span className={clsx('text-xs px-2 py-0.5 rounded-full border font-medium', enabled ? 'text-green-400 bg-green-400/10 border-green-400/30' : 'text-gray-400 bg-gray-400/10 border-gray-400/30')}>
      {enabled ? 'Active' : 'Paused'}
    </span>
  );
}

function formatDate(val: string | null) {
  if (!val) return '—';
  return new Date(val).toLocaleString();
}

// ── History batch row (expandable, with per-device stdout/stderr) ────────────

interface BatchItem {
  id: string; status: string; exitCode: number | null;
  stdout: string | null; stderr: string | null;
  triggeredAt: string; startedAt: string | null; finishedAt: string | null;
  deviceId: number; deviceName: string; deviceOsType?: string | null;
}

interface BatchData {
  batchId: string; triggeredAt: string; triggeredBy: string | null;
  total: number; ok: number; fail: number; pending: number;
  items: BatchItem[];
}

function statusBadge(s: string) {
  const c =
    s === 'success' ? 'text-green-400 border-green-400/30 bg-green-400/10' :
    s === 'failure' ? 'text-red-400 border-red-400/30 bg-red-400/10' :
    s === 'timeout' ? 'text-orange-400 border-orange-400/30 bg-orange-400/10' :
    s === 'running' || s === 'sent' || s === 'pending' ? 'text-blue-400 border-blue-400/30 bg-blue-400/10' :
    s === 'skipped' ? 'text-yellow-400 border-yellow-400/30 bg-yellow-400/10' :
    'text-text-muted border-border bg-bg-tertiary';
  return <span className={`shrink-0 px-1.5 py-0.5 rounded-full border font-medium capitalize text-[10px] ${c}`}>{s}</span>;
}

function fmtDuration(startedAt: string | null, finishedAt: string | null) {
  if (!startedAt || !finishedAt) return null;
  const ms = Math.max(0, new Date(finishedAt).getTime() - new Date(startedAt).getTime());
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function HistoryBatchRow({ batch }: { batch: BatchData }) {
  const [open, setOpen] = useState(false);
  const [expandedExecId, setExpandedExecId] = useState<string | null>(null);
  const { ok, fail, pending, total, items } = batch;
  const isSingle = total === 1;
  const allOk = ok === total;

  return (
    <div className="rounded border border-border/50 bg-bg-secondary overflow-hidden">
      {/* Summary row */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 text-xs px-2 py-1.5 text-left hover:bg-bg-tertiary/50 cursor-pointer"
      >
        {open
          ? <ChevronDown className="w-3 h-3 text-text-muted shrink-0" />
          : <ChevronRight className="w-3 h-3 text-text-muted shrink-0" />
        }
        <span className="text-text-muted shrink-0">{new Date(batch.triggeredAt).toLocaleString()}</span>

        {isSingle ? (
          <>
            {statusBadge(items[0].status)}
            <span className="text-text-primary font-medium truncate flex-1">{items[0].deviceName}</span>
            {items[0].exitCode != null && <span className="text-text-muted shrink-0 font-mono">exit {items[0].exitCode}</span>}
            {fmtDuration(items[0].startedAt, items[0].finishedAt) && (
              <span className="text-text-muted shrink-0">{fmtDuration(items[0].startedAt, items[0].finishedAt)}</span>
            )}
          </>
        ) : (
          <>
            {allOk ? (
              <span className="text-green-400 font-medium">All OK</span>
            ) : (
              <span className="font-medium flex items-center gap-1">
                {ok > 0 && <span className="text-green-400">{ok} OK</span>}
                {ok > 0 && (fail > 0 || pending > 0) && <span className="text-text-muted">·</span>}
                {fail > 0 && <span className="text-red-400">{fail} failed</span>}
                {fail > 0 && pending > 0 && <span className="text-text-muted">·</span>}
                {pending > 0 && <span className="text-blue-400">{pending} in progress</span>}
              </span>
            )}
            <span className="text-text-muted">({total} device{total > 1 ? 's' : ''})</span>
          </>
        )}
      </button>

      {/* Expanded: per-device rows */}
      {open && (
        <div className="border-t border-border/30">
          {items.map((r) => {
            const isExpanded = expandedExecId === r.id;
            const dur = fmtDuration(r.startedAt, r.finishedAt);
            return (
              <div key={r.id} className="border-b border-border/20 last:border-b-0">
                {/* Device row */}
                <div
                  className="flex items-center gap-2 text-xs px-3 py-1.5 hover:bg-bg-tertiary/30 cursor-pointer"
                  onClick={() => setExpandedExecId(isExpanded ? null : r.id)}
                >
                  {isExpanded
                    ? <ChevronDown className="w-3 h-3 text-text-muted shrink-0" />
                    : <ChevronRight className="w-3 h-3 text-text-muted shrink-0" />
                  }
                  {statusBadge(r.status)}
                  <span className="text-text-primary font-medium truncate flex-1 min-w-0">{r.deviceName}</span>
                  {r.exitCode != null && <span className="text-text-muted shrink-0 font-mono">exit {r.exitCode}</span>}
                  {dur && <span className="text-text-muted shrink-0">{dur}</span>}
                  <Link
                    to={`/devices/${r.deviceId}`}
                    onClick={(e) => e.stopPropagation()}
                    className="shrink-0 text-text-muted hover:text-accent transition-colors p-0.5 rounded hover:bg-accent/10"
                    title="Open device"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </Link>
                </div>

                {/* Expanded: stdout/stderr */}
                {isExpanded && (
                  <div className="px-4 py-2 bg-[#0d0f14] border-t border-border/20 space-y-2">
                    {r.stdout && (
                      <div>
                        <p className="text-[10px] text-green-400/70 uppercase font-medium mb-0.5">stdout</p>
                        <pre className="text-[11px] text-green-300/90 font-mono whitespace-pre-wrap break-all max-h-40 overflow-y-auto scrollbar-thin">
                          {r.stdout}
                        </pre>
                      </div>
                    )}
                    {r.stderr && (
                      <div>
                        <p className="text-[10px] text-red-400/70 uppercase font-medium mb-0.5">stderr</p>
                        <pre className="text-[11px] text-red-300/90 font-mono whitespace-pre-wrap break-all max-h-40 overflow-y-auto scrollbar-thin">
                          {r.stderr}
                        </pre>
                      </div>
                    )}
                    {!r.stdout && !r.stderr && (
                      <p className="text-[10px] text-text-muted italic">No output captured.</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function ScriptSchedulesPage({ embedded }: { embedded?: boolean } = {}) {
  const [schedules, setSchedules] = useState<ScriptSchedule[]>([]);
  const [scripts, setScripts] = useState<Script[]>([]);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<ScriptSchedule | null>(null);
  const [form, setForm] = useState<ScheduleFormData>(defaultForm);
  const [isSaving, setIsSaving] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [historyByScheduleId, setHistoryByScheduleId] = useState<Record<number, Awaited<ReturnType<typeof scriptApi.getScheduleHistory>>>>({});
  const [loadingHistoryId, setLoadingHistoryId] = useState<number | null>(null);

  const loadScheduleHistory = useCallback(async (scheduleId: number) => {
    setLoadingHistoryId(scheduleId);
    try {
      const rows = await scriptApi.getScheduleHistory(scheduleId, 10);
      setHistoryByScheduleId((prev) => ({ ...prev, [scheduleId]: rows }));
    } catch {
      toast.error('Failed to load schedule history');
    } finally {
      setLoadingHistoryId(null);
    }
  }, []);

  const { fetchGroups } = useGroupStore();

  /**
   * Load schedules/scripts/scenarios.
   *
   * `showSpinner` controls whether the loading spinner replaces the list
   * during the fetch. We only show it on the very first load — subsequent
   * polls keep the list rendered and just swap in the new data, avoiding
   * the flash/blink effect that happens when the DOM gets unmounted.
   */
  const load = useCallback(async (showSpinner = false) => {
    if (showSpinner) setIsLoading(true);
    try {
      const [schedList, scriptList, scenarioList] = await Promise.all([
        scriptApi.listSchedules(),
        scriptApi.list(),
        scenarioApi.list(),
      ]);
      setSchedules(schedList);
      setScripts(scriptList);
      setScenarios(scenarioList);
    } catch {
      if (showSpinner) toast.error('Failed to load schedules');
    } finally {
      if (showSpinner) setIsLoading(false);
    }
  }, []);

  // Initial mount — show spinner once.
  useEffect(() => { load(true); }, [load]);

  // Background refresh every 60s. No spinner, no blink — just swaps data.
  useEffect(() => {
    const id = setInterval(() => load(false), 60_000);
    return () => clearInterval(id);
  }, [load]);
  useEffect(() => { fetchGroups(); }, [fetchGroups]);

  const handleOpenCreate = () => {
    setForm(defaultForm);
    setEditingSchedule(null);
    setShowForm(true);
  };

  const handleOpenEdit = (schedule: ScriptSchedule) => {
    setForm({
      name: schedule.name,
      description: schedule.description ?? '',
      scriptId: schedule.scriptId,
      targetType: schedule.targetType,
      targetIds: schedule.targetIds ?? [],
      scheduleMode: schedule.cronExpression ? 'cron' : 'once',
      cronExpression: schedule.cronExpression ?? '0 2 * * *',
      fireOnceAt: schedule.fireOnceAt ? toLocalDatetimeString(schedule.fireOnceAt) : '',
      timezone: schedule.timezone,
      catchupEnabled: schedule.catchupEnabled,
      catchupMax: schedule.catchupMax,
      assertPass: schedule.assertPass ?? false,
      notifyOnce: schedule.notifyOnce ?? false,
      onFailureScenarioId: schedule.onFailureScenarioId ?? null,
      notificationChannels: schedule.notificationChannels ?? [],
      timeoutSeconds: schedule.timeoutSeconds ?? null,
      skipIfInFlight: schedule.skipIfInFlight ?? true,
      enabled: schedule.enabled,
    });
    setEditingSchedule(schedule);
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error('Name is required'); return; }
    if (!form.scriptId) { toast.error('Script is required'); return; }
    if (form.scheduleMode === 'once' && !form.fireOnceAt) { toast.error('Fire date is required'); return; }
    if (form.scheduleMode === 'once' && new Date(form.fireOnceAt) <= new Date()) { toast.error('Fire date must be in the future'); return; }
    if (form.scheduleMode === 'cron' && !form.cronExpression.trim()) { toast.error('Cron expression is required'); return; }

    setIsSaving(true);
    try {
      const payload = {
        name: form.name,
        description: form.description || null,
        scriptId: form.scriptId,
        targetType: form.targetType,
        targetIds: form.targetIds,
        cronExpression: form.scheduleMode === 'cron' ? form.cronExpression : null,
        fireOnceAt: form.scheduleMode === 'now' ? new Date().toISOString() : form.scheduleMode === 'once' ? new Date(form.fireOnceAt).toISOString() : null,
        timezone: form.timezone,
        catchupEnabled: form.catchupEnabled,
        catchupMax: form.catchupMax,
        assertPass: form.assertPass,
        notifyOnce: form.notifyOnce,
        onFailureScenarioId: form.assertPass ? form.onFailureScenarioId : null,
        notificationChannels: form.notificationChannels,
        timeoutSeconds: form.timeoutSeconds,
        skipIfInFlight: form.skipIfInFlight,
        enabled: form.scheduleMode === 'now' ? true : form.enabled,
        parameterValues: {},
        runConditions: [],
        tenantId: 0,
      };
      if (editingSchedule) {
        await scriptApi.updateSchedule(editingSchedule.id, payload);
        toast.success('Schedule updated');
      } else {
        await scriptApi.createSchedule(payload as any);
        toast.success('Schedule created');
      }
      setShowForm(false);
      setEditingSchedule(null);
      await load();
    } catch {
      toast.error('Failed to save schedule');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (schedule: ScriptSchedule) => {
    if (!confirm(`Delete schedule "${schedule.name}"?`)) return;
    try {
      await scriptApi.deleteSchedule(schedule.id);
      toast.success('Schedule deleted');
      await load();
    } catch {
      toast.error('Failed to delete schedule');
    }
  };

  const handleToggle = async (schedule: ScriptSchedule) => {
    try {
      await scriptApi.updateSchedule(schedule.id, { enabled: !schedule.enabled });
      toast.success(schedule.enabled ? 'Schedule paused' : 'Schedule activated');
      await load();
    } catch {
      toast.error('Failed to update schedule');
    }
  };



  return (
    <div className={embedded ? 'space-y-6' : 'p-6 space-y-6'}>
      {!embedded && <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Script Schedules</h1>
          <p className="text-sm text-text-muted mt-0.5">Automate script execution on a schedule</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => load(true)} className="p-2 text-text-muted hover:text-text-primary hover:bg-bg-secondary rounded-lg transition-colors">
            <RefreshCw className={clsx('w-4 h-4', isLoading && 'animate-spin')} />
          </button>
          <button
            onClick={handleOpenCreate}
            className="flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-lg hover:bg-accent/80 text-sm transition-colors"
          >
            <Plus className="w-4 h-4" />
            New Schedule
          </button>
        </div>
      </div>}

      {/* Embedded header with actions */}
      {embedded && (
        <div className="flex items-center justify-end gap-2">
          <button onClick={() => load(true)} className="p-2 text-text-muted hover:text-text-primary hover:bg-bg-secondary rounded-lg transition-colors">
            <RefreshCw className={clsx('w-4 h-4', isLoading && 'animate-spin')} />
          </button>
          <button
            onClick={handleOpenCreate}
            className="flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-lg hover:bg-accent/80 text-sm transition-colors"
          >
            <Plus className="w-4 h-4" />
            New Schedule
          </button>
        </div>
      )}

      {/* Form panel */}
      {showForm && (
        <div className="bg-bg-secondary border border-border rounded-xl p-6 space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-text-primary">{editingSchedule ? 'Edit Schedule' : 'New Schedule'}</h2>
            <div className="flex gap-2">
              <button
                onClick={() => { setShowForm(false); setEditingSchedule(null); }}
                className="px-4 py-2 text-sm text-text-muted hover:text-text-primary border border-border rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="px-4 py-2 text-sm bg-accent text-white rounded-lg hover:bg-accent/80 disabled:opacity-50 transition-colors"
              >
                {isSaving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-medium text-text-muted uppercase">Name *</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full px-3 py-2 text-sm bg-bg-tertiary border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-text-muted uppercase">Script *</label>
              <select
                value={form.scriptId ?? ''}
                onChange={(e) => setForm({ ...form, scriptId: e.target.value ? parseInt(e.target.value, 10) : null })}
                className="w-full px-3 py-2 text-sm bg-bg-tertiary border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent"
              >
                <option value="">Select script...</option>
                {scripts.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-text-muted uppercase">Target</label>
              <div className="flex gap-2">
                {(['all', 'group'] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setForm({ ...form, targetType: t, targetIds: [] })}
                    className={clsx(
                      'flex-1 py-2 text-sm rounded-lg border transition-colors',
                      form.targetType === t ? 'bg-accent/10 border-accent text-accent' : 'border-border text-text-muted hover:border-accent/50',
                    )}
                  >
                    {t === 'all' ? 'All devices' : 'By group'}
                  </button>
                ))}
              </div>
            </div>
            {form.targetType === 'group' && (
              <div className="space-y-1">
                <label className="text-xs font-medium text-text-muted uppercase">Groups</label>
                <GroupTreeMultiSelect
                  selectedIds={form.targetIds}
                  onChange={(ids) => setForm({ ...form, targetIds: ids })}
                />
              </div>
            )}
            <div className="space-y-1">
              <label className="text-xs font-medium text-text-muted uppercase">Schedule Type</label>
              <div className="flex gap-2">
                <button
                  onClick={() => setForm({ ...form, scheduleMode: 'cron' })}
                  className={clsx('flex-1 py-2 text-sm rounded-lg border transition-colors', form.scheduleMode === 'cron' ? 'bg-accent/10 border-accent text-accent' : 'border-border text-text-muted hover:border-accent/50')}
                >
                  Recurring (cron)
                </button>
                <button
                  onClick={() => setForm({ ...form, scheduleMode: 'once' })}
                  className={clsx('flex-1 py-2 text-sm rounded-lg border transition-colors', form.scheduleMode === 'once' ? 'bg-accent/10 border-accent text-accent' : 'border-border text-text-muted hover:border-accent/50')}
                >
                  One-time
                </button>
                <button
                  onClick={() => setForm({ ...form, scheduleMode: 'now' })}
                  className={clsx('flex-1 py-2 text-sm rounded-lg border transition-colors', form.scheduleMode === 'now' ? 'bg-accent/10 border-accent text-accent' : 'border-border text-text-muted hover:border-accent/50')}
                >
                  Now
                </button>
              </div>
            </div>
            {form.scheduleMode === 'cron' ? (
              <div className="space-y-1">
                <label className="text-xs font-medium text-text-muted uppercase">Cron Expression</label>
                <input
                  value={form.cronExpression}
                  onChange={(e) => setForm({ ...form, cronExpression: e.target.value })}
                  className="w-full px-3 py-2 text-sm bg-bg-tertiary border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent font-mono"
                  placeholder="0 2 * * *"
                />
                <div className="flex flex-wrap gap-1 mt-1">
                  {COMMON_CRONS.map((c) => (
                    <button
                      key={c.value}
                      onClick={() => setForm({ ...form, cronExpression: c.value })}
                      className="text-xs px-2 py-0.5 bg-bg-tertiary border border-border rounded hover:border-accent/50 text-text-muted hover:text-text-primary transition-colors"
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : form.scheduleMode === 'once' ? (
              <div className="space-y-1">
                <label className="text-xs font-medium text-text-muted uppercase">Run At</label>
                <input
                  type="datetime-local"
                  value={form.fireOnceAt}
                  min={new Date().toISOString().slice(0, 16)}
                  onChange={(e) => setForm({ ...form, fireOnceAt: e.target.value })}
                  className="w-full px-3 py-2 text-sm bg-bg-tertiary border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent"
                />
              </div>
            ) : (
              <div className="px-3 py-2 text-sm bg-bg-tertiary border border-border rounded-lg text-text-muted">
                The script will execute immediately on all targets when saved.
              </div>
            )}
            <div className="space-y-1">
              <label className="text-xs font-medium text-text-muted uppercase">Timezone</label>
              <select
                value={form.timezone}
                onChange={(e) => setForm({ ...form, timezone: e.target.value })}
                className="w-full px-3 py-2 text-sm bg-bg-tertiary border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent"
              >
                {(typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [
                  'UTC','Europe/Paris','Europe/London','Europe/Berlin','Europe/Rome','Europe/Madrid',
                  'Europe/Brussels','Europe/Amsterdam','Europe/Zurich','Europe/Vienna','Europe/Warsaw',
                  'Europe/Prague','Europe/Stockholm','Europe/Copenhagen','Europe/Helsinki','Europe/Oslo',
                  'Europe/Lisbon','Europe/Dublin','Europe/Athens','Europe/Bucharest','Europe/Istanbul',
                  'Europe/Moscow','Europe/Kiev','America/New_York','America/Chicago','America/Denver',
                  'America/Los_Angeles','America/Toronto','America/Vancouver','America/Mexico_City',
                  'America/Sao_Paulo','America/Argentina/Buenos_Aires','America/Bogota','America/Lima',
                  'Asia/Tokyo','Asia/Shanghai','Asia/Hong_Kong','Asia/Seoul','Asia/Singapore',
                  'Asia/Dubai','Asia/Kolkata','Asia/Bangkok','Asia/Jakarta','Asia/Taipei',
                  'Australia/Sydney','Australia/Melbourne','Pacific/Auckland','Africa/Cairo',
                  'Africa/Johannesburg','Africa/Lagos','Africa/Casablanca',
                ]).map(tz => <option key={tz} value={tz}>{tz.replace(/_/g, ' ')}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-text-muted uppercase">Description</label>
              <input
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                className="w-full px-3 py-2 text-sm bg-bg-tertiary border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent"
              />
            </div>
          </div>

          <div className="flex items-center gap-2 pt-2 border-t border-border">
            <span className="text-sm text-text-muted whitespace-nowrap">Timeout override:</span>
            <input
              type="number"
              min={0}
              placeholder="(script default)"
              value={form.timeoutSeconds ?? ''}
              onChange={(e) => {
                const raw = e.target.value;
                if (raw === '') setForm({ ...form, timeoutSeconds: null });
                else setForm({ ...form, timeoutSeconds: Math.max(0, parseInt(raw, 10) || 0) });
              }}
              className="w-28 px-2 py-1 text-sm bg-bg-tertiary border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent"
            />
            <span className="text-xs text-text-muted">seconds — empty = use script default, 0 = no timeout</span>
          </div>

          <div className="pt-2">
            <ToggleSwitch
              checked={form.skipIfInFlight}
              onChange={(v) => setForm({ ...form, skipIfInFlight: v })}
              label="Skip if still running"
              description="On each tick, skip devices whose previous run hasn't finished yet."
            />
          </div>

          <div className="flex flex-wrap gap-6 pt-2">
            <ToggleSwitch
              checked={form.enabled}
              onChange={(v) => setForm({ ...form, enabled: v })}
              label="Enabled"
            />
            <ToggleSwitch
              checked={form.catchupEnabled}
              onChange={(v) => setForm({ ...form, catchupEnabled: v })}
              label="Enable catchup"
            />
            {form.catchupEnabled && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-text-muted">Max catchup runs:</span>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={form.catchupMax}
                  onChange={(e) => setForm({ ...form, catchupMax: parseInt(e.target.value, 10) || 3 })}
                  className="w-16 px-2 py-1 text-sm bg-bg-tertiary border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent"
                />
              </div>
            )}
            <ToggleSwitch
              checked={form.assertPass}
              onChange={(v) => setForm({ ...form, assertPass: v })}
              label="Assert pass"
            />
            {form.assertPass && (
              <p className="text-xs text-orange-400/80 ml-6">If the script exits with a non-zero code, the device will show a "Schedule Error" status and a notification will be sent.</p>
            )}
            {form.assertPass && (
              <div className="ml-6">
                <ToggleSwitch
                  checked={form.notifyOnce}
                  onChange={(v) => setForm({ ...form, notifyOnce: v })}
                  label="Notify once"
                  size="sm"
                />
                <p className="text-[10px] text-text-muted mt-0.5 ml-10">Only send one alert per device until recovery — no repeated notifications on consecutive failures.</p>
              </div>
            )}
            {form.assertPass && (
              <div className="flex items-center gap-2 ml-6">
                <span className="text-sm text-text-muted whitespace-nowrap">On failure, trigger scenario:</span>
                <select
                  value={form.onFailureScenarioId ?? ''}
                  onChange={(e) => setForm({ ...form, onFailureScenarioId: e.target.value ? parseInt(e.target.value, 10) : null })}
                  className="px-3 py-1.5 text-sm bg-bg-tertiary border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent"
                >
                  <option value="">None</option>
                  {scenarios.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            )}

            {/* Notification channels */}
            <NotificationChannelBindings
              value={form.notificationChannels}
              onChange={(next) => setForm({ ...form, notificationChannels: next })}
            />
          </div>
        </div>
      )}

      {/* Schedules list */}
      {isLoading ? (
        <div className="flex items-center justify-center h-48">
          <RefreshCw className="w-5 h-5 animate-spin text-text-muted" />
        </div>
      ) : schedules.length === 0 ? (
        <div className="p-12 text-center text-text-muted bg-bg-secondary border border-border rounded-xl">
          <Calendar className="w-10 h-10 mx-auto mb-3 opacity-50" />
          <p className="font-medium text-text-primary mb-1">No schedules yet</p>
          <p className="text-sm">Create a schedule to automate script execution across your fleet.</p>
          <button
            onClick={handleOpenCreate}
            className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-lg hover:bg-accent/80 text-sm transition-colors"
          >
            <Plus className="w-4 h-4" />
            New Schedule
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {schedules.map((schedule) => {
            const expanded = expandedId === schedule.id;
            const script = scripts.find((s) => s.id === schedule.scriptId);
            return (
              <div key={schedule.id} className="bg-bg-secondary border border-border rounded-xl overflow-hidden">
                <div className="flex items-center gap-4 px-4 py-3">
                  <button
                    onClick={() => {
                      const newId = expanded ? null : schedule.id;
                      setExpandedId(newId);
                      if (newId !== null && !historyByScheduleId[schedule.id]) {
                        loadScheduleHistory(schedule.id);
                      }
                    }}
                    className="text-text-muted hover:text-text-primary transition-colors"
                  >
                    {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-text-primary">{schedule.name}</span>
                      <StatusBadge enabled={schedule.enabled} />
                    </div>
                    <div className="flex items-center gap-3 text-xs text-text-muted mt-0.5 flex-wrap">
                      <span className="flex items-center gap-1">
                        <Terminal className="w-3 h-3" />
                        {script?.name ?? `Script #${schedule.scriptId}`}
                      </span>
                      <span className={clsx(
                        'flex items-center gap-1',
                        schedule.resolvedDeviceCount === 0 && 'text-red-400',
                      )}>
                        <Play className="w-3 h-3" />
                        {(() => {
                          const resolved = schedule.resolvedDeviceCount ?? null;
                          const resolvedTxt = resolved == null ? '' : ` → ${resolved} device${resolved === 1 ? '' : 's'}`;
                          if (schedule.targetType === 'all') return `All devices${resolvedTxt}`;
                          const n = (schedule.targetIds ?? []).length;
                          return `${n} ${schedule.targetType}${n === 1 ? '' : 's'}${resolvedTxt}`;
                        })()}
                        {schedule.resolvedDeviceCount === 0 && (
                          <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded border border-red-400/40 bg-red-400/10">
                            empty target
                          </span>
                        )}
                      </span>
                      <span className="flex items-center gap-1 font-mono">
                        <Clock className="w-3 h-3" />
                        {schedule.cronExpression ?? 'One-time'}
                      </span>
                      {schedule.createdByName && (
                        <span className="flex items-center gap-1">
                          <User className="w-3 h-3" />
                          {schedule.createdByName}
                        </span>
                      )}
                      {schedule.updatedByName && schedule.updatedBy !== schedule.createdBy && (
                        <span className="text-text-muted/60">
                          (edited by {schedule.updatedByName})
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => handleToggle(schedule)}
                      className="text-text-muted hover:text-accent transition-colors"
                      title={schedule.enabled ? 'Pause schedule' : 'Activate schedule'}
                    >
                      {schedule.enabled ? <ToggleRight className="w-5 h-5 text-green-400" /> : <ToggleLeft className="w-5 h-5" />}
                    </button>
                    <button
                      onClick={() => handleOpenEdit(schedule)}
                      className="p-1.5 text-text-muted hover:text-text-primary hover:bg-bg-tertiary rounded transition-colors"
                    >
                      <Edit className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(schedule)}
                      className="p-1.5 text-text-muted hover:text-red-400 hover:bg-red-400/10 rounded transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                {expanded && (
                  <div className="border-t border-border px-4 py-3 grid grid-cols-2 md:grid-cols-4 gap-4 bg-bg-tertiary/50">
                    <div>
                      <p className="text-xs text-text-muted uppercase font-medium mb-0.5">Last run</p>
                      <p className="text-sm text-text-primary">{formatDate(schedule.lastRunAt)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-text-muted uppercase font-medium mb-0.5">Next run</p>
                      <p className="text-sm text-text-primary">{formatDate(schedule.nextRunAt)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-text-muted uppercase font-medium mb-0.5">Timezone</p>
                      <p className="text-sm text-text-primary">{schedule.timezone}</p>
                    </div>
                    <div>
                      <p className="text-xs text-text-muted uppercase font-medium mb-0.5">Catchup</p>
                      <p className="text-sm text-text-primary">
                        {schedule.catchupEnabled ? `Yes (max ${schedule.catchupMax})` : 'No'}
                        {schedule.assertPass && (
                          <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-orange-400/10 text-orange-400 border border-orange-400/20">
                            Assert
                          </span>
                        )}
                      </p>
                    </div>
                    {schedule.description && (
                      <div className="md:col-span-4">
                        <p className="text-xs text-text-muted uppercase font-medium mb-0.5">Description</p>
                        <p className="text-sm text-text-primary">{schedule.description}</p>
                      </div>
                    )}

                    {/* History — last executions, grouped by batch */}
                    <div className="md:col-span-4 pt-3 border-t border-border/50">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-xs text-text-muted uppercase font-medium">Recent history</p>
                        <button
                          onClick={() => loadScheduleHistory(schedule.id)}
                          disabled={loadingHistoryId === schedule.id}
                          className="text-[10px] px-2 py-0.5 rounded border border-border text-text-muted hover:text-text-primary hover:border-accent/40 transition-colors"
                        >
                          {loadingHistoryId === schedule.id ? 'Loading...' : 'Refresh'}
                        </button>
                      </div>
                      {(() => {
                        const batches = historyByScheduleId[schedule.id];
                        if (!batches) return <p className="text-xs text-text-muted italic">Loading history...</p>;
                        if (batches.length === 0) return (
                          <p className="text-xs text-text-muted italic">
                            No executions yet.{' '}
                            {schedule.lastRunAt && 'Schedule has ticked but no history rows were created — check server logs for dispatch errors (missing script, offline device, etc.).'}
                          </p>
                        );
                        return (
                          <div className="space-y-1.5">
                            {batches.map((batch) => (
                              <HistoryBatchRow key={batch.batchId} batch={batch} />
                            ))}
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Inline Group Tree Multi-Select ──

function GroupTreeMultiSelect({ selectedIds, onChange }: { selectedIds: number[]; onChange: (ids: number[]) => void }) {
  const [tree, setTree] = useState<DeviceGroupTreeNode[]>([]);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  useEffect(() => {
    groupsApi.tree().then((t) => {
      setTree(t);
      // Auto-expand all on first load
      const all = new Set<number>();
      const walk = (nodes: DeviceGroupTreeNode[]) => { for (const n of nodes) { all.add(n.id); walk(n.children); } };
      walk(t);
      setExpanded(all);
    }).catch(() => {});
  }, []);

  // Collect all descendant IDs of a node
  const getDescendantIds = (node: DeviceGroupTreeNode): number[] => {
    const ids: number[] = [];
    for (const c of node.children) { ids.push(c.id, ...getDescendantIds(c)); }
    return ids;
  };

  const selected = new Set(selectedIds);

  // Check state for a node: 'all' | 'some' | 'none'
  const getCheckState = (node: DeviceGroupTreeNode): 'all' | 'some' | 'none' => {
    const descendants = getDescendantIds(node);
    const selfSelected = selected.has(node.id);
    if (descendants.length === 0) return selfSelected ? 'all' : 'none';
    const allIds = [node.id, ...descendants];
    const selectedCount = allIds.filter((id) => selected.has(id)).length;
    if (selectedCount === allIds.length) return 'all';
    if (selectedCount > 0) return 'some';
    return 'none';
  };

  const toggleNode = (node: DeviceGroupTreeNode) => {
    const descendants = getDescendantIds(node);
    const allIds = [node.id, ...descendants];
    const state = getCheckState(node);

    let next: Set<number>;
    if (state === 'all') {
      // Deselect all
      next = new Set(selectedIds.filter((id) => !allIds.includes(id)));
    } else {
      // Select all
      next = new Set([...selectedIds, ...allIds]);
    }
    onChange(Array.from(next));
  };

  const toggleExpand = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const renderNode = (node: DeviceGroupTreeNode, depth: number) => {
    const hasChildren = node.children.length > 0;
    const isExpanded = expanded.has(node.id);
    const state = getCheckState(node);
    const count = node.total ?? node.deviceCount ?? 0;

    return (
      <div key={node.id}>
        <div
          className={clsx(
            'flex items-center gap-1.5 py-1.5 transition-colors rounded hover:bg-bg-hover',
            state === 'all' && 'bg-accent/5',
          )}
          style={{ paddingLeft: `${8 + depth * 20}px`, paddingRight: 8 }}
        >
          <button
            onClick={() => hasChildren && toggleExpand(node.id)}
            className={clsx('shrink-0 p-0.5 text-text-muted hover:text-text-primary transition-colors', !hasChildren && 'invisible')}
          >
            <ChevronRight className={clsx('w-3 h-3 transition-transform', isExpanded && 'rotate-90')} />
          </button>

          <button
            onClick={() => toggleNode(node)}
            className={clsx(
              'w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors',
              state === 'all' ? 'bg-accent border-accent text-white' :
              state === 'some' ? 'bg-accent/30 border-accent text-white' :
              'border-border hover:border-accent/50',
            )}
          >
            {state === 'all' && <Check className="w-3 h-3" />}
            {state === 'some' && <Minus className="w-3 h-3" />}
          </button>

          <FolderOpen className={clsx('w-3.5 h-3.5 shrink-0', state !== 'none' ? 'text-accent' : 'text-text-muted')} />
          <span
            className={clsx(
              'flex-1 text-sm truncate cursor-pointer',
              state !== 'none' ? 'text-text-primary font-medium' : 'text-text-primary',
            )}
            onClick={() => toggleNode(node)}
          >
            {node.name}
          </span>
          <span className="text-text-muted text-[10px] shrink-0">{count}</span>
        </div>
        {hasChildren && isExpanded && node.children.map((c) => renderNode(c, depth + 1))}
      </div>
    );
  };

  if (tree.length === 0) {
    return <p className="text-sm text-text-muted py-2">No groups available</p>;
  }

  return (
    <div className="rounded-lg border border-border bg-bg-tertiary max-h-60 overflow-y-auto py-1">
      {tree.map((n) => renderNode(n, 0))}
    </div>
  );
}
