import { useEffect, useState, useCallback } from 'react';
import {
  Plus, ShieldCheck, ShieldAlert, ShieldX, RefreshCw, Edit, Trash2,
  ChevronDown, ChevronUp, CheckCircle, XCircle, AlertTriangle, Activity,
  BookOpen, GripVertical, X, Sparkles, ArrowRight, Monitor,
  Wrench, EyeOff, Eye, ChevronRight, Check, Minus, FolderOpen,
} from 'lucide-react';
import { complianceApi } from '@/api/compliance.api';
import { groupsApi } from '@/api/groups.api';
import { useAuthStore } from '@/store/authStore';
import type { DeviceGroupTreeNode } from '@obliance/shared';
import { useDeviceStore } from '@/store/deviceStore';
import type {
  CompliancePolicy, CompliancePreset, ComplianceResult,
  ComplianceFramework, ComplianceRule, ComplianceCheckType,
  ComplianceOperator, CheckSeverity, ScriptPlatform,
} from '@obliance/shared';
import toast from 'react-hot-toast';
import { clsx } from 'clsx';
import { useTranslation } from 'react-i18next';

type Tab = 'results' | 'policies';

const FRAMEWORKS: ComplianceFramework[] = ['CIS', 'NIST', 'ISO27001', 'PCI_DSS', 'HIPAA', 'SOC2', 'custom'];
const FRAMEWORK_LABELS: Record<ComplianceFramework, string> = {
  CIS: 'CIS', NIST: 'NIST', ISO27001: 'ISO 27001', PCI_DSS: 'PCI DSS',
  HIPAA: 'HIPAA', SOC2: 'SOC 2', custom: 'Custom',
};

const CHECK_TYPES: ComplianceCheckType[] = ['registry', 'file', 'command', 'service', 'event_log', 'process', 'policy'];
const OPERATORS: ComplianceOperator[] = ['eq', 'neq', 'contains', 'not_contains', 'exists', 'not_exists', 'gt', 'lt', 'regex'];
const PLATFORMS: ScriptPlatform[] = ['all', 'windows', 'linux', 'macos'];
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
    <div className="border border-border rounded-lg p-3 space-y-2 bg-bg-tertiary/40 relative">
      <div className="flex items-start gap-2">
        <GripVertical className="w-4 h-4 text-text-muted mt-2 shrink-0 cursor-grab" />
        <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
          {/* Name */}
          <div className="lg:col-span-2 space-y-0.5">
            <label className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
              {t('compliance.ruleBuilder.ruleName')} *
            </label>
            <input
              value={rule.name}
              onChange={e => set({ name: e.target.value })}
              placeholder="Rule name"
              className="w-full px-2 py-1.5 text-sm bg-bg-secondary border border-border rounded text-text-primary focus:outline-none focus:border-accent"
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
              placeholder="e.g. Firewall"
              className="w-full px-2 py-1.5 text-sm bg-bg-secondary border border-border rounded text-text-primary focus:outline-none focus:border-accent"
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
              className="w-full px-2 py-1.5 text-sm bg-bg-secondary border border-border rounded text-text-primary focus:outline-none focus:border-accent"
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
              className="w-full px-2 py-1.5 text-sm bg-bg-secondary border border-border rounded text-text-primary focus:outline-none focus:border-accent"
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
              className="w-full px-2 py-1.5 text-sm bg-bg-secondary border border-border rounded text-text-primary focus:outline-none focus:border-accent"
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
              className="w-full px-2 py-1.5 text-sm bg-bg-secondary border border-border rounded text-text-primary focus:outline-none focus:border-accent"
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
              className="w-full px-2 py-1.5 text-sm bg-bg-secondary border border-border rounded font-mono text-text-primary focus:outline-none focus:border-accent"
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
                placeholder="Expected value"
                className="w-full px-2 py-1.5 text-sm bg-bg-secondary border border-border rounded font-mono text-text-primary focus:outline-none focus:border-accent"
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
              className="w-full px-2 py-1.5 text-sm bg-bg-secondary border border-border rounded text-text-primary focus:outline-none focus:border-accent"
            />
          </div>
          {/* Remediation Script */}
          <div className="lg:col-span-4 space-y-0.5">
            <label className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
              Remediation Script
              <span className="ml-1 normal-case font-normal text-text-muted/60">— script to fix this rule when it fails</span>
            </label>
            <textarea
              value={rule.remediationScript ?? ''}
              onChange={e => set({ remediationScript: e.target.value || undefined })}
              placeholder="PowerShell or Bash script to remediate..."
              rows={2}
              className="w-full px-2 py-1.5 text-sm bg-bg-secondary border border-border rounded font-mono text-text-primary focus:outline-none focus:border-accent resize-y"
            />
          </div>
        </div>
        <button
          onClick={onDelete}
          className="p-1 text-text-muted hover:text-red-400 hover:bg-red-400/10 rounded transition-colors shrink-0"
          title={t('compliance.ruleBuilder.deleteRule')}
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Severity badge preview */}
      <div className="flex items-center gap-2 pl-6">
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
  enabled: boolean;
  rules: RuleFormData[];
}

const defaultPolicyForm: PolicyFormData = {
  name: '', description: '', framework: 'CIS', targetType: 'all', targetIds: [],
  enabled: true, rules: [],
};

// ── Main page ─────────────────────────────────────────────────────────────────
export function CompliancePage({ embedded }: { embedded?: boolean } = {}) {
  const { t } = useTranslation();
  const { isAdmin } = useAuthStore();
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

  const load = useCallback(async () => {
    setIsLoading(true);
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
      setIsLoading(false);
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
      enabled: policy.enabled,
      rules: (policy.rules ?? []).map(r => ({ ...r, autoRemediateScriptId: null })),
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
      rules: preset.rules.map(r => ({ ...r, autoRemediateScriptId: null })),
    }));
    setShowPresets(false);
    toast.success(t('compliance.presetLoaded'));
  };

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error('Policy name is required'); return; }
    setIsSaving(true);
    try {
      const payload = {
        name: form.name,
        description: form.description || null,
        framework: form.framework,
        targetType: form.targetType,
        targetIds: form.targetIds,
        rules: form.rules,
        enabled: form.enabled,
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
    if (!confirm(t('compliance.confirmDelete'))) return;
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
    const key = ruleIds.map(id => `${deviceId}:${policyId}:${id}`);
    setRemediatingRules(prev => { const s = new Set(prev); key.forEach(k => s.add(k)); return s; });
    try {
      await complianceApi.remediate(deviceId, policyId, ruleIds);
      toast.success(`Remediation sent for ${ruleIds.length} rule(s)`);
    } catch {
      toast.error('Failed to send remediation');
    } finally {
      setRemediatingRules(prev => { const s = new Set(prev); key.forEach(k => s.delete(k)); return s; });
    }
  };

  const handleRemediateAll = async (result: ComplianceResult) => {
    const failingRuleIds = result.results
      .filter(rr => rr.status === 'fail' && !isRuleIgnored(result.deviceId, result.policyId, rr.ruleId))
      .map(rr => rr.ruleId)
      .filter(id => getRemediationScript(result.policyId, id));
    if (failingRuleIds.length === 0) { toast.error('No remediable rules'); return; }
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
      toast.success(`${ruleIds.length} rule(s) ignored`);
    } catch {
      toast.error('Failed to ignore rules');
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
      toast.success(`${ruleIds.length} rule(s) unignored`);
    } catch {
      toast.error('Failed to unignore rules');
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

  const filteredPolicies = filterFramework
    ? policies.filter(p => p.framework === filterFramework)
    : policies;

  const filteredResults = filterFramework
    ? results.filter(r => r.policy?.framework === filterFramework)
    : results;

  const avgScore = results.length > 0
    ? results.reduce((sum, r) => sum + r.complianceScore, 0) / results.length
    : null;
  const passingCount = results.filter(r => r.complianceScore >= 80).length;
  const warningCount = results.filter(r => r.complianceScore >= 50 && r.complianceScore < 80).length;
  const failingCount = results.filter(r => r.complianceScore < 50).length;

  return (
    <div className={embedded ? 'space-y-6' : 'p-6 space-y-6'}>
      {/* Header */}
      {!embedded && <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">{t('compliance.title')}</h1>
          <p className="text-sm text-text-muted mt-0.5">{t('compliance.description')}</p>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin() && (
            <button
              onClick={async () => {
                try {
                  const n = await complianceApi.syncPresets();
                  if (n > 0) {
                    toast.success(`${n} policy(ies) synced with latest presets`);
                    await load();
                  } else {
                    toast.success('All policies already up to date');
                  }
                } catch { toast.error('Sync failed'); }
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-border text-text-muted hover:text-accent hover:border-accent/50 transition-colors"
              title="Sync existing policies with latest built-in preset rules"
            >
              <Sparkles className="w-3.5 h-3.5" />
              Sync presets
            </button>
          )}
          <button onClick={load} className="p-2 text-text-muted hover:text-text-primary hover:bg-bg-secondary rounded-lg transition-colors">
            <RefreshCw className={clsx('w-4 h-4', isLoading && 'animate-spin')} />
          </button>
        </div>
      </div>}

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="p-4 bg-bg-secondary border border-border rounded-xl">
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
        <div className="p-4 bg-bg-secondary border border-border rounded-xl flex items-center gap-3">
          <div className="p-2 rounded-lg bg-green-400/10"><CheckCircle className="w-4 h-4 text-green-400" /></div>
          <div>
            <p className="text-xl font-bold text-text-primary">{passingCount}</p>
            <p className="text-xs text-text-muted">{t('compliance.passing')}</p>
          </div>
        </div>
        <div className="p-4 bg-bg-secondary border border-border rounded-xl flex items-center gap-3">
          <div className="p-2 rounded-lg bg-yellow-400/10"><AlertTriangle className="w-4 h-4 text-yellow-400" /></div>
          <div>
            <p className="text-xl font-bold text-text-primary">{warningCount}</p>
            <p className="text-xs text-text-muted">{t('compliance.warning')}</p>
          </div>
        </div>
        <div className="p-4 bg-bg-secondary border border-border rounded-xl flex items-center gap-3">
          <div className="p-2 rounded-lg bg-red-400/10"><XCircle className="w-4 h-4 text-red-400" /></div>
          <div>
            <p className="text-xl font-bold text-text-primary">{failingCount}</p>
            <p className="text-xs text-text-muted">{t('compliance.failing')}</p>
          </div>
        </div>
      </div>

      {/* Tabs + filter */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-1 rounded-lg bg-bg-secondary p-1 border border-border">
          {(['results', 'policies'] as Tab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={clsx(
                'flex-1 px-4 py-2 text-sm font-medium rounded-md transition-colors',
                activeTab === tab ? 'bg-accent text-white' : 'text-text-muted hover:text-text-primary',
              )}
            >
              {tab === 'results' ? t('compliance.tabResults') : t('compliance.tabPolicies')}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Device filter — results tab only */}
          {activeTab === 'results' && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-bg-secondary border border-border rounded-lg">
              <Monitor className="w-3.5 h-3.5 text-text-muted shrink-0" />
              <select
                value={filterDeviceId}
                onChange={(e) => setFilterDeviceId(e.target.value === '' ? '' : parseInt(e.target.value))}
                className="text-sm bg-transparent text-text-primary focus:outline-none min-w-[120px]"
              >
                <option value="">{t('compliance.allDevices')}</option>
                {devices.map(d => (
                  <option key={d.id} value={d.id}>
                    {d.displayName || d.hostname}
                  </option>
                ))}
              </select>
            </div>
          )}
          <select
            value={filterFramework}
            onChange={(e) => setFilterFramework(e.target.value)}
            className="px-3 py-1.5 text-sm bg-bg-secondary border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent"
          >
            <option value="">{t('compliance.allFrameworks')}</option>
            {FRAMEWORKS.map(f => <option key={f} value={f}>{FRAMEWORK_LABELS[f]}</option>)}
          </select>
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
            <div className="p-12 text-center text-text-muted bg-bg-secondary border border-border rounded-xl">
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
              <div key={result.id} className="bg-bg-secondary border border-border rounded-xl overflow-hidden">
                <div
                  className="flex items-center gap-4 px-4 py-3 cursor-pointer hover:bg-bg-tertiary transition-colors"
                  onClick={() => setExpandedResultId(expanded ? null : result.id)}
                >
                  <div className={clsx('p-2 rounded-lg', result.complianceScore >= 80 ? 'bg-green-400/10' : result.complianceScore >= 50 ? 'bg-yellow-400/10' : 'bg-red-400/10')}>
                    <ScoreIcon className={clsx('w-4 h-4', scoreColor(result.complianceScore))} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="flex items-center gap-1.5">
                        <Monitor className="w-3.5 h-3.5 text-text-muted shrink-0" />
                        <span className="text-sm font-medium text-text-primary">
                          {result.deviceName ?? t('compliance.deviceId', { id: result.deviceId })}
                        </span>
                      </div>
                      {result.policy && (
                        <span className="text-xs px-2 py-0.5 bg-bg-tertiary border border-border rounded-full text-text-muted">
                          {FRAMEWORK_LABELS[result.policy.framework]} · {result.policy.name}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-1">
                      <div className="flex-1 max-w-48 h-1.5 bg-bg-tertiary rounded-full overflow-hidden">
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
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs text-text-muted hidden sm:block">
                      {new Date(result.checkedAt).toLocaleDateString()}
                    </span>
                    {failCount > 0 && (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleRemediateAll(result); }}
                        className="flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-lg bg-accent/10 text-accent border border-accent/20 hover:bg-accent/20 transition-colors"
                        title="Remediate all failing rules"
                      >
                        <Wrench className="w-3 h-3" />
                        Fix All
                      </button>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); handleTriggerCheck(result.deviceId, result.policyId); }}
                      className="p-1.5 text-text-muted hover:text-accent hover:bg-bg-tertiary rounded transition-colors"
                      title={t('compliance.rerun')}
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                    </button>
                    {expanded ? <ChevronUp className="w-4 h-4 text-text-muted" /> : <ChevronDown className="w-4 h-4 text-text-muted" />}
                  </div>
                </div>

                {expanded && result.results.length > 0 && (() => {
                  const remediableFailCount = result.results.filter(rr =>
                    rr.status === 'fail' && !isRuleIgnored(result.deviceId, result.policyId, rr.ruleId)
                    && getRemediationScript(result.policyId, rr.ruleId)
                  ).length;
                  return (
                    <div className="border-t border-border bg-bg-tertiary/50">
                      {/* Bulk actions bar */}
                      {remediableFailCount > 0 && (
                        <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-bg-tertiary/80">
                          <button
                            onClick={(e) => { e.stopPropagation(); handleRemediateAll(result); }}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-accent/10 text-accent border border-accent/20 hover:bg-accent/20 transition-colors"
                          >
                            <Wrench className="w-3.5 h-3.5" />
                            Remediate all ({remediableFailCount})
                          </button>
                        </div>
                      )}
                      <div className="divide-y divide-border">
                        {result.results.map((ruleResult) => {
                          const ignored = isRuleIgnored(result.deviceId, result.policyId, ruleResult.ruleId);
                          const hasRemediation = !!getRemediationScript(result.policyId, ruleResult.ruleId);
                          const isRemediating = remediatingRules.has(`${result.deviceId}:${result.policyId}:${ruleResult.ruleId}`);
                          return (
                            <div key={ruleResult.ruleId} className={clsx('flex items-start gap-3 px-4 py-2.5', ignored && 'opacity-50')}>
                              <div className="shrink-0 mt-0.5">
                                {ignored ? <EyeOff className="w-4 h-4 text-text-muted" /> :
                                  ruleResult.status === 'pass' ? <CheckCircle className="w-4 h-4 text-green-400" /> :
                                  ruleResult.status === 'fail' ? <XCircle className="w-4 h-4 text-red-400" /> :
                                  ruleResult.status === 'warning' ? <AlertTriangle className="w-4 h-4 text-yellow-400" /> :
                                  <div className="w-4 h-4 rounded-full border-2 border-border" />}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-medium text-text-primary">
                                  {ruleResult.ruleName ?? policyRuleNames.get(`${result.policyId}:${ruleResult.ruleId}`) ?? ruleResult.ruleId}
                                </p>
                                <p className="text-[10px] text-text-muted/60 font-mono">{ruleResult.ruleId}</p>
                                {ruleResult.actualValue !== undefined && ruleResult.actualValue !== null && (
                                  <p className="text-xs text-text-muted mt-0.5">
                                    {t('compliance.actualValue')}: <span className="font-mono">{String(ruleResult.actualValue)}</span>
                                  </p>
                                )}
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
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
                                  <button
                                    onClick={(e) => { e.stopPropagation(); handleRemediate(result.deviceId, result.policyId, [ruleResult.ruleId]); }}
                                    disabled={isRemediating}
                                    className="p-1 text-accent hover:bg-accent/10 rounded transition-colors disabled:opacity-50"
                                    title="Remediate"
                                  >
                                    <Wrench className={clsx('w-3.5 h-3.5', isRemediating && 'animate-spin')} />
                                  </button>
                                )}
                                {!ignored ? (
                                  <button
                                    onClick={(e) => { e.stopPropagation(); handleIgnore(result.deviceId, result.policyId, [ruleResult.ruleId]); }}
                                    className="p-1 text-text-muted hover:text-yellow-400 hover:bg-yellow-400/10 rounded transition-colors"
                                    title="Ignore this rule"
                                  >
                                    <EyeOff className="w-3.5 h-3.5" />
                                  </button>
                                ) : (
                                  <button
                                    onClick={(e) => { e.stopPropagation(); handleUnignore(result.deviceId, result.policyId, [ruleResult.ruleId]); }}
                                    className="p-1 text-text-muted hover:text-green-400 hover:bg-green-400/10 rounded transition-colors"
                                    title="Unignore this rule"
                                  >
                                    <Eye className="w-3.5 h-3.5" />
                                  </button>
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
            <div className="bg-bg-secondary border border-border rounded-xl p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-text-primary">
                  {editingPolicy ? t('compliance.editPolicy') : t('compliance.newPolicyTitle')}
                </h2>
                <div className="flex gap-2">
                  <button
                    onClick={() => { setShowForm(false); setEditingPolicy(null); }}
                    className="px-4 py-2 text-sm text-text-muted hover:text-text-primary border border-border rounded-lg transition-colors"
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
                            : 'border-border bg-bg-secondary hover:border-accent/60 hover:bg-bg-tertiary',
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
                    className="w-full px-3 py-2 text-sm bg-bg-tertiary border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-text-muted uppercase">{t('compliance.framework')}</label>
                  <select
                    value={form.framework}
                    onChange={(e) => setForm({ ...form, framework: e.target.value as ComplianceFramework })}
                    className="w-full px-3 py-2 text-sm bg-bg-tertiary border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent"
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
                          form.targetType === tt ? 'bg-accent/10 border-accent text-accent' : 'border-border text-text-muted hover:border-accent/50',
                        )}
                      >
                        {tt === 'all' ? t('compliance.allDevices') : t('compliance.deviceGroup')}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-1 md:col-span-2">
                  <label className="text-xs font-medium text-text-muted uppercase">{t('compliance.descriptionLabel')}</label>
                  <input
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    className="w-full px-3 py-2 text-sm bg-bg-tertiary border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent"
                  />
                </div>
                {form.targetType === 'group' && (
                  <div className="space-y-1 md:col-span-2">
                    <label className="text-xs font-medium text-text-muted uppercase">Groups</label>
                    <PolicyGroupTreeMultiSelect
                      selectedIds={form.targetIds}
                      onChange={(ids) => setForm({ ...form, targetIds: ids })}
                    />
                  </div>
                )}
              </div>

              {/* Rule builder */}
              <div className="border-t border-border pt-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-text-primary">
                    {t('compliance.ruleBuilder.title')} <span className="text-text-muted font-normal">({form.rules.length})</span>
                  </h3>
                  <div className="flex gap-2">
                    {/* Presets quick button (compact, for editing) */}
                    {editingPolicy && (
                      <div className="relative">
                        <button
                          onClick={() => setShowPresets(!showPresets)}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-border text-text-muted hover:text-text-primary hover:border-accent/50 rounded-lg transition-colors"
                        >
                          <BookOpen className="w-3.5 h-3.5" />
                          {t('compliance.presets')}
                        </button>
                        {showPresets && (
                          <div className="absolute right-0 top-full mt-1 z-10 w-80 bg-bg-secondary border border-border rounded-xl shadow-xl overflow-hidden">
                            <div className="p-2 border-b border-border">
                              <p className="text-xs font-semibold text-text-muted uppercase px-2 py-1">
                                {t('compliance.presets')}
                              </p>
                            </div>
                            {presets.map(preset => (
                              <button
                                key={preset.id}
                                onClick={() => handleLoadPreset(preset)}
                                className="w-full text-left px-4 py-3 hover:bg-bg-tertiary transition-colors border-b border-border last:border-0"
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
                  <p className="text-sm text-text-muted text-center py-8 bg-bg-tertiary/30 rounded-lg border border-dashed border-border">
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

              <div className="flex gap-4 pt-2 border-t border-border">
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
              <div className="p-6 bg-bg-secondary border border-border rounded-xl space-y-4">
                <div className="text-center space-y-1">
                  <ShieldCheck className="w-10 h-10 mx-auto opacity-30 text-text-muted" />
                  <p className="font-medium text-text-primary">{t('compliance.noPolicies')}</p>
                  <p className="text-sm text-text-muted">{t('compliance.noPoliciesDesc')}</p>
                </div>
                <div className="border-t border-border pt-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-accent" />
                    <span className="text-sm font-semibold text-text-primary">{t('compliance.startWithPreset')}</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {presets.map(preset => (
                      <button
                        key={preset.id}
                        onClick={() => { handleOpenCreate(); setTimeout(() => handleLoadPreset(preset), 50); }}
                        className="text-left p-3 rounded-lg border border-border bg-bg-tertiary hover:border-accent/60 hover:bg-bg-secondary transition-all group"
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
              {filteredPolicies.map((policy) => (
                <div key={policy.id} className="p-4 bg-bg-secondary border border-border rounded-xl">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-text-primary">{policy.name}</span>
                        <span className="text-xs px-2 py-0.5 bg-bg-tertiary border border-border rounded-full text-text-muted">
                          {FRAMEWORK_LABELS[policy.framework]}
                        </span>
                        <span className={clsx('text-xs px-2 py-0.5 rounded-full border font-medium',
                          policy.enabled ? 'text-green-400 bg-green-400/10 border-green-400/30' : 'text-gray-400 bg-gray-400/10 border-gray-400/30')}>
                          {policy.enabled ? t('status.active') : t('status.inactive')}
                        </span>
                      </div>
                      {policy.description && (
                        <p className="text-xs text-text-muted mt-1">{policy.description}</p>
                      )}
                      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5 text-xs text-text-muted">
                        <span>{t('compliance.target')}: <span className="text-text-primary">
                          {policy.targetType === 'all' ? t('compliance.allDevices') : `${policy.targetIds?.length ?? 0} group(s)`}
                        </span></span>
                        <span>{t('compliance.rules')}: <span className="text-text-primary">{policy.rules.length}</span></span>
                        <span>{t('compliance.created')}: <span className="text-text-primary">{new Date(policy.createdAt).toLocaleDateString()}</span></span>
                      </div>

                      {/* Severity breakdown */}
                      {policy.rules.length > 0 && (
                        <div className="flex gap-3 mt-1.5">
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
                    <div className="flex gap-1 shrink-0">
                      <button
                        onClick={() => handleOpenEdit(policy)}
                        className="p-1.5 text-text-muted hover:text-text-primary hover:bg-bg-tertiary rounded transition-colors"
                        title={t('common.edit')}
                      >
                        <Edit className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(policy.id)}
                        className="p-1.5 text-text-muted hover:text-red-400 hover:bg-red-400/10 rounded transition-colors"
                        title={t('common.delete')}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── GroupTreeMultiSelect for compliance policies ─────────────────────────────

function PolicyGroupTreeMultiSelect({ selectedIds, onChange }: { selectedIds: number[]; onChange: (ids: number[]) => void }) {
  const [tree, setTree] = useState<DeviceGroupTreeNode[]>([]);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  useEffect(() => {
    groupsApi.tree().then((t) => {
      setTree(t);
      const all = new Set<number>();
      const walk = (nodes: DeviceGroupTreeNode[]) => { for (const n of nodes) { all.add(n.id); walk(n.children); } };
      walk(t);
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
            className={clsx('shrink-0 p-0.5 text-text-muted hover:text-text-primary transition-colors', !hasChildren && 'invisible')}
          >
            <ChevronRight className={clsx('w-3 h-3 transition-transform', isExpanded && 'rotate-90')} />
          </button>
          <button
            type="button"
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
        {hasChildren && isExpanded && node.children.map((c: DeviceGroupTreeNode) => renderNode(c, depth + 1))}
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
