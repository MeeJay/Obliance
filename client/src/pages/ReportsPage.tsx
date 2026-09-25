import { useEffect, useState, useCallback } from 'react';
import { Plus, FileText, Download, RefreshCw, Edit, Trash2, Play, Clock, CheckCircle, AlertCircle, Loader, ChevronDown, ChevronUp, Ban } from 'lucide-react';
import { reportApi } from '@/api/report.api';
import type { Report, ReportOutput, ReportType, ReportFormat, ReportSection, Device } from '@obliance/shared';
import toast from 'react-hot-toast';
import { clsx } from 'clsx';
import { cn } from '@/utils/cn';
import { useTranslation } from 'react-i18next';
import { GroupTreePicker } from '@/components/devices/GroupTreePicker';
import { deviceApi } from '@/api/device.api';
import { PageContainer } from '@/components/common/PageContainer';
import { IconButton } from '@/components/common/IconButton';
import { useConfirm } from '@/components/common/ConfirmDialog';
import { useIsCoarsePointer } from '@/hooks/useMediaQuery';
import { downloadUrl } from '@/utils/download';
import { DeviceFilterSelect } from './CompliancePage';

const REPORT_TYPE_LABELS: Record<ReportType, string> = {
 fleet: 'Fleet Overview',
 compliance: 'Compliance',
 scripts: 'Script Executions',
 updates: 'Updates',
 software: 'Software Inventory',
 custom: 'Custom',
};

const REPORT_FORMAT_LABELS: Record<ReportFormat, string> = {
 json: 'JSON',
 csv: 'CSV',
 pdf: 'PDF',
 excel: 'Excel',
 html: 'HTML',
};

const REPORT_SECTION_LABELS: Record<ReportSection, string> = {
 hardware: 'Hardware',
 software: 'Software',
 updates: 'Updates',
 compliance: 'Compliance',
 scripts_history: 'Script History',
 network: 'Network',
 inventory_detail: 'Detailed per-server',
};

const REPORT_TYPES: ReportType[] = ['fleet', 'compliance', 'scripts', 'updates', 'software', 'custom'];
const REPORT_FORMATS: ReportFormat[] = ['pdf', 'csv', 'excel', 'html', 'json'];
const REPORT_SECTIONS: ReportSection[] = ['hardware', 'network', 'inventory_detail', 'software', 'updates', 'compliance', 'scripts_history'];

// Cron presets — same set as the script-schedule UI so admins don't have to
// learn a different vocabulary depending on which scheduler they're using.
const COMMON_CRONS = [
 { id: 'hourly', label: 'Every hour', value: '0 * * * *' },
 { id: 'daily2am', label: 'Every day at 2am', value: '0 2 * * *' },
 { id: 'monday9am', label: 'Every Monday at 9am', value: '0 9 * * 1' },
 { id: 'sundayMidnight', label: 'Every Sunday at midnight', value: '0 0 * * 0' },
 { id: 'every15min', label: 'Every 15 minutes', value: '*/15 * * * *' },
];

interface ReportFormData {
 name: string;
 description: string;
 type: ReportType;
 format: ReportFormat;
 scopeType: 'tenant' | 'group' | 'device';
 scopeId: number | null;
 sections: ReportSection[];
 // Tri-state run mode mirrors the scripts-schedule form: an admin can pick
 // recurring (cron), one-shot at a future time (not implemented yet — falls
 // back to cron), or "now" (save the definition and immediately fire one
 // generate run, no schedule). 'now' is the equivalent of the user's
 // "rapport à l'instant T" request.
 runMode: 'cron' | 'now';
 scheduleCron: string;
 timezone: string;
 isEnabled: boolean;
}

const defaultForm: ReportFormData = {
 name: '',
 description: '',
 type: 'fleet',
 format: 'pdf',
 scopeType: 'tenant',
 scopeId: null,
 sections: ['hardware', 'software', 'updates'],
 runMode: 'cron',
 scheduleCron: '',
 timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
 isEnabled: true,
};

function StatusBadge({ status }: { status: ReportOutput['status'] }) {
 const { t } = useTranslation();
 const config = {
 generating: { label: t('reports.status.generating', 'Generating'), color: 'text-blue-400 bg-blue-400/10 border-blue-400/30', icon: Loader, pulse: true },
 ready: { label: t('reports.status.ready', 'Ready'), color: 'text-green-400 bg-green-400/10 border-green-400/30', icon: CheckCircle, pulse: false },
 error: { label: t('reports.status.error', 'Error'), color: 'text-red-400 bg-red-400/10 border-red-400/30', icon: AlertCircle, pulse: false },
 }[status];

 const Icon = config.icon;
 return (
 <span className={clsx('text-xs px-2 py-0.5 rounded-full border font-medium flex items-center gap-1 w-fit', config.color)}>
 <Icon className={clsx('w-3 h-3', config.pulse && 'animate-spin')} />
 {config.label}
 </span>
 );
}

function formatBytes(bytes: number | null): string {
 if (!bytes) return '';
 if (bytes < 1024) return `${bytes} B`;
 if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
 return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(val: string | null): string {
 if (!val) return '—';
 return new Date(val).toLocaleString();
}

/** The server streams the file under its on-disk name (res.download). */
function outputFilename(output: ReportOutput): string | undefined {
 const base = output.filePath?.split(/[\\/]/).pop();
 return base || undefined;
}

export function ReportsPage({ embedded }: { embedded?: boolean } = {}) {
 const [reports, setReports] = useState<Report[]>([]);
 const [outputsByReport, setOutputsByReport] = useState<Record<number, ReportOutput[]>>({});
 const [isLoading, setIsLoading] = useState(true);
 const [showForm, setShowForm] = useState(false);
 const [editingReport, setEditingReport] = useState<Report | null>(null);
 const [form, setForm] = useState<ReportFormData>(defaultForm);
 const [isSaving, setIsSaving] = useState(false);
 const [generatingId, setGeneratingId] = useState<number | null>(null);
 const [expandedId, setExpandedId] = useState<number | null>(null);
 const [filterType, setFilterType] = useState<string>('');
 const [devices, setDevices] = useState<Device[]>([]);
 const { t } = useTranslation();
 const confirm = useConfirm();
 const coarse = useIsCoarsePointer();

 const typeLabel = (type: ReportType) => t(`reports.types.${type}`, REPORT_TYPE_LABELS[type]);

 const load = useCallback(async () => {
 setIsLoading(true);
 try {
 const reportList = await reportApi.list();
 setReports(reportList);
 } catch {
 toast.error(t('reports.loadFailed', 'Failed to load reports'));
 } finally {
 setIsLoading(false);
 }
 }, [t]);

 useEffect(() => { load(); }, [load]);
 // Devices for the "Specific device" scope selector (approved only).
 useEffect(() => { deviceApi.list({ approvalStatus: 'approved' }).then(setDevices).catch(() => setDevices([])); }, []);

 const loadOutputs = async (reportId: number) => {
 try {
 const outputs = await reportApi.listOutputs(reportId);
 setOutputsByReport(prev => ({ ...prev, [reportId]: outputs }));
 } catch {
 // ignore
 }
 };

 // No socket for report completion — poll a report's outputs while one is still
 // "generating" so the status flips to Ready/Error on its own (self-terminating).
 useEffect(() => {
 const generatingIds = Object.entries(outputsByReport)
 .filter(([, outs]) => outs.some((o) => o.status === 'generating'))
 .map(([id]) => Number(id));
 if (generatingIds.length === 0) return;
 const timer = setTimeout(() => { generatingIds.forEach((rid) => loadOutputs(rid)); }, 2500);
 return () => clearTimeout(timer);
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [outputsByReport]);

 const handleToggleExpand = async (reportId: number) => {
 if (expandedId === reportId) {
 setExpandedId(null);
 } else {
 setExpandedId(reportId);
 await loadOutputs(reportId);
 }
 };

 const handleOpenCreate = () => {
 setForm(defaultForm);
 setEditingReport(null);
 setShowForm(true);
 };

 const handleOpenEdit = (report: Report) => {
 setForm({
 name: report.name,
 description: report.description ?? '',
 type: report.type,
 format: report.format,
 scopeType: report.scopeType,
 scopeId: report.scopeId,
 sections: report.sections,
 runMode: report.scheduleCron ? 'cron' : 'now',
 scheduleCron: report.scheduleCron ?? '',
 timezone: report.timezone,
 isEnabled: report.isEnabled,
 });
 setEditingReport(report);
 setShowForm(true);
 };

 const handleSave = async () => {
 if (!form.name.trim()) { toast.error(t('reports.nameRequired', 'Report name is required')); return; }
 if ((form.scopeType === 'group' || form.scopeType === 'device') && !form.scopeId) {
 toast.error(t('reports.pickTarget') || (form.scopeType === 'group' ? 'Please choose a group' : 'Please choose a device'));
 return;
 }
 setIsSaving(true);
 try {
 const payload = {
 name: form.name,
 description: form.description || null,
 type: form.type,
 format: form.format,
 scopeType: form.scopeType,
 scopeId: form.scopeId,
 sections: form.sections,
 // 'now' mode = save the definition without a recurring schedule and
 // fire one generate run immediately. The user picks "à l'instant T"
 // and gets a finished output in the outputs list within seconds.
 scheduleCron: form.runMode === 'now' ? null : (form.scheduleCron || null),
 timezone: form.timezone,
 isEnabled: form.isEnabled,
 filters: {},
 tenantId: 0,
 };
 let savedReport: Report | undefined;
 if (editingReport) {
 savedReport = await reportApi.update(editingReport.id, payload);
 toast.success(t('reports.updated', 'Report updated'));
 } else {
 savedReport = await reportApi.create(payload as any);
 toast.success(t('reports.created', 'Report created'));
 }
 // Fire an immediate generation when the user chose 'now'. Errors here
 // are non-fatal — the report definition is already saved.
 if (form.runMode === 'now' && savedReport?.id) {
 try {
 await reportApi.generate(savedReport.id);
 toast.success(t('reports.generationStarted', 'Generation started'));
 } catch { toast.error(t('reports.generationStartFailed', 'Failed to start generation')); }
 }
 setShowForm(false);
 setEditingReport(null);
 await load();
 } catch {
 toast.error(t('reports.saveFailed', 'Failed to save report'));
 } finally {
 setIsSaving(false);
 }
 };

 const handleDelete = async (id: number) => {
 if (!(await confirm({ message: t('reports.deleteConfirm', 'Delete this report?'), danger: true }))) return;
 try {
 await reportApi.delete(id);
 toast.success(t('reports.deleted', 'Report deleted'));
 if (expandedId === id) setExpandedId(null);
 await load();
 } catch {
 toast.error(t('reports.deleteFailed', 'Failed to delete report'));
 }
 };

 const handleGenerate = async (report: Report) => {
 setGeneratingId(report.id);
 try {
 await reportApi.generate(report.id);
 toast.success(t('reports.generateStarted', 'Report generation started'));
 await loadOutputs(report.id);
 if (expandedId !== report.id) {
 setExpandedId(report.id);
 }
 } catch {
 toast.error(t('reports.generateFailed', 'Failed to generate report'));
 } finally {
 setGeneratingId(null);
 }
 };

 // Authenticated same-origin route: the shared helper hands it to the
 // Android DownloadManager (with the session cookie) or uses an
 // <a download> in a browser — window.open was a no-op in the WebView.
 const handleDownload = async (output: ReportOutput) => {
 const ok = await downloadUrl(reportApi.getDownloadUrl(output.id), outputFilename(output));
 if (!ok) toast.error(t('common.error') || 'Something went wrong');
 };

 const handleCancel = async (reportId: number, outputId: number) => {
 try {
 await reportApi.cancelOutput(outputId);
 await loadOutputs(reportId);
 toast.success(t('reports.cancelled') || 'Generation cancelled');
 } catch {
 toast.error(t('common.error') || 'Something went wrong');
 }
 };

 const toggleSection = (section: ReportSection) => {
 setForm(prev => ({
 ...prev,
 sections: prev.sections.includes(section)
 ? prev.sections.filter(s => s !== section)
 : [...prev.sections, section],
 }));
 };

 const filteredReports = filterType ? reports.filter(r => r.type === filterType) : reports;

 const newReportButton = (extra?: string) => (
 <button
 onClick={handleOpenCreate}
 className={cn('flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-lg hover:bg-accent/80 text-sm transition-colors', extra)}
 >
 <Plus className="w-4 h-4" />
 {t('reports.newReport', 'New Report')}
 </button>
 );

 return (
 <PageContainer embedded={embedded} className="space-y-6">
 {!embedded && <div className="flex flex-wrap items-center justify-between gap-2">
 <div>
 <h1 className="text-2xl font-bold text-text-primary">{t('reports.title', 'Reports')}</h1>
 <p className="text-sm text-text-muted mt-0.5">{t('reports.subtitle', 'Generate and download fleet reports')}</p>
 </div>
 <div className="flex gap-2">
 <IconButton
 label={t('common.refresh', 'Refresh')}
 icon={<RefreshCw className={clsx('w-4 h-4', isLoading && 'animate-spin')} />}
 size="lg"
 onClick={load}
 className="rounded-lg hover:bg-bg-secondary"
 />
 {newReportButton()}
 </div>
 </div>}

 {/* Embedded mode hides the full header above — expose create + refresh here so
 you can always add another report, not just from the empty state. */}
 {embedded && !showForm && (
 <div className="flex items-center justify-end gap-2">
 <IconButton
 label={t('common.refresh', 'Refresh')}
 icon={<RefreshCw className={clsx('w-4 h-4', isLoading && 'animate-spin')} />}
 size="lg"
 onClick={load}
 className="rounded-lg hover:bg-bg-secondary"
 />
 {newReportButton()}
 </div>
 )}

 {/* Report form */}
 {showForm && (
 <div className="bg-bg-secondary rounded-xl p-4 sm:p-6 space-y-5">
 <div className="flex flex-wrap items-center justify-between gap-2">
 <h2 className="text-lg font-semibold text-text-primary">{editingReport ? t('reports.editReport', 'Edit Report') : t('reports.newReport', 'New Report')}</h2>
 <div className="flex gap-2">
 <button
 onClick={() => { setShowForm(false); setEditingReport(null); }}
 className="px-4 py-2 text-sm text-text-muted hover:text-text-primary rounded-lg transition-colors"
 >
 {t('common.cancel', 'Cancel')}
 </button>
 <button
 onClick={handleSave}
 disabled={isSaving}
 className="px-4 py-2 text-sm bg-accent text-white rounded-lg hover:bg-accent/80 disabled:opacity-50 transition-colors"
 >
 {isSaving ? t('common.saving', 'Saving…') : t('common.save', 'Save')}
 </button>
 </div>
 </div>

 <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
 <div className="space-y-1">
 <label className="text-xs font-medium text-text-muted uppercase">{t('reports.nameLabel', 'Name')} *</label>
 <input
 value={form.name}
 onChange={(e) => setForm({ ...form, name: e.target.value })}
 className="w-full px-3 py-2 text-sm bg-bg-tertiary rounded-lg text-text-primary focus:outline-none focus:border-accent"
 />
 </div>
 <div className="space-y-1">
 <label className="text-xs font-medium text-text-muted uppercase">{t('common.type', 'Type')}</label>
 <select
 value={form.type}
 onChange={(e) => setForm({ ...form, type: e.target.value as ReportType })}
 className="w-full px-3 py-2 text-sm bg-bg-tertiary rounded-lg text-text-primary focus:outline-none focus:border-accent"
 >
 {REPORT_TYPES.map(rt => <option key={rt} value={rt}>{typeLabel(rt)}</option>)}
 </select>
 </div>
 <div className="space-y-1">
 <label className="text-xs font-medium text-text-muted uppercase">{t('reports.format', 'Format')}</label>
 <div className="flex gap-2 flex-wrap">
 {REPORT_FORMATS.map(fmt => (
 <button
 key={fmt}
 onClick={() => setForm({ ...form, format: fmt })}
 className={clsx(
 'px-3 py-1.5 text-sm rounded-lg border transition-colors coarse:min-h-10',
 form.format === fmt ? 'bg-accent/10 border-accent text-accent' : 'border-transparent text-text-muted hover:border-accent/50 hover:text-text-primary',
 )}
 >
 {REPORT_FORMAT_LABELS[fmt]}
 </button>
 ))}
 </div>
 </div>
 <div className="space-y-1">
 <label className="text-xs font-medium text-text-muted uppercase">{t('reports.scope', 'Scope')}</label>
 <select
 value={form.scopeType}
 onChange={(e) => setForm({ ...form, scopeType: e.target.value as 'tenant' | 'group' | 'device', scopeId: null })}
 className="w-full px-3 py-2 text-sm bg-bg-tertiary rounded-lg text-text-primary focus:outline-none focus:border-accent"
 >
 <option value="tenant">{t('reports.scopeTenant', 'Entire tenant')}</option>
 <option value="group">{t('reports.scopeGroup', 'Device group')}</option>
 <option value="device">{t('reports.scopeDevice', 'Specific device')}</option>
 </select>
 </div>
 {form.scopeType === 'group' && (
 <div className="space-y-1">
 <label className="text-xs font-medium text-text-muted uppercase">{t('reports.group') || 'Group'}</label>
 <GroupTreePicker value={form.scopeId} onChange={(id) => setForm({ ...form, scopeId: id })} />
 </div>
 )}
 {form.scopeType === 'device' && (
 <div className="space-y-1 min-w-0">
 <label className="text-xs font-medium text-text-muted uppercase">{t('reports.device') || 'Device'}</label>
 {coarse ? (
 // Touch: a native <select> over the whole fleet is an unsearchable
 // wall on Android — use the searchable device picker instead.
 <DeviceFilterSelect
 devices={devices}
 value={form.scopeId ?? ''}
 onChange={(v) => setForm({ ...form, scopeId: v === '' ? null : v })}
 allLabel={t('reports.selectDevice') || 'Select a device…'}
 touchTriggerClassName="w-full flex items-center gap-1.5 px-3 py-2 min-h-10 text-sm bg-bg-tertiary rounded-lg text-text-primary text-left min-w-0"
 />
 ) : (
 <select
 value={form.scopeId ?? ''}
 onChange={(e) => setForm({ ...form, scopeId: e.target.value ? parseInt(e.target.value, 10) : null })}
 className="w-full max-w-full px-3 py-2 text-sm bg-bg-tertiary rounded-lg text-text-primary focus:outline-none focus:border-accent"
 >
 <option value="">{t('reports.selectDevice') || 'Select a device…'}</option>
 {devices.map((d) => (
 <option key={d.id} value={d.id}>{d.displayName || d.hostname}</option>
 ))}
 </select>
 )}
 </div>
 )}
 <div className="space-y-1 md:col-span-2">
 <label className="text-xs font-medium text-text-muted uppercase">{t('reports.whenToRun', 'When to run')}</label>
 <div className="flex gap-2">
 <button
 type="button"
 onClick={() => setForm({ ...form, runMode: 'cron' })}
 className={clsx(
 'flex-1 py-2 text-sm rounded-lg border transition-colors',
 form.runMode === 'cron' ? 'bg-accent/10 border-accent text-accent' : 'border-transparent text-text-muted hover:border-accent/50',
 )}
 >
 {t('reports.runRecurring', 'Recurring (cron)')}
 </button>
 <button
 type="button"
 onClick={() => setForm({ ...form, runMode: 'now' })}
 className={clsx(
 'flex-1 py-2 text-sm rounded-lg border transition-colors',
 form.runMode === 'now' ? 'bg-accent/10 border-accent text-accent' : 'border-transparent text-text-muted hover:border-accent/50',
 )}
 >
 {t('reports.runNow', 'Generate now')}
 </button>
 </div>
 </div>
 {form.runMode === 'cron' && (
 <div className="space-y-1">
 <label className="text-xs font-medium text-text-muted uppercase">{t('reports.scheduleCron', 'Schedule (cron)')}</label>
 <input
 value={form.scheduleCron}
 onChange={(e) => setForm({ ...form, scheduleCron: e.target.value })}
 placeholder={t('reports.cronPlaceholder', 'e.g. 0 8 * * 1')}
 autoCapitalize="off" autoCorrect="off" spellCheck={false}
 className="w-full px-3 py-2 text-sm bg-bg-tertiary rounded-lg text-text-primary focus:outline-none focus:border-accent font-mono"
 />
 <div className="flex flex-wrap gap-1 mt-1 coarse:gap-2">
 {COMMON_CRONS.map((c) => (
 <button
 key={c.value}
 type="button"
 onClick={() => setForm({ ...form, scheduleCron: c.value })}
 className="text-xs px-2 py-0.5 bg-bg-tertiary rounded hover:border-accent/50 text-text-muted hover:text-text-primary transition-colors coarse:min-h-9 coarse:px-3"
 >
 {t(`reports.cronPresets.${c.id}`, c.label)}
 </button>
 ))}
 </div>
 </div>
 )}
 <div className="space-y-1">
 <label className="text-xs font-medium text-text-muted uppercase">{t('reports.timezone', 'Timezone')}</label>
 <input
 value={form.timezone}
 onChange={(e) => setForm({ ...form, timezone: e.target.value })}
 autoCapitalize="off" autoCorrect="off" spellCheck={false}
 className="w-full px-3 py-2 text-sm bg-bg-tertiary rounded-lg text-text-primary focus:outline-none focus:border-accent"
 />
 </div>
 <div className="space-y-1 md:col-span-2">
 <label className="text-xs font-medium text-text-muted uppercase">{t('common.description', 'Description')}</label>
 <input
 value={form.description}
 onChange={(e) => setForm({ ...form, description: e.target.value })}
 className="w-full px-3 py-2 text-sm bg-bg-tertiary rounded-lg text-text-primary focus:outline-none focus:border-accent"
 />
 </div>
 </div>

 <div className="space-y-2">
 <label className="text-xs font-medium text-text-muted uppercase">{t('reports.sections', 'Sections')}</label>
 <div className="flex flex-wrap gap-2">
 {REPORT_SECTIONS.map(section => (
 <button
 key={section}
 onClick={() => toggleSection(section)}
 className={clsx(
 'px-3 py-1.5 text-xs rounded-lg border transition-colors coarse:min-h-10',
 form.sections.includes(section) ? 'bg-accent/10 border-accent text-accent' : 'border-transparent text-text-muted hover:border-accent/50 hover:text-text-primary',
 )}
 >
 {t(`reports.sectionLabels.${section}`, REPORT_SECTION_LABELS[section])}
 </button>
 ))}
 </div>
 </div>

 <div className="flex gap-4 pt-2 ">
 <label className="flex items-center gap-2 cursor-pointer coarse:min-h-10">
 <input
 type="checkbox"
 checked={form.isEnabled}
 onChange={(e) => setForm({ ...form, isEnabled: e.target.checked })}
 className="rounded"
 />
 <span className="text-sm text-text-primary">{t('reports.enabledForScheduled', 'Enabled (for scheduled runs)')}</span>
 </label>
 </div>
 </div>
 )}

 {/* Filter */}
 <div className="flex flex-wrap items-center gap-3">
 <select
 value={filterType}
 onChange={(e) => setFilterType(e.target.value)}
 className="px-3 py-1.5 text-sm bg-bg-secondary rounded-lg text-text-primary focus:outline-none focus:border-accent"
 >
 <option value="">{t('reports.allTypes', 'All types')}</option>
 {REPORT_TYPES.map(rt => <option key={rt} value={rt}>{typeLabel(rt)}</option>)}
 </select>
 <span className="text-sm text-text-muted">
 {t('reports.count', { count: filteredReports.length, defaultValue_one: '{{count}} report', defaultValue_other: '{{count}} reports' })}
 </span>
 </div>

 {/* Reports list */}
 {isLoading ? (
 <div className="flex items-center justify-center h-48">
 <RefreshCw className="w-5 h-5 animate-spin text-text-muted" />
 </div>
 ) : filteredReports.length === 0 ? (
 <div className="p-6 sm:p-12 text-center text-text-muted bg-bg-secondary rounded-xl">
 <FileText className="w-10 h-10 mx-auto mb-3 opacity-50" />
 <p className="font-medium text-text-primary mb-1">{t('reports.empty', 'No reports yet')}</p>
 <p className="text-sm">{t('reports.emptyHint', 'Create reports to generate fleet insights and export data.')}</p>
 {newReportButton('mt-4 inline-flex')}
 </div>
 ) : (
 <div className="space-y-2">
 {filteredReports.map((report) => {
 const expanded = expandedId === report.id;
 const outputs = outputsByReport[report.id] ?? [];
 return (
 <div key={report.id} className="bg-bg-secondary rounded-xl overflow-hidden">
 {/* Below sm the actions wrap onto their own full-width row, so the
 name + badges keep the whole card width. */}
 <div className="flex items-center gap-4 px-4 py-3 max-sm:flex-wrap max-sm:gap-3">
 <div className="p-2 rounded-lg bg-accent/10">
 <FileText className="w-4 h-4 text-accent" />
 </div>
 <div className="flex-1 min-w-0">
 <div className="flex items-center gap-2 flex-wrap">
 <span className="text-sm font-medium text-text-primary break-words min-w-0">{report.name}</span>
 <span className="text-xs px-2 py-0.5 bg-bg-tertiary rounded-full text-text-muted">
 {typeLabel(report.type)}
 </span>
 <span className="text-xs px-2 py-0.5 bg-bg-tertiary rounded-full text-text-muted">
 {REPORT_FORMAT_LABELS[report.format]}
 </span>
 {report.scheduleCron && (
 <span className="text-xs px-2 py-0.5 bg-bg-tertiary rounded-full text-text-muted flex items-center gap-1">
 <Clock className="w-2.5 h-2.5" />
 {report.scheduleCron}
 </span>
 )}
 </div>
 {report.description && <p className="text-xs text-text-muted mt-0.5 truncate max-sm:whitespace-normal max-sm:line-clamp-2">{report.description}</p>}
 <p className="text-xs text-text-muted mt-0.5">
 {t('reports.lastGenerated', 'Last generated')}: {formatDate(report.lastGeneratedAt)} · {t('reports.scope', 'Scope')}: {report.scopeType}
 </p>
 </div>
 <div className="flex items-center gap-2 shrink-0 max-sm:w-full max-sm:justify-end">
 <button
 onClick={() => handleGenerate(report)}
 disabled={generatingId === report.id}
 className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-accent/10 text-accent border border-accent/30 rounded-lg hover:bg-accent/20 disabled:opacity-50 transition-colors coarse:min-h-10 max-sm:mr-auto"
 title={t('reports.generateTitle', 'Generate report')}
 >
 {generatingId === report.id ? (
 <RefreshCw className="w-3.5 h-3.5 animate-spin" />
 ) : (
 <Play className="w-3.5 h-3.5" />
 )}
 {t('reports.generate', 'Generate')}
 </button>
 <IconButton
 label={t('reports.viewOutputs', 'View outputs')}
 icon={expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
 aria-expanded={expanded}
 onClick={() => handleToggleExpand(report.id)}
 className="hover:bg-bg-tertiary"
 />
 <IconButton
 label={t('common.edit', 'Edit')}
 icon={<Edit className="w-4 h-4" />}
 onClick={() => handleOpenEdit(report)}
 className="hover:bg-bg-tertiary"
 />
 <IconButton
 label={t('common.delete', 'Delete')}
 icon={<Trash2 className="w-4 h-4" />}
 variant="danger"
 onClick={() => handleDelete(report.id)}
 />
 </div>
 </div>

 {expanded && (
 <div className=" bg-bg-tertiary/50">
 {outputs.length === 0 ? (
 <div className="px-4 py-6 text-center text-text-muted">
 <p className="text-sm">{t('reports.noOutputs', 'No outputs yet. Click Generate to create the first output.')}</p>
 </div>
 ) : (
 <div className="divide-y divide-border">
 {/* Header row — hidden below md where each output is a card. */}
 <div className="max-md:hidden grid grid-cols-4 gap-4 px-4 py-2 text-xs font-medium text-text-muted uppercase">
 <span>{t('reports.colGenerated', 'Generated')}</span>
 <span>{t('common.status', 'Status')}</span>
 <span>{t('reports.colSize', 'Size')}</span>
 <span className="text-right">{t('common.actions', 'Actions')}</span>
 </div>
 {outputs.map((output) => (
 // md+: 4-column grid (unchanged). Below md: a wrapping card —
 // date + status, size, then full-width actions.
 <div key={output.id} className="grid grid-cols-4 gap-4 px-4 py-3 items-center max-md:flex max-md:flex-wrap max-md:gap-x-3 max-md:gap-y-2">
 <span className="text-xs text-text-primary">{formatDate(output.generatedAt)}</span>
 <StatusBadge status={output.status} />
 <span className="text-xs text-text-muted">
 {formatBytes(output.fileSizeBytes)}
 {output.rowCount !== null && <span className="ml-1">· {t('reports.rows', { count: output.rowCount, defaultValue: '{{count}} rows' })}</span>}
 </span>
 <div className="flex justify-end gap-2 items-center min-w-0 max-md:w-full max-md:justify-start">
 {output.status === 'ready' && output.filePath && (
 <button
 onClick={() => handleDownload(output)}
 className="flex items-center gap-1.5 px-2.5 py-1 text-xs bg-green-500/20 text-green-400 border border-green-500/30 rounded hover:bg-green-500/30 transition-colors coarse:min-h-10 max-md:flex-1 max-md:justify-center"
 >
 <Download className="w-3 h-3" />
 {t('common.download', 'Download')}
 </button>
 )}
 {output.status === 'generating' && (
 <button
 onClick={() => handleCancel(report.id, output.id)}
 title={t('reports.cancel') || 'Cancel generation'}
 className="flex items-center gap-1.5 px-2.5 py-1 text-xs bg-red-500/20 text-red-400 border border-red-500/30 rounded hover:bg-red-500/30 transition-colors coarse:min-h-10 max-md:flex-1 max-md:justify-center"
 >
 <Ban className="w-3 h-3" />
 {t('reports.cancel') || 'Cancel'}
 </button>
 )}
 {output.status === 'error' && output.errorMessage && (
 // Full error text below md / on touch (it was only in title=).
 <span className="text-xs text-red-400 truncate max-w-xs max-md:max-w-none max-md:whitespace-normal max-md:break-words coarse:whitespace-normal coarse:break-words" title={output.errorMessage}>
 {output.errorMessage}
 </span>
 )}
 </div>
 </div>
 ))}
 </div>
 )}
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
