import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
 Plus, ShieldCheck, ShieldAlert, ShieldX, RefreshCw, Edit, Trash2,
 ChevronDown, ChevronUp, CheckCircle, XCircle, AlertTriangle, Activity,
 BookOpen, GripVertical, X, Sparkles, ArrowRight, Monitor,
 Wrench, EyeOff, Eye, ChevronRight, Check, Minus, FolderOpen, Search,
} from 'lucide-react';
import { complianceApi } from '@/api/compliance.api';
import { groupsApi } from '@/api/groups.api';
import { getSocket } from '@/socket/socketClient';
import { useAuthStore } from '@/store/authStore';
import type { DeviceGroupTreeNode } from '@obliance/shared';
import { useDeviceStore } from '@/store/deviceStore';
import { useTenantStore } from '@/store/tenantStore';
import { TargetTenantsPicker } from '@/components/common/TargetTenantsPicker';
import { TenantBadge } from '@/components/common/TenantBadge';
import { TenantFilterChips } from '@/components/common/TenantFilterChips';
import { useTenantFilter } from '@/hooks/useTenantFilter';
import { MASTER_TENANT_ID } from '@obliance/shared';
import type { Device } from '@obliance/shared';
import type {
 CompliancePolicy, CompliancePreset, ComplianceResult,
 ComplianceFramework, ComplianceRule, ComplianceCheckType,
 ComplianceOperator, CheckSeverity, ScriptPlatform,
} from '@obliance/shared';
import toast from 'react-hot-toast';
import { clsx } from 'clsx';
import { useTranslation } from 'react-i18next';
import { SegmentedTabs } from '@/components/common/SegmentedTabs';
import { PageContainer } from '@/components/common/PageContainer';
import { IconButton } from '@/components/common/IconButton';
import { Modal } from '@/components/common/Modal';
import { Tip, InfoTip } from '@/components/common/Tip';
import { useConfirm } from '@/components/common/ConfirmDialog';
import { useIsCoarsePointer } from '@/hooks/useMediaQuery';
import { useClickOutside } from '@/hooks/useClickOutside';
import { deviceMatchesSearch } from '@/utils/deviceSearch';

type Tab = 'results' | 'policies';

const FRAMEWORKS: ComplianceFramework[] = ['CIS', 'NIST', 'ISO27001', 'PCI_DSS', 'HIPAA', 'SOC2', 'custom'];
const FRAMEWORK_LABELS: Record<ComplianceFramework, string> = {
 CIS: 'CIS', NIST: 'NIST', ISO27001: 'ISO 27001', PCI_DSS: 'PCI DSS',
 HIPAA: 'HIPAA', SOC2: 'SOC 2', custom: 'Custom',
};

const CHECK_TYPES: ComplianceCheckType[] = ['registry', 'file', 'command', 'service', 'event_log', 'process', 'policy'];
const OPERATORS: ComplianceOperator[] = ['eq', 'neq', 'contains', 'not_contains', 'exists', 'not_exists', 'gt', 'lt', 'regex'];
const PLATFORMS: ScriptPlatform[] = ['all', 'windows', 'linux', 'macos', 'freebsd'];
const SEVERITIES: CheckSeverity[] = ['optional', 'low', 'moderate', 'high', 'critical'];

const SEVERITY_COLOR: Record<CheckSeverity, string> = {
 optional: 'text-gray-400', low: 'text-blue-400', moderate: 'text-yellow-400', high: 'text-orange-400', critical: 'text-red-400',
};

function scoreColor(score: number): string {
 if (score >= 80) return 'text-green-400';
 if (score >= 50) return 'text-yellow-400';
 return 'text-red-400';
}
function scoreBg(score: number): string {
 if (score >= 80) return 'bg-green-400';
 if (score >= 50) return 'bg-yellow-400';
 return 'bg-red-400';
}
function scoreIcon(score: number) {
 if (score >= 80) return ShieldCheck;
 if (score >= 50) return ShieldAlert;
 return ShieldX;
}
function statusColor(s: string) {
 if (s === 'pass') return 'text-green-400';
 if (s === 'fail') return 'text-red-400';
 if (s === 'warning') return 'text-yellow-400';
 return 'text-text-muted';
}

// ── Device filter ──────────────────────────────────────────────────────────────
/**
 * "Filter results by device" control, shared with SoftwareCompliancePage.
 * Fine pointer: the historical native <select> (desktop unchanged). Touch:
 * a native <select> over the whole fleet (2000+ devices) is an unsearchable
 * wall on Android, so the control opens a searchable list instead.
 */
const DEVICE_FILTER_LIMIT = 200;
export function DeviceFilterSelect({
 devices, value, onChange, allLabel,
}: {
 devices: Device[];
 value: number | '';
 onChange: (value: number | '') => void;
 allLabel: string;
}) {
 const { t } = useTranslation();
 const coarse = useIsCoarsePointer();
 const [open, setOpen] = useState(false);
 const [query, setQuery] = useState('');
 const name = (d: Device) => d.displayName || d.hostname;
 const selected = value === '' ? null : devices.find(d => d.id === value) ?? null;
 const filtered = useMemo(
 () => (open ? devices.filter(d => deviceMatchesSearch(d, query)) : []),
 [devices, query, open],
 );

 if (!coarse) {
 return (
 <div className="flex items-center gap-1.5 px-3 py-1.5 bg-bg-secondary rounded-lg min-w-0 max-w-full">
 <Monitor className="w-3.5 h-3.5 text-text-muted shrink-0" />
 <select
 value={value}
 onChange={(e) => onChange(e.target.value === '' ? '' : parseInt(e.target.value))}
 className="text-sm bg-transparent text-text-primary focus:outline-none min-w-[120px] max-w-full"
 >
 <option value="">{allLabel}</option>
 {devices.map(d => (
 <option key={d.id} value={d.id}>
 {name(d)}
 </option>
 ))}
 </select>
 </div>
 );
 }

 const pick = (v: number | '') => { onChange(v); setOpen(false); };
 const rowCls = (active: boolean) => clsx(
 'w-full min-h-11 px-4 py-2 flex items-center gap-2 text-left text-sm transition-colors',
 active ? 'bg-accent/10 text-accent font-medium' : 'text-text-primary hover:bg-bg-tertiary',
 );
 return (
 <>
 <button
 type="button"
 onClick={() => { setQuery(''); setOpen(true); }}
 aria-haspopup="dialog"
 className="flex items-center gap-1.5 px-3 py-1.5 min-h-10 bg-bg-secondary rounded-lg min-w-0 max-w-full text-sm text-text-primary"
 >
 <Monitor className="w-3.5 h-3.5 text-text-muted shrink-0" />
 <span className="truncate">{selected ? name(selected) : allLabel}</span>
 <ChevronDown className="w-3.5 h-3.5 shrink-0 text-text-muted" />
 </button>
 <Modal
 open={open}
 onClose={() => setOpen(false)}
 title={t('compliance.filterByDevice', 'Filter by device')}
 icon={<Monitor className="w-4 h-4 text-accent" />}
 bodyClassName="p-0"
 >
 <div className="sticky top-0 z-10 bg-bg-secondary px-4 pb-2 pt-1">
 <div className="flex items-center gap-2 px-3 py-2 bg-bg-tertiary rounded-lg">
 <Search className="w-3.5 h-3.5 text-text-muted shrink-0" />
 <input
 type="search"
 value={query}
 onChange={(e) => setQuery(e.target.value)}
 placeholder={t('devices.searchPlaceholder', 'Hostname, IP, user, UUID, OS, tag…')}
 autoCapitalize="off" autoCorrect="off" spellCheck={false}
 className="flex-1 min-w-0 bg-transparent text-sm text-text-primary placeholder:text-text-muted/60 focus:outline-none"
 />
 </div>
 </div>
 <div className="pb-2">
 <button type="button" onClick={() => pick('')} className={rowCls(value === '')}>{allLabel}</button>
 {filtered.slice(0, DEVICE_FILTER_LIMIT).map(d => (
 <button key={d.id} type="button" onClick={() => pick(d.id)} className={rowCls(value === d.id)}>
 <span className="flex-1 min-w-0 truncate">{name(d)}</span>
 {d.ipLocal && <span className="shrink-0 text-xs font-mono text-text-muted">{d.ipLocal}</span>}
 </button>
 ))}
 {filtered.length === 0 && (
 <p className="px-4 py-3 text-sm text-text-muted">{t('common.noResults')}</p>
 )}
 {filtered.length > DEVICE_FILTER_LIMIT && (
 <p className="px-4 py-3 text-xs text-text-muted">
 {t('compliance.refineSearch', { count: filtered.length - DEVICE_FILTER_LIMIT, defaultValue: '{{count}} more — refine the search' })}
 </p>
 )}
 </div>
 </Modal>
 </>
 );
}

// ── Rule editor ────────────────────────────────────────────────────────────────
type RuleFormData = Omit<ComplianceRule, 'autoRemediateScriptId'> & { autoRemediateScriptId: null };

function makeEmptyRule(): RuleFormData {
 return {
 id: crypto.randomUUID(),
 name: '',
 category: '',
 checkType: 'command',
 targetPlatform: 'all',
 target: '',
 expected: '',
 operator: 'eq',
 severity: 'moderate',
 autoRemediateScriptId: null,
 };
}

function RuleEditorRow({
 rule, onChange, onDelete,
}: {
 rule: RuleFormData;
 onChange: (r: RuleFormData) => void; onDelete: () => void;
}) {
 const { t } = useTranslation();
 const set = (patch: Partial<RuleFormData>) => onChange({ ...rule, ...patch });

 // Some operators don't need an "expected" value
 const needsExpected = !['exists', 'not_exists'].includes(rule.operator);

 return (
 <div className="rounded-lg p-3 space-y-2 bg-bg-tertiary/40 relative">
 <div className="flex items-start gap-2">
 {/* Decorative only (no reordering) — hidden on touch where it reads as a drag handle. */}
 <GripVertical className="w-4 h-4 text-text-muted mt-2 shrink-0 cursor-grab coarse:hidden" />
 <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
 {/* Name */}
 <div className="lg:col-span-2 space-y-0.5">
 <label className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
 {t('compliance.ruleBuilder.ruleName')} *
 </label>
 <input
 value={rule.name}
 onChange={e => set({ name: e.target.value })}
 placeholder={t('compliance.ruleBuilder.ruleName')}
 className="w-full px-2 py-1.5 text-sm bg-bg-secondary rounded text-text-primary focus:outline-none focus:border-accent"
 />
 </div>
 {/* Category */}
 <div className="space-y-0.5">
 <label className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
 {t('compliance.ruleBuilder.category')}
 </label>
 <input
 value={rule.category ?? ''}
 onChange={e => set({ category: e.target.value })}
 placeholder={t('compliance.ruleBuilder.categoryPlaceholder', 'e.g. Firewall')}
 className="w-full px-2 py-1.5 text-sm bg-bg-secondary rounded text-text-primary focus:outline-none focus:border-accent"
 />
 </div>
 {/* Severity */}
 <div className="space-y-0.5">
 <label className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
 {t('compliance.ruleBuilder.severity')}
 </label>
 <select
 value={rule.severity}
 onChange={e => set({ severity: e.target.value as CheckSeverity })}
 className="w-full px-2 py-1.5 text-sm bg-bg-secondary rounded text-text-primary focus:outline-none focus:border-accent"
 >
 {SEVERITIES.map(s => (
 <option key={s} value={s}>
 {t(`compliance.severities.${s}`)}
 </option>
 ))}
 </select>
 </div>

 {/* Check type */}
 <div className="space-y-0.5">
 <label className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
 {t('compliance.ruleBuilder.checkType')}
 </label>
 <select
 value={rule.checkType}
 onChange={e => set({ checkType: e.target.value as ComplianceCheckType })}
 className="w-full px-2 py-1.5 text-sm bg-bg-secondary rounded text-text-primary focus:outline-none focus:border-accent"
 >
 {CHECK_TYPES.map(c => (
 <option key={c} value={c}>{t(`compliance.checkTypes.${c}`)}</option>
 ))}
 </select>
 </div>
 {/* Platform */}
 <div className="space-y-0.5">
 <label className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
 {t('compliance.ruleBuilder.targetPlatform')}
 </label>
 <select
 value={rule.targetPlatform}
 onChange={e => set({ targetPlatform: e.target.value as ScriptPlatform })}
 className="w-full px-2 py-1.5 text-sm bg-bg-secondary rounded text-text-primary focus:outline-none focus:border-accent"
 >
 {PLATFORMS.map(p => <option key={p} value={p}>{p}</option>)}
 </select>
 </div>
 {/* Operator */}
 <div className="space-y-0.5">
 <label className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
 {t('compliance.ruleBuilder.operator')}
 </label>
 <select
 value={rule.operator}
 onChange={e => set({ operator: e.target.value as ComplianceOperator })}
 className="w-full px-2 py-1.5 text-sm bg-bg-secondary rounded text-text-primary focus:outline-none focus:border-accent"
 >
 {OPERATORS.map(op => (
 <option key={op} value={op}>{t(`compliance.operators.${op}`)}</option>
 ))}
 </select>
 </div>
 {/* Target */}
 <div className="lg:col-span-2 space-y-0.5">
 <label className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
 {t('compliance.ruleBuilder.target')} *
 {rule.checkType === 'registry' && (
 <span className="ml-1 normal-case font-normal text-text-muted">HKLM\Key\Path|ValueName</span>
 )}
 {rule.checkType === 'event_log' && (
 <span className="ml-1 normal-case font-normal text-text-muted">LogName|EventID[|hours]</span>
 )}
 </label>
 <input
 value={rule.target}
 onChange={e => set({ target: e.target.value })}
 placeholder={
 rule.checkType === 'registry' ? 'HKLM\\SOFTWARE\\...\\Parameters|SMB1' :
 rule.checkType === 'file' ? '/etc/ssh/sshd_config' :
 rule.checkType === 'command' ? '(Get-MpComputerStatus).RealTimeProtectionEnabled' :
 rule.checkType === 'service' ? 'wuauserv' :
 rule.checkType === 'process' ? 'notepad' :
 rule.checkType === 'event_log' ? 'Security|4625|24' :
 'Target'
 }
 autoCapitalize="off" autoCorrect="off" spellCheck={false}
 className="w-full px-2 py-1.5 text-sm bg-bg-secondary rounded font-mono text-text-primary focus:outline-none focus:border-accent"
 />
 </div>
 {/* Expected */}
 {needsExpected && (
 <div className="space-y-0.5">
 <label className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
 {t('compliance.ruleBuilder.expected')}
 </label>
 <input
 value={String(rule.expected ?? '')}
 onChange={e => set({ expected: e.target.value })}
 placeholder={t('compliance.ruleBuilder.expectedPlaceholder', 'Expected value')}
 autoCapitalize="off" autoCorrect="off" spellCheck={false}
 className="w-full px-2 py-1.5 text-sm bg-bg-secondary rounded font-mono text-text-primary focus:outline-none focus:border-accent"
 />
 </div>
 )}
 {/* Min OS Version */}
 <div className="space-y-0.5">
 <label className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
 {t('compliance.ruleBuilder.minOsVersion')}
 </label>
 <input
 value={rule.minOsVersion ?? ''}
 onChange={e => set({ minOsVersion: e.target.value || undefined })}
 placeholder={t('compliance.ruleBuilder.minOsVersionPlaceholder')}
 className="w-full px-2 py-1.5 text-sm bg-bg-secondary rounded text-text-primary focus:outline-none focus:border-accent"
 />
 </div>
 {/* Remediation Script */}
 <div className="lg:col-span-4 space-y-0.5">
 <label className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
 {t('compliance.ruleBuilder.remediationScript', 'Remediation Script')}
 <span className="ml-1 normal-case font-normal text-text-muted/60">— {t('compliance.ruleBuilder.remediationScriptHint', 'script to fix this rule when it fails')}</span>
 </label>
 <textarea
 value={rule.remediationScript ?? ''}
 onChange={e => set({ remediationScript: e.target.value || undefined })}
 placeholder={t('compliance.ruleBuilder.remediationScriptPlaceholder', 'PowerShell or Bash script to remediate...')}
 rows={2}
 autoCapitalize="off" autoCorrect="off" spellCheck={false}
 className="w-full px-2 py-1.5 text-sm bg-bg-secondary rounded font-mono text-text-primary focus:outline-none focus:border-accent resize-y"
 />
 </div>
 </div>
 <IconButton
 label={t('compliance.ruleBuilder.deleteRule')}
 icon={<X className="w-4 h-4" />}
 size="sm"
 variant="danger"
 onClick={onDelete}
 className="shrink-0"
 />
 </div>

 {/* Severity badge preview */}
 <div className="flex flex-wrap items-center gap-2 pl-6 coarse:pl-0">
 <span className={clsx('text-[10px] font-semibold uppercase', SEVERITY_COLOR[rule.severity])}>
 ● {rule.severity}
 </span>
 <span className="text-[10px] text-text-muted">
 {t(`compliance.checkTypes.${rule.checkType}`)} · {rule.targetPlatform} · {t(`compliance.operators.${rule.operator}`)}
 </span>
 </div>
 </div>
 );
}

// ── Policy form ─────────────────────────────────────────────────────────────────
interface PolicyFormData {
 name: string;
 description: string;
 framework: ComplianceFramework;
 targetType: 'group' | 'all';
 targetIds: number[];
 targetPlatform: 'windows' | 'linux' | 'macos' | 'freebsd' | 'all';
 enabled: boolean;
 rules: RuleFormData[];
 /** Master-only fan-out: extra tenants where this policy is visible
 * in read-only. Null when local. */
 targetTenantIds: number[] | null;
}

const defaultPolicyForm: PolicyFormData = {
 name: '', description: '', framework: 'CIS', targetType: 'all', targetIds: [],
 targetPlatform: 'all', enabled: true, rules: [],
 targetTenantIds: null,
};

// ── Main page ─────────────────────────────────────────────────────────────────
export function CompliancePage({ embedded }: { embedded?: boolean } = {}) {
 const { t } = useTranslation();
 const confirm = useConfirm();
 const coarse = useIsCoarsePointer();
 const { isAdmin } = useAuthStore();
 const currentTenantId = useTenantStore((s) => s.currentTenantId);
 /** A policy is read-only when it's owned by another tenant AND we
 * aren't on the master tenant. */
 const isReadOnlyForCaller = (p: CompliancePolicy): boolean => {
 if (currentTenantId === MASTER_TENANT_ID) return false;
 return p.tenantId !== currentTenantId;
 };
 const tenantFilter = useTenantFilter();
 const deviceMap = useDeviceStore(s => s.devices);
 const devices = Array.from(deviceMap.values());
 const [activeTab, setActiveTab] = useState<Tab>('results');
 const [policies, setPolicies] = useState<CompliancePolicy[]>([]);
 const [results, setResults] = useState<ComplianceResult[]>([]);
 const [presets, setPresets] = useState<CompliancePreset[]>([]);
 const [isLoading, setIsLoading] = useState(true);
 const [filterFramework, setFilterFramework] = useState<string>('');
 const [filterDeviceId, setFilterDeviceId] = useState<number | ''>('');
 const [showForm, setShowForm] = useState(false);
 const [editingPolicy, setEditingPolicy] = useState<CompliancePolicy | null>(null);
 const [form, setForm] = useState<PolicyFormData>(defaultPolicyForm);
 const [isSaving, setIsSaving] = useState(false);
 const [expandedResultId, setExpandedResultId] = useState<number | null>(null);
 const [showPresets, setShowPresets] = useState(false);
 const [ignoredRules, setIgnoredRules] = useState<Record<number, Record<number, string[]>>>({});
 const [remediatingRules, setRemediatingRules] = useState<Set<string>>(new Set());
 const presetsMenuRef = useRef<HTMLDivElement>(null);
 useClickOutside(presetsMenuRef, () => setShowPresets(false), showPresets);

 // Silent reloads (e.g. socket-driven refresh on a check_compliance ack)
 // skip the spinner so the active tab doesn't flash empty and re-render
 // every time another agent's compliance scan finishes.
 const load = useCallback(async (opts?: { silent?: boolean }) => {
 if (!opts?.silent) setIsLoading(true);
 try {
 const [policiesData, resultsData, presetsData] = await Promise.all([
 complianceApi.listPolicies(),
 complianceApi.listResults({ page: 1 }),
 complianceApi.listPresets(),
 ]);
 setPolicies(policiesData);
 setResults(resultsData.items);
 setPresets(presetsData);
 } catch {
 toast.error(t('compliance.failedLoad'));
 } finally {
 if (!opts?.silent) setIsLoading(false);
 }
 }, [t]);

 // Reload results when device filter changes
 const loadResults = useCallback(async (deviceId?: number) => {
 setIsLoading(true);
 try {
 const resultsData = await complianceApi.listResults({ page: 1, deviceId });
 setResults(resultsData.items);
 } catch {
 toast.error(t('compliance.failedLoad'));
 } finally {
 setIsLoading(false);
 }
 }, [t]);

 useEffect(() => { load(); }, [load]);

 // Refresh compliance results live when a check_compliance command acks.
 // Debounced to 2 s so a fleet-wide scan (many parallel acks) doesn't trigger
 // a reload-storm; the reload is silent so the visible tab keeps its content.
 useEffect(() => {
 const socket = getSocket();
 if (!socket) return;
 let timer: ReturnType<typeof setTimeout> | null = null;
 const debounced = (cmd?: any) => {
 if (cmd && cmd.type && cmd.type !== 'check_compliance') return;
 if (timer) clearTimeout(timer);
 timer = setTimeout(() => load({ silent: true }), 2000);
 };
 socket.on('COMMAND_UPDATED', debounced);
 return () => {
 socket.off('COMMAND_UPDATED', debounced);
 if (timer) clearTimeout(timer);
 };
 }, [load]);

 // Load ignored rules for expanded result
 useEffect(() => {
 if (expandedResultId == null) return;
 const result = results.find(r => r.id === expandedResultId);
 if (!result || ignoredRules[result.deviceId]?.[result.policyId]) return;
 complianceApi.getIgnoredRules(result.deviceId).then(data => {
 setIgnoredRules(prev => ({ ...prev, [result.deviceId]: data }));
 }).catch(() => {});
 }, [expandedResultId, results]);

 useEffect(() => {
 loadResults(filterDeviceId !== '' ? filterDeviceId : undefined);
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [filterDeviceId]);

 const handleOpenCreate = () => {
 setForm(defaultPolicyForm);
 setEditingPolicy(null);
 setShowForm(true);
 setShowPresets(false);
 };

 const handleOpenEdit = (policy: CompliancePolicy) => {
 setForm({
 name: policy.name,
 description: policy.description ?? '',
 framework: policy.framework,
 targetType: policy.targetType,
 targetIds: policy.targetIds ?? [],
 targetPlatform: policy.targetPlatform ?? 'all',
 enabled: policy.enabled,
 rules: (policy.rules ?? []).map(r => ({ ...r, autoRemediateScriptId: null })),
 targetTenantIds: policy.targetTenantIds ?? null,
 });
 setEditingPolicy(policy);
 setShowForm(true);
 setShowPresets(false);
 setActiveTab('policies');
 };

 const handleLoadPreset = (preset: CompliancePreset) => {
 setForm(f => ({
 ...f,
 name: f.name || preset.name,
 description: f.description || preset.description,
 framework: preset.framework,
 targetPlatform: preset.targetPlatform ?? 'all',
 rules: preset.rules.map(r => ({ ...r, autoRemediateScriptId: null })),
 }));
 setShowPresets(false);
 toast.success(t('compliance.presetLoaded'));
 };

 const handleSave = async () => {
 if (!form.name.trim()) { toast.error(t('compliance.nameRequired', 'Policy name is required')); return; }
 setIsSaving(true);
 try {
 const payload = {
 name: form.name,
 description: form.description || null,
 framework: form.framework,
 targetType: form.targetType,
 targetIds: form.targetIds,
 targetPlatform: form.targetPlatform,
 rules: form.rules,
 enabled: form.enabled,
 // Master-only fan-out — server ignores from non-master callers.
 targetTenantIds: form.targetTenantIds,
 tenantId: 0,
 };
 if (editingPolicy) {
 await complianceApi.updatePolicy(editingPolicy.id, payload);
 toast.success(t('compliance.policyUpdated'));
 } else {
 await complianceApi.createPolicy(payload as any);
 toast.success(t('compliance.policyCreated'));
 }
 setShowForm(false);
 setEditingPolicy(null);
 await load();
 } catch {
 toast.error(t('compliance.failedSave'));
 } finally {
 setIsSaving(false);
 }
 };

 const handleDelete = async (id: number) => {
 if (!(await confirm({ message: t('compliance.confirmDelete'), danger: true }))) return;
 try {
 await complianceApi.deletePolicy(id);
 toast.success(t('compliance.policyDeleted'));
 await load();
 } catch {
 toast.error(t('compliance.failedDelete'));
 }
 };

 const handleTriggerCheck = async (deviceId: number, policyId?: number) => {
 try {
 await complianceApi.triggerCheck(deviceId, policyId);
 toast.success(t('compliance.triggerCheck'));
 } catch {
 toast.error(t('compliance.failedTrigger'));
 }
 };

 const handleRemediate = async (deviceId: number, policyId: number, ruleIds: string[]) => {
 // Remediation runs a script on the device right away. The icon buttons
 // are small and close to "Ignore" — on touch, ask first (desktop unchanged).
 if (coarse && !(await confirm({
 title: t('compliance.remediateConfirmTitle', 'Run remediation?'),
 message: t('compliance.remediateConfirm', { count: ruleIds.length, defaultValue: 'Run the remediation script for {{count}} rule(s) on this device now?' }),
 confirmLabel: t('softwareCompliance.actions.remediate'),
 }))) return;
 const key = ruleIds.map(id => `${deviceId}:${policyId}:${id}`);
 setRemediatingRules(prev => { const s = new Set(prev); key.forEach(k => s.add(k)); return s; });
 try {
 await complianceApi.remediate(deviceId, policyId, ruleIds);
 toast.success(t('compliance.remediationSent', { count: ruleIds.length, defaultValue: 'Remediation sent for {{count}} rule(s)' }));
 } catch {
 toast.error(t('compliance.remediationFailed', 'Failed to send remediation'));
 } finally {
 setRemediatingRules(prev => { const s = new Set(prev); key.forEach(k => s.delete(k)); return s; });
 }
 };

 const handleRemediateAll = async (result: ComplianceResult) => {
 const failingRuleIds = result.results
 .filter(rr => rr.status === 'fail' && !isRuleIgnored(result.deviceId, result.policyId, rr.ruleId))
 .map(rr => rr.ruleId)
 .filter(id => getRemediationScript(result.policyId, id));
 if (failingRuleIds.length === 0) { toast.error(t('compliance.noRemediableRules', 'No remediable rules')); return; }
 await handleRemediate(result.deviceId, result.policyId, failingRuleIds);
 };

 const handleIgnore = async (deviceId: number, policyId: number, ruleIds: string[]) => {
 try {
 await complianceApi.ignoreRules(deviceId, policyId, ruleIds);
 setIgnoredRules(prev => {
 const copy = { ...prev };
 if (!copy[deviceId]) copy[deviceId] = {};
 copy[deviceId][policyId] = [...(copy[deviceId][policyId] ?? []), ...ruleIds];
 return copy;
 });
 toast.success(t('compliance.rulesIgnored', { count: ruleIds.length, defaultValue: '{{count}} rule(s) ignored' }));
 } catch {
 toast.error(t('compliance.ignoreFailed', 'Failed to ignore rules'));
 }
 };

 const handleUnignore = async (deviceId: number, policyId: number, ruleIds: string[]) => {
 try {
 await complianceApi.unignoreRules(deviceId, policyId, ruleIds);
 setIgnoredRules(prev => {
 const copy = { ...prev };
 if (copy[deviceId]?.[policyId]) {
 copy[deviceId][policyId] = copy[deviceId][policyId].filter(id => !ruleIds.includes(id));
 }
 return copy;
 });
 toast.success(t('compliance.rulesUnignored', { count: ruleIds.length, defaultValue: '{{count}} rule(s) unignored' }));
 } catch {
 toast.error(t('compliance.unignoreFailed', 'Failed to unignore rules'));
 }
 };

 const isRuleIgnored = (deviceId: number, policyId: number, ruleId: string) =>
 ignoredRules[deviceId]?.[policyId]?.includes(ruleId) ?? false;

 // Resolve remediationScript: policy rule first, then fallback to preset
 const getRemediationScript = (policyId: number, ruleId: string): string | undefined => {
 const policy = policies.find(p => p.id === policyId);
 const policyRule = policy?.rules.find(r => r.id === ruleId);
 if (policyRule?.remediationScript) return policyRule.remediationScript;
 // Fallback: find in presets by matching rule id
 for (const preset of presets) {
 const presetRule = preset.rules.find(r => r.id === ruleId);
 if (presetRule?.remediationScript) return presetRule.remediationScript;
 }
 return undefined;
 };

 // Rule CRUD
 const addRule = () => setForm(f => ({ ...f, rules: [...f.rules, makeEmptyRule()] }));
 const updateRule = (index: number, rule: RuleFormData) =>
 setForm(f => ({ ...f, rules: f.rules.map((r, i) => i === index ? rule : r) }));
 const deleteRule = (index: number) =>
 setForm(f => ({ ...f, rules: f.rules.filter((_, i) => i !== index) }));

 // Build a map policyId:ruleId → rule name for display in expanded results
 const policyRuleNames = new Map<string, string>(
 policies.flatMap(p => (p.rules ?? []).map(rule => [`${p.id}:${rule.id}`, rule.name] as [string, string])),
 );

 const filteredPolicies = policies
 .filter(p => !filterFramework || p.framework === filterFramework)
 .filter(p => tenantFilter.value.size === 0 || tenantFilter.value.has(p.tenantId));

 const filteredResults = filterFramework
 ? results.filter(r => r.policy?.framework === filterFramework)
 : results;

 const avgScore = results.length > 0
 ? results.reduce((sum, r) => sum + r.complianceScore, 0) / results.length
 : null;
 const passingCount = results.filter(r => r.complianceScore >= 80).length;
 const warningCount = results.filter(r => r.complianceScore >= 50 && r.complianceScore < 80).length;
 const failingCount = results.filter(r => r.complianceScore < 50).length;

 // Sync presets + refresh. They lived only in the (non-embedded) header,
 // but the page is only ever mounted embedded (PoliciesPage) — so in
 // embedded mode they are rendered in the tabs/filter toolbar instead.
 const headerActions = (
 <div className="flex items-center gap-2">
 {isAdmin() && (
 <>
 <button
 onClick={async () => {
 try {
 const n = await complianceApi.syncPresets();
 if (n > 0) {
 toast.success(t('compliance.syncPresetsDone', { count: n, defaultValue: '{{count}} policy(ies) synced with latest presets' }));
 await load();
 } else {
 toast.success(t('compliance.syncPresetsUpToDate', 'All policies already up to date'));
 }
 } catch { toast.error(t('compliance.syncPresetsFailed', 'Sync failed')); }
 }}
 className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg text-text-muted hover:text-accent hover:border-accent/50 transition-colors coarse:min-h-10"
 title={t('compliance.syncPresetsHint', 'Sync existing policies with latest built-in preset rules')}
 >
 <Sparkles className="w-3.5 h-3.5" />
 {t('compliance.syncPresets', 'Sync presets')}
 </button>
 {/* The explanation is a hover title — give touch users a tap target for it. */}
 {coarse && <InfoTip content={t('compliance.syncPresetsHint', 'Sync existing policies with latest built-in preset rules')} />}
 </>
 )}
 <button onClick={() => load()} aria-label={t('common.refresh')} className="p-2 text-text-muted hover:text-text-primary hover:bg-bg-secondary rounded-lg transition-colors coarse:min-h-10 coarse:min-w-10">
 <RefreshCw className={clsx('w-4 h-4', isLoading && 'animate-spin')} />
 </button>
 </div>
 );

 return (
 <PageContainer embedded={embedded} className="space-y-6">
 {/* Header */}
 {!embedded && <div className="flex flex-wrap items-center justify-between gap-2">
 <div>
 <h1 className="text-2xl font-bold text-text-primary">{t('compliance.title')}</h1>
 <p className="text-sm text-text-muted mt-0.5">{t('compliance.description')}</p>
 </div>
 {headerActions}
 </div>}

 {/* Summary cards */}
 <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
 <div className="p-4 bg-bg-secondary rounded-xl">
 <div className="flex items-center gap-3">
 <div className={clsx('p-2 rounded-lg', avgScore !== null ? (avgScore >= 80 ? 'bg-green-400/10' : avgScore >= 50 ? 'bg-yellow-400/10' : 'bg-red-400/10') : 'bg-bg-tertiary')}>
 <Activity className={clsx('w-4 h-4', avgScore !== null ? scoreColor(avgScore) : 'text-text-muted')} />
 </div>
 <div>
 <p className={clsx('text-xl font-bold', avgScore !== null ? scoreColor(avgScore) : 'text-text-muted')}>
 {avgScore !== null ? `${avgScore.toFixed(0)}%` : '—'}
 </p>
 <p className="text-xs text-text-muted">{t('compliance.avgScore')}</p>
 </div>
 </div>
 </div>
 <div className="p-4 bg-bg-secondary rounded-xl flex items-center gap-3">
 <div className="p-2 rounded-lg bg-green-400/10"><CheckCircle className="w-4 h-4 text-green-400" /></div>
 <div>
 <p className="text-xl font-bold text-text-primary">{passingCount}</p>
 <p className="text-xs text-text-muted">{t('compliance.passing')}</p>
 </div>
 </div>
 <div className="p-4 bg-bg-secondary rounded-xl flex items-center gap-3">
 <div className="p-2 rounded-lg bg-yellow-400/10"><AlertTriangle className="w-4 h-4 text-yellow-400" /></div>
 <div>
 <p className="text-xl font-bold text-text-primary">{warningCount}</p>
 <p className="text-xs text-text-muted">{t('compliance.warning')}</p>
 </div>
 </div>
 <div className="p-4 bg-bg-secondary rounded-xl flex items-center gap-3">
 <div className="p-2 rounded-lg bg-red-400/10"><XCircle className="w-4 h-4 text-red-400" /></div>
 <div>
 <p className="text-xl font-bold text-text-primary">{failingCount}</p>
 <p className="text-xs text-text-muted">{t('compliance.failing')}</p>
 </div>
 </div>
 </div>

 {/* Tabs + filter */}
 <div className="flex items-center justify-between gap-4 flex-wrap">
 <SegmentedTabs<Tab>
 tabs={[
 { id: 'results', label: t('compliance.tabResults') },
 { id: 'policies', label: t('compliance.tabPolicies') },
 ]}
 value={activeTab}
 onChange={setActiveTab}
 className="max-w-full"
 />
 <div className="flex items-center gap-2 flex-wrap min-w-0 max-w-full">
 {/* Device filter — results tab only */}
 {activeTab === 'results' && (
 <DeviceFilterSelect
 devices={devices}
 value={filterDeviceId}
 onChange={setFilterDeviceId}
 allLabel={t('compliance.allDevices')}
 />
 )}
 <select
 value={filterFramework}
 onChange={(e) => setFilterFramework(e.target.value)}
 className="px-3 py-1.5 text-sm bg-bg-secondary rounded-lg text-text-primary focus:outline-none focus:border-accent"
 >
 <option value="">{t('compliance.allFrameworks')}</option>
 {FRAMEWORKS.map(f => <option key={f} value={f}>{FRAMEWORK_LABELS[f]}</option>)}
 </select>
 {embedded && headerActions}
 </div>
 </div>

 {/* Results tab */}
 {activeTab === 'results' && (
 <div className="space-y-3">
 {isLoading ? (
 <div className="flex items-center justify-center h-48">
 <RefreshCw className="w-5 h-5 animate-spin text-text-muted" />
 </div>
 ) : filteredResults.length === 0 ? (
 <div className="p-12 text-center text-text-muted bg-bg-secondary rounded-xl">
 <ShieldCheck className="w-10 h-10 mx-auto mb-3 opacity-50" />
 <p className="font-medium text-text-primary mb-1">{t('compliance.noResults')}</p>
 <p className="text-sm">{t('compliance.noResultsDesc')}</p>
 </div>
 ) : filteredResults.map((result) => {
 const expanded = expandedResultId === result.id;
 const ScoreIcon = scoreIcon(result.complianceScore);
 const passCount = result.results.filter(r => r.status === 'pass').length;
 const failCount = result.results.filter(r => r.status === 'fail').length;
 const warnCount = result.results.filter(r => r.status === 'warning').length;
 const total = result.results.length;

 return (
 <div key={result.id} className="bg-bg-secondary rounded-xl overflow-hidden">
 <div
 className="flex items-center gap-3 sm:gap-4 px-4 py-3 cursor-pointer hover:bg-bg-tertiary transition-colors"
 onClick={() => setExpandedResultId(expanded ? null : result.id)}
 >
 <div className={clsx('p-2 rounded-lg', result.complianceScore >= 80 ? 'bg-green-400/10' : result.complianceScore >= 50 ? 'bg-yellow-400/10' : 'bg-red-400/10')}>
 <ScoreIcon className={clsx('w-4 h-4', scoreColor(result.complianceScore))} />
 </div>
 <div className="flex-1 min-w-0">
 <div className="flex items-center gap-2 flex-wrap">
 <div className="flex items-center gap-1.5">
 <Monitor className="w-3.5 h-3.5 text-text-muted shrink-0" />
 <span className="text-sm font-medium text-text-primary break-all">
 {result.deviceName ?? t('compliance.deviceId', { id: result.deviceId })}
 </span>
 </div>
 {result.policy && (
 <span className="text-xs px-2 py-0.5 bg-bg-tertiary rounded-full text-text-muted">
 {FRAMEWORK_LABELS[result.policy.framework]} · {result.policy.name}
 </span>
 )}
 </div>
 <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1">
 <div className="flex-1 max-w-48 min-w-[3rem] h-1.5 bg-bg-tertiary rounded-full overflow-hidden">
 <div
 className={clsx('h-full rounded-full transition-all', scoreBg(result.complianceScore))}
 style={{ width: `${result.complianceScore}%` }}
 />
 </div>
 <span className={clsx('text-sm font-bold', scoreColor(result.complianceScore))}>
 {result.complianceScore.toFixed(0)}%
 </span>
 <span className="text-xs text-text-muted">
 {passCount}✓{failCount > 0 ? ` ${failCount}✗` : ''}{warnCount > 0 ? ` ${warnCount}⚠` : ''}{total > 0 ? ` / ${total}` : ''}
 </span>
 {/* The date column is hidden below sm — keep it on the stats line there. */}
 <span className="text-xs text-text-muted sm:hidden">
 {new Date(result.checkedAt).toLocaleDateString()}
 </span>
 </div>
 </div>
 <div className="flex items-center gap-2 shrink-0">
 <span className="text-xs text-text-muted hidden sm:block">
 {new Date(result.checkedAt).toLocaleDateString()}
 </span>
 {failCount > 0 && (
 <button
 onClick={(e) => { e.stopPropagation(); handleRemediateAll(result); }}
 className="flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-lg bg-accent/10 text-accent border border-accent/20 hover:bg-accent/20 transition-colors coarse:min-h-10"
 title={t('compliance.remediateAllFailing', 'Remediate all failing rules')}
 >
 <Wrench className="w-3 h-3" />
 {t('softwareCompliance.actions.fixAll')}
 </button>
 )}
 <IconButton
 label={t('compliance.rerun')}
 icon={<RefreshCw className="w-3.5 h-3.5" />}
 variant="accent"
 onClick={(e) => { e.stopPropagation(); handleTriggerCheck(result.deviceId, result.policyId); }}
 className="hover:bg-bg-tertiary"
 />
 {expanded ? <ChevronUp className="w-4 h-4 text-text-muted" /> : <ChevronDown className="w-4 h-4 text-text-muted" />}
 </div>
 </div>

 {expanded && result.results.length > 0 && (() => {
 const remediableFailCount = result.results.filter(rr =>
 rr.status === 'fail' && !isRuleIgnored(result.deviceId, result.policyId, rr.ruleId)
 && getRemediationScript(result.policyId, rr.ruleId)
 ).length;
 return (
 <div className=" bg-bg-tertiary/50">
 {/* Bulk actions bar */}
 {remediableFailCount > 0 && (
 <div className="flex items-center gap-2 px-4 py-2 bg-bg-tertiary/80">
 <button
 onClick={(e) => { e.stopPropagation(); handleRemediateAll(result); }}
 className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-accent/10 text-accent border border-accent/20 hover:bg-accent/20 transition-colors"
 >
 <Wrench className="w-3.5 h-3.5" />
 {t('compliance.remediateAll', 'Remediate all')} ({remediableFailCount})
 </button>
 </div>
 )}
 <div className="divide-y divide-border">
 {result.results.map((ruleResult) => {
 const ignored = isRuleIgnored(result.deviceId, result.policyId, ruleResult.ruleId);
 const hasRemediation = !!getRemediationScript(result.policyId, ruleResult.ruleId);
 const isRemediating = remediatingRules.has(`${result.deviceId}:${result.policyId}:${ruleResult.ruleId}`);
 return (
 <div key={ruleResult.ruleId} className={clsx('flex items-start gap-3 px-4 py-2.5 max-sm:flex-wrap', ignored && 'opacity-50')}>
 <div className="shrink-0 mt-0.5">
 {ignored ? <EyeOff className="w-4 h-4 text-text-muted" /> :
 ruleResult.status === 'pass' ? <CheckCircle className="w-4 h-4 text-green-400" /> :
 ruleResult.status === 'fail' ? <XCircle className="w-4 h-4 text-red-400" /> :
 ruleResult.status === 'warning' ? <AlertTriangle className="w-4 h-4 text-yellow-400" /> :
 <div className="w-4 h-4 rounded-full border-2 border-transparent" />}
 </div>
 <div className="flex-1 min-w-0">
 <p className="text-xs font-medium text-text-primary">
 {ruleResult.ruleName ?? policyRuleNames.get(`${result.policyId}:${ruleResult.ruleId}`) ?? ruleResult.ruleId}
 </p>
 <p className="text-[10px] text-text-muted/60 font-mono break-all">{ruleResult.ruleId}</p>
 {ruleResult.actualValue !== undefined && ruleResult.actualValue !== null && (
 <p className="text-xs text-text-muted mt-0.5">
 {t('compliance.actualValue')}: <span className="font-mono break-all">{String(ruleResult.actualValue)}</span>
 </p>
 )}
 </div>
 {/* Below sm the action cluster takes its own line under the rule name. */}
 <div className="flex items-center gap-1.5 shrink-0 max-sm:basis-full max-sm:justify-end">
 {ignored && (
 <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-500/10 text-gray-400 border border-gray-500/20">
 ignored
 </span>
 )}
 {ruleResult.remediationTriggered && (
 <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">
 remediated
 </span>
 )}
 <span className={clsx('text-xs font-medium', statusColor(ruleResult.status))}>
 {ignored ? 'ignored' : ruleResult.status}
 </span>
 {/* Action buttons for failing rules */}
 {ruleResult.status === 'fail' && !ignored && hasRemediation && (
 <IconButton
 label={t('softwareCompliance.actions.remediate')}
 onClick={(e) => { e.stopPropagation(); handleRemediate(result.deviceId, result.policyId, [ruleResult.ruleId]); }}
 disabled={isRemediating}
 size="sm"
 variant="primary"
 className="gap-1 disabled:opacity-50 coarse:px-2.5"
 icon={<>
 <Wrench className={clsx('w-3.5 h-3.5', isRemediating && 'animate-spin')} />
 {/* Touch: visible label (the meaning was only in a hover tooltip). */}
 <span className="hidden coarse:inline text-xs">{t('softwareCompliance.actions.remediate')}</span>
 </>}
 />
 )}
 {!ignored ? (
 <IconButton
 label={t('compliance.ignoreRule', 'Ignore this rule')}
 onClick={(e) => { e.stopPropagation(); handleIgnore(result.deviceId, result.policyId, [ruleResult.ruleId]); }}
 size="sm"
 variant="plain"
 className="gap-1 hover:text-yellow-400 hover:bg-yellow-400/10 coarse:px-2.5"
 icon={<>
 <EyeOff className="w-3.5 h-3.5" />
 <span className="hidden coarse:inline text-xs">{t('compliance.ignore', 'Ignore')}</span>
 </>}
 />
 ) : (
 <IconButton
 label={t('compliance.unignoreRule', 'Unignore this rule')}
 onClick={(e) => { e.stopPropagation(); handleUnignore(result.deviceId, result.policyId, [ruleResult.ruleId]); }}
 size="sm"
 variant="plain"
 className="gap-1 hover:text-green-400 hover:bg-green-400/10 coarse:px-2.5"
 icon={<>
 <Eye className="w-3.5 h-3.5" />
 <span className="hidden coarse:inline text-xs">{t('compliance.unignore', 'Unignore')}</span>
 </>}
 />
 )}
 </div>
 </div>
 );
 })}
 </div>
 </div>
 );
 })()}
 </div>
 );
 })}
 </div>
 )}

 {/* Policies tab */}
 {activeTab === 'policies' && (
 <div className="space-y-4">
 {/* Policy form */}
 {showForm && (
 <div className="bg-bg-secondary rounded-xl p-4 sm:p-6 space-y-4">
 {/* Master-only fan-out picker. Hidden on child tenants —
 child admins can only create local policies. */}
 <TargetTenantsPicker
 value={form.targetTenantIds}
 onChange={(next) => setForm({ ...form, targetTenantIds: next })}
 />
 <div className="flex flex-wrap items-center justify-between gap-2">
 <h2 className="text-lg font-semibold text-text-primary">
 {editingPolicy ? t('compliance.editPolicy') : t('compliance.newPolicyTitle')}
 </h2>
 <div className="flex gap-2">
 <button
 onClick={() => { setShowForm(false); setEditingPolicy(null); }}
 className="px-4 py-2 text-sm text-text-muted hover:text-text-primary rounded-lg transition-colors"
 >
 {t('common.cancel')}
 </button>
 <button
 onClick={handleSave}
 disabled={isSaving}
 className="px-4 py-2 text-sm bg-accent text-white rounded-lg hover:bg-accent/80 disabled:opacity-50 transition-colors"
 >
 {isSaving ? t('common.saving') : t('common.save')}
 </button>
 </div>
 </div>

 {/* ── Presets — shown prominently at the top when no rules loaded yet ── */}
 {!editingPolicy && presets.length > 0 && (
 <div className="rounded-xl border border-accent/20 bg-accent/5 p-4 space-y-3">
 <div className="flex items-center gap-2">
 <Sparkles className="w-4 h-4 text-accent" />
 <span className="text-sm font-semibold text-text-primary">{t('compliance.presets')} — {t('compliance.presetsSuggest')}</span>
 </div>
 <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
 {presets.map(preset => (
 <button
 key={preset.id}
 onClick={() => handleLoadPreset(preset)}
 className={clsx(
 'text-left p-3 rounded-lg border transition-all group',
 form.rules.length > 0 && form.framework === preset.framework
 ? 'border-accent bg-accent/10'
 : 'border-transparent bg-bg-secondary hover:border-accent/60 hover:bg-bg-tertiary',
 )}
 >
 <div className="flex items-center justify-between mb-1">
 <span className="text-xs font-bold text-text-primary line-clamp-1">{preset.name}</span>
 <span className={clsx(
 'text-[10px] px-1.5 py-0.5 rounded font-semibold shrink-0 ml-1',
 preset.framework === 'CIS' ? 'bg-blue-400/20 text-blue-400' :
 preset.framework === 'NIST' ? 'bg-teal-400/20 text-teal-400' :
 preset.framework === 'ISO27001' ? 'bg-green-400/20 text-green-400' :
 preset.framework === 'PCI_DSS' ? 'bg-orange-400/20 text-orange-400' :
 preset.framework === 'HIPAA' ? 'bg-pink-400/20 text-pink-400' :
 preset.framework === 'SOC2' ? 'bg-cyan-400/20 text-cyan-400' :
 'bg-bg-tertiary text-text-muted',
 )}>
 {FRAMEWORK_LABELS[preset.framework]}
 </span>
 </div>
 <p className="text-[11px] text-text-muted line-clamp-2 leading-relaxed">{preset.description}</p>
 <div className="flex items-center justify-between mt-1.5">
 <span className="text-[10px] text-accent">{preset.rules.length} {t('compliance.rules')}</span>
 <ArrowRight className="w-3 h-3 text-text-muted group-hover:text-accent transition-colors" />
 </div>
 </button>
 ))}
 </div>
 <p className="text-[11px] text-text-muted">{t('compliance.presetsNote')}</p>
 </div>
 )}

 {/* Basic fields */}
 <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
 <div className="space-y-1">
 <label className="text-xs font-medium text-text-muted uppercase">{t('compliance.policy')} *</label>
 <input
 value={form.name}
 onChange={(e) => setForm({ ...form, name: e.target.value })}
 placeholder={t('compliance.namePlaceholder')}
 className="w-full px-3 py-2 text-sm bg-bg-tertiary rounded-lg text-text-primary focus:outline-none focus:border-accent"
 />
 </div>
 <div className="space-y-1">
 <label className="text-xs font-medium text-text-muted uppercase">{t('compliance.framework')}</label>
 <select
 value={form.framework}
 onChange={(e) => setForm({ ...form, framework: e.target.value as ComplianceFramework })}
 className="w-full px-3 py-2 text-sm bg-bg-tertiary rounded-lg text-text-primary focus:outline-none focus:border-accent"
 >
 {FRAMEWORKS.map(f => <option key={f} value={f}>{FRAMEWORK_LABELS[f]}</option>)}
 </select>
 </div>
 <div className="space-y-1">
 <label className="text-xs font-medium text-text-muted uppercase">{t('compliance.target')}</label>
 <div className="flex gap-2">
 {(['all', 'group'] as const).map((tt) => (
 <button
 key={tt}
 type="button"
 onClick={() => setForm({ ...form, targetType: tt, targetIds: [] })}
 className={clsx(
 'flex-1 py-2 text-sm rounded-lg border transition-colors',
 form.targetType === tt ? 'bg-accent/10 border-accent text-accent' : 'border-transparent text-text-muted hover:border-accent/50',
 )}
 >
 {tt === 'all' ? t('compliance.allDevices') : t('compliance.deviceGroup')}
 </button>
 ))}
 </div>
 </div>
 <div className="space-y-1">
 <label className="text-xs font-medium text-text-muted uppercase">{t('compliance.ruleBuilder.targetPlatform')}</label>
 <div className="flex flex-wrap gap-1">
 {(['all', 'windows', 'linux', 'macos'] as const).map((p) => (
 <button
 key={p}
 type="button"
 onClick={() => setForm({ ...form, targetPlatform: p })}
 className={clsx(
 'flex-1 py-2 text-xs rounded-lg border transition-colors',
 form.targetPlatform === p ? 'bg-accent/10 border-accent text-accent' : 'border-transparent text-text-muted hover:border-accent/50',
 )}
 >
 {p === 'all' ? t('common.all') : p === 'macos' ? 'macOS' : p.charAt(0).toUpperCase() + p.slice(1)}
 </button>
 ))}
 </div>
 </div>
 <div className="space-y-1 md:col-span-2">
 <label className="text-xs font-medium text-text-muted uppercase">{t('compliance.descriptionLabel')}</label>
 <input
 value={form.description}
 onChange={(e) => setForm({ ...form, description: e.target.value })}
 className="w-full px-3 py-2 text-sm bg-bg-tertiary rounded-lg text-text-primary focus:outline-none focus:border-accent"
 />
 </div>
 {form.targetType === 'group' && (
 <div className="space-y-1 md:col-span-2">
 <label className="text-xs font-medium text-text-muted uppercase">{t('softwareCompliance.groups')}</label>
 <PolicyGroupTreeMultiSelect
 selectedIds={form.targetIds}
 onChange={(ids) => setForm({ ...form, targetIds: ids })}
 />
 </div>
 )}
 </div>

 {/* Rule builder */}
 <div className=" pt-4 space-y-3">
 <div className="flex flex-wrap items-center justify-between gap-2">
 <h3 className="text-sm font-semibold text-text-primary">
 {t('compliance.ruleBuilder.title')} <span className="text-text-muted font-normal">({form.rules.length})</span>
 </h3>
 <div className="flex gap-2">
 {/* Presets quick button (compact, for editing) */}
 {editingPolicy && (
 <div className="relative" ref={presetsMenuRef}>
 <button
 onClick={() => setShowPresets(!showPresets)}
 aria-expanded={showPresets}
 className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-transparent text-text-muted hover:text-text-primary hover:border-accent/50 rounded-lg transition-colors"
 >
 <BookOpen className="w-3.5 h-3.5" />
 {t('compliance.presets')}
 </button>
 {showPresets && (
 <div className="absolute right-0 top-full mt-1 z-10 w-80 max-w-[calc(100vw-2rem)] max-h-[60vh] max-h-[60dvh] overflow-y-auto overscroll-contain bg-bg-secondary rounded-xl shadow-xl">
 <div className="p-2 ">
 <p className="text-xs font-semibold text-text-muted uppercase px-2 py-1">
 {t('compliance.presets')}
 </p>
 </div>
 {presets.map(preset => (
 <button
 key={preset.id}
 onClick={() => handleLoadPreset(preset)}
 className="w-full text-left px-4 py-3 hover:bg-bg-tertiary transition-colors last:border-0"
 >
 <div className="flex items-center justify-between">
 <span className="text-sm font-medium text-text-primary">{preset.name}</span>
 <span className="text-xs text-text-muted">{FRAMEWORK_LABELS[preset.framework]}</span>
 </div>
 <p className="text-xs text-text-muted mt-0.5 line-clamp-1">{preset.description}</p>
 <p className="text-xs text-accent mt-0.5">{preset.rules.length} {t('compliance.rules')}</p>
 </button>
 ))}
 </div>
 )}
 </div>
 )}
 <button
 onClick={addRule}
 className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-accent text-white rounded-lg hover:bg-accent/80 transition-colors"
 >
 <Plus className="w-3.5 h-3.5" />
 {t('compliance.ruleBuilder.addRule')}
 </button>
 </div>
 </div>

 {form.rules.length === 0 ? (
 <p className="text-sm text-text-muted text-center py-8 bg-bg-tertiary/30 rounded-lg border border-dashed border-transparent">
 {t('compliance.ruleBuilder.noRules')}
 </p>
 ) : (
 <div className="space-y-2">
 {form.rules.map((rule, i) => (
 <RuleEditorRow
 key={rule.id}
 rule={rule}
 onChange={r => updateRule(i, r)}
 onDelete={() => deleteRule(i)}
 />
 ))}
 </div>
 )}
 </div>

 <div className="flex gap-4 pt-2 ">
 <label className="flex items-center gap-2 cursor-pointer">
 <input
 type="checkbox"
 checked={form.enabled}
 onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
 className="rounded"
 />
 <span className="text-sm text-text-primary">{t('compliance.policyEnabled')}</span>
 </label>
 </div>
 </div>
 )}

 <div className="flex justify-end">
 <button
 onClick={handleOpenCreate}
 className="flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-lg hover:bg-accent/80 text-sm transition-colors"
 >
 <Plus className="w-4 h-4" />
 {t('compliance.newPolicy')}
 </button>
 </div>

 {isLoading ? (
 <div className="flex items-center justify-center h-48">
 <RefreshCw className="w-5 h-5 animate-spin text-text-muted" />
 </div>
 ) : filteredPolicies.length === 0 ? (
 /* ── Empty state with preset cards ── */
 <div className="space-y-4">
 <div className="p-6 bg-bg-secondary rounded-xl space-y-4">
 <div className="text-center space-y-1">
 <ShieldCheck className="w-10 h-10 mx-auto opacity-30 text-text-muted" />
 <p className="font-medium text-text-primary">{t('compliance.noPolicies')}</p>
 <p className="text-sm text-text-muted">{t('compliance.noPoliciesDesc')}</p>
 </div>
 <div className=" pt-4 space-y-3">
 <div className="flex items-center gap-2">
 <Sparkles className="w-4 h-4 text-accent" />
 <span className="text-sm font-semibold text-text-primary">{t('compliance.startWithPreset')}</span>
 </div>
 <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
 {presets.map(preset => (
 <button
 key={preset.id}
 onClick={() => { handleOpenCreate(); setTimeout(() => handleLoadPreset(preset), 50); }}
 className="text-left p-3 rounded-lg bg-bg-tertiary hover:border-accent/60 hover:bg-bg-secondary transition-all group"
 >
 <div className="flex items-center justify-between mb-1">
 <span className="text-xs font-bold text-text-primary line-clamp-1">{preset.name}</span>
 <span className={clsx(
 'text-[10px] px-1.5 py-0.5 rounded font-semibold shrink-0 ml-1',
 preset.framework === 'CIS' ? 'bg-blue-400/20 text-blue-400' :
 preset.framework === 'NIST' ? 'bg-teal-400/20 text-teal-400' :
 preset.framework === 'ISO27001' ? 'bg-green-400/20 text-green-400' :
 preset.framework === 'PCI_DSS' ? 'bg-orange-400/20 text-orange-400' :
 preset.framework === 'HIPAA' ? 'bg-pink-400/20 text-pink-400' :
 preset.framework === 'SOC2' ? 'bg-cyan-400/20 text-cyan-400' :
 'bg-bg-tertiary text-text-muted',
 )}>
 {FRAMEWORK_LABELS[preset.framework]}
 </span>
 </div>
 <p className="text-[11px] text-text-muted line-clamp-2 leading-relaxed">{preset.description}</p>
 <div className="flex items-center justify-between mt-1.5">
 <span className="text-[10px] text-accent">{preset.rules.length} {t('compliance.rules')}</span>
 <ArrowRight className="w-3 h-3 text-text-muted group-hover:text-accent transition-colors" />
 </div>
 </button>
 ))}
 </div>
 </div>
 </div>
 </div>
 ) : (
 <div className="space-y-3">
 <TenantFilterChips
 value={tenantFilter.value}
 onChange={tenantFilter.setValue}
 availableTenantIds={[...new Set(policies.map((p) => p.tenantId))]}
 className="mb-2"
 />
 {filteredPolicies.map((policy) => (
 <div key={policy.id} className="p-4 bg-bg-secondary rounded-xl">
 <div className="flex items-start justify-between gap-4">
 <div className="flex-1 min-w-0">
 <div className="flex items-center gap-2 flex-wrap">
 <span className="text-sm font-medium text-text-primary">{policy.name}</span>
 <span className="text-xs px-2 py-0.5 bg-bg-tertiary rounded-full text-text-muted">
 {FRAMEWORK_LABELS[policy.framework]}
 </span>
 <span className={clsx('text-xs px-2 py-0.5 rounded-full border font-medium',
 policy.enabled ? 'text-green-400 bg-green-400/10 border-green-400/30' : 'text-gray-400 bg-gray-400/10 border-gray-400/30')}>
 {policy.enabled ? t('status.active') : t('status.inactive')}
 </span>
 <TenantBadge tenantId={policy.tenantId} />
 </div>
 {policy.description && (
 <p className="text-xs text-text-muted mt-1">{policy.description}</p>
 )}
 <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5 text-xs text-text-muted">
 <span>{t('compliance.target')}: <span className="text-text-primary">
 {policy.targetType === 'all' ? t('compliance.allDevices') : t('compliance.groupCount', { count: policy.targetIds?.length ?? 0, defaultValue: '{{count}} group(s)' })}
 </span></span>
 {policy.targetPlatform && policy.targetPlatform !== 'all' && (
 <span className="text-xs px-1.5 py-0.5 rounded bg-bg-tertiary border border-transparent capitalize">
 {policy.targetPlatform === 'macos' ? 'macOS' : policy.targetPlatform}
 </span>
 )}
 <span>{t('compliance.rules')}: <span className="text-text-primary">{policy.rules.length}</span></span>
 <span>{t('compliance.created')}: <span className="text-text-primary">{new Date(policy.createdAt).toLocaleDateString()}</span></span>
 </div>

 {/* Severity breakdown */}
 {policy.rules.length > 0 && (
 <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5">
 {(['critical', 'high', 'moderate', 'low', 'optional'] as CheckSeverity[]).map(s => {
 const n = policy.rules.filter(r => r.severity === s).length;
 return n > 0 ? (
 <span key={s} className={clsx('text-[10px] font-semibold uppercase', SEVERITY_COLOR[s])}>
 {n} {s}
 </span>
 ) : null;
 })}
 </div>
 )}
 </div>
 <div className="flex gap-1 shrink-0 items-center">
 {isReadOnlyForCaller(policy) && (
 // The read-only reason was only in the disabled buttons' title — tap the badge on touch.
 <Tip content={t('masterTenant.readOnlyTooltip')} className="mr-1">
 <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] uppercase tracking-wider rounded-full bg-amber-400/10 text-amber-400 border border-amber-400/30">
 🔒 Master
 </span>
 </Tip>
 )}
 <IconButton
 label={t('common.edit')}
 icon={<Edit className="w-4 h-4" />}
 onClick={() => handleOpenEdit(policy)}
 disabled={isReadOnlyForCaller(policy)}
 title={isReadOnlyForCaller(policy) ? t('masterTenant.readOnlyTooltip') : t('common.edit')}
 className="hover:bg-bg-tertiary"
 />
 <IconButton
 label={t('common.delete')}
 icon={<Trash2 className="w-4 h-4" />}
 variant="danger"
 onClick={() => handleDelete(policy.id)}
 disabled={isReadOnlyForCaller(policy)}
 title={isReadOnlyForCaller(policy) ? t('masterTenant.readOnlyTooltip') : t('common.delete')}
 />
 </div>
 </div>
 </div>
 ))}
 </div>
 )}
 </div>
 )}
 </PageContainer>
 );
}

// ── GroupTreeMultiSelect for compliance policies ─────────────────────────────

function PolicyGroupTreeMultiSelect({ selectedIds, onChange }: { selectedIds: number[]; onChange: (ids: number[]) => void }) {
 const { t } = useTranslation();
 const [tree, setTree] = useState<DeviceGroupTreeNode[]>([]);
 const [expanded, setExpanded] = useState<Set<number>>(new Set());

 useEffect(() => {
 groupsApi.tree().then((tr) => {
 setTree(tr);
 const all = new Set<number>();
 const walk = (nodes: DeviceGroupTreeNode[]) => { for (const n of nodes) { all.add(n.id); walk(n.children); } };
 walk(tr);
 setExpanded(all);
 }).catch(() => {});
 }, []);

 const getDescendantIds = (node: DeviceGroupTreeNode): number[] => {
 const ids: number[] = [];
 for (const c of node.children) { ids.push(c.id, ...getDescendantIds(c)); }
 return ids;
 };

 const selected = new Set(selectedIds);

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
 next = new Set(selectedIds.filter((id) => !allIds.includes(id)));
 } else {
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
 type="button"
 onClick={() => hasChildren && toggleExpand(node.id)}
 aria-label={node.name} aria-expanded={hasChildren ? isExpanded : undefined}
 className={clsx('shrink-0 p-0.5 text-text-muted hover:text-text-primary transition-colors coarse:inline-flex coarse:min-h-10 coarse:min-w-10 coarse:items-center coarse:justify-center', !hasChildren && 'invisible')}
 >
 <ChevronRight className={clsx('w-3 h-3 coarse:w-4 coarse:h-4 transition-transform', isExpanded && 'rotate-90')} />
 </button>
 <button
 type="button"
 onClick={() => toggleNode(node)}
 aria-label={node.name} aria-pressed={state === 'all'}
 className={clsx(
 'w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors coarse:w-5 coarse:h-5',
 state === 'all' ? 'bg-accent border-accent text-white' :
 state === 'some' ? 'bg-accent/30 border-accent text-white' :
 'border-transparent hover:border-accent/50',
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
 {hasChildren && isExpanded && node.children.map((c: DeviceGroupTreeNode) => renderNode(c, depth + 1))}
 </div>
 );
 };

 if (tree.length === 0) {
 return <p className="text-sm text-text-muted py-2">{t('updates.policy.noGroups', 'No groups available')}</p>;
 }

 return (
 <div className="rounded-lg bg-bg-tertiary max-h-60 overflow-y-auto py-1">
 {tree.map((n) => renderNode(n, 0))}
 </div>
 );
}
