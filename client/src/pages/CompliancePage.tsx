import { useEffect, useState, useCallback } from 'react';
import { Plus, ShieldCheck, ShieldAlert, ShieldX, RefreshCw, Edit, Trash2, ChevronDown, ChevronUp, CheckCircle, XCircle, AlertTriangle, Activity } from 'lucide-react';
import { complianceApi } from '@/api/compliance.api';
import type { CompliancePolicy, ComplianceResult, ComplianceFramework } from '@obliance/shared';
import toast from 'react-hot-toast';
import { clsx } from 'clsx';

type Tab = 'results' | 'policies';

const FRAMEWORKS: ComplianceFramework[] = ['CIS', 'NIST', 'ISO27001', 'PCI_DSS', 'HIPAA', 'SOC2', 'custom'];

const FRAMEWORK_LABELS: Record<ComplianceFramework, string> = {
  CIS: 'CIS',
  NIST: 'NIST',
  ISO27001: 'ISO 27001',
  PCI_DSS: 'PCI DSS',
  HIPAA: 'HIPAA',
  SOC2: 'SOC 2',
  custom: 'Custom',
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

interface PolicyFormData {
  name: string;
  description: string;
  framework: ComplianceFramework;
  targetType: 'device' | 'group' | 'all';
  targetId: number | null;
  enabled: boolean;
}

const defaultPolicyForm: PolicyFormData = {
  name: '',
  description: '',
  framework: 'CIS',
  targetType: 'all',
  targetId: null,
  enabled: true,
};

export function CompliancePage() {
  const [activeTab, setActiveTab] = useState<Tab>('results');
  const [policies, setPolicies] = useState<CompliancePolicy[]>([]);
  const [results, setResults] = useState<ComplianceResult[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filterFramework, setFilterFramework] = useState<string>('');
  const [showForm, setShowForm] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState<CompliancePolicy | null>(null);
  const [form, setForm] = useState<PolicyFormData>(defaultPolicyForm);
  const [isSaving, setIsSaving] = useState(false);
  const [expandedResultId, setExpandedResultId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const [policiesData, resultsData] = await Promise.all([
        complianceApi.listPolicies(),
        complianceApi.listResults({ page: 1 }),
      ]);
      setPolicies(policiesData);
      setResults(resultsData.items);
    } catch {
      toast.error('Failed to load compliance data');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleOpenCreate = () => {
    setForm(defaultPolicyForm);
    setEditingPolicy(null);
    setShowForm(true);
  };

  const handleOpenEdit = (policy: CompliancePolicy) => {
    setForm({
      name: policy.name,
      description: policy.description ?? '',
      framework: policy.framework,
      targetType: policy.targetType,
      targetId: policy.targetId,
      enabled: policy.enabled,
    });
    setEditingPolicy(policy);
    setShowForm(true);
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
        targetId: form.targetId,
        rules: [],
        enabled: form.enabled,
        tenantId: 0,
      };
      if (editingPolicy) {
        await complianceApi.updatePolicy(editingPolicy.id, payload);
        toast.success('Policy updated');
      } else {
        await complianceApi.createPolicy(payload as any);
        toast.success('Policy created');
      }
      setShowForm(false);
      setEditingPolicy(null);
      await load();
    } catch {
      toast.error('Failed to save policy');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this compliance policy?')) return;
    try {
      await complianceApi.deletePolicy(id);
      toast.success('Policy deleted');
      await load();
    } catch {
      toast.error('Failed to delete policy');
    }
  };

  const handleTriggerCheck = async (deviceId: number, policyId?: number) => {
    try {
      await complianceApi.triggerCheck(deviceId, policyId);
      toast.success('Compliance check triggered');
    } catch {
      toast.error('Failed to trigger check');
    }
  };

  const filteredPolicies = filterFramework
    ? policies.filter(p => p.framework === filterFramework)
    : policies;

  const filteredResults = filterFramework
    ? results.filter(r => r.policy?.framework === filterFramework)
    : results;

  // Compute summary stats
  const avgScore = results.length > 0
    ? results.reduce((sum, r) => sum + r.complianceScore, 0) / results.length
    : null;

  const passingCount = results.filter(r => r.complianceScore >= 80).length;
  const warningCount = results.filter(r => r.complianceScore >= 50 && r.complianceScore < 80).length;
  const failingCount = results.filter(r => r.complianceScore < 50).length;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Compliance</h1>
          <p className="text-sm text-text-muted mt-0.5">Monitor device compliance against security frameworks</p>
        </div>
        <button onClick={load} className="p-2 text-text-muted hover:text-text-primary hover:bg-bg-secondary rounded-lg transition-colors">
          <RefreshCw className={clsx('w-4 h-4', isLoading && 'animate-spin')} />
        </button>
      </div>

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
              <p className="text-xs text-text-muted">Avg score</p>
            </div>
          </div>
        </div>
        <div className="p-4 bg-bg-secondary border border-border rounded-xl flex items-center gap-3">
          <div className="p-2 rounded-lg bg-green-400/10">
            <CheckCircle className="w-4 h-4 text-green-400" />
          </div>
          <div>
            <p className="text-xl font-bold text-text-primary">{passingCount}</p>
            <p className="text-xs text-text-muted">Passing (≥80%)</p>
          </div>
        </div>
        <div className="p-4 bg-bg-secondary border border-border rounded-xl flex items-center gap-3">
          <div className="p-2 rounded-lg bg-yellow-400/10">
            <AlertTriangle className="w-4 h-4 text-yellow-400" />
          </div>
          <div>
            <p className="text-xl font-bold text-text-primary">{warningCount}</p>
            <p className="text-xs text-text-muted">Warning (50–79%)</p>
          </div>
        </div>
        <div className="p-4 bg-bg-secondary border border-border rounded-xl flex items-center gap-3">
          <div className="p-2 rounded-lg bg-red-400/10">
            <XCircle className="w-4 h-4 text-red-400" />
          </div>
          <div>
            <p className="text-xl font-bold text-text-primary">{failingCount}</p>
            <p className="text-xs text-text-muted">Failing (&lt;50%)</p>
          </div>
        </div>
      </div>

      {/* Framework filter + Tabs */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="border-b border-border flex-1">
          <nav className="-mb-px flex gap-1">
            {(['results', 'policies'] as Tab[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={clsx(
                  'px-4 py-2.5 text-sm font-medium border-b-2 capitalize transition-colors',
                  activeTab === tab ? 'border-accent text-accent' : 'border-transparent text-text-muted hover:text-text-primary hover:border-border',
                )}
              >
                {tab === 'results' ? 'Results' : 'Policies'}
              </button>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={filterFramework}
            onChange={(e) => setFilterFramework(e.target.value)}
            className="px-3 py-1.5 text-sm bg-bg-secondary border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent"
          >
            <option value="">All frameworks</option>
            {FRAMEWORKS.map(f => <option key={f} value={f}>{FRAMEWORK_LABELS[f]}</option>)}
          </select>
        </div>
      </div>

      {activeTab === 'results' && (
        <div className="space-y-3">
          {isLoading ? (
            <div className="flex items-center justify-center h-48">
              <RefreshCw className="w-5 h-5 animate-spin text-text-muted" />
            </div>
          ) : filteredResults.length === 0 ? (
            <div className="p-12 text-center text-text-muted bg-bg-secondary border border-border rounded-xl">
              <ShieldCheck className="w-10 h-10 mx-auto mb-3 opacity-50" />
              <p className="font-medium text-text-primary mb-1">No compliance results yet</p>
              <p className="text-sm">Assign compliance policies to your devices to begin monitoring.</p>
            </div>
          ) : (
            filteredResults.map((result) => {
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
                        <span className="text-sm font-medium text-text-primary">Device #{result.deviceId}</span>
                        {result.policy && (
                          <span className="text-xs px-2 py-0.5 bg-bg-tertiary border border-border rounded-full text-text-muted">
                            {FRAMEWORK_LABELS[result.policy.framework]} · {result.policy.name}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-1">
                        {/* Score bar */}
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
                          {passCount}✓ {failCount > 0 ? `${failCount}✗ ` : ''}{warnCount > 0 ? `${warnCount}⚠` : ''}{total > 0 ? ` of ${total} checks` : ''}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs text-text-muted hidden sm:block">
                        {new Date(result.checkedAt).toLocaleDateString()}
                      </span>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleTriggerCheck(result.deviceId, result.policyId); }}
                        className="p-1.5 text-text-muted hover:text-accent hover:bg-bg-tertiary rounded transition-colors"
                        title="Re-run compliance check"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                      </button>
                      {expanded ? <ChevronUp className="w-4 h-4 text-text-muted" /> : <ChevronDown className="w-4 h-4 text-text-muted" />}
                    </div>
                  </div>

                  {expanded && result.results.length > 0 && (
                    <div className="border-t border-border bg-bg-tertiary/50">
                      <div className="divide-y divide-border">
                        {result.results.map((ruleResult) => (
                          <div key={ruleResult.ruleId} className="flex items-start gap-3 px-4 py-2.5">
                            <div className="shrink-0 mt-0.5">
                              {ruleResult.status === 'pass' && <CheckCircle className="w-4 h-4 text-green-400" />}
                              {ruleResult.status === 'fail' && <XCircle className="w-4 h-4 text-red-400" />}
                              {ruleResult.status === 'warning' && <AlertTriangle className="w-4 h-4 text-yellow-400" />}
                              {(ruleResult.status === 'unknown' || ruleResult.status === 'skipped' || ruleResult.status === 'error') && (
                                <div className="w-4 h-4 rounded-full border-2 border-border" />
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium text-text-primary">{ruleResult.ruleId}</p>
                              {ruleResult.actualValue !== undefined && ruleResult.actualValue !== null && (
                                <p className="text-xs text-text-muted mt-0.5">
                                  Actual: <span className="font-mono">{String(ruleResult.actualValue)}</span>
                                </p>
                              )}
                            </div>
                            <span className={clsx('text-xs font-medium shrink-0', ruleResult.status === 'pass' ? 'text-green-400' : ruleResult.status === 'fail' ? 'text-red-400' : ruleResult.status === 'warning' ? 'text-yellow-400' : 'text-text-muted')}>
                              {ruleResult.status}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {activeTab === 'policies' && (
        <div className="space-y-4">
          {/* Policy form */}
          {showForm && (
            <div className="bg-bg-secondary border border-border rounded-xl p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-text-primary">{editingPolicy ? 'Edit Policy' : 'New Compliance Policy'}</h2>
                <div className="flex gap-2">
                  <button
                    onClick={() => { setShowForm(false); setEditingPolicy(null); }}
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
                  <label className="text-xs font-medium text-text-muted uppercase">Framework</label>
                  <select
                    value={form.framework}
                    onChange={(e) => setForm({ ...form, framework: e.target.value as ComplianceFramework })}
                    className="w-full px-3 py-2 text-sm bg-bg-tertiary border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent"
                  >
                    {FRAMEWORKS.map(f => <option key={f} value={f}>{FRAMEWORK_LABELS[f]}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-text-muted uppercase">Target</label>
                  <select
                    value={form.targetType}
                    onChange={(e) => setForm({ ...form, targetType: e.target.value as 'device' | 'group' | 'all', targetId: null })}
                    className="w-full px-3 py-2 text-sm bg-bg-tertiary border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent"
                  >
                    <option value="all">All devices</option>
                    <option value="group">Device group</option>
                    <option value="device">Specific device</option>
                  </select>
                </div>
                <div className="space-y-1 md:col-span-2">
                  <label className="text-xs font-medium text-text-muted uppercase">Description</label>
                  <input
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    className="w-full px-3 py-2 text-sm bg-bg-tertiary border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent"
                  />
                </div>
              </div>

              <div className="flex gap-4 pt-2 border-t border-border">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.enabled}
                    onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
                    className="rounded"
                  />
                  <span className="text-sm text-text-primary">Enabled</span>
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
              New Policy
            </button>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center h-48">
              <RefreshCw className="w-5 h-5 animate-spin text-text-muted" />
            </div>
          ) : filteredPolicies.length === 0 ? (
            <div className="p-12 text-center text-text-muted bg-bg-secondary border border-border rounded-xl">
              <ShieldCheck className="w-10 h-10 mx-auto mb-3 opacity-50" />
              <p className="font-medium text-text-primary mb-1">No compliance policies yet</p>
              <p className="text-sm">Create policies to enforce security standards across your fleet.</p>
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
                        <span className={clsx('text-xs px-2 py-0.5 rounded-full border font-medium', policy.enabled ? 'text-green-400 bg-green-400/10 border-green-400/30' : 'text-gray-400 bg-gray-400/10 border-gray-400/30')}>
                          {policy.enabled ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                      {policy.description && (
                        <p className="text-xs text-text-muted mt-1">{policy.description}</p>
                      )}
                      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5 text-xs text-text-muted">
                        <span>Target: <span className="text-text-primary">{policy.targetType === 'all' ? 'All devices' : `${policy.targetType} #${policy.targetId}`}</span></span>
                        <span>Rules: <span className="text-text-primary">{policy.rules.length}</span></span>
                        <span>Created: <span className="text-text-primary">{new Date(policy.createdAt).toLocaleDateString()}</span></span>
                      </div>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button
                        onClick={() => handleOpenEdit(policy)}
                        className="p-1.5 text-text-muted hover:text-text-primary hover:bg-bg-tertiary rounded transition-colors"
                      >
                        <Edit className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(policy.id)}
                        className="p-1.5 text-text-muted hover:text-red-400 hover:bg-red-400/10 rounded transition-colors"
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
