import { useEffect, useRef, useState, useCallback } from 'react';
import { Plus, Edit, Trash2, RefreshCw, TerminalSquare, Loader2, FolderOpen, ChevronRight, ChevronDown, Wand2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { clsx } from 'clsx';
import { Trans, useTranslation } from 'react-i18next';
import { customSectionApi } from '@/api/customSection.api';
import { groupsApi } from '@/api/groups.api';
import { useDeviceStore } from '@/store/deviceStore';
import { ToggleSwitch } from '@/components/common/ToggleSwitch';
import { DashboardBuilder } from '@/components/customSections/DashboardBuilder';
import type { CustomSection, CustomSectionRenderMode, DeviceGroupTreeNode } from '@obliance/shared';
import { TenantBadge } from '@/components/common/TenantBadge';
import { TenantFilterChips } from '@/components/common/TenantFilterChips';
import { useTenantFilter } from '@/hooks/useTenantFilter';
import { PageContainer } from '@/components/common/PageContainer';
import { IconButton } from '@/components/common/IconButton';
import { Modal } from '@/components/common/Modal';
import { useConfirm } from '@/components/common/ConfirmDialog';
import { useIsCoarsePointer } from '@/hooks/useMediaQuery';
import { useNativeBack } from '@/hooks/useNativeBack';

interface FormData {
 name: string;
 description: string;
 command: string;
 platform: 'all' | 'windows' | 'linux' | 'macos';
 runtime: 'bash' | 'sh' | 'powershell' | 'cmd';
 usePty: boolean;
 renderMode: CustomSectionRenderMode;
 autoRefreshEnabled: boolean;
 autoRefreshIntervalSeconds: number;
 targetType: 'all' | 'group' | 'device';
 targetIds: number[];
}

const emptyForm: FormData = {
 name: '',
 description: '',
 command: '',
 platform: 'linux',
 runtime: 'bash',
 usePty: true,
 renderMode: 'terminal',
 autoRefreshEnabled: false,
 autoRefreshIntervalSeconds: 30,
 targetType: 'all',
 targetIds: [],
};

/**
 * Squash the multi-line script body into a single short preview for the
 * list row. Long PowerShell scripts otherwise produce a 200-char one-
 * liner via the row's `truncate` and a horizontal scrollbar that hides
 * the action buttons on the right. We grab the first non-empty line and
 * cap it at ~120 chars; full body remains visible in the tooltip and
 * inside the edit form.
 */
function commandPreview(cmd: string): { preview: string; isMultiline: boolean } {
 const lines = (cmd ?? '').split(/\r?\n/);
 const firstReal = lines.find((l) => l.trim().length > 0) ?? '';
 const trimmed = firstReal.trim();
 const cap = 120;
 const preview = trimmed.length > cap ? `${trimmed.slice(0, cap)}…` : trimmed;
 const isMultiline = lines.length > 1 && lines.slice(1).some((l) => l.trim().length > 0);
 return { preview, isMultiline };
}

export function CustomSectionsPage({ embedded }: { embedded?: boolean } = {}) {
 const { t } = useTranslation();
 const confirm = useConfirm();
 const coarse = useIsCoarsePointer();
 const tenantFilter = useTenantFilter();
 const [sections, setSections] = useState<CustomSection[]>([]);
 const [isLoading, setIsLoading] = useState(true);
 const [editing, setEditing] = useState<CustomSection | null>(null);
 const [isCreating, setIsCreating] = useState(false);
 const [form, setForm] = useState<FormData>(emptyForm);
 const [isSaving, setIsSaving] = useState(false);
 const [groupTree, setGroupTree] = useState<DeviceGroupTreeNode[]>([]);
 /** Dashboard builder modal — only meaningful for HTML render mode. */
 const [builderOpen, setBuilderOpen] = useState(false);
 /** Touch: the full command of a row, expanded in place (it was only in title=). */
 const [expandedCmdId, setExpandedCmdId] = useState<number | null>(null);
 /** Form snapshot taken on open — used to guard accidental dismissals on touch. */
 const initialFormRef = useRef<FormData>(emptyForm);
 const { getDeviceList, fetchDevices } = useDeviceStore();

 const load = useCallback(async () => {
 setIsLoading(true);
 try {
 const [list, tree] = await Promise.all([
 customSectionApi.list(),
 groupsApi.tree().catch(() => []),
 ]);
 setSections(list);
 setGroupTree(tree);
 } catch {
 toast.error(t('customSections.loadFailed', 'Failed to load custom sections'));
 } finally {
 setIsLoading(false);
 }
 }, [t]);

 useEffect(() => { load(); }, [load]);
 useEffect(() => { fetchDevices(); }, [fetchDevices]);

 const openCreate = () => {
 initialFormRef.current = emptyForm;
 setForm(emptyForm);
 setEditing(null);
 setIsCreating(true);
 };

 const openEdit = (s: CustomSection) => {
 const next: FormData = {
 name: s.name,
 description: s.description ?? '',
 command: s.command,
 platform: s.platform,
 runtime: s.runtime,
 usePty: s.usePty,
 renderMode: s.renderMode ?? 'terminal',
 autoRefreshEnabled: s.autoRefreshEnabled ?? false,
 autoRefreshIntervalSeconds: s.autoRefreshIntervalSeconds ?? 30,
 targetType: s.targetType,
 targetIds: s.targetIds ?? [],
 };
 initialFormRef.current = next;
 setForm(next);
 setEditing(s);
 setIsCreating(false);
 };

 const closeForm = () => {
 setBuilderOpen(false);
 setEditing(null);
 setIsCreating(false);
 };

 // Close button / backdrop / Android back (and Escape on touch devices with
 // a keyboard). On touch a stray back gesture or backdrop tap would silently
 // drop a pasted script — ask first when the form was changed. Desktop
 // behaviour is unchanged: Escape does nothing there (see closeOnEscape on
 // the Modal), X / Cancel / backdrop close silently as before.
 const requestClose = async () => {
 if (isSaving) return;
 const dirty = JSON.stringify(form) !== JSON.stringify(initialFormRef.current);
 if (coarse && dirty && !(await confirm({
 message: t('customSections.discardConfirm', 'Discard your changes?'),
 confirmLabel: t('customSections.discard', 'Discard'),
 danger: true,
 }))) return;
 closeForm();
 };

 // The dashboard builder is its own overlay: Android back closes it first
 // instead of the edit dialog underneath. Escape is swallowed (the builder
 // deliberately ignores it, and it must not reach the Modal below and
 // discard the edit form either).
 useNativeBack((source) => {
 if (source === 'escape') return true;
 setBuilderOpen(false);
 }, builderOpen, { escape: true });

 const handleSave = async () => {
 if (!form.name.trim() || !form.command.trim()) {
 toast.error(t('customSections.nameCommandRequired', 'Name and command are required'));
 return;
 }
 setIsSaving(true);
 try {
 if (editing) {
 await customSectionApi.update(editing.id, form);
 toast.success(t('customSections.updated', 'Custom section updated'));
 } else {
 await customSectionApi.create(form);
 toast.success(t('customSections.created', 'Custom section created'));
 }
 closeForm();
 await load();
 } catch {
 toast.error(t('customSections.saveFailed', 'Failed to save'));
 } finally {
 setIsSaving(false);
 }
 };

 const handleDelete = async (s: CustomSection) => {
 if (!(await confirm({
 message: t('customSections.deleteConfirm', { name: s.name, defaultValue: 'Delete custom section "{{name}}"?' }),
 danger: true,
 }))) return;
 try {
 await customSectionApi.delete(s.id);
 toast.success(t('common.deleted', 'Deleted'));
 await load();
 } catch {
 toast.error(t('customSections.deleteFailed', 'Failed to delete'));
 }
 };

 const showForm = isCreating || editing !== null;

 const targetSummary = (s: CustomSection) => (
 s.targetType === 'all' ? t('customSections.targetAllLower', 'all devices')
 : s.targetType === 'group' ? t('customSections.targetGroupCount', { count: s.targetIds.length, defaultValue: '{{count}} group(s)' })
 : t('customSections.targetDeviceCount', { count: s.targetIds.length, defaultValue: '{{count}} device(s)' })
 );

 return (
 <PageContainer embedded={embedded} className="space-y-4">
 <div className="flex flex-wrap items-center justify-between gap-2">
 {!embedded ? (
 <div className="flex items-center gap-2">
 <TerminalSquare className="w-5 h-5 text-text-muted" />
 <h1 className="text-xl font-semibold text-text-primary">{t('customSections.title', 'Custom Sections')}</h1>
 </div>
 ) : <div />}
 <div className="flex items-center gap-2 ml-auto">
 <IconButton
 label={t('common.refresh', 'Refresh')}
 icon={<RefreshCw className={clsx('w-4 h-4', isLoading && 'animate-spin')} />}
 size="lg"
 variant="plain"
 onClick={load}
 disabled={isLoading}
 className="rounded-lg disabled:opacity-100"
 />
 <button onClick={openCreate} className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-accent text-white rounded-lg hover:bg-accent/90 transition-colors coarse:min-h-10">
 <Plus className="w-4 h-4" />
 {t('customSections.newSection', 'New section')}
 </button>
 </div>
 </div>

 <p className="text-xs text-text-muted">
 <Trans
 i18nKey="customSections.intro"
 defaults="Custom sections appear as dedicated tabs between <strong>Remote</strong> and <strong>Explorer</strong> on each targeted device. Clicking the tab opens a read-only console that streams the configured command's live output. The process is killed when the tab is closed."
 components={{ strong: <strong /> }}
 />
 </p>

 <div className="grid gap-2">
 {isLoading ? (
 <div className="text-center text-text-muted text-sm py-8">
 <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />
 {t('common.loading', 'Loading…')}
 </div>
 ) : sections.length === 0 ? (
 <div className="text-center text-text-muted text-sm py-8">
 {t('customSections.empty', 'No custom sections yet. Click "New section" to create one.')}
 </div>
 ) : (
 <>
 <TenantFilterChips
 value={tenantFilter.value}
 onChange={tenantFilter.setValue}
 availableTenantIds={[...new Set(sections.map((s) => s.tenantId))]}
 className="mb-2"
 />
 {sections
 .filter((s) => tenantFilter.value.size === 0 || tenantFilter.value.has(s.tenantId))
 .map((s) => {
 const { preview, isMultiline } = commandPreview(s.command);
 const cmdExpanded = coarse && expandedCmdId === s.id;
 const previewNode = preview || <em className="text-text-muted/60">{t('customSections.emptyCommand', '(empty)')}</em>;
 return (
 <div key={s.id} className="p-3 bg-bg-secondary rounded-lg flex items-center gap-3 min-w-0">
 <TerminalSquare className="w-4 h-4 text-accent shrink-0" />
 <div className="flex-1 min-w-0">
 <div className="flex items-center gap-2 flex-wrap">
 <span className="text-sm font-semibold text-text-primary truncate">{s.name}</span>
 <span className="text-[10px] text-text-muted uppercase">{s.platform}</span>
 <span className="text-[10px] text-text-muted uppercase">{s.runtime}</span>
 {s.usePty && <span className="text-[10px] text-accent">pty</span>}
 {s.renderMode === 'html' && (
 <span className="text-[10px] px-1.5 py-0 rounded-full border border-purple-400/30 bg-purple-400/10 text-purple-400 uppercase tracking-wide">html</span>
 )}
 {isMultiline && (
 <span className="text-[10px] px-1.5 py-0 rounded-full text-text-muted">{t('customSections.multiline', 'multi-line script')}</span>
 )}
 <TenantBadge tenantId={s.tenantId} />
 </div>
 {coarse ? (
 // Touch: the full command was only in a hover title — tap to expand it.
 <button
 type="button"
 onClick={() => setExpandedCmdId(cmdExpanded ? null : s.id)}
 aria-expanded={cmdExpanded}
 aria-label={t('customSections.showCommand', 'Show full command')}
 className="block w-full text-left text-xs text-text-muted font-mono truncate mt-0.5 min-h-8"
 >
 {previewNode}
 </button>
 ) : (
 <div className="text-xs text-text-muted font-mono truncate mt-0.5" title={s.command}>{previewNode}</div>
 )}
 {cmdExpanded && (
 <pre className="mt-1 max-h-48 overflow-auto overscroll-contain rounded bg-bg-tertiary p-2 text-[11px] font-mono text-text-primary whitespace-pre-wrap break-all">{s.command}</pre>
 )}
 <div className="text-[10px] text-text-muted mt-0.5">
 {t('customSections.target', 'Target')}: {targetSummary(s)}
 </div>
 </div>
 <IconButton
 label={t('common.edit', 'Edit')}
 icon={<Edit className="w-3.5 h-3.5" />}
 variant="plain"
 onClick={() => openEdit(s)}
 className="hover:text-accent shrink-0"
 />
 <IconButton
 label={t('common.delete', 'Delete')}
 icon={<Trash2 className="w-3.5 h-3.5" />}
 variant="plain"
 onClick={() => handleDelete(s)}
 className="hover:text-red-400 shrink-0"
 />
 </div>
 );
 })}
 </>
 )}
 </div>

 {/* Edit/create modal — shared Modal: full screen below sm, scrolling
 body, Android back closes it. Escape only on touch devices (guarded by
 the dirty check); on desktop it keeps doing nothing, as the old
 overlay did — a stray Escape must not drop a pasted script. */}
 <Modal
 open={showForm}
 onClose={() => { void requestClose(); }}
 closeOnEscape={coarse}
 title={editing ? t('customSections.editTitle', 'Edit custom section') : t('customSections.newTitle', 'New custom section')}
 size="lg"
 dismissible={!isSaving}
 bodyClassName="px-5 py-4 space-y-3"
 footerClassName="px-5"
 footer={<>
 <button onClick={() => { void requestClose(); }} disabled={isSaving} className="px-3 py-1.5 text-sm text-text-muted hover:text-text-primary rounded transition-colors coarse:min-h-10">{t('common.cancel', 'Cancel')}</button>
 <button onClick={handleSave} disabled={isSaving} className="px-4 py-1.5 text-sm bg-accent text-white rounded hover:bg-accent/90 disabled:opacity-50 transition-colors flex items-center gap-2 coarse:min-h-10">
 {isSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
 {editing ? t('customSections.update', 'Update') : t('common.create', 'Create')}
 </button>
 </>}
 >
 <div>
 <label className="text-xs text-text-muted uppercase">{t('customSections.nameLabel', 'Name (tab label)')}</label>
 <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
 placeholder="HTOP"
 className="w-full mt-1 px-3 py-2 text-sm bg-bg-tertiary rounded-lg focus:outline-none focus:border-accent" />
 </div>
 <div>
 <label className="text-xs text-text-muted uppercase">{t('customSections.descriptionLabel', 'Description (optional)')}</label>
 <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
 className="w-full mt-1 px-3 py-2 text-sm bg-bg-tertiary rounded-lg focus:outline-none focus:border-accent" />
 </div>
 <div>
 <div className="flex flex-wrap items-center justify-between gap-2">
 <label className="text-xs text-text-muted uppercase">{t('customSections.commandLabel', 'Command or script')}</label>
 {/* Dashboard builder shortcut — only useful for HTML
 render mode; the generated script outputs the
 Obliance-branded dashboard markup. Hidden in
 terminal mode where a hand-written one-liner
 (htop / tail -f) is the whole point. */}
 {form.renderMode === 'html' && (
 <button
 type="button"
 onClick={() => setBuilderOpen(true)}
 className="inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded-md border border-purple-400/30 bg-purple-400/10 text-purple-400 hover:bg-purple-400/20 transition-colors coarse:min-h-10 coarse:px-3"
 >
 <Wand2 className="w-3 h-3" /> {t('customSections.dashboardBuilder', 'Dashboard builder')}
 </button>
 )}
 </div>
 <textarea value={form.command} onChange={(e) => setForm({ ...form, command: e.target.value })}
 rows={form.command.includes('\n') ? 12 : 4} placeholder={t('customSections.commandPlaceholder', 'htop\n\n# or paste a full script — PowerShell, bash, …')}
 autoCapitalize="off" autoCorrect="off" spellCheck={false}
 className="w-full mt-1 px-3 py-2 text-sm bg-bg-tertiary rounded-lg focus:outline-none focus:border-accent font-mono whitespace-pre" />
 <p className="text-[10px] text-text-muted mt-1">
 <Trans
 i18nKey="customSections.commandHint"
 defaults="Initially intended for a single command (htop, top, etc.) but accepts a full script too. PowerShell scripts can output an HTML document — see render mode below. The <strong>Dashboard builder</strong> generates a self-contained script from a sample output if you want a kickstart."
 components={{ strong: <strong /> }}
 />
 </p>
 </div>
 {builderOpen && (
 <DashboardBuilder
 runtime={form.runtime === 'powershell' ? 'powershell' : 'sh'}
 initialCommand={form.command}
 initialTitle={form.name}
 onClose={() => setBuilderOpen(false)}
 onInsert={(generated, runtime) => {
 setForm((prev) => ({
 ...prev,
 command: generated,
 runtime: runtime === 'powershell' ? 'powershell' : 'bash',
 // Builder always produces HTML output.
 renderMode: 'html',
 usePty: false,
 }));
 setBuilderOpen(false);
 }}
 />
 )}
 <div className="grid grid-cols-2 gap-3">
 <div>
 <label className="text-xs text-text-muted uppercase">{t('customSections.platform', 'Platform')}</label>
 <select value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value as any })}
 className="w-full mt-1 px-3 py-2 text-sm bg-bg-tertiary rounded-lg focus:outline-none focus:border-accent">
 <option value="all">{t('common.all', 'All')}</option>
 <option value="linux">Linux</option>
 <option value="windows">Windows</option>
 <option value="macos">macOS</option>
 </select>
 </div>
 <div>
 <label className="text-xs text-text-muted uppercase">{t('customSections.runtime', 'Runtime')}</label>
 <select value={form.runtime} onChange={(e) => setForm({ ...form, runtime: e.target.value as any })}
 className="w-full mt-1 px-3 py-2 text-sm bg-bg-tertiary rounded-lg focus:outline-none focus:border-accent">
 <option value="bash">bash</option>
 <option value="sh">sh</option>
 <option value="powershell">powershell</option>
 <option value="cmd">cmd</option>
 </select>
 </div>
 </div>
 <ToggleSwitch
 checked={form.usePty}
 onChange={(v) => setForm({ ...form, usePty: v })}
 label={t('customSections.usePty', 'Use PTY')}
 description={t('customSections.usePtyHint', 'Required for curses apps: htop, top, less, watch...')}
 />

 <div>
 <label className="text-xs text-text-muted uppercase">{t('customSections.renderMode', 'Render mode')}</label>
 <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-1">
 <button type="button"
 onClick={() => setForm({ ...form, renderMode: 'terminal', usePty: form.usePty })}
 className={clsx(
 'p-2.5 text-left rounded-lg border transition-colors',
 form.renderMode === 'terminal' ? 'bg-accent/10 border-accent text-accent' : 'border-transparent text-text-muted hover:border-accent/50',
 )}>
 <div className="text-sm font-semibold">{t('customSections.renderTerminal', 'Terminal stream')}</div>
 <div className="text-[10px] mt-0.5 coarse:text-xs">{t('customSections.renderTerminalHint', 'Live xterm console — htop, tail -f, anything CLI.')}</div>
 </button>
 <button type="button"
 onClick={() => setForm({ ...form, renderMode: 'html', usePty: false })}
 className={clsx(
 'p-2.5 text-left rounded-lg border transition-colors',
 form.renderMode === 'html' ? 'bg-purple-400/10 border-purple-400 text-purple-400' : 'border-transparent text-text-muted hover:border-purple-400/50',
 )}>
 <div className="text-sm font-semibold">{t('customSections.renderHtml', 'HTML document')}</div>
 <div className="text-[10px] mt-0.5 coarse:text-xs">
 <Trans
 i18nKey="customSections.renderHtmlHint"
 defaults="Script writes a full HTML page (e.g. PowerShell <code>ConvertTo-Html</code>) — rendered in a sandboxed panel."
 components={{ code: <code className="font-mono" /> }}
 />
 </div>
 </button>
 </div>
 {form.renderMode === 'html' && (
 <p className="text-[10px] text-text-muted mt-2">
 {t('customSections.htmlPtyNote', 'PTY is forced off for HTML output — terminal control sequences corrupt the document. Sandboxed iframe means scripts/forms are blocked, only static HTML + CSS render.')}
 </p>
 )}
 </div>

 {/* Auto-refresh — HTML mode only. Cycle is "run → wait
 N seconds → run", measured from the previous run's
 exit, so a slow-running script never overlaps with
 itself. Useful for self-updating dashboards
 (uptime / inventory / latest events). */}
 {form.renderMode === 'html' && (
 <div className="rounded-lg p-3 space-y-2 bg-bg-tertiary/30">
 <ToggleSwitch
 checked={form.autoRefreshEnabled}
 onChange={(v) => setForm({ ...form, autoRefreshEnabled: v })}
 label={t('customSections.autoRefresh', 'Auto refresh')}
 description={t('customSections.autoRefreshHint', 'Re-run the script at a fixed cadence so the panel acts as a live dashboard.')}
 />
 {form.autoRefreshEnabled && (
 <div>
 <label className="text-[11px] text-text-muted uppercase">{t('customSections.interval', 'Interval (seconds)')}</label>
 <input
 type="number" min={1} max={3600}
 inputMode="numeric"
 value={form.autoRefreshIntervalSeconds}
 onChange={(e) => {
 const n = parseInt(e.target.value, 10);
 setForm({ ...form, autoRefreshIntervalSeconds: Number.isFinite(n) && n > 0 ? n : 1 });
 }}
 className="w-32 mt-1 px-3 py-1.5 text-sm bg-bg-tertiary rounded-lg focus:outline-none focus:border-accent"
 />
 <p className="text-[10px] text-text-muted mt-1">
 {t('customSections.intervalHint', 'The cycle starts when the previous run exits — a 30s interval on a 5s script means a refresh every ~35s. Minimum 1s, max 3600s (1h).')}
 </p>
 </div>
 )}
 </div>
 )}

 <div>
 <label className="text-xs text-text-muted uppercase">{t('customSections.target', 'Target')}</label>
 <div className="flex flex-wrap gap-2 mt-1">
 {(['all', 'group', 'device'] as const).map((tt) => (
 <button key={tt} onClick={() => setForm({ ...form, targetType: tt, targetIds: [] })}
 className={clsx('px-3 py-1.5 text-xs rounded-lg border transition-colors coarse:min-h-10', form.targetType === tt ? 'bg-accent/10 border-accent text-accent' : 'border-transparent text-text-muted hover:border-accent/50')}>
 {tt === 'all' ? t('customSections.targetAll', 'All devices') : tt === 'group' ? t('customSections.targetGroups', 'Groups') : t('customSections.targetDevices', 'Specific devices')}
 </button>
 ))}
 </div>
 {form.targetType === 'group' && groupTree.length > 0 && (
 <div className="mt-2 max-h-40 coarse:max-h-64 overflow-y-auto overscroll-contain rounded-lg p-2">
 <GroupTreeSelector nodes={groupTree} selected={form.targetIds}
 onChange={(ids) => setForm({ ...form, targetIds: ids })} />
 </div>
 )}
 {form.targetType === 'device' && (
 <div className="mt-2 max-h-40 coarse:max-h-64 overflow-y-auto overscroll-contain rounded-lg p-2 space-y-1">
 {getDeviceList()
 .filter((d) => form.platform === 'all' || d.osType === form.platform)
 .map((d) => {
 const checked = form.targetIds.includes(d.id);
 return (
 <label key={d.id} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-bg-tertiary px-1 rounded coarse:min-h-10 coarse:px-2">
 <input type="checkbox" checked={checked}
 onChange={(e) => setForm({ ...form, targetIds: e.target.checked ? [...form.targetIds, d.id] : form.targetIds.filter((id) => id !== d.id) })} />
 <span className="truncate">{d.displayName || d.hostname}</span>
 </label>
 );
 })}
 </div>
 )}
 </div>
 </Modal>
 </PageContainer>
 );
}

function GroupTreeSelector({ nodes, selected, onChange, depth = 0 }: { nodes: DeviceGroupTreeNode[]; selected: number[]; onChange: (ids: number[]) => void; depth?: number }) {
 const { t } = useTranslation();
 const [expanded, setExpanded] = useState<Set<number>>(new Set());
 return (
 <div>
 {nodes.map((n) => {
 const isOpen = expanded.has(n.id);
 const isSelected = selected.includes(n.id);
 return (
 <div key={n.id} style={{ marginLeft: depth * 16 }}>
 <div className="flex items-center gap-1.5 py-0.5 coarse:py-0 coarse:min-h-10">
 {n.children.length > 0 ? (
 <button
 type="button"
 aria-expanded={isOpen}
 aria-label={isOpen ? t('customSections.collapseGroup', 'Collapse {{name}}', { name: n.name }) : t('customSections.expandGroup', 'Expand {{name}}', { name: n.name })}
 onClick={() => {
 const next = new Set(expanded);
 isOpen ? next.delete(n.id) : next.add(n.id);
 setExpanded(next);
 }}
 className="coarse:inline-flex coarse:min-h-10 coarse:min-w-10 coarse:items-center coarse:justify-center coarse:-ml-3 coarse:-mr-2"
 >
 {isOpen ? <ChevronDown className="w-3 h-3 text-text-muted coarse:w-4 coarse:h-4" /> : <ChevronRight className="w-3 h-3 text-text-muted coarse:w-4 coarse:h-4" />}
 </button>
 ) : <span className="w-3 coarse:w-4" />}
 {/* The label makes the whole name a tap target for the checkbox. */}
 <label className="flex items-center gap-1.5 min-w-0 flex-1 cursor-pointer coarse:min-h-10">
 <input type="checkbox" checked={isSelected}
 onChange={(e) => onChange(e.target.checked ? [...selected, n.id] : selected.filter((id) => id !== n.id))} />
 <FolderOpen className="w-3 h-3 text-text-muted shrink-0" />
 <span className="text-xs text-text-primary truncate coarse:text-sm">{n.name}</span>
 </label>
 </div>
 {isOpen && n.children.length > 0 && (
 <GroupTreeSelector nodes={n.children} selected={selected} onChange={onChange} depth={depth + 1} />
 )}
 </div>
 );
 })}
 </div>
 );
}
