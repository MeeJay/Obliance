import { useEffect, useLayoutEffect, useState, useCallback, useRef, type ChangeEvent } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { ToggleSwitch } from '@/components/common/ToggleSwitch';
import { Plus, Edit, Trash2, RefreshCw, Play, ToggleLeft, ToggleRight, ChevronDown, ChevronUp, Minus, ArrowUp, ArrowDown, Zap, X, Download, Upload, FileText, History, Terminal, AlertCircle, CheckCircle2, Clock, Loader2, GitBranch, StopCircle, Check, ClipboardCopy, ClipboardPaste, ArrowLeft } from 'lucide-react';
import { Modal } from '@/components/common/Modal';
import { IconButton } from '@/components/common/IconButton';
import { ActionMenu, type ActionMenuItem } from '@/components/common/ActionMenu';
import { Tip } from '@/components/common/Tip';
import { useConfirm, usePrompt } from '@/components/common/ConfirmDialog';
import { GroupTreeMultiSelect } from '@/components/automation/GroupTreeMultiSelect';
import { StickyFormActions, useRevealOnOpen } from '@/components/automation/FormActions';
import { PageContainer } from '@/components/common/PageContainer';
import { useNativeBack } from '@/hooks/useNativeBack';
import { MEDIA, useMediaQuery, useCanHover, useIsCoarsePointer, useLayoutMode } from '@/hooks/useMediaQuery';
import { saveJson } from '@/utils/download';
import { copyTextDeferred } from '@/utils/clipboard';

/** Per-row export button with a menu offering two flavours (+ copy).
 * Lean (default) exports the scenario alone — small file, points at
 * scripts by id. With scripts embeds full bodies so the import is
 * self-contained on a fresh tenant. Rendered through ActionMenu (portal,
 * fixed position) so the scenario card's overflow-hidden no longer clips
 * it, and as a bottom sheet on phones. */
function ExportMenu({
 scenario,
 onExport,
 onCopy,
}: {
 scenario: Scenario;
 onExport: (s: Scenario, includeScripts: boolean) => void;
 onCopy: (s: Scenario) => void;
}) {
 const { t } = useTranslation();
 const label = t('scenarios.export.menu', 'Export this scenario as JSON');
 return (
 <ActionMenu
 label={label}
 menuClassName="w-auto min-w-[220px]"
 items={exportMenuItems(t, scenario, onExport, onCopy)}
 trigger={(p) => (
 <IconButton
 {...p}
 label={label}
 variant="accent"
 icon={<Download className="w-4 h-4" />}
 />
 )}
 />
 );
}

type TFn = ReturnType<typeof useTranslation>['t'];

/** Export actions — shared by the md+ export menu and the phone row menu. */
function exportMenuItems(
 t: TFn,
 scenario: Scenario,
 onExport: (s: Scenario, includeScripts: boolean) => void,
 onCopy: (s: Scenario) => void,
): ActionMenuItem[] {
 return [
 {
 key: 'export-lean',
 icon: <Download className="w-4 h-4" />,
 label: t('scenarios.export.lean', 'Export (lean)'),
 description: t('scenarios.export.leanDesc', 'Scenario only — references scripts by id'),
 onClick: () => onExport(scenario, false),
 },
 {
 key: 'export-full',
 icon: <Download className="w-4 h-4" />,
 label: t('scenarios.export.withScripts', 'Export with scripts'),
 description: t('scenarios.export.withScriptsDesc', 'Self-contained — embeds full script bodies'),
 onClick: () => onExport(scenario, true),
 },
 {
 key: 'export-copy',
 icon: <ClipboardCopy className="w-4 h-4" />,
 label: t('scenarios.export.copyJson', 'Copy JSON to clipboard'),
 description: t('scenarios.export.copyJsonDesc', 'Lean export, ready to paste (e.g. into an AI chat)'),
 onClick: () => onCopy(scenario),
 },
 ];
}

/**
 * Top of the app body (= bottom of the header, including the safe area,
 * the ObliTools tab bar and any banner): the full-screen graph editor is
 * anchored there so the Obliance topbar stays visible. Falls back to the
 * historic 52 px when <main> is not found.
 */
function useAppBodyTop(active: boolean): number {
 const [top, setTop] = useState(52);
 useLayoutEffect(() => {
 if (!active) return;
 const measure = () => {
 const main = document.querySelector('main');
 const value = main ? Math.round(main.getBoundingClientRect().top) : NaN;
 setTop(Number.isFinite(value) && value >= 0 ? value : 52);
 };
 measure();
 window.addEventListener('resize', measure);
 return () => window.removeEventListener('resize', measure);
 }, [active]);
 return top;
}
import { ScenarioGraphEditor } from '@/components/scenarios/ScenarioGraphEditor';
import { scenarioApi } from '@/api/scenario.api';
import { scriptApi } from '@/api/script.api';
import { useGroupStore } from '@/store/groupStore';
import { getSocket } from '@/socket/socketClient';
import type { Scenario, ScenarioTriggerType, ScenarioStatus, ScenarioRun, Script, ScriptSchedule, AutomationNotificationBinding, Device } from '@obliance/shared';
import { deviceApi } from '@/api/device.api';
// Notifications + on_success/on_failure toggles retired — moved to per-node
// `Send notification` configuration in the v2 graph editor.
import { DeviceMultiSelect } from '@/components/common/DeviceMultiSelect';
import { TargetTenantsPicker } from '@/components/common/TargetTenantsPicker';
import { FanOutChips } from '@/components/common/FanOutChips';
import { TenantBadge } from '@/components/common/TenantBadge';
import { TenantFilterChips } from '@/components/common/TenantFilterChips';
import { useTenantFilter } from '@/hooks/useTenantFilter';
import { useTenantStore } from '@/store/tenantStore';
import { MASTER_TENANT_ID } from '@obliance/shared';
import toast from 'react-hot-toast';
import { clsx } from 'clsx';

const TRIGGER_LABELS: Record<ScenarioTriggerType, string> = {
 session_login: 'Session Login',
 machine_boot: 'Machine Boot',
 agent_approved: 'Agent Approved',
 group_join: 'Group Join',
 schedule_failure: 'Schedule Failure',
 schedule_cron: 'Cron Schedule',
 manual: 'Manual',
 agent_back_online: 'Agent Back Online',
 metric_warning: 'Metric Warning',
 metric_critical: 'Metric Critical',
 metric_custom: 'Metric Custom',
};

const TRIGGER_COLORS: Record<ScenarioTriggerType, string> = {
 session_login: 'text-blue-400 bg-blue-400/10 border-blue-400/30',
 machine_boot: 'text-purple-400 bg-purple-400/10 border-purple-400/30',
 agent_approved: 'text-green-400 bg-green-400/10 border-green-400/30',
 group_join: 'text-orange-400 bg-orange-400/10 border-orange-400/30',
 schedule_failure: 'text-red-400 bg-red-400/10 border-red-400/30',
 schedule_cron: 'text-purple-400 bg-purple-400/10 border-purple-400/30',
 manual: 'text-gray-400 bg-gray-400/10 border-gray-400/30',
 agent_back_online: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30',
 metric_warning: 'text-amber-400 bg-amber-400/10 border-amber-400/30',
 metric_critical: 'text-red-400 bg-red-400/10 border-red-400/30',
 metric_custom: 'text-fuchsia-400 bg-fuchsia-400/10 border-fuchsia-400/30',
};

const STATUS_COLORS: Record<ScenarioStatus, string> = {
 draft: 'text-gray-400 bg-gray-400/10 border-gray-400/30',
 active: 'text-green-400 bg-green-400/10 border-green-400/30',
 disabled: 'text-red-400 bg-red-400/10 border-red-400/30',
};

interface StepFormData {
 name: string;
 checkScriptId: number | null;
 resolveScriptId: number | null;
 timeoutSeconds: number;
 retryCount: number;
}

interface ScenarioFormData {
 name: string;
 description: string;
 triggerType: ScenarioTriggerType;
 triggerConfig: { groupIds?: number[]; scheduleId?: number };
 targetType: string;
 targetIds: number[];
 status: ScenarioStatus;
 variables: Array<{ key: string; value: string }>;
 steps: StepFormData[];
 retryPolicy: { maxRetries: number; retryDelaySeconds: number };
 timeoutSeconds: number;
 notifyOnSuccess: boolean;
 notifyOnFailure: boolean;
 bypassPrivacyMode: boolean;
 notificationChannels: AutomationNotificationBinding[];
 /** Master-only fan-out target tenants. Null = local. */
 targetTenantIds: number[] | null;
}

const defaultForm: ScenarioFormData = {
 name: '',
 description: '',
 triggerType: 'manual',
 triggerConfig: {},
 targetType: 'all',
 targetIds: [],
 status: 'draft',
 variables: [],
 steps: [],
 retryPolicy: { maxRetries: 0, retryDelaySeconds: 60 },
 timeoutSeconds: 3600,
 notifyOnSuccess: false,
 notifyOnFailure: true,
 bypassPrivacyMode: false,
 notificationChannels: [],
 targetTenantIds: null,
};

const defaultStep: StepFormData = {
 name: '',
 checkScriptId: null,
 resolveScriptId: null,
 timeoutSeconds: 300,
 retryCount: 0,
};

function TriggerBadge({ type, count }: { type: ScenarioTriggerType; count?: number }) {
 return (
 <span className={clsx('text-xs px-2 py-0.5 rounded-full border font-medium', TRIGGER_COLORS[type])}>
 {TRIGGER_LABELS[type]}{count != null && count > 1 ? ` (${count})` : ''}
 </span>
 );
}

function ScenarioStatusBadge({ status }: { status: ScenarioStatus }) {
 return (
 <span className={clsx('text-xs px-2 py-0.5 rounded-full border font-medium capitalize', STATUS_COLORS[status])}>
 {status}
 </span>
 );
}

export function ScenariosPage({ embedded }: { embedded?: boolean } = {}) {
 const { t } = useTranslation();
 const currentTenantId = useTenantStore((s) => s.currentTenantId);
 /** A scenario is read-only for the active tenant when it's owned by
 * another tenant AND we're not on the master tenant. Master always
 * has god-view edit rights. */
 const isReadOnlyForCaller = (s: Scenario): boolean => {
 if (currentTenantId === MASTER_TENANT_ID) return false;
 return s.tenantId !== currentTenantId;
 };
 // Master narrow filter — chip row above the list. URL-synced via
 // useTenantFilter so admins can deep-link to "scenarios filtered to
 // Contoso".
 const tenantFilter = useTenantFilter();
 // JSON import flow state — `importPreview` holds the parsed file +
 // server-returned conflicts so the user can resolve script-uuid
 // collisions before committing. Keyed file input so a re-pick of
 // the same file still triggers onChange.
 const [importPreview, setImportPreview] = useState<{
 payload: any;
 conflicts: Array<{ scriptUuid: string; existingScriptId: number; existingName: string; importedName: string }>;
 } | null>(null);
 const [importResolutions, setImportResolutions] = useState<Record<string, 'skip' | 'overwrite' | 'new'>>({});
 const [importBusy, setImportBusy] = useState(false);
 const importFileInputRef = useRef<HTMLInputElement | null>(null);

 const confirm = useConfirm();
 const prompt = usePrompt();
 const canHover = useCanHover();
 const isCoarse = useIsCoarsePointer();
 const layoutMode = useLayoutMode();
 // Row actions: the historic inline icon cluster with a mouse from md up,
 // one labelled "⋯" menu on a phone or a touch screen.
 const compactRowActions = layoutMode === 'phone' || isCoarse;
 const readOnlyReason = t('automations.readOnlyMaster', 'Managed by the Default tenant — read-only');

 const handlePickImportFile = () => importFileInputRef.current?.click();

 const handleImportFileSelected = async (e: ChangeEvent<HTMLInputElement>) => {
 const f = e.target.files?.[0];
 e.target.value = ''; // reset so re-picking the same file works
 if (!f) return;
 try {
 const text = await f.text();
 await startImport(JSON.parse(text));
 } catch (err: any) {
 toast.error(err?.response?.data?.error || err?.message || 'Failed to read file');
 }
 };

 // No-file path (phone menu): paste the JSON — handy for LLM-generated
 // scenarios and when the device has no file to pick.
 const handlePasteImport = async () => {
 const text = await prompt({
 title: t('scenarios.pasteJsonTitle', 'Paste a scenario JSON'),
 message: t('scenarios.pasteJsonHint', 'Paste an exported scenario (with or without embedded scripts).'),
 multiline: true,
 required: true,
 placeholder: '{ "formatVersion": 2, … }',
 confirmLabel: t('scenarios.importJson', 'Import JSON'),
 });
 if (text === null) return;
 let payload: unknown;
 try {
 payload = JSON.parse(text);
 } catch {
 toast.error(t('scenarios.invalidJson', 'Invalid JSON'));
 return;
 }
 try {
 await startImport(payload);
 } catch (err: any) {
 toast.error(err?.response?.data?.error || err?.message || t('scenarios.importFailed', 'Failed to import scenario'));
 }
 };

 // Two-pass import: preview (conflicts) → commit, shared by file + paste.
 const startImport = async (payload: any) => {
 const preview = await scenarioApi.importPreview(payload);
 // Default every conflict to 'skip' (safe — keeps existing scripts)
 const defaultResolutions: Record<string, 'skip' | 'overwrite' | 'new'> = {};
 for (const c of preview.conflicts) defaultResolutions[c.scriptUuid] = 'skip';
 setImportPreview({ payload, conflicts: preview.conflicts });
 setImportResolutions(defaultResolutions);
 // No conflicts → commit immediately, no modal.
 if (preview.conflicts.length === 0) {
 await commitImport(payload, {});
 }
 };

 const commitImport = async (payload: any, resolutions: Record<string, 'skip' | 'overwrite' | 'new'>) => {
 setImportBusy(true);
 try {
 const result = await scenarioApi.importCommit(payload, resolutions);
 toast.success(`Scenario imported: ${result.scenario.name}`);
 setImportPreview(null);
 setImportResolutions({});
 await load();
 } catch (err: any) {
 toast.error(err?.response?.data?.error || 'Failed to import scenario');
 } finally {
 setImportBusy(false);
 }
 };

 // Downloads go through utils/download (Android shell → native saveFile,
 // browser → anchor with deferred revoke).
 const handleDownloadTemplate = async () => {
 let dummy: unknown;
 try {
 dummy = await scenarioApi.dummyExport();
 } catch {
 toast.error(t('scenarios.templateFetchFailed', 'Failed to fetch template'));
 return;
 }
 if (!(await saveJson(dummy, 'obliance-scenario-template.json'))) {
 toast.error(t('importExport.failedExport', 'Export failed'));
 }
 };

 const handleExportScenario = async (scenario: Scenario, includeScripts: boolean) => {
 try {
 const data = await scenarioApi.exportScenario(scenario.id, { includeScripts });
 const slug = scenario.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
 const ok = await saveJson(data, `scenario-${slug || scenario.id}${includeScripts ? '-with-scripts' : ''}.json`);
 if (!ok) toast.error(t('scenarios.export.failed', 'Failed to export scenario'));
 } catch {
 toast.error(t('scenarios.export.failed', 'Failed to export scenario'));
 }
 };

 const handleCopyScenarioJson = async (scenario: Scenario) => {
 // The export is fetched over the network, but WebKit (iOS / iPadOS
 // browsers, macOS Safari) only allows a clipboard write that STARTS
 // inside the click / tap gesture — copyTextDeferred() starts it
 // synchronously with a promised ClipboardItem, then falls back to
 // copyText() (async Clipboard API → execCommand → Android native bridge).
 const textPromise = scenarioApi
 .exportScenario(scenario.id, { includeScripts: false })
 .then((data) => JSON.stringify(data, null, 2));
 const ok = await copyTextDeferred(textPromise);
 if (!ok && (await textPromise.then(() => false, () => true))) {
 toast.error(t('scenarios.export.failed', 'Failed to export scenario'));
 return;
 }
 if (ok) toast.success(t('common.copied', 'Copied!'));
 else toast.error(t('common.error', 'Error'));
 };
 const [scenarios, setScenarios] = useState<Scenario[]>([]);
 const [scripts, setScripts] = useState<Script[]>([]);
 // schedules previously fed the schedule_failure trigger picker —
 // retired now that triggers live entirely in the graph editor. Kept
 // the setter so the existing fetch in load() doesn't need to change.
 const [, setSchedules] = useState<ScriptSchedule[]>([]);
 const [isLoading, setIsLoading] = useState(true);
 const [showForm, setShowForm] = useState(false);
 const [editingScenario, setEditingScenario] = useState<Scenario | null>(null);
 const [form, setForm] = useState<ScenarioFormData>(defaultForm);
 const [isSaving, setIsSaving] = useState(false);
 const [expandedId, setExpandedId] = useState<number | null>(null);
 // v2 graph editor — opens a full-viewport modal with React Flow when set.
 const [graphEditorScenarioId, setGraphEditorScenarioId] = useState<number | null>(null);
 const [showTemplateModal, setShowTemplateModal] = useState(false);
 const [triggerModalScenario, setTriggerModalScenario] = useState<Scenario | null>(null);
 const [triggerDeviceIds, setTriggerDeviceIds] = useState<number[]>([]);
 const [triggerSearch, setTriggerSearch] = useState('');
 const [isTriggering, setIsTriggering] = useState(false);
 // Devices loaded for the trigger picker — scoped to the scenario's
 // target (group / device / all) so we don't drown the admin in
 // unrelated rows and don't get truncated at the legacy 100-row cap.
 const [triggerDevices, setTriggerDevices] = useState<Device[]>([]);
 const [triggerLoading, setTriggerLoading] = useState(false);
 // Run-history drill-down for the "History" button on each card.
 const [historyForScenario, setHistoryForScenario] = useState<Scenario | null>(null);
 // (deviceStore removed — trigger picker uses its own scoped fetch via
 // deviceApi.listPaginated to bypass the 100-row cap.)
 const [templates, setTemplates] = useState<any[]>([]);
 const [loadingTemplates, setLoadingTemplates] = useState(false);
 const [selectedTemplate, setSelectedTemplate] = useState<any | null>(null);
 const [templateVars, setTemplateVars] = useState<Record<string, string>>({});
 const [importingTemplate, setImportingTemplate] = useState(false);

 const { fetchGroups } = useGroupStore();

 // Inline metadata form: scroll it into view when it opens (phone / tablet).
 const formRef = useRef<HTMLDivElement>(null);
 useRevealOnOpen(formRef, showForm ? (editingScenario?.id ?? 'new') : null);
 const closeForm = () => { setShowForm(false); setEditingScenario(null); };

 // Full-screen graph editor: anchored under the real header height, and
 // the Android back gesture closes it (after a confirmation — the editor
 // keeps its unsaved state internally) instead of leaving Automations.
 const graphTop = useAppBodyTop(graphEditorScenarioId != null);
 useNativeBack(() => {
 void confirm({
 message: t('scenarios.graphEditor.closeConfirm', 'Close the graph editor? Unsaved changes will be lost.'),
 confirmLabel: t('common.close', 'Close'),
 }).then((ok) => { if (ok) setGraphEditorScenarioId(null); });
 }, graphEditorScenarioId != null);
 // Template modal: Android back goes from a template's detail back to the list.
 useNativeBack(() => setSelectedTemplate(null), showTemplateModal && selectedTemplate != null);

 /**
 * Reload scenarios + scripts + schedules.
 *
 * `silent` skips the loading-spinner toggle so background refreshes
 * driven by socket events don't flick the page on a 200-device
 * fleet (where SCENARIO_RUN_UPDATED fires nonstop). The first
 * mount keeps the spinner; subsequent socket-driven reloads use
 * silent=true and just swap the data underneath.
 */
 const load = useCallback(async (silent = false) => {
 if (!silent) setIsLoading(true);
 try {
 const [scenarioList, scriptList, scheduleList] = await Promise.all([
 scenarioApi.list().catch(() => []),
 scriptApi.list().catch(() => []),
 scriptApi.listSchedules().catch(() => []),
 ]);
 setScenarios(Array.isArray(scenarioList) ? scenarioList : []);
 setScripts(Array.isArray(scriptList) ? scriptList : []);
 setSchedules(Array.isArray(scheduleList) ? scheduleList : []);
 } catch {
 if (!silent) toast.error('Failed to load scenarios');
 } finally {
 if (!silent) setIsLoading(false);
 }
 }, []);

 useEffect(() => { load(); }, [load]);
 useEffect(() => { fetchGroups(); }, [fetchGroups]);

 // Live refresh on scenario run / step updates emitted by the
 // orchestrator. On a 200-device fleet these events fire dozens of
 // times per second; we coalesce with a 1500ms debounce (was 400ms)
 // and reload silently so the list rows don't flick to a loading
 // state. The user sees the active-run counter tick down naturally
 // as runs complete without losing scroll position.
 useEffect(() => {
 const socket = getSocket();
 if (!socket) return;
 let timer: ReturnType<typeof setTimeout> | null = null;
 const debounced = () => {
 if (timer) clearTimeout(timer);
 timer = setTimeout(() => load(true), 1500);
 };
 socket.on('SCENARIO_RUN_UPDATED', debounced);
 socket.on('SCENARIO_STEP_UPDATED', debounced);
 socket.on('SCENARIO_NODE_UPDATED', debounced);
 return () => {
 socket.off('SCENARIO_RUN_UPDATED', debounced);
 socket.off('SCENARIO_STEP_UPDATED', debounced);
 socket.off('SCENARIO_NODE_UPDATED', debounced);
 if (timer) clearTimeout(timer);
 };
 }, [load]);

 const handleOpenCreate = () => {
 setForm(defaultForm);
 setEditingScenario(null);
 setShowForm(true);
 };

 const handleOpenEdit = async (scenario: Scenario) => {
 // The list endpoint only returns stepCount; fetch full scenario with steps
 let full: Scenario;
 try {
 full = await scenarioApi.getById(scenario.id);
 } catch {
 toast.error('Failed to load scenario');
 return;
 }
 const vars = full.variables
 ? Object.entries(full.variables).map(([key, value]) => ({ key, value }))
 : [];
 const steps: StepFormData[] = (full.steps ?? [])
 .slice()
 .sort((a, b) => a.sortOrder - b.sortOrder)
 .map((s) => ({
 name: s.name,
 checkScriptId: s.checkScriptId,
 resolveScriptId: s.resolveScriptId,
 timeoutSeconds: s.timeoutSeconds,
 retryCount: s.retryCount,
 }));
 setForm({
 name: full.name,
 description: full.description ?? '',
 triggerType: full.triggerType,
 triggerConfig: full.triggerConfig ?? {},
 targetType: full.targetType,
 targetIds: full.targetIds ?? [],
 status: full.status,
 variables: vars,
 steps,
 retryPolicy: full.retryPolicy ?? { maxRetries: 0, retryDelaySeconds: 60 },
 timeoutSeconds: full.timeoutSeconds,
 notifyOnSuccess: full.notifyOnSuccess,
 notifyOnFailure: full.notifyOnFailure,
 bypassPrivacyMode: !!full.bypassPrivacyMode,
 notificationChannels: full.notificationChannels ?? [],
 targetTenantIds: full.targetTenantIds ?? null,
 });
 setEditingScenario(full);
 setShowForm(true);
 };

 const handleSave = async () => {
 if (!form.name.trim()) { toast.error('Name is required'); return; }
 // v2: structure is managed in the graph editor. The metadata form
 // accepts an empty step list; the auto-migration creates a minimal
 // (trigger → end_success) graph that the user customises in
 // ScenarioGraphEditor afterwards.
 for (const step of form.steps) {
 if (!step.name.trim()) { toast.error('All steps must have a name'); return; }
 }

 setIsSaving(true);
 try {
 const variables: Record<string, string> = {};
 for (const v of form.variables) {
 if (v.key.trim()) variables[v.key.trim()] = v.value;
 }

 const payload = {
 name: form.name,
 description: form.description || null,
 triggerType: form.triggerType,
 triggerConfig: form.triggerConfig,
 targetType: form.targetType,
 targetIds: form.targetIds,
 status: form.status,
 variables,
 steps: form.steps.map((s, i) => ({
 name: s.name,
 checkScriptId: s.checkScriptId,
 resolveScriptId: s.resolveScriptId,
 timeoutSeconds: s.timeoutSeconds,
 retryCount: s.retryCount,
 sortOrder: i,
 parameterOverrides: {},
 })),
 retryPolicy: form.retryPolicy,
 timeoutSeconds: form.timeoutSeconds,
 notifyOnSuccess: form.notifyOnSuccess,
 notifyOnFailure: form.notifyOnFailure,
 bypassPrivacyMode: form.bypassPrivacyMode,
 notificationChannels: form.notificationChannels,
 // Master-only fan-out — server ignores this from non-master callers.
 targetTenantIds: form.targetTenantIds,
 };

 if (editingScenario) {
 // Server returns 202 with { approvalId, status: 'pending_approval' }
 // when the bypass-privacy toggle flip needs second-admin sign-off.
 // Axios passes that through as a normal success — surface it as a
 // distinct toast so the admin knows the change isn't live yet.
 const out = (await scenarioApi.update(editingScenario.id, payload)) as any;
 if (out && out.status === 'pending_approval') {
 toast.success(t('scenarios.privacyBypass.pendingApprovalToast') || 'Scenario saved — privacy-bypass toggle awaiting admin approval', { duration: 6000 });
 } else {
 toast.success(t('scenarios.savedToast', 'Scenario updated'));
 }
 } else {
 await scenarioApi.create(payload);
 toast.success(t('scenarios.createdToast', 'Scenario created'));
 }
 setShowForm(false);
 setEditingScenario(null);
 await load();
 } catch {
 toast.error('Failed to save scenario');
 } finally {
 setIsSaving(false);
 }
 };

 const handleDelete = async (scenario: Scenario) => {
 if (!(await confirm({
 message: t('scenarios.deleteConfirmNamed', { name: scenario.name, defaultValue: 'Delete scenario "{{name}}"?' }),
 danger: true,
 }))) return;
 try {
 await scenarioApi.delete(scenario.id);
 toast.success('Scenario deleted');
 await load();
 } catch {
 toast.error('Failed to delete scenario');
 }
 };

 const handleStopRuns = async (scenario: Scenario) => {
 const count = scenario.activeRunCount ?? 0;
 if (!(await confirm({
 message: t('scenarios.stopRunsConfirm', {
 count,
 name: scenario.name,
 defaultValue: `Stop ${count} active run${count > 1 ? 's' : ''} of "{{name}}"?`,
 }),
 confirmLabel: t('scenarios.stopRunsAction', 'Stop runs'),
 danger: true,
 }))) return;
 try {
 const r = await scenarioApi.cancelAllRuns(scenario.id);
 toast.success(t('scenarios.cancelledRuns', {
 count: r.cancelled,
 defaultValue: `Cancelled ${r.cancelled} run${r.cancelled !== 1 ? 's' : ''}`,
 }));
 await load();
 } catch (err) {
 // Surface the real server message instead of swallowing it — past
 // iterations of "Failed to start run" / "Failed to stop" hid the
 // actual cause.
 const e = err as { response?: { data?: { error?: string } }; message?: string };
 const detail = e?.response?.data?.error || e?.message || 'Unknown error';
 console.error('cancelAllRuns failed', err);
 toast.error(t('scenarios.stopRunsFailed', { detail, defaultValue: 'Failed to stop runs: {{detail}}' }));
 }
 };

 const handleToggle = async (scenario: Scenario) => {
 try {
 if (scenario.status === 'active') {
 await scenarioApi.disable(scenario.id);
 toast.success('Scenario disabled');
 } else {
 await scenarioApi.enable(scenario.id);
 toast.success('Scenario enabled');
 }
 await load();
 } catch {
 toast.error('Failed to update scenario');
 }
 };

 const handleTrigger = async (scenario: Scenario) => {
 setTriggerLoading(true);
 setTriggerSearch('');
 setTriggerModalScenario(scenario);
 try {
 // 1) Pre-selection from the server (resolves group → devices via the
 // closure table). Falls back to the configured device list.
 let preselected: number[] = [];
 try {
 preselected = await scenarioApi.resolvedTargets(scenario.id);
 } catch {
 preselected = scenario.targetType === 'device' ? (scenario.targetIds ?? []) : [];
 }
 setTriggerDeviceIds(preselected);

 // 2) Device pool scoped to the scenario's target. listPaginated with
 // pageSize=5000 covers fleets up to 5k without truncating; the
 // old fetch was capped at 100 (legacy /devices default), which
 // masked half a 500-device target group.
 const merged = new Map<number, Device>();
 if (scenario.targetType === 'group' && (scenario.targetIds ?? []).length > 0) {
 // Multi-group target: fetch each group's devices (with descendants)
 // in parallel and dedupe.
 const results = await Promise.all(
 (scenario.targetIds ?? []).map((gid) =>
 deviceApi.listPaginated({ groupId: gid, includeSubgroups: true, pageSize: 5000 }),
 ),
 );
 for (const r of results) for (const d of r.items) merged.set(d.id, d);
 } else if (scenario.targetType === 'device' && (scenario.targetIds ?? []).length > 0) {
 // Specific device list: fetch the whole tenant once, filter to those.
 const r = await deviceApi.listPaginated({ pageSize: 5000 });
 for (const d of r.items) {
 if ((scenario.targetIds ?? []).includes(d.id)) merged.set(d.id, d);
 }
 } else {
 // 'all', 'self', or no target: show every device so the admin can
 // pick anything for a one-off run.
 const r = await deviceApi.listPaginated({ pageSize: 5000 });
 for (const d of r.items) merged.set(d.id, d);
 }
 setTriggerDevices(Array.from(merged.values()));
 } finally {
 setTriggerLoading(false);
 }
 };

 const confirmTrigger = async () => {
 if (!triggerModalScenario) return;
 if (triggerDeviceIds.length === 0) {
 toast.error('Select at least one device');
 return;
 }
 setIsTriggering(true);
 try {
 const runs = await scenarioApi.trigger(triggerModalScenario.id, triggerDeviceIds);
 toast.success(`Triggered ${runs.length} run(s)`);
 setTriggerModalScenario(null);
 } catch {
 toast.error('Failed to trigger scenario');
 } finally {
 setIsTriggering(false);
 }
 };

 // Step helpers
 const addStep = () => {
 setForm({ ...form, steps: [...form.steps, { ...defaultStep, name: `Step ${form.steps.length + 1}` }] });
 };

 const removeStep = (index: number) => {
 setForm({ ...form, steps: form.steps.filter((_, i) => i !== index) });
 };

 const updateStep = (index: number, updates: Partial<StepFormData>) => {
 const steps = [...form.steps];
 steps[index] = { ...steps[index], ...updates };
 setForm({ ...form, steps });
 };

 const moveStep = (index: number, direction: 'up' | 'down') => {
 const steps = [...form.steps];
 const targetIndex = direction === 'up' ? index - 1 : index + 1;
 if (targetIndex < 0 || targetIndex >= steps.length) return;
 [steps[index], steps[targetIndex]] = [steps[targetIndex], steps[index]];
 setForm({ ...form, steps });
 };

 // Template helpers
 const handleOpenTemplates = async () => {
 setShowTemplateModal(true);
 setSelectedTemplate(null);
 setTemplateVars({});
 setLoadingTemplates(true);
 try {
 const list = await scenarioApi.listTemplates();
 setTemplates(list);
 } catch {
 toast.error('Failed to load templates');
 } finally {
 setLoadingTemplates(false);
 }
 };

 const handleSelectTemplate = (tpl: any) => {
 setSelectedTemplate(tpl);
 setTemplateVars(tpl.variables ? { ...tpl.variables } : {});
 };

 const handleImportTemplate = async () => {
 if (!selectedTemplate) return;
 setImportingTemplate(true);
 try {
 await scenarioApi.instantiateTemplate(selectedTemplate.id, { variables: templateVars });
 toast.success(`Scenario "${selectedTemplate.name}" imported`);
 setShowTemplateModal(false);
 setSelectedTemplate(null);
 await load();
 } catch {
 toast.error('Failed to import template');
 } finally {
 setImportingTemplate(false);
 }
 };

 // Variable helpers
 const addVariable = () => {
 setForm({ ...form, variables: [...form.variables, { key: '', value: '' }] });
 };

 const removeVariable = (index: number) => {
 setForm({ ...form, variables: form.variables.filter((_, i) => i !== index) });
 };

 const updateVariable = (index: number, field: 'key' | 'value', val: string) => {
 const vars = [...form.variables];
 vars[index] = { ...vars[index], [field]: val };
 setForm({ ...form, variables: vars });
 };

 const checkScripts = scripts.filter((s) => s.purpose === 'check');
 const resolveScripts = scripts.filter((s) => s.purpose === 'resolve' || s.purpose === 'execute' || s.purpose === 'compliance');

 // Toolbar: the historic inline buttons from md up; below md the import /
 // template actions collapse into one labelled "⋯" menu (5 text buttons
 // wrapped over three rows on a phone), which also offers "Paste JSON".
 const toolbar = (
 <>
 <IconButton
 label={t('common.refresh', 'Refresh')}
 onClick={() => load()}
 size="lg"
 icon={<RefreshCw className={clsx('w-4 h-4', isLoading && 'animate-spin')} />}
 className="rounded-lg hover:bg-bg-secondary"
 />
 <button
 onClick={handleOpenTemplates}
 className="hidden md:flex items-center gap-2 px-4 py-2 border border-transparent text-text-primary rounded-lg hover:bg-bg-secondary text-sm transition-colors"
 >
 <Download className="w-4 h-4" />
 {t('scenarios.importFromTemplate', 'Import from template')}
 </button>
 {/* Embedded mode is what users see on /schedules → Scenarios
 tab, i.e. THE common entry point. The standalone /scenarios
 route is barely used. So Import JSON + Empty template have
 to live in this branch too — leaving them only on the
 non-embedded shell hides the JSON import/export workflow
 behind an URL almost no admin opens directly. */}
 <button
 onClick={handlePickImportFile}
 disabled={importBusy}
 title={t('scenarios.importJsonHint', 'Import a scenario JSON file (with or without embedded scripts)')}
 className="hidden md:flex items-center gap-2 px-4 py-2 border border-transparent text-text-primary rounded-lg hover:bg-bg-secondary text-sm transition-colors disabled:opacity-50"
 >
 <Upload className="w-4 h-4" />
 {t('scenarios.importJson', 'Import JSON')}
 </button>
 {/* Touch tablets: no-file import path (the phone gets it in the menu below). */}
 {isCoarse && (
 <button
 onClick={() => { void handlePasteImport(); }}
 disabled={importBusy}
 className="hidden md:flex items-center gap-2 px-4 py-2 border border-transparent text-text-primary rounded-lg hover:bg-bg-secondary text-sm transition-colors disabled:opacity-50"
 >
 <ClipboardPaste className="w-4 h-4" />
 {t('scenarios.pasteJson', 'Paste JSON')}
 </button>
 )}
 <button
 onClick={handleDownloadTemplate}
 title={t('scenarios.emptyTemplateHint', 'Download an empty scenario JSON to share with an AI / colleague')}
 className="hidden md:flex items-center gap-2 px-4 py-2 border border-transparent text-text-muted hover:text-text-primary rounded-lg hover:bg-bg-secondary text-sm transition-colors"
 >
 <FileText className="w-4 h-4" />
 {t('scenarios.emptyTemplate', 'Empty template')}
 </button>
 <span className="md:hidden">
 <ActionMenu
 label={t('scenarios.importExportMenu', 'Import / templates')}
 triggerSize="lg"
 triggerClassName="rounded-lg hover:bg-bg-secondary"
 items={[
 {
 key: 'tpl',
 icon: <Download className="w-4 h-4" />,
 label: t('scenarios.importFromTemplate', 'Import from template'),
 onClick: handleOpenTemplates,
 },
 {
 key: 'file',
 icon: <Upload className="w-4 h-4" />,
 label: t('scenarios.importJson', 'Import JSON'),
 description: t('scenarios.importJsonHint', 'Import a scenario JSON file (with or without embedded scripts)'),
 disabled: importBusy,
 onClick: handlePickImportFile,
 },
 {
 key: 'paste',
 icon: <ClipboardPaste className="w-4 h-4" />,
 label: t('scenarios.pasteJson', 'Paste JSON'),
 disabled: importBusy,
 onClick: () => { void handlePasteImport(); },
 },
 {
 key: 'empty',
 icon: <FileText className="w-4 h-4" />,
 label: t('scenarios.emptyTemplate', 'Empty template'),
 description: t('scenarios.emptyTemplateHint', 'Download an empty scenario JSON to share with an AI / colleague'),
 separator: true,
 onClick: () => { void handleDownloadTemplate(); },
 },
 ]}
 />
 </span>
 <button
 onClick={handleOpenCreate}
 className="flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-lg hover:bg-accent/80 text-sm transition-colors"
 >
 <Plus className="w-4 h-4" />
 New Scenario
 </button>
 </>
 );

 return (
 <PageContainer embedded={embedded} className="space-y-6">
 {!embedded && (
 <div className="flex flex-wrap items-center justify-between gap-3">
 <div className="min-w-0">
 <h1 className="text-2xl font-bold text-text-primary">Scenarios</h1>
 <p className="text-sm text-text-muted mt-0.5">Automate multi-step check-and-resolve workflows</p>
 </div>
 <div className="flex flex-wrap gap-2">
 {toolbar}
 </div>
 </div>
 )}

 {embedded && (
 <div className="flex items-center justify-end gap-2 flex-wrap">
 {toolbar}
 </div>
 )}

 {/* Template import modal. Title size, backdrop (no blur), shadow and
 the 80vh cap reproduce the former hand-rolled desktop dialog. */}
 <Modal
 open={showTemplateModal}
 onClose={() => setShowTemplateModal(false)}
 title={<span className="text-lg">{t('scenarios.importFromTemplate', 'Import from template')}</span>}
 size="lg"
 className="bg-bg-primary shadow-xl sm:max-h-[80dvh] sm:supports-[not(height:100dvh)]:max-h-[80vh]"
 overlayClassName="bg-black/50 backdrop-blur-none"
 bodyClassName="p-4 sm:p-6 space-y-3"
 >
 {loadingTemplates ? (
 <div className="flex items-center justify-center py-12">
 <RefreshCw className="w-5 h-5 animate-spin text-text-muted" />
 </div>
 ) : templates.length === 0 ? (
 <p className="text-sm text-text-muted text-center py-12">{t('scenarios.noTemplates', 'No templates available.')}</p>
 ) : selectedTemplate ? (
 <div className="space-y-4">
 <button
 onClick={() => setSelectedTemplate(null)}
 className="text-sm text-accent hover:underline coarse:py-2"
 >
 &larr; Back to templates
 </button>
 <div className="bg-bg-secondary rounded-lg p-4">
 <h3 className="text-sm font-semibold text-text-primary">{selectedTemplate.name}</h3>
 <p className="text-xs text-text-muted mt-1">{selectedTemplate.description}</p>
 <div className="flex gap-3 mt-2 text-xs text-text-muted">
 <span>{TRIGGER_LABELS[selectedTemplate.triggerType as ScenarioTriggerType] ?? selectedTemplate.triggerType}</span>
 <span>{selectedTemplate.stepCount} step{selectedTemplate.stepCount !== 1 ? 's' : ''}</span>
 </div>
 </div>
 {Object.keys(templateVars).length > 0 && (
 <div className="space-y-3">
 <h4 className="text-sm font-semibold text-text-primary">Variables</h4>
 <p className="text-xs text-text-muted">Fill in the template variables before importing.</p>
 {Object.entries(templateVars).map(([key, value]) => (
 <div key={key} className="space-y-1">
 <label className="text-xs font-medium text-text-muted uppercase font-mono">{key}</label>
 <input
 value={value}
 onChange={(e) => setTemplateVars({ ...templateVars, [key]: e.target.value })}
 placeholder={`Enter ${key}...`}
 autoCapitalize="off"
 autoCorrect="off"
 spellCheck={false}
 className="w-full px-3 py-2 text-sm bg-bg-tertiary rounded-lg text-text-primary focus:outline-none focus:border-accent"
 />
 </div>
 ))}
 </div>
 )}
 <button
 onClick={handleImportTemplate}
 disabled={importingTemplate}
 className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-accent text-white rounded-lg hover:bg-accent/80 disabled:opacity-50 text-sm transition-colors"
 >
 {importingTemplate ? 'Importing...' : 'Import Scenario'}
 </button>
 </div>
 ) : (
 templates.map((tpl) => (
 <div
 key={tpl.id}
 className="bg-bg-secondary rounded-lg p-4 hover:border-accent/50 transition-colors"
 >
 <div className="flex items-start justify-between gap-4">
 <div className="flex-1 min-w-0">
 <h3 className="text-sm font-semibold text-text-primary">{tpl.name}</h3>
 <p className="text-xs text-text-muted mt-1 line-clamp-2">{tpl.description}</p>
 <div className="flex gap-3 mt-2 text-xs text-text-muted">
 <span>{TRIGGER_LABELS[tpl.triggerType as ScenarioTriggerType] ?? tpl.triggerType}</span>
 <span>{tpl.stepCount} step{tpl.stepCount !== 1 ? 's' : ''}</span>
 {Object.keys(tpl.variables ?? {}).length > 0 && (
 <span>{Object.keys(tpl.variables).length} variable{Object.keys(tpl.variables).length !== 1 ? 's' : ''}</span>
 )}
 </div>
 </div>
 <button
 onClick={() => handleSelectTemplate(tpl)}
 className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 coarse:min-h-10 text-xs bg-accent text-white rounded-lg hover:bg-accent/80 transition-colors"
 >
 <Download className="w-3.5 h-3.5" />
 Import
 </button>
 </div>
 </div>
 ))
 )}
 </Modal>

 {/* Form panel */}
 {showForm && (
 <div ref={formRef} className="bg-bg-secondary rounded-xl p-3 sm:p-4 lg:p-6 space-y-5 scroll-mt-3">
 <div className="flex items-center justify-between">
 <h2 className="text-lg font-semibold text-text-primary">{editingScenario ? 'Edit Scenario' : 'New Scenario'}</h2>
 {/* Below md: Save / Cancel in the sticky bar at the bottom of the form. */}
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

 {/* Basic fields */}
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
 <label className="text-xs font-medium text-text-muted uppercase">Status</label>
 <select
 value={form.status}
 onChange={(e) => setForm({ ...form, status: e.target.value as ScenarioStatus })}
 className="w-full px-3 py-2 text-sm bg-bg-tertiary rounded-lg text-text-primary focus:outline-none focus:border-accent"
 >
 <option value="draft">Draft</option>
 <option value="active">Active</option>
 <option value="disabled">Disabled</option>
 </select>
 </div>
 {/* Master-only fan-out picker. Renders only when the caller
 is on the master tenant; child-tenant admins never see it. */}
 <div className="md:col-span-2">
 <TargetTenantsPicker
 value={form.targetTenantIds}
 onChange={(next) => setForm({ ...form, targetTenantIds: next })}
 />
 </div>
 {/* Trigger config moved entirely to the graph editor in v2.
 New scenarios get a default `trigger_manual` node from the
 auto-migration; the user adds / replaces / multiplies
 triggers from the React Flow canvas. The form keeps only
 metadata (name, description, status, target, variables). */}

 <div className="space-y-1">
 <label className="text-xs font-medium text-text-muted uppercase">Target</label>
 {/* For event triggers we offer a "Originating device" option
 ('self') that's the right default 95 % of the time —
 session_login fires on a device, the resolve script
 should run on that same device. Broadcasting a script
 to a whole group when one device logs in is rarely the
 intent and is footgun-prone. */}
 {(() => {
 const eventDriven = ['session_login', 'machine_boot', 'agent_approved', 'group_join'].includes(form.triggerType);
 const choices: { v: string; l: string }[] = eventDriven
 ? [
 { v: 'self', l: 'Originating device' },
 { v: 'all', l: 'All devices' },
 { v: 'group', l: 'By group' },
 { v: 'device', l: 'By device' },
 ]
 : [
 { v: 'all', l: 'All devices' },
 { v: 'group', l: 'By group' },
 { v: 'device', l: 'By device' },
 ];
 return (
 <div className="grid grid-cols-2 gap-2 sm:flex">
 {choices.map((t) => (
 <button
 key={t.v}
 onClick={() => setForm({ ...form, targetType: t.v as 'self' | 'all' | 'group' | 'device', targetIds: [] })}
 className={clsx(
 'flex-1 py-2 text-sm rounded-lg border transition-colors',
 form.targetType === t.v ? 'bg-accent/10 border-accent text-accent' : 'border-transparent text-text-muted hover:border-accent/50',
 )}
 >
 {t.l}
 </button>
 ))}
 </div>
 );
 })()}
 {form.targetType === 'self' && (
 <p className="text-[11px] text-text-muted mt-1">
 Runs only on the device that fired the trigger
 {form.triggerType === 'session_login' && ' (the agent reporting the new session).'}
 {form.triggerType === 'machine_boot' && ' (the agent that just booted).'}
 {form.triggerType === 'group_join' && ' (the device that just joined the group).'}
 {form.triggerType === 'agent_approved' && ' (the agent that was just approved).'}
 </p>
 )}
 </div>
 {form.targetType === 'group' && (
 <div className="space-y-1">
 <label className="text-xs font-medium text-text-muted uppercase">Target Groups</label>
 <GroupTreeMultiSelect
 selectedIds={form.targetIds}
 onChange={(ids) => setForm({ ...form, targetIds: ids })}
 />
 </div>
 )}
 {form.targetType === 'device' && (
 <div className="space-y-1">
 <label className="text-xs font-medium text-text-muted uppercase">Target Devices</label>
 <DeviceMultiSelect
 selectedIds={form.targetIds}
 onChange={(ids) => setForm({ ...form, targetIds: ids })}
 />
 </div>
 )}

 <div className="space-y-1">
 <label className="text-xs font-medium text-text-muted uppercase">Timeout (seconds)</label>
 <input
 type="number"
 value={form.timeoutSeconds}
 onChange={(e) => setForm({ ...form, timeoutSeconds: parseInt(e.target.value, 10) || 3600 })}
 className="w-full px-3 py-2 text-sm bg-bg-tertiary rounded-lg text-text-primary focus:outline-none focus:border-accent"
 />
 </div>

 <div className="space-y-1 md:col-span-2">
 <label className="text-xs font-medium text-text-muted uppercase">Description</label>
 <textarea
 value={form.description}
 onChange={(e) => setForm({ ...form, description: e.target.value })}
 rows={2}
 className="w-full px-3 py-2 text-sm bg-bg-tertiary rounded-lg text-text-primary focus:outline-none focus:border-accent resize-none"
 />
 </div>
 </div>

 {/* Retry policy */}
 <div className=" pt-4">
 <h3 className="text-sm font-semibold text-text-primary mb-3">Retry Policy</h3>
 <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
 <div className="space-y-1">
 <label className="text-xs font-medium text-text-muted uppercase">Max Retries</label>
 <input
 type="number"
 min={0}
 max={10}
 value={form.retryPolicy.maxRetries}
 onChange={(e) => setForm({ ...form, retryPolicy: { ...form.retryPolicy, maxRetries: parseInt(e.target.value, 10) || 0 } })}
 className="w-full px-3 py-2 text-sm bg-bg-tertiary rounded-lg text-text-primary focus:outline-none focus:border-accent"
 />
 </div>
 <div className="space-y-1">
 <label className="text-xs font-medium text-text-muted uppercase">Retry Delay (seconds)</label>
 <input
 type="number"
 min={0}
 value={form.retryPolicy.retryDelaySeconds}
 onChange={(e) => setForm({ ...form, retryPolicy: { ...form.retryPolicy, retryDelaySeconds: parseInt(e.target.value, 10) || 60 } })}
 className="w-full px-3 py-2 text-sm bg-bg-tertiary rounded-lg text-text-primary focus:outline-none focus:border-accent"
 />
 </div>
 </div>
 </div>

 {/* Privacy bypass toggle — when on, the scenario runs on
 devices currently in privacy mode. Default off. Flipping
 this on is gated by the action-restriction matrix under
 `scenario.bypass_privacy_mode` (default = double admin
 approval), so the save call may return 202 / require 2FA
 instead of completing immediately. */}
 <div className="pt-4">
 <h3 className="text-sm font-semibold text-text-primary mb-3">
 {t('scenarios.privacyBypass.title') || 'Privacy mode'}
 </h3>
 <div className="flex items-start gap-3 max-sm:flex-col max-sm:gap-2 px-3 py-3 rounded-lg bg-bg-tertiary">
 <ToggleSwitch
 checked={form.bypassPrivacyMode}
 onChange={(v) => setForm({ ...form, bypassPrivacyMode: v })}
 label={t('scenarios.privacyBypass.label') || 'Bypass privacy mode'}
 />
 <div className="flex-1 text-[11px] text-text-muted leading-snug">
 {t('scenarios.privacyBypass.hint') ||
  "When off (default), devices in privacy mode are skipped silently. When on, the scenario runs on them too — overrides a user's explicit privacy choice. Enabling this may require admin approval depending on the tenant's restriction settings."}
 </div>
 </div>
 </div>

 {/* Notifications — moved to the graph (Send notification node).
 The legacy scenario-level toggles + channel bindings still
 exist in the DB but are no longer read by the v2 engine.
 Drop a small reminder so admins know where to configure
 notifications now. */}
 <div className="pt-4 ">
 <div className="flex items-start gap-3 px-3 py-2 rounded-lg bg-bg-tertiary border border-transparent text-xs text-text-muted">
 <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
 <div>
 <div className="font-medium text-text-primary">Notifications are configured in the graph editor</div>
 Drop a <span className="font-mono px-1 py-0 rounded bg-bg-secondary border border-transparent">Send notification</span> node into your graph and wire it to the path you want to notify on. Per-node bindings replace the old scenario-level <span className="font-mono">notify_on_success</span>/<span className="font-mono">notify_on_failure</span> flags.
 </div>
 </div>
 </div>

 {/* Variables */}
 <div className=" pt-4">
 <div className="flex items-center justify-between mb-3">
 <h3 className="text-sm font-semibold text-text-primary">Variables</h3>
 <button
 onClick={addVariable}
 className="flex items-center gap-1 px-3 py-1.5 text-xs bg-bg-tertiary rounded-lg text-text-muted hover:text-text-primary hover:border-accent/50 transition-colors"
 >
 <Plus className="w-3 h-3" />
 Add Variable
 </button>
 </div>
 {form.variables.length === 0 ? (
 <p className="text-xs text-text-muted">No variables defined.</p>
 ) : (
 <div className="space-y-2">
 {form.variables.map((v, i) => (
 <div key={i} className="flex gap-2 items-center">
 <input
 value={v.key}
 onChange={(e) => updateVariable(i, 'key', e.target.value)}
 placeholder="Key"
 autoCapitalize="off"
 autoCorrect="off"
 autoComplete="off"
 spellCheck={false}
 className="flex-1 min-w-0 px-3 py-1.5 text-sm bg-bg-tertiary rounded-lg text-text-primary focus:outline-none focus:border-accent font-mono"
 />
 <input
 value={v.value}
 onChange={(e) => updateVariable(i, 'value', e.target.value)}
 placeholder="Value"
 autoCapitalize="off"
 autoCorrect="off"
 autoComplete="off"
 spellCheck={false}
 className="flex-1 min-w-0 px-3 py-1.5 text-sm bg-bg-tertiary rounded-lg text-text-primary focus:outline-none focus:border-accent"
 />
 <IconButton
 label={t('common.delete', 'Delete')}
 onClick={() => removeVariable(i)}
 variant="danger"
 showTooltip={false}
 icon={<X className="w-3.5 h-3.5" />}
 />
 </div>
 ))}
 </div>
 )}
 </div>

 {/* Structure — v2-only. The graph editor is the single source
 of truth for nodes and edges. The legacy step editor has
 been retired now that every scenario flows through the v2
 engine; we keep the React Flow callback below to jump
 straight from the metadata form into the canvas. */}
 <div className=" pt-4">
 <div className="flex items-center gap-3 max-sm:flex-col max-sm:items-stretch">
 <div className="flex-1">
 <h3 className="text-sm font-semibold text-text-primary">Structure</h3>
 <p className="text-xs text-text-muted mt-0.5">
 Save this form first, then click the <span className="font-mono px-1 py-0 rounded bg-bg-tertiary border border-transparent">GitBranch</span> icon on the scenario card to design the check / resolve / branch flow visually.
 </p>
 </div>
 {editingScenario && (
 <button
 onClick={() => { setShowForm(false); setEditingScenario(null); setGraphEditorScenarioId(editingScenario.id); }}
 className="px-3 py-1.5 coarse:min-h-10 text-sm bg-accent/10 border border-accent/30 text-accent rounded-lg hover:bg-accent/20 transition-colors inline-flex items-center gap-1.5 max-sm:justify-center"
 >
 <GitBranch className="w-3.5 h-3.5" /> Open graph editor
 </button>
 )}
 </div>
 {/* v1 step editor removed — kept the placeholder so the
 surrounding JSX block remains balanced. Anything legacy
 returning here can be put back inside this comment-only
 fragment. */}
 <div className="hidden">
 <div className="mt-3 flex items-center justify-between mb-3">
 <h3 className="text-sm font-semibold text-text-primary">Steps</h3>
 <button
 onClick={addStep}
 className="flex items-center gap-1 px-3 py-1.5 text-xs bg-bg-tertiary rounded-lg text-text-muted hover:text-text-primary hover:border-accent/50 transition-colors"
 >
 <Plus className="w-3 h-3" />
 Add Step
 </button>
 </div>
 {form.steps.length === 0 ? (
 <p className="text-xs text-text-muted">No steps yet. New scenarios start with an empty graph that you build in the graph editor.</p>
 ) : (
 <div className="space-y-3">
 {form.steps.map((step, i) => (
 <div key={i} className="bg-bg-tertiary rounded-lg p-4 space-y-3">
 <div className="flex items-center justify-between">
 <span className="text-xs font-semibold text-text-muted uppercase">Step {i + 1}</span>
 <div className="flex items-center gap-1">
 <button
 onClick={() => moveStep(i, 'up')}
 disabled={i === 0}
 className="p-1 text-text-muted hover:text-text-primary disabled:opacity-30 transition-colors"
 >
 <ArrowUp className="w-3.5 h-3.5" />
 </button>
 <button
 onClick={() => moveStep(i, 'down')}
 disabled={i === form.steps.length - 1}
 className="p-1 text-text-muted hover:text-text-primary disabled:opacity-30 transition-colors"
 >
 <ArrowDown className="w-3.5 h-3.5" />
 </button>
 <button
 onClick={() => removeStep(i)}
 className="p-1 text-text-muted hover:text-red-400 hover:bg-red-400/10 rounded transition-colors"
 >
 <Trash2 className="w-3.5 h-3.5" />
 </button>
 </div>
 </div>
 <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
 <div className="space-y-1">
 <label className="text-xs font-medium text-text-muted uppercase">Name *</label>
 <input
 value={step.name}
 onChange={(e) => updateStep(i, { name: e.target.value })}
 className="w-full px-3 py-1.5 text-sm bg-bg-secondary rounded-lg text-text-primary focus:outline-none focus:border-accent"
 />
 </div>
 <div className="space-y-1">
 <label className="text-xs font-medium text-text-muted uppercase">Check Script</label>
 <select
 value={step.checkScriptId ?? ''}
 onChange={(e) => updateStep(i, { checkScriptId: e.target.value ? parseInt(e.target.value, 10) : null })}
 className="w-full px-3 py-1.5 text-sm bg-bg-secondary rounded-lg text-text-primary focus:outline-none focus:border-accent"
 >
 <option value="">None</option>
 {checkScripts.length > 0 ? (
 checkScripts.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)
 ) : (
 scripts.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)
 )}
 </select>
 </div>
 <div className="space-y-1">
 <label className="text-xs font-medium text-text-muted uppercase">Resolve Script</label>
 <select
 value={step.resolveScriptId ?? ''}
 onChange={(e) => updateStep(i, { resolveScriptId: e.target.value ? parseInt(e.target.value, 10) : null })}
 className="w-full px-3 py-1.5 text-sm bg-bg-secondary rounded-lg text-text-primary focus:outline-none focus:border-accent"
 >
 <option value="">None</option>
 {resolveScripts.length > 0 ? (
 resolveScripts.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)
 ) : (
 scripts.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)
 )}
 </select>
 </div>
 <div className="grid grid-cols-2 gap-3">
 <div className="space-y-1">
 <label className="text-xs font-medium text-text-muted uppercase">Timeout (s)</label>
 <input
 type="number"
 value={step.timeoutSeconds}
 onChange={(e) => updateStep(i, { timeoutSeconds: parseInt(e.target.value, 10) || 300 })}
 className="w-full px-3 py-1.5 text-sm bg-bg-secondary rounded-lg text-text-primary focus:outline-none focus:border-accent"
 />
 </div>
 <div className="space-y-1">
 <label className="text-xs font-medium text-text-muted uppercase">Retries</label>
 <input
 type="number"
 min={0}
 max={10}
 value={step.retryCount}
 onChange={(e) => updateStep(i, { retryCount: parseInt(e.target.value, 10) || 0 })}
 className="w-full px-3 py-1.5 text-sm bg-bg-secondary rounded-lg text-text-primary focus:outline-none focus:border-accent"
 />
 </div>
 </div>
 </div>
 </div>
 ))}
 </div>
 )}
 </div>
 </div>

 <StickyFormActions
 onCancel={closeForm}
 onSave={handleSave}
 saving={isSaving}
 className="-mx-3 -mb-3 sm:-mx-4 sm:-mb-4"
 />
 </div>
 )}

 {/* Scenarios list */}
 {isLoading ? (
 <div className="flex items-center justify-center h-48">
 <RefreshCw className="w-5 h-5 animate-spin text-text-muted" />
 </div>
 ) : scenarios.length === 0 ? (
 <div className="p-12 text-center text-text-muted bg-bg-secondary rounded-xl">
 <Zap className="w-10 h-10 mx-auto mb-3 opacity-50" />
 <p className="font-medium text-text-primary mb-1">No scenarios yet</p>
 <p className="text-sm">Create a scenario to automate multi-step check-and-resolve workflows.</p>
 <button
 onClick={handleOpenCreate}
 className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-lg hover:bg-accent/80 text-sm transition-colors"
 >
 <Plus className="w-4 h-4" />
 New Scenario
 </button>
 </div>
 ) : (
 <div className="space-y-2">
 {/* Master tenant filter chips — hidden outside master. Reads/
 writes the `tenants` querystring param so deep-links
 survive. The list of available tenants is the union of
 scenarios' owning tenants. */}
 <TenantFilterChips
 value={tenantFilter.value}
 onChange={tenantFilter.setValue}
 availableTenantIds={[...new Set(scenarios.map((s) => s.tenantId))]}
 className="mb-2"
 />
 {scenarios
 .filter((s) => tenantFilter.value.size === 0 || tenantFilter.value.has(s.tenantId))
 .map((scenario) => {
 const expanded = expandedId === scenario.id;
 // v2 graphs show their action-node count (excludes triggers
 // and end_* terminators — those are passive "wiring" rather
 // than meaningful work units). Falls back to v1's step
 // count when the scenario hasn't been migrated yet.
 const nodeCount = (scenario as { nodeCount?: number }).nodeCount;
 const legacyStepCount = scenario.stepCount ?? scenario.steps?.length ?? 0;
 const itemCount = nodeCount && nodeCount > 0 ? nodeCount : legacyStepCount;
 const itemLabel = nodeCount && nodeCount > 0 ? 'node' : 'step';
 const readOnly = isReadOnlyForCaller(scenario);
 const canTrigger = (scenario.triggerCounts?.manual ?? 0) > 0 || scenario.triggerType === 'manual';
 const activeRuns = scenario.activeRunCount ?? 0;
 const stopLabel = t('scenarios.stopActiveRuns', {
 count: activeRuns,
 defaultValue: `Stop ${activeRuns} active run${activeRuns > 1 ? 's' : ''}`,
 });
 const toggleLabel = scenario.status === 'active' ? t('common.disable', 'Disable') : t('common.enable', 'Enable');
 const stopBadge = activeRuns > 0 ? (
 <button
 onClick={() => { void handleStopRuns(scenario); }}
 className="inline-flex items-center gap-1 px-1.5 py-0.5 coarse:min-h-10 coarse:px-2.5 rounded text-red-400 hover:bg-red-400/10 transition-colors"
 title={stopLabel}
 aria-label={stopLabel}
 >
 <StopCircle className="w-4 h-4" />
 <span className="text-[11px] font-mono">{activeRuns}</span>
 </button>
 ) : null;
 // Phone / touch: every action in one labelled "⋯" menu (8 bare
 // icons told apart only by title= are unusable by finger).
 const rowMenuItems: ActionMenuItem[] = [
 { key: 'trigger', icon: <Play className="w-4 h-4" />, label: t('scenarios.triggerNow', 'Trigger now'), hidden: !canTrigger, onClick: () => { void handleTrigger(scenario); } },
 { key: 'stop', icon: <StopCircle className="w-4 h-4" />, label: stopLabel, hidden: activeRuns === 0, danger: true, onClick: () => { void handleStopRuns(scenario); } },
 {
 key: 'toggle',
 icon: scenario.status === 'active' ? <ToggleRight className="w-4 h-4 text-green-400" /> : <ToggleLeft className="w-4 h-4" />,
 label: toggleLabel,
 onClick: () => { void handleToggle(scenario); },
 },
 { key: 'history', icon: <History className="w-4 h-4" />, label: t('scenarios.runHistory', 'Run history'), onClick: () => setHistoryForScenario(scenario) },
 {
 key: 'graph',
 icon: <GitBranch className="w-4 h-4" />,
 label: t('scenarios.editGraph', 'Edit graph'),
 description: readOnly ? readOnlyReason : undefined,
 disabled: readOnly,
 onClick: () => setGraphEditorScenarioId(scenario.id),
 },
 {
 key: 'edit',
 icon: <Edit className="w-4 h-4" />,
 label: t('scenarios.editMetadata', 'Edit metadata'),
 description: readOnly ? readOnlyReason : undefined,
 disabled: readOnly,
 onClick: () => { void handleOpenEdit(scenario); },
 },
 ...exportMenuItems(t, scenario, handleExportScenario, handleCopyScenarioJson).map((item, i) => ({ ...item, separator: i === 0 })),
 {
 key: 'delete',
 icon: <Trash2 className="w-4 h-4" />,
 label: t('common.delete', 'Delete'),
 description: readOnly ? readOnlyReason : undefined,
 disabled: readOnly,
 danger: true,
 separator: true,
 onClick: () => { void handleDelete(scenario); },
 },
 ];
 return (
 <div key={scenario.id} className="bg-bg-secondary rounded-xl overflow-hidden">
 <div className="flex items-center gap-2 md:gap-4 px-3 md:px-4 py-3">
 <IconButton
 label={expanded ? t('automations.collapse', 'Collapse') : t('automations.expand', 'Expand')}
 aria-expanded={expanded}
 onClick={() => setExpandedId(expanded ? null : scenario.id)}
 variant="plain"
 showTooltip={false}
 className="p-0 shrink-0"
 icon={expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
 />
 <div className="flex-1 min-w-0">
 <div className="flex items-center gap-2 flex-wrap">
 <span className="min-w-0 break-words text-sm font-medium text-text-primary">{scenario.name}</span>
 <ScenarioStatusBadge status={scenario.status} />
 {readOnly && (
 // Tap on the badge explains why Edit / Delete are disabled.
 <Tip content={readOnlyReason} disabled={canHover}>
 <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] uppercase tracking-wider rounded-full bg-amber-400/10 text-amber-400 border border-amber-400/30">
 🔒 Master
 </span>
 </Tip>
 )}
 <TenantBadge tenantId={scenario.tenantId} />
 <FanOutChips targetTenantIds={scenario.targetTenantIds} />
 {/* Multi-trigger: render one badge per type, with a
 (n) suffix when several nodes of the same type
 coexist. Falls back to the single legacy
 triggerType when no triggerCounts payload is
 available (defensive — the server always sends
 the counts now). */}
 {scenario.triggerCounts && Object.keys(scenario.triggerCounts).length > 0
 ? Object.entries(scenario.triggerCounts).map(([type, count]) => (
 <TriggerBadge
 key={type}
 type={type as ScenarioTriggerType}
 count={count > 1 ? count : undefined}
 />
 ))
 : <TriggerBadge type={scenario.triggerType} />}
 </div>
 <div className="flex items-center gap-3 text-xs text-text-muted mt-0.5 flex-wrap">
 <span>{itemCount} {itemLabel}{itemCount !== 1 ? 's' : ''}</span>
 <span>
 {scenario.targetType === 'all'
 ? 'All devices'
 : `${(scenario.targetIds ?? []).length} ${scenario.targetType}(s)`}
 </span>
 </div>
 </div>
 <div className="flex items-center gap-2 shrink-0">
 {compactRowActions ? (
 <>
 {/* The active-run counter stays visible (it is
 information as much as an action). */}
 {stopBadge}
 <ActionMenu
 label={t('ui.moreActions', 'More actions')}
 sheetTitle={scenario.name}
 items={rowMenuItems}
 />
 </>
 ) : (
 <>
 {/* In v2, the Play icon shows whenever the scenario has
 a manual trigger in its graph (triggerCounts.manual > 0)
 OR the legacy triggerType is 'manual'. The legacy
 check covers freshly-created scenarios that haven't
 been migrated yet — it would otherwise be dropped
 and admins couldn't fire them from the list view. */}
 {canTrigger && (
 <button
 onClick={() => handleTrigger(scenario)}
 className="p-1.5 text-text-muted hover:text-accent hover:bg-accent/10 rounded transition-colors"
 title={t('scenarios.triggerNow', 'Trigger now')}
 aria-label={t('scenarios.triggerNow', 'Trigger now')}
 >
 <Play className="w-4 h-4" />
 </button>
 )}
 {stopBadge}
 <button
 onClick={() => handleToggle(scenario)}
 className="text-text-muted hover:text-accent transition-colors"
 title={toggleLabel}
 aria-label={toggleLabel}
 >
 {scenario.status === 'active' ? <ToggleRight className="w-5 h-5 text-green-400" /> : <ToggleLeft className="w-5 h-5" />}
 </button>
 <button
 onClick={() => setHistoryForScenario(scenario)}
 className="p-1.5 text-text-muted hover:text-accent hover:bg-accent/10 rounded transition-colors"
 title={t('scenarios.runHistory', 'Run history')}
 aria-label={t('scenarios.runHistory', 'Run history')}
 >
 <History className="w-4 h-4" />
 </button>
 <button
 onClick={() => setGraphEditorScenarioId(scenario.id)}
 disabled={readOnly}
 title={readOnly ? readOnlyReason : t('scenarios.editGraph', 'Edit graph')}
 aria-label={t('scenarios.editGraph', 'Edit graph')}
 className="p-1.5 text-text-muted hover:text-accent hover:bg-accent/10 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
 >
 <GitBranch className="w-4 h-4" />
 </button>
 <button
 onClick={() => handleOpenEdit(scenario)}
 disabled={readOnly}
 title={readOnly ? readOnlyReason : t('scenarios.editMetadata', 'Edit metadata')}
 aria-label={t('scenarios.editMetadata', 'Edit metadata')}
 className="p-1.5 text-text-muted hover:text-text-primary hover:bg-bg-tertiary rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
 >
 <Edit className="w-4 h-4" />
 </button>
 {/* Export menu — explicit "lean" vs "with scripts"
 choice. Lean = scenario + nodes + edges, points
 at scripts by id (works only when the dest
 tenant already has them). With scripts =
 portable; the importer asks the user how to
 handle uuid collisions. */}
 <ExportMenu scenario={scenario} onExport={handleExportScenario} onCopy={handleCopyScenarioJson} />
 <button
 onClick={() => handleDelete(scenario)}
 disabled={readOnly}
 title={readOnly ? readOnlyReason : undefined}
 aria-label={t('common.delete', 'Delete')}
 className="p-1.5 text-text-muted hover:text-red-400 hover:bg-red-400/10 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
 >
 <Trash2 className="w-4 h-4" />
 </button>
 </>
 )}
 </div>
 </div>
 {expanded && (
 <div className=" px-4 py-3 bg-bg-tertiary/50 space-y-3">
 {scenario.description && (
 <div>
 <p className="text-xs text-text-muted uppercase font-medium mb-0.5">Description</p>
 <p className="text-sm text-text-primary">{scenario.description}</p>
 </div>
 )}
 <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
 <div>
 <p className="text-xs text-text-muted uppercase font-medium mb-0.5">Timeout</p>
 <p className="text-sm text-text-primary">{scenario.timeoutSeconds}s</p>
 </div>
 <div>
 <p className="text-xs text-text-muted uppercase font-medium mb-0.5">Retry Policy</p>
 <p className="text-sm text-text-primary">
 {scenario.retryPolicy?.maxRetries ?? 0} retries, {scenario.retryPolicy?.retryDelaySeconds ?? 60}s delay
 </p>
 </div>
 <div>
 <p className="text-xs text-text-muted uppercase font-medium mb-0.5">Notifications</p>
 <p className="text-sm text-text-primary">
 {scenario.notifyOnSuccess && 'Success '}
 {scenario.notifyOnFailure && 'Failure'}
 {!scenario.notifyOnSuccess && !scenario.notifyOnFailure && 'None'}
 </p>
 </div>
 <div>
 <p className="text-xs text-text-muted uppercase font-medium mb-0.5">Created</p>
 <p className="text-sm text-text-primary">{new Date(scenario.createdAt).toLocaleDateString()}</p>
 </div>
 </div>
 {(scenario.steps?.length ?? 0) > 0 && (
 <div>
 <p className="text-xs text-text-muted uppercase font-medium mb-2">Steps</p>
 <div className="space-y-1">
 {scenario.steps!.sort((a, b) => a.sortOrder - b.sortOrder).map((step, i) => (
 <div key={step.id} className="flex items-center gap-3 max-md:flex-wrap max-md:gap-y-1 px-3 py-2 bg-bg-secondary rounded-lg">
 <span className="text-xs font-mono text-text-muted w-5 text-center">{i + 1}</span>
 <span className="text-sm text-text-primary flex-1">{step.name}</span>
 {step.checkScript && (
 <span className="text-xs px-2 py-0.5 rounded bg-blue-400/10 text-blue-400 border border-blue-400/20">
 Check: {step.checkScript.name}
 </span>
 )}
 {step.resolveScript && (
 <span className="text-xs px-2 py-0.5 rounded bg-orange-400/10 text-orange-400 border border-orange-400/20">
 Resolve: {step.resolveScript.name}
 </span>
 )}
 <span className="text-xs text-text-muted">{step.timeoutSeconds}s</span>
 {step.retryCount > 0 && (
 <span className="text-xs text-text-muted">{step.retryCount}x retry</span>
 )}
 </div>
 ))}
 </div>
 </div>
 )}
 </div>
 )}
 </div>
 );
 })}
 </div>
 )}

 <Modal
 open={triggerModalScenario != null}
 onClose={() => { if (!isTriggering) setTriggerModalScenario(null); }}
 dismissible={!isTriggering}
 title={<>
 <span className="block truncate text-lg">{t('scenarios.runScenario', 'Run scenario')}</span>
 {triggerModalScenario && (
 <span className="block whitespace-normal break-words text-xs font-normal text-text-muted mt-0.5">{triggerModalScenario.name}</span>
 )}
 </>}
 size="lg"
 className="shadow-none sm:max-h-[80dvh] sm:supports-[not(height:100dvh)]:max-h-[80vh]"
 overlayClassName="backdrop-blur-none"
 bodyClassName="px-4 sm:px-6 py-4 space-y-3"
 footerClassName="px-4 sm:px-6 py-4"
 footer={<>
 <button
 onClick={() => setTriggerModalScenario(null)}
 disabled={isTriggering}
 className="px-4 py-2 coarse:min-h-11 text-sm text-text-muted hover:text-text-primary rounded-lg transition-colors"
 >
 {t('common.cancel', 'Cancel')}
 </button>
 <button
 onClick={confirmTrigger}
 disabled={isTriggering || triggerDeviceIds.length === 0}
 className="px-4 py-2 coarse:min-h-11 text-sm bg-accent text-white rounded-lg hover:bg-accent/90 disabled:opacity-50 transition-colors flex items-center gap-2"
 >
 <Play className="w-4 h-4" />
 {isTriggering ? t('scenarios.running', 'Running...') : t('scenarios.run', 'Run')}
 </button>
 </>}
 >
 {triggerModalScenario && (<>
 <label className="block text-xs font-medium text-text-muted uppercase">{t('scenarios.targetDevices', 'Target devices')}</label>
 <input
 type="text"
 value={triggerSearch}
 onChange={(e) => setTriggerSearch(e.target.value)}
 placeholder={t('scenarios.searchDevices', 'Search devices...')}
 autoCapitalize="off"
 autoCorrect="off"
 spellCheck={false}
 enterKeyHint="search"
 className="w-full px-3 py-2 text-sm bg-bg-tertiary rounded-lg text-text-primary focus:outline-none focus:border-accent"
 />
 {/* Phone (full-screen sheet): the list flows in the body scroll
 instead of a nested 320 px scroller. */}
 <div className="rounded-lg bg-bg-tertiary max-h-80 max-sm:max-h-none overflow-y-auto">
 {(() => {
 if (triggerLoading) {
 return <p className="text-sm text-text-muted p-3">Loading devices…</p>;
 }
 const devices = triggerDevices.filter((d) => {
 const q = triggerSearch.toLowerCase();
 return !q || (d.hostname || '').toLowerCase().includes(q) || (d.displayName || '').toLowerCase().includes(q);
 });
 if (devices.length === 0) return <p className="text-sm text-text-muted p-3">No devices in this scenario's target.</p>;
 const allSelected = devices.length > 0 && devices.every((d) => triggerDeviceIds.includes(d.id));
 return (
 <>
 <div
 className="flex items-center gap-2 px-3 py-2 coarse:min-h-11 cursor-pointer hover:bg-bg-secondary"
 onClick={() => {
 if (allSelected) setTriggerDeviceIds((prev) => prev.filter((id) => !devices.some((d) => d.id === id)));
 else setTriggerDeviceIds((prev) => Array.from(new Set([...prev, ...devices.map((d) => d.id)])));
 }}
 >
 <div className={clsx('w-4 h-4 rounded border flex items-center justify-center', allSelected ? 'bg-accent border-accent' : 'border-transparent')}>
 {allSelected && <Check className="w-3 h-3 text-white" />}
 </div>
 <span className="text-xs text-text-muted">Select all ({devices.length})</span>
 </div>
 {devices.map((d) => {
 const selected = triggerDeviceIds.includes(d.id);
 return (
 <div
 key={d.id}
 className="flex items-center gap-2 px-3 py-2 coarse:min-h-11 cursor-pointer hover:bg-bg-secondary"
 onClick={() => {
 setTriggerDeviceIds((prev) => selected ? prev.filter((id) => id !== d.id) : [...prev, d.id]);
 }}
 >
 <div className={clsx('w-4 h-4 rounded border flex items-center justify-center', selected ? 'bg-accent border-accent' : 'border-transparent')}>
 {selected && <Check className="w-3 h-3 text-white" />}
 </div>
 <span className="text-sm text-text-primary flex-1 truncate">{d.displayName || d.hostname}</span>
 <span className="text-xs text-text-muted capitalize">{d.osType}</span>
 </div>
 );
 })}
 </>
 );
 })()}
 </div>
 <p className="text-xs text-text-muted">
 {t('scenarios.devicesSelected', { count: triggerDeviceIds.length, defaultValue: '{{count}} device(s) selected' })}
 </p>
 </>)}
 </Modal>

 {historyForScenario && (
 <ScenarioHistoryModal
 scenario={historyForScenario}
 onClose={() => setHistoryForScenario(null)}
 />
 )}

 {/* v2 graph editor — rendered via createPortal directly into
 <body> so the modal escapes any ancestor stacking context
 (AppLayout, sidebar wrappers, etc.). Hardcoded z-index 200
 + inline style guarantees the modal sits above the floating
 sidebar (z-[51]) and the pinned sidebar (z-50). `top` is
 the measured bottom of the header (52 px on a plain
 desktop; more with a native tab bar, a banner or a status
 bar inset) so the Obliance topbar stays visible. */}
 {graphEditorScenarioId != null && createPortal(
 <div
 className="fixed left-0 right-0 bottom-0 bg-bg-primary pb-safe"
 style={{ top: graphTop, zIndex: 200 }}
 >
 <ScenarioGraphEditor
 scenarioId={graphEditorScenarioId}
 onClose={() => setGraphEditorScenarioId(null)}
 onStatusChanged={(next) => {
 // Patch the row in-place so the badge flips without a
 // full reload. The user can keep editing the graph.
 setScenarios((prev) => prev.map((s) =>
 s.id === graphEditorScenarioId ? { ...s, status: next } : s,
 ));
 }}
 />
 </div>,
 document.body,
 )}

 {/* Hidden file input — driven by handlePickImportFile; reset
 on each pick so re-uploading the same file triggers onChange. */}
 <input
 ref={importFileInputRef}
 type="file"
 accept="application/json,.json"
 className="hidden"
 onChange={handleImportFileSelected}
 />

 {/* Conflict-resolution modal — shown only when the imported
 file embeds scripts whose uuid already exists in the target
 tenant. The user picks per-script: skip / overwrite / new. */}
 <Modal
 open={!!importPreview && importPreview.conflicts.length > 0}
 onClose={() => { if (!importBusy) { setImportPreview(null); setImportResolutions({}); } }}
 dismissible={!importBusy}
 closeOnBackdrop={false}
 closeOnEscape={false}
 // Mouse: no x, like the former dialog (Cancel is in the footer).
 // Touch full-screen sheet: keep the x in reach at the top.
 showCloseButton={canHover ? false : undefined}
 title={<>
 <span className="flex items-center gap-2">
 <Upload className="w-4 h-4 shrink-0 text-accent" />
 <span className="min-w-0 truncate">{t('scenarios.import.conflictsTitle', 'Resolve script conflicts')}</span>
 </span>
 {importPreview && (
 <span className="block whitespace-normal text-xs font-normal text-text-muted mt-1">
 {t('scenarios.import.conflictsHint', {
 count: importPreview.conflicts.length,
 defaultValue: `The import contains {{count}} script${importPreview.conflicts.length > 1 ? 's' : ''} whose UUID already exists. Choose what to do for each.`,
 })}
 </span>
 )}
 </>}
 size="lg"
 className="sm:max-h-[80dvh] sm:supports-[not(height:100dvh)]:max-h-[80vh]"
 bodyClassName="px-5 py-3 space-y-3"
 footerClassName="px-5 py-3"
 footer={importPreview && <>
 <button
 onClick={() => { setImportPreview(null); setImportResolutions({}); }}
 disabled={importBusy}
 className="px-3 py-1.5 coarse:min-h-11 coarse:px-4 text-xs text-text-muted hover:text-text-primary disabled:opacity-50"
 >
 {t('common.cancel', 'Cancel')}
 </button>
 <button
 onClick={() => commitImport(importPreview.payload, importResolutions)}
 disabled={importBusy}
 className="px-3 py-1.5 coarse:min-h-11 coarse:px-4 text-xs bg-accent text-white rounded hover:bg-accent/80 disabled:opacity-50"
 >
 {importBusy ? t('scenarios.import.importing', 'Importing…') : t('scenarios.import.confirm', 'Confirm import')}
 </button>
 </>}
 >
 {importPreview && (<>
 {importPreview.conflicts.map((c) => {
 const choice = importResolutions[c.scriptUuid] ?? 'skip';
 return (
 <div key={c.scriptUuid} className="rounded-lg p-3">
 <div className="text-sm font-medium text-text-primary">{c.importedName}</div>
 <div className="text-[11px] text-text-muted font-mono mb-2">{c.scriptUuid}</div>
 <div className="text-[11px] text-text-muted mb-2">
 {t('scenarios.import.existingScript', 'Existing script:')} <span className="text-text-primary">{c.existingName}</span> (#{c.existingScriptId})
 </div>
 <div className="flex gap-2 flex-wrap">
 {([
 { v: 'skip', label: t('scenarios.import.keepExisting', 'Keep existing'), desc: t('scenarios.import.keepExistingDesc', 'Don\'t touch the existing script. Imported nodes point at it.') },
 { v: 'overwrite', label: t('scenarios.import.overwrite', 'Overwrite'), desc: t('scenarios.import.overwriteDesc', 'Replace the existing script body with the imported one.') },
 { v: 'new', label: t('scenarios.import.newCopy', 'Create new copy'), desc: t('scenarios.import.newCopyDesc', 'Insert as a fresh script with " (imported)" suffix.') },
 ] as Array<{ v: 'skip' | 'overwrite' | 'new'; label: string; desc: string }>).map((opt) => (
 <button
 key={opt.v}
 onClick={() => setImportResolutions({ ...importResolutions, [c.scriptUuid]: opt.v })}
 className={clsx(
 'flex-1 min-w-[120px] text-left p-2 rounded border transition-colors',
 choice === opt.v ? 'border-accent bg-accent/10 text-accent' : 'border-transparent text-text-muted hover:border-accent/40',
 )}
 >
 <div className="text-xs font-semibold">{opt.label}</div>
 <div className="text-[10px] text-text-muted/80 mt-0.5">{opt.desc}</div>
 </button>
 ))}
 </div>
 </div>
 );
 })}
 </>)}
 </Modal>
 </PageContainer>
 );
}

// ── Run history modal ────────────────────────────────────────────────────────
//
// Fetches `GET /api/scenarios/:id/runs` and lets the admin drill into any
// run to see per-step outcomes (stdout / stderr / exit code). The modal
// stays open long enough for the server to update the run status via
// SCENARIO_RUN_UPDATED socket events, so a manually-triggered run
// refreshes live.

function ScenarioHistoryModal({ scenario, onClose }: { scenario: Scenario; onClose: () => void }) {
 const { t } = useTranslation();
 // md+: run list | run detail side by side (historic layout). Below md:
 // one pane at a time — tapping a run opens its detail with a back bar
 // (two 50 % columns of 11 px monospace are unreadable on a phone).
 const isMd = useMediaQuery(MEDIA.md);
 const [runs, setRuns] = useState<ScenarioRun[]>([]);
 const [loading, setLoading] = useState(true);
 const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
 const [selectedRun, setSelectedRun] = useState<ScenarioRun | null>(null);
 const [detailLoading, setDetailLoading] = useState(false);

 const loadList = useCallback(async () => {
 setLoading(true);
 try {
 const items = await scenarioApi.listRunsForScenario(scenario.id);
 setRuns(items);
 } catch {
 toast.error('Failed to load run history');
 } finally {
 setLoading(false);
 }
 }, [scenario.id]);

 useEffect(() => { loadList(); }, [loadList]);

 // Auto-refresh while the modal is open so the admin sees status flip
 // from running → success/failure live.
 useEffect(() => {
 const t = setInterval(loadList, 4000);
 return () => clearInterval(t);
 }, [loadList]);

 // Drill-down: load full detail (step runs, stdout/stderr) when selected.
 useEffect(() => {
 if (!selectedRunId) { setSelectedRun(null); return; }
 setDetailLoading(true);
 scenarioApi.getRun(selectedRunId)
 .then(setSelectedRun)
 .catch(() => toast.error('Failed to load run detail'))
 .finally(() => setDetailLoading(false));
 }, [selectedRunId]);

 const statusColor = (s: string) => {
 switch (s) {
 case 'success': return 'text-green-400 bg-green-400/10 border-green-400/30';
 case 'failure': return 'text-red-400 bg-red-400/10 border-red-400/30';
 case 'cancelled': return 'text-gray-400 bg-gray-400/10 border-gray-400/30';
 case 'running': return 'text-blue-400 bg-blue-400/10 border-blue-400/30';
 case 'pending': return 'text-yellow-400 bg-yellow-400/10 border-yellow-400/30';
 default: return 'text-text-muted bg-bg-tertiary border-transparent';
 }
 };
 const statusIcon = (s: string) => {
 switch (s) {
 case 'success': return <CheckCircle2 className="w-3 h-3" />;
 case 'failure': return <AlertCircle className="w-3 h-3" />;
 case 'running': return <Loader2 className="w-3 h-3 animate-spin" />;
 case 'pending': return <Clock className="w-3 h-3" />;
 default: return <Minus className="w-3 h-3" />;
 }
 };

 // Narrow: Android back / Escape returns from a run's detail to the list
 // (registered after the Modal's own handler, so it wins while active).
 const showDetailOnly = !isMd && selectedRunId != null;
 useNativeBack(() => setSelectedRunId(null), showDetailOnly, { escape: true });

 return (
 <Modal
 open
 onClose={onClose}
 size="2xl"
 className="bg-bg-primary shadow-xl sm:max-w-5xl sm:max-h-[90dvh] sm:supports-[not(height:100dvh)]:max-h-[90vh]"
 overlayClassName="bg-black/50 backdrop-blur-none"
 bodyClassName="p-0 flex overflow-hidden"
 title={<>
 <span className="flex items-center gap-2 min-w-0">
 <History className="w-4 h-4 shrink-0" />
 <span className="truncate">
 {t('scenarios.history.title', { name: scenario.name, defaultValue: 'Run history — {{name}}' })}
 </span>
 </span>
 <span className="block text-xs font-normal text-text-muted mt-0.5">
 {loading
 ? t('common.loading', 'Loading…')
 : t('scenarios.history.runCount', { count: runs.length, defaultValue: `{{count}} run${runs.length !== 1 ? 's' : ''}` })}
 </span>
 </>}
 >
 <div className="flex-1 min-h-0 min-w-0 flex flex-col md:flex-row">
 {/* Left: run list (full width below md until a run is picked) */}
 <div className={clsx('md:w-1/2 min-h-0 overflow-y-auto overscroll-contain', showDetailOnly ? 'hidden' : 'flex-1 md:flex-none')}>
 {loading ? (
 <div className="p-8 text-center text-xs text-text-muted">{t('common.loading', 'Loading…')}</div>
 ) : runs.length === 0 ? (
 <div className="p-8 text-center text-xs text-text-muted">
 {t('scenarios.history.empty', 'No runs yet. Trigger the scenario to create one.')}
 </div>
 ) : (
 <div className="divide-y divide-border/50">
 {runs.map((run) => {
 const name = run.device?.displayName || run.device?.hostname || `#${run.deviceId}`;
 const started = run.startedAt || run.createdAt;
 return (
 <button
 key={run.id}
 onClick={() => setSelectedRunId(run.id)}
 className={clsx(
 'w-full px-3 py-2 coarse:py-3 flex items-start gap-2 text-left text-xs transition-colors',
 selectedRunId === run.id
 ? 'bg-accent/15 text-text-primary'
 : 'hover:bg-bg-secondary text-text-primary',
 )}
 >
 <span className={clsx(
 'inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-medium flex-shrink-0 mt-0.5',
 statusColor(run.status),
 )}>
 {statusIcon(run.status)}
 {run.status}
 </span>
 <div className="flex-1 min-w-0">
 <div className="font-medium truncate">{name}</div>
 <div className="text-[10px] text-text-muted mt-0.5">
 {run.triggerType} · {new Date(started).toLocaleString()}
 {run.finishedAt && run.startedAt && (
 <> · {Math.round(
 (new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()) / 1000,
 )}s</>
 )}
 </div>
 </div>
 </button>
 );
 })}
 </div>
 )}
 </div>

 {/* Right: selected run detail (below md: only once a run is picked, with a back bar) */}
 <div className={clsx('md:w-1/2 min-h-0 overflow-y-auto overscroll-contain p-3', showDetailOnly ? 'flex-1' : 'hidden md:block')}>
 {showDetailOnly && (
 <div className="-mx-3 -mt-3 mb-3 px-2 py-1.5 flex items-center gap-2 sticky -top-3 z-10 bg-bg-primary">
 <IconButton
 label={t('common.back', 'Back')}
 icon={<ArrowLeft className="w-4 h-4" />}
 onClick={() => setSelectedRunId(null)}
 />
 <span className="min-w-0 flex-1 truncate text-sm font-medium text-text-primary">
 {(() => {
 const r = runs.find((x) => x.id === selectedRunId) ?? selectedRun;
 return r ? (r.device?.displayName || r.device?.hostname || `#${r.deviceId}`) : '';
 })()}
 </span>
 </div>
 )}
 {!selectedRunId ? (
 <div className="flex items-center justify-center h-full text-xs text-text-muted">
 {t('scenarios.history.pickRun', 'Pick a run to see step-by-step output.')}
 </div>
 ) : detailLoading ? (
 <div className="flex items-center justify-center h-full">
 <Loader2 className="w-4 h-4 animate-spin text-text-muted" />
 </div>
 ) : !selectedRun ? (
 <div className="flex items-center justify-center h-full text-xs text-text-muted">
 {t('scenarios.history.runGone', 'Run no longer exists.')}
 </div>
 ) : (
 <div className="space-y-2">
 {selectedRun.errorMessage && (
 <div className="p-2 rounded border border-red-400/30 bg-red-400/10 text-[11px] text-red-400 font-mono whitespace-pre-wrap">
 {selectedRun.errorMessage}
 </div>
 )}
 {/* v2 graphs populate `nodeRuns`; v1 scenarios use the
 legacy `stepRuns`. We render whichever is non-empty;
 if both are empty, the run truly has no trace yet. */}
 {(selectedRun.nodeRuns ?? []).length > 0 ? (
 (selectedRun.nodeRuns ?? []).map((nr) => (
 <div key={nr.id} className="rounded-lg overflow-hidden">
 <div className="flex items-center gap-2 px-3 py-2 bg-bg-secondary flex-wrap">
 <span className={clsx(
 'inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-medium',
 statusColor(nr.status === 'failed' ? 'failure' : nr.status),
 )}>
 {statusIcon(nr.status === 'failed' ? 'failure' : nr.status)}
 {nr.status}
 </span>
 <span className="text-xs font-medium text-text-primary truncate flex-1 min-w-0">
 {nr.nodeLabel || nr.nodeType}
 </span>
 <span className="text-[10px] text-text-muted/70 font-mono">
 {nr.nodeType.replace(/^trigger_/, 'trigger:').replace(/^run_/, 'run:').replace(/^end_/, 'end:')}
 </span>
 {typeof nr.exitCode === 'number' && (
 <span className={clsx(
 'text-[10px] font-mono px-1.5 py-0 rounded border',
 nr.exitCode === 0
 ? 'text-green-400 bg-green-400/10 border-green-400/30'
 : 'text-red-400 bg-red-400/10 border-red-400/30',
 )}>
 exit {nr.exitCode}
 </span>
 )}
 </div>
 {(nr.stdout || nr.stderr || nr.errorMessage) && (
 <div className="px-3 py-2 text-[11px] font-mono space-y-2 bg-bg-primary">
 {nr.errorMessage && (
 <div className="text-red-400 bg-red-400/10 border border-red-400/30 rounded px-2 py-1.5">
 {nr.errorMessage}
 </div>
 )}
 {nr.stdout && (
 <div>
 <div className="text-text-muted flex items-center gap-1"><Terminal className="w-3 h-3" />stdout</div>
 <pre className="whitespace-pre-wrap text-text-primary">{nr.stdout.slice(-2000)}</pre>
 </div>
 )}
 {nr.stderr && (
 <div>
 <div className="text-red-400/70">stderr</div>
 <pre className="whitespace-pre-wrap text-red-400/80">{nr.stderr.slice(-2000)}</pre>
 </div>
 )}
 </div>
 )}
 </div>
 ))
 ) : (selectedRun.stepRuns ?? []).length === 0 ? (
 <div className="text-xs text-text-muted">No step runs recorded.</div>
 ) : (
 (selectedRun.stepRuns ?? []).map((sr) => (
 <div key={sr.id} className="rounded-lg overflow-hidden">
 <div className="flex items-center gap-2 px-3 py-2 bg-bg-secondary flex-wrap">
 <span className={clsx(
 'inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-medium',
 statusColor(sr.status),
 )}>
 {statusIcon(sr.status)}
 {sr.status}
 </span>
 <span className="text-xs font-medium text-text-primary truncate flex-1 min-w-0">
 {sr.step?.name || `Step ${sr.sortOrder + 1}`}
 </span>
 {typeof sr.checkExitCode === 'number' && (
 <span className="text-[10px] text-text-muted font-mono">check={sr.checkExitCode}</span>
 )}
 {typeof sr.resolveExitCode === 'number' && (
 <span className="text-[10px] text-text-muted font-mono">resolve={sr.resolveExitCode}</span>
 )}
 {typeof sr.recheckExitCode === 'number' && (
 <span className="text-[10px] text-text-muted font-mono">recheck={sr.recheckExitCode}</span>
 )}
 </div>
 {(sr.checkStdout || sr.checkStderr || sr.resolveStdout || sr.resolveStderr || sr.recheckStdout || sr.recheckStderr) && (
 <div className="px-3 py-2 text-[11px] font-mono space-y-2 bg-bg-primary">
 {sr.checkStdout && (
 <div>
 <div className="text-text-muted flex items-center gap-1"><Terminal className="w-3 h-3" />check stdout</div>
 <pre className="whitespace-pre-wrap text-text-primary">{sr.checkStdout.slice(-2000)}</pre>
 </div>
 )}
 {sr.checkStderr && (
 <div>
 <div className="text-red-400/70">check stderr</div>
 <pre className="whitespace-pre-wrap text-red-400/80">{sr.checkStderr.slice(-2000)}</pre>
 </div>
 )}
 {sr.resolveStdout && (
 <div>
 <div className="text-text-muted flex items-center gap-1"><Terminal className="w-3 h-3" />resolve stdout</div>
 <pre className="whitespace-pre-wrap text-text-primary">{sr.resolveStdout.slice(-2000)}</pre>
 </div>
 )}
 {sr.resolveStderr && (
 <div>
 <div className="text-red-400/70">resolve stderr</div>
 <pre className="whitespace-pre-wrap text-red-400/80">{sr.resolveStderr.slice(-2000)}</pre>
 </div>
 )}
 {sr.recheckStdout && (
 <div>
 <div className="text-text-muted flex items-center gap-1"><Terminal className="w-3 h-3" />recheck stdout</div>
 <pre className="whitespace-pre-wrap text-text-primary">{sr.recheckStdout.slice(-2000)}</pre>
 </div>
 )}
 {sr.recheckStderr && (
 <div>
 <div className="text-red-400/70">recheck stderr</div>
 <pre className="whitespace-pre-wrap text-red-400/80">{sr.recheckStderr.slice(-2000)}</pre>
 </div>
 )}
 </div>
 )}
 </div>
 ))
 )}
 </div>
 )}
 </div>
 </div>
 </Modal>
 );
}
