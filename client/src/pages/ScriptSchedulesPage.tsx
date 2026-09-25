import { useEffect, useState, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Calendar, Clock, Play, Edit, Trash2, RefreshCw, ToggleLeft, ToggleRight, Terminal, ChevronDown, ChevronUp, ChevronRight, User, ExternalLink, Download } from 'lucide-react';
import { Link } from 'react-router-dom';
import { scriptApi } from '@/api/script.api';
import { scenarioApi } from '@/api/scenario.api';
import { useGroupStore } from '@/store/groupStore';
import type { Script, ScriptSchedule, ScheduleTargetType, Scenario, AutomationNotificationBinding } from '@obliance/shared';
import { NotificationChannelBindings } from '@/components/automation/NotificationChannelBindings';
import { GroupTreeMultiSelect } from '@/components/automation/GroupTreeMultiSelect';
import { StickyFormActions, useRevealOnOpen } from '@/components/automation/FormActions';
import { PageContainer } from '@/components/common/PageContainer';
import { IconButton } from '@/components/common/IconButton';
import { ActionMenu } from '@/components/common/ActionMenu';
import { Tip } from '@/components/common/Tip';
import { useConfirm } from '@/components/common/ConfirmDialog';
import { downloadUrl } from '@/utils/download';
import { useCanHover } from '@/hooks/useMediaQuery';
import { ToggleSwitch } from '@/components/common/ToggleSwitch';
import { DeviceMultiSelect } from '@/components/common/DeviceMultiSelect';
import { TargetTenantsPicker } from '@/components/common/TargetTenantsPicker';
import { TenantBadge } from '@/components/common/TenantBadge';
import { TenantFilterChips } from '@/components/common/TenantFilterChips';
import { useTenantFilter } from '@/hooks/useTenantFilter';
import { useTenantStore } from '@/store/tenantStore';
import { MASTER_TENANT_ID } from '@obliance/shared';
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
 bypassPrivacyMode: boolean;
 enabled: boolean;
 /** Master-only fan-out: extra tenants that see this schedule in
 * read-only. Null when the schedule is local. */
 targetTenantIds: number[] | null;
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
 bypassPrivacyMode: false,
 enabled: true,
 targetTenantIds: null,
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

/** Hint shown under a ToggleSwitch label on touch devices only (mouse users get the title= tooltip). */
function TouchHint({ text }: { text: string }) {
 return <span className="block can-hover:hidden">{text}</span>;
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
 'text-text-muted border-transparent bg-bg-tertiary';
 return <span className={`shrink-0 px-1.5 py-0.5 rounded-full border font-medium capitalize text-[10px] ${c}`}>{s}</span>;
}

function fmtDuration(startedAt: string | null, finishedAt: string | null) {
 if (!startedAt || !finishedAt) return null;
 const ms = Math.max(0, new Date(finishedAt).getTime() - new Date(startedAt).getTime());
 return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function HistoryBatchRow({ batch, scheduleId, scheduleName }: { batch: BatchData; scheduleId: number; scheduleName?: string }) {
 const { t } = useTranslation();
 const [open, setOpen] = useState(false);
 const [expandedExecId, setExpandedExecId] = useState<string | null>(null);
 const { ok, fail, pending, total, items } = batch;
 const isSingle = total === 1;
 const allOk = ok === total;

 return (
 <div className="rounded/50 bg-bg-secondary overflow-hidden">
 {/* Summary row */}
 <button
 onClick={() => setOpen((v) => !v)}
 aria-expanded={open}
 className="w-full flex items-center gap-2 max-sm:flex-wrap max-sm:gap-y-1 text-xs px-2 py-1.5 coarse:py-2.5 text-left hover:bg-bg-tertiary/50 cursor-pointer"
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
 <div className="/30">
 <div className="flex justify-end px-3 py-1.5">
 {/* Authenticated server route (Content-Disposition:
 attachment) — downloadUrl() goes through the Android
 DownloadManager with the session cookie in the app,
 and an <a download> in a browser. */}
 <button
 type="button"
 onClick={async (e) => {
 e.stopPropagation();
 // Explicit filename: the Android DownloadManager fixes the
 // destination before the request, so without it the file
 // would land as "export.bin". Mirrors the server's
 // Content-Disposition name (which still wins in browsers).
 const safeName = String(scheduleName || 'schedule').replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 60);
 const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
 const ok = await downloadUrl(
 `/api/schedules/${scheduleId}/history/${encodeURIComponent(batch.batchId)}/export`,
 `${safeName}-history-${stamp}.csv`,
 );
 if (!ok) toast.error(t('importExport.failedExport', 'Export failed'));
 }}
 className="flex items-center gap-1.5 px-2 py-1 coarse:min-h-10 coarse:px-3 text-[11px] font-medium text-text-muted hover:text-accent rounded hover:bg-accent/10 transition-colors"
 title={t('schedules.exportHistory', 'Export this run to CSV (full stdout/stderr)')}
 >
 <Download className="w-3.5 h-3.5" /> {t('schedules.exportCsv', 'Export CSV')}
 </button>
 </div>
 {items.map((r) => {
 const isExpanded = expandedExecId === r.id;
 const dur = fmtDuration(r.startedAt, r.finishedAt);
 return (
 <div key={r.id} className="/20 last:border-b-0">
 {/* Device row */}
 <div
 className="flex items-center gap-2 text-xs px-3 py-1.5 coarse:py-0.5 hover:bg-bg-tertiary/30 cursor-pointer"
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
 className="shrink-0 inline-flex items-center justify-center text-text-muted hover:text-accent transition-colors p-0.5 coarse:min-h-10 coarse:min-w-10 rounded hover:bg-accent/10"
 title={t('schedules.openDevice', 'Open device')}
 aria-label={t('schedules.openDevice', 'Open device')}
 >
 <ExternalLink className="w-3.5 h-3.5" />
 </Link>
 </div>

 {/* Expanded: stdout/stderr */}
 {isExpanded && (
 <div className="px-4 py-2 bg-[#0d0f14] /20 space-y-2">
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
 const { t } = useTranslation();
 const currentTenantId = useTenantStore((s) => s.currentTenantId);
 /** A schedule is read-only when it's owned by another tenant AND we're
 * not on the master tenant. Master always has god-view edit rights. */
 const isReadOnlyForCaller = (s: ScriptSchedule): boolean => {
 if (currentTenantId === MASTER_TENANT_ID) return false;
 return s.tenantId !== currentTenantId;
 };
 const tenantFilter = useTenantFilter();
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
 const confirm = useConfirm();
 const canHover = useCanHover();
 // The inline form opens above the list: bring it into view on phone /
 // tablet so tapping Edit on a lower row visibly does something.
 const formRef = useRef<HTMLDivElement>(null);
 useRevealOnOpen(formRef, showForm ? (editingSchedule?.id ?? 'new') : null);
 const readOnlyReason = t('automations.readOnlyMaster', 'Managed by the Default tenant — read-only');
 // Toggle explanations: title= tooltip with a mouse, inline caption on touch.
 const toggleHints = {
 enabled: t('schedules.enabledHint', 'When off, the cron loop ignores this schedule entirely — no ticks, no history.'),
 skipIfInFlight: t('schedules.skipIfRunningHint', "On each tick, skip devices whose previous execution hasn't finished yet. Prevents overlapping runs on slow hosts."),
 catchup: t('schedules.catchupHint', 'If the server was down during a scheduled tick, run it once the server is back (bounded by Max catchup runs).'),
 assertPass: t('schedules.assertPassTooltip', 'When the script exits non-zero, mark the device with a "Schedule Error" status and fire a notification. Leave off for pure-metric scripts where a non-zero exit is expected behaviour.'),
 notifyOnce: t('schedules.notifyOnceTooltip', 'Dedupe repeated failure notifications per device: one alert when it starts failing, silence until it recovers. Applies to Assert Pass alerts.'),
 bypassPrivacy: t('schedules.privacyBypass.hint', "When off (default), devices in privacy mode are skipped silently. When on, the schedule runs on them too — overrides the user's explicit privacy choice. Enabling this may require admin approval depending on the tenant's restriction settings."),
 };

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
 bypassPrivacyMode: !!schedule.bypassPrivacyMode,
 enabled: schedule.enabled,
 targetTenantIds: schedule.targetTenantIds ?? null,
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
 bypassPrivacyMode: form.bypassPrivacyMode,
 enabled: form.scheduleMode === 'now' ? true : form.enabled,
 // Master-only fan-out — server ignores from non-master callers.
 targetTenantIds: form.targetTenantIds,
 parameterValues: {},
 runConditions: [],
 tenantId: 0,
 };
 if (editingSchedule) {
 // 202 + pending_approval indicates the bypass-privacy flip is gated
 // by the action-restriction matrix and now awaits second-admin sign-
 // off. Axios passes 202 as success, so we sniff the body shape.
 const out = (await scriptApi.updateSchedule(editingSchedule.id, payload)) as any;
 if (out && out.status === 'pending_approval') {
 toast.success(t('schedules.privacyBypass.pendingApprovalToast') || 'Schedule saved — privacy-bypass toggle awaiting admin approval', { duration: 6000 });
 } else {
 toast.success('Schedule updated');
 }
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
 if (!(await confirm({
 message: t('schedules.deleteConfirmNamed', { name: schedule.name, defaultValue: 'Delete schedule "{{name}}"?' }),
 danger: true,
 }))) return;
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



 const refreshButton = (
 <IconButton
 label={t('common.refresh', 'Refresh')}
 onClick={() => load(true)}
 size="lg"
 icon={<RefreshCw className={clsx('w-4 h-4', isLoading && 'animate-spin')} />}
 className="rounded-lg hover:bg-bg-secondary"
 />
 );

 const closeForm = () => { setShowForm(false); setEditingSchedule(null); };

 return (
 <PageContainer embedded={embedded} className="space-y-6">
 {!embedded && <div className="flex flex-wrap items-center justify-between gap-3">
 <div className="min-w-0">
 <h1 className="text-2xl font-bold text-text-primary">Script Schedules</h1>
 <p className="text-sm text-text-muted mt-0.5">Automate script execution on a schedule</p>
 </div>
 <div className="flex gap-2">
 {refreshButton}
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
 {refreshButton}
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
 <div ref={formRef} className="bg-bg-secondary rounded-xl p-3 sm:p-4 lg:p-6 space-y-5 scroll-mt-3">
 <div className="flex items-center justify-between">
 <h2 className="text-lg font-semibold text-text-primary">{editingSchedule ? 'Edit Schedule' : 'New Schedule'}</h2>
 {/* Below md the Save / Cancel pair lives in the sticky bar at the bottom of the form. */}
 <div className="hidden md:flex gap-2">
 <button
 onClick={closeForm}
 className="px-4 py-2 text-sm text-text-muted hover:text-text-primary rounded-lg transition-colors"
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

 {/* Master-only fan-out picker. Hidden automatically on
 child tenants — child admins can only create local schedules. */}
 <TargetTenantsPicker
 value={form.targetTenantIds}
 onChange={(next) => setForm({ ...form, targetTenantIds: next })}
 />

 <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
 <div className="space-y-1">
 <label className="text-xs font-medium text-text-muted uppercase">Name *</label>
 <input
 value={form.name}
 onChange={(e) => setForm({ ...form, name: e.target.value })}
 className="w-full px-3 py-2 text-sm bg-bg-tertiary rounded-lg text-text-primary focus:outline-none focus:border-accent"
 />
 </div>
 <div className="space-y-1">
 <label className="text-xs font-medium text-text-muted uppercase">Script *</label>
 <select
 value={form.scriptId ?? ''}
 onChange={(e) => setForm({ ...form, scriptId: e.target.value ? parseInt(e.target.value, 10) : null })}
 className="w-full px-3 py-2 text-sm bg-bg-tertiary rounded-lg text-text-primary focus:outline-none focus:border-accent"
 >
 <option value="">Select script...</option>
 {scripts.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
 </select>
 </div>
 <div className="space-y-1">
 <label className="text-xs font-medium text-text-muted uppercase">Target</label>
 <div className="flex gap-2">
 {(['all', 'group', 'device'] as const).map((t) => (
 <button
 key={t}
 onClick={() => setForm({ ...form, targetType: t, targetIds: [] })}
 className={clsx(
 'flex-1 py-2 text-sm rounded-lg border transition-colors',
 form.targetType === t ? 'bg-accent/10 border-accent text-accent' : 'border-transparent text-text-muted hover:border-accent/50',
 )}
 >
 {t === 'all' ? 'All devices' : t === 'group' ? 'By group' : 'By device'}
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
 {form.targetType === 'device' && (
 <div className="space-y-1">
 <label className="text-xs font-medium text-text-muted uppercase">Devices</label>
 <DeviceMultiSelect
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
 className={clsx('flex-1 py-2 text-sm rounded-lg border transition-colors', form.scheduleMode === 'cron' ? 'bg-accent/10 border-accent text-accent' : 'border-transparent text-text-muted hover:border-accent/50')}
 >
 Recurring (cron)
 </button>
 <button
 onClick={() => setForm({ ...form, scheduleMode: 'once' })}
 className={clsx('flex-1 py-2 text-sm rounded-lg border transition-colors', form.scheduleMode === 'once' ? 'bg-accent/10 border-accent text-accent' : 'border-transparent text-text-muted hover:border-accent/50')}
 >
 One-time
 </button>
 <button
 onClick={() => setForm({ ...form, scheduleMode: 'now' })}
 className={clsx('flex-1 py-2 text-sm rounded-lg border transition-colors', form.scheduleMode === 'now' ? 'bg-accent/10 border-accent text-accent' : 'border-transparent text-text-muted hover:border-accent/50')}
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
 className="w-full px-3 py-2 text-sm bg-bg-tertiary rounded-lg text-text-primary focus:outline-none focus:border-accent font-mono"
 placeholder="0 2 * * *"
 autoCapitalize="off"
 autoCorrect="off"
 autoComplete="off"
 spellCheck={false}
 />
 <div className="flex flex-wrap gap-1 coarse:gap-1.5 mt-1">
 {COMMON_CRONS.map((c) => (
 <button
 key={c.value}
 onClick={() => setForm({ ...form, cronExpression: c.value })}
 className="text-xs px-2 py-0.5 coarse:px-2.5 coarse:py-1.5 bg-bg-tertiary rounded hover:border-accent/50 text-text-muted hover:text-text-primary transition-colors"
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
 className="w-full px-3 py-2 text-sm bg-bg-tertiary rounded-lg text-text-primary focus:outline-none focus:border-accent"
 />
 </div>
 ) : (
 <div className="px-3 py-2 text-sm bg-bg-tertiary rounded-lg text-text-muted">
 The script will execute immediately on all targets when saved.
 </div>
 )}
 <div className="space-y-1">
 <label className="text-xs font-medium text-text-muted uppercase">Timezone</label>
 <select
 value={form.timezone}
 onChange={(e) => setForm({ ...form, timezone: e.target.value })}
 className="w-full px-3 py-2 text-sm bg-bg-tertiary rounded-lg text-text-primary focus:outline-none focus:border-accent"
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
 className="w-full px-3 py-2 text-sm bg-bg-tertiary rounded-lg text-text-primary focus:outline-none focus:border-accent"
 />
 </div>
 </div>

 <div className="flex items-center gap-2 pt-2 max-sm:flex-wrap">
 <span className="text-sm text-text-muted whitespace-nowrap">Timeout override:</span>
 <input
 type="number"
 min={0}
 placeholder="(default)"
 value={form.timeoutSeconds ?? ''}
 onChange={(e) => {
 const raw = e.target.value;
 if (raw === '') setForm({ ...form, timeoutSeconds: null });
 else setForm({ ...form, timeoutSeconds: Math.max(0, parseInt(raw, 10) || 0) });
 }}
 className="w-28 px-2 py-1 text-sm bg-bg-tertiary rounded-lg text-text-primary focus:outline-none focus:border-accent"
 />
 <span className="text-xs text-text-muted max-sm:basis-full">seconds — empty = use script default, 0 = no timeout</span>
 </div>

 {/*
 Toggles block — kept on a single wrapping row, with each toggle
 isolated in its own flex item so Tailwind's gap-6 can flow them
 cleanly. The "Max catchup runs" input is grouped with its parent
 toggle so the pair never breaks apart on wrap. Tooltips are
 attached via `title` on the switch — the old inline <p> pushed
 other items to a new line and misaligned the row.
 */}
 {/* Touch devices never see title= tooltips: there the same hint
 is rendered as a caption under each label (hidden on mouse
 devices, so the desktop row is unchanged) and title is not
 passed, so ToggleSwitch does not add a redundant (i). Stacked
 below sm. */}
 <div className="flex flex-wrap gap-x-6 gap-y-3 pt-2 items-center max-sm:flex-col max-sm:items-stretch">
 <ToggleSwitch
 checked={form.enabled}
 onChange={(v) => setForm({ ...form, enabled: v })}
 label="Enabled"
 title={canHover ? toggleHints.enabled : undefined}
 description={<TouchHint text={toggleHints.enabled} />}
 />
 <ToggleSwitch
 checked={form.skipIfInFlight}
 onChange={(v) => setForm({ ...form, skipIfInFlight: v })}
 label="Skip if still running"
 title={canHover ? toggleHints.skipIfInFlight : undefined}
 description={<TouchHint text={toggleHints.skipIfInFlight} />}
 />
 <div className="flex items-center gap-2 max-sm:flex-wrap">
 <ToggleSwitch
 checked={form.catchupEnabled}
 onChange={(v) => setForm({ ...form, catchupEnabled: v })}
 label="Enable catchup"
 title={canHover ? toggleHints.catchup : undefined}
 description={<TouchHint text={toggleHints.catchup} />}
 />
 {form.catchupEnabled && (
 <>
 <span className="text-xs text-text-muted whitespace-nowrap">Max:</span>
 <input
 type="number"
 min={1}
 max={10}
 value={form.catchupMax}
 onChange={(e) => setForm({ ...form, catchupMax: parseInt(e.target.value, 10) || 3 })}
 className="w-14 px-2 py-1 text-sm bg-bg-tertiary rounded-lg text-text-primary focus:outline-none focus:border-accent"
 title="Maximum number of missed runs to catch up on."
 />
 </>
 )}
 </div>
 <ToggleSwitch
 checked={form.assertPass}
 onChange={(v) => setForm({ ...form, assertPass: v })}
 label="Assert pass"
 title={canHover ? toggleHints.assertPass : undefined}
 description={<TouchHint text={toggleHints.assertPass} />}
 />
 <ToggleSwitch
 checked={form.notifyOnce}
 onChange={(v) => setForm({ ...form, notifyOnce: v })}
 label="Notify once"
 title={canHover ? toggleHints.notifyOnce : undefined}
 description={<TouchHint text={toggleHints.notifyOnce} />}
 />
 <ToggleSwitch
 checked={form.bypassPrivacyMode}
 onChange={(v) => setForm({ ...form, bypassPrivacyMode: v })}
 label={t('schedules.privacyBypass.label', 'Bypass privacy mode')}
 title={canHover ? toggleHints.bypassPrivacy : undefined}
 description={<TouchHint text={toggleHints.bypassPrivacy} />}
 />
 </div>

 {form.assertPass && (
 <div className="flex items-center gap-2 pt-1 max-sm:flex-col max-sm:items-stretch max-sm:gap-1">
 <span className="text-sm text-text-muted whitespace-nowrap">On failure, trigger scenario:</span>
 <select
 value={form.onFailureScenarioId ?? ''}
 onChange={(e) => setForm({ ...form, onFailureScenarioId: e.target.value ? parseInt(e.target.value, 10) : null })}
 className="px-3 py-1.5 text-sm bg-bg-tertiary rounded-lg text-text-primary focus:outline-none focus:border-accent max-sm:w-full max-sm:min-w-0"
 >
 <option value="">None</option>
 {scenarios.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
 </select>
 </div>
 )}

 <div className="pt-2">
 <NotificationChannelBindings
 value={form.notificationChannels}
 onChange={(next) => setForm({ ...form, notificationChannels: next })}
 />
 </div>

 <StickyFormActions
 onCancel={closeForm}
 onSave={handleSave}
 saving={isSaving}
 className="-mx-3 -mb-3 sm:-mx-4 sm:-mb-4"
 />
 </div>
 )}

 {/* Schedules list */}
 {isLoading ? (
 <div className="flex items-center justify-center h-48">
 <RefreshCw className="w-5 h-5 animate-spin text-text-muted" />
 </div>
 ) : schedules.length === 0 ? (
 <div className="p-12 text-center text-text-muted bg-bg-secondary rounded-xl">
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
 <TenantFilterChips
 value={tenantFilter.value}
 onChange={tenantFilter.setValue}
 availableTenantIds={[...new Set(schedules.map((s) => s.tenantId))]}
 className="mb-2"
 />
 {schedules
 .filter((s) => tenantFilter.value.size === 0 || tenantFilter.value.has(s.tenantId))
 .map((schedule) => {
 const expanded = expandedId === schedule.id;
 const script = scripts.find((s) => s.id === schedule.scriptId);
 return (
 <div key={schedule.id} className="bg-bg-secondary rounded-xl overflow-hidden">
 {/* Whole header row toggles the expanded view. The right-hand
 action buttons stop propagation so clicking them doesn't
 accidentally collapse the row. */}
 <div
 onClick={() => {
 const newId = expanded ? null : schedule.id;
 setExpandedId(newId);
 if (newId !== null && !historyByScheduleId[schedule.id]) {
 loadScheduleHistory(schedule.id);
 }
 }}
 aria-expanded={expanded}
 className="flex items-center gap-2 md:gap-4 px-3 md:px-4 py-3 cursor-pointer hover:bg-bg-tertiary/30 transition-colors"
 >
 <span className="text-text-muted shrink-0">
 {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
 </span>
 <div className="flex-1 min-w-0">
 <div className="flex items-center gap-2 flex-wrap">
 <span className="text-sm font-medium text-text-primary">{schedule.name}</span>
 <StatusBadge enabled={schedule.enabled} />
 {isReadOnlyForCaller(schedule) && (
 // Tap on the badge explains why Edit / Delete are disabled.
 // On desktop (canHover) the Tip is disabled, so the click
 // bubbles and toggles the row exactly as before.
 <span className="inline-flex" onClick={canHover ? undefined : (e) => e.stopPropagation()}>
 <Tip content={readOnlyReason} disabled={canHover}>
 <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] uppercase tracking-wider rounded-full bg-amber-400/10 text-amber-400 border border-amber-400/30">
 🔒 Master
 </span>
 </Tip>
 </span>
 )}
 <TenantBadge tenantId={schedule.tenantId} />
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
 {/* Action buttons — stopPropagation so clicking them
 doesn't also toggle the expand/collapse on the row. */}
 <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
 {(() => {
 const readOnly = isReadOnlyForCaller(schedule);
 const toggleLabel = schedule.enabled
 ? t('schedules.pauseSchedule', 'Pause schedule')
 : t('schedules.activateSchedule', 'Activate schedule');
 return (
 <>
 {/* md+: inline icons (historic desktop look, 40 px targets on touch). */}
 <IconButton
 label={toggleLabel}
 onClick={() => handleToggle(schedule)}
 variant="plain"
 className="hidden md:inline-flex p-0 hover:text-accent"
 icon={schedule.enabled ? <ToggleRight className="w-5 h-5 text-green-400" /> : <ToggleLeft className="w-5 h-5" />}
 />
 <IconButton
 label={t('common.edit', 'Edit')}
 onClick={() => handleOpenEdit(schedule)}
 disabled={readOnly}
 title={readOnly ? readOnlyReason : undefined}
 showTooltip={false}
 className="hidden md:inline-flex hover:bg-bg-tertiary"
 icon={<Edit className="w-4 h-4" />}
 />
 <IconButton
 label={t('common.delete', 'Delete')}
 onClick={() => handleDelete(schedule)}
 disabled={readOnly}
 title={readOnly ? readOnlyReason : undefined}
 showTooltip={false}
 variant="danger"
 className="hidden md:inline-flex"
 icon={<Trash2 className="w-4 h-4" />}
 />
 {/* Phone: every action in one labelled menu. */}
 <span className="md:hidden">
 <ActionMenu
 label={t('ui.moreActions', 'More actions')}
 sheetTitle={schedule.name}
 items={[
 {
 key: 'toggle',
 icon: schedule.enabled ? <ToggleRight className="w-4 h-4 text-green-400" /> : <ToggleLeft className="w-4 h-4" />,
 label: toggleLabel,
 onClick: () => handleToggle(schedule),
 },
 {
 key: 'edit',
 icon: <Edit className="w-4 h-4" />,
 label: t('common.edit', 'Edit'),
 description: readOnly ? readOnlyReason : undefined,
 disabled: readOnly,
 onClick: () => handleOpenEdit(schedule),
 },
 {
 key: 'delete',
 icon: <Trash2 className="w-4 h-4" />,
 label: t('common.delete', 'Delete'),
 description: readOnly ? readOnlyReason : undefined,
 disabled: readOnly,
 danger: true,
 separator: true,
 onClick: () => handleDelete(schedule),
 },
 ]}
 />
 </span>
 </>
 );
 })()}
 </div>
 </div>
 {expanded && (
 <div className=" px-4 py-3 grid grid-cols-2 md:grid-cols-4 gap-4 bg-bg-tertiary/50">
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
 <div className="md:col-span-4 pt-3 /50">
 <div className="flex items-center justify-between mb-2">
 <p className="text-xs text-text-muted uppercase font-medium">Recent history</p>
 <button
 onClick={() => loadScheduleHistory(schedule.id)}
 disabled={loadingHistoryId === schedule.id}
 className="text-[10px] px-2 py-0.5 coarse:px-3 coarse:py-2 rounded text-text-muted hover:text-text-primary hover:border-accent/40 transition-colors"
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
 <HistoryBatchRow key={batch.batchId} batch={batch} scheduleId={schedule.id} scheduleName={schedule.name} />
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
 </PageContainer>
 );
}
