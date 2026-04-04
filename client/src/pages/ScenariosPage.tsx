import { useEffect, useState, useCallback } from 'react';
import { Plus, Edit, Trash2, RefreshCw, Play, ToggleLeft, ToggleRight, ChevronDown, ChevronUp, ChevronRight, FolderOpen, Check, Minus, ArrowUp, ArrowDown, Zap, X } from 'lucide-react';
import { scenarioApi } from '@/api/scenario.api';
import { scriptApi } from '@/api/script.api';
import { groupsApi } from '@/api/groups.api';
import { useGroupStore } from '@/store/groupStore';
import type { Scenario, ScenarioTriggerType, ScenarioStatus, Script, ScriptSchedule, DeviceGroupTreeNode } from '@obliance/shared';
import toast from 'react-hot-toast';
import { clsx } from 'clsx';

const TRIGGER_LABELS: Record<ScenarioTriggerType, string> = {
  session_login: 'Session Login',
  machine_boot: 'Machine Boot',
  agent_approved: 'Agent Approved',
  group_join: 'Group Join',
  schedule_failure: 'Schedule Failure',
  manual: 'Manual',
};

const TRIGGER_COLORS: Record<ScenarioTriggerType, string> = {
  session_login: 'text-blue-400 bg-blue-400/10 border-blue-400/30',
  machine_boot: 'text-purple-400 bg-purple-400/10 border-purple-400/30',
  agent_approved: 'text-green-400 bg-green-400/10 border-green-400/30',
  group_join: 'text-orange-400 bg-orange-400/10 border-orange-400/30',
  schedule_failure: 'text-red-400 bg-red-400/10 border-red-400/30',
  manual: 'text-gray-400 bg-gray-400/10 border-gray-400/30',
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
};

const defaultStep: StepFormData = {
  name: '',
  checkScriptId: null,
  resolveScriptId: null,
  timeoutSeconds: 300,
  retryCount: 0,
};

function TriggerBadge({ type }: { type: ScenarioTriggerType }) {
  return (
    <span className={clsx('text-xs px-2 py-0.5 rounded-full border font-medium', TRIGGER_COLORS[type])}>
      {TRIGGER_LABELS[type]}
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
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [scripts, setScripts] = useState<Script[]>([]);
  const [schedules, setSchedules] = useState<ScriptSchedule[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingScenario, setEditingScenario] = useState<Scenario | null>(null);
  const [form, setForm] = useState<ScenarioFormData>(defaultForm);
  const [isSaving, setIsSaving] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const { fetchGroups } = useGroupStore();

  const load = useCallback(async () => {
    setIsLoading(true);
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
      toast.error('Failed to load scenarios');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { fetchGroups(); }, [fetchGroups]);

  const handleOpenCreate = () => {
    setForm(defaultForm);
    setEditingScenario(null);
    setShowForm(true);
  };

  const handleOpenEdit = (scenario: Scenario) => {
    const vars = scenario.variables
      ? Object.entries(scenario.variables).map(([key, value]) => ({ key, value }))
      : [];
    const steps: StepFormData[] = (scenario.steps ?? [])
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((s) => ({
        name: s.name,
        checkScriptId: s.checkScriptId,
        resolveScriptId: s.resolveScriptId,
        timeoutSeconds: s.timeoutSeconds,
        retryCount: s.retryCount,
      }));
    setForm({
      name: scenario.name,
      description: scenario.description ?? '',
      triggerType: scenario.triggerType,
      triggerConfig: scenario.triggerConfig ?? {},
      targetType: scenario.targetType,
      targetIds: scenario.targetIds ?? [],
      status: scenario.status,
      variables: vars,
      steps,
      retryPolicy: scenario.retryPolicy ?? { maxRetries: 0, retryDelaySeconds: 60 },
      timeoutSeconds: scenario.timeoutSeconds,
      notifyOnSuccess: scenario.notifyOnSuccess,
      notifyOnFailure: scenario.notifyOnFailure,
    });
    setEditingScenario(scenario);
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error('Name is required'); return; }
    if (form.steps.length === 0) { toast.error('At least one step is required'); return; }
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
      };

      if (editingScenario) {
        await scenarioApi.update(editingScenario.id, payload);
        toast.success('Scenario updated');
      } else {
        await scenarioApi.create(payload);
        toast.success('Scenario created');
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
    if (!confirm(`Delete scenario "${scenario.name}"?`)) return;
    try {
      await scenarioApi.delete(scenario.id);
      toast.success('Scenario deleted');
      await load();
    } catch {
      toast.error('Failed to delete scenario');
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
    try {
      const runs = await scenarioApi.trigger(scenario.id, []);
      toast.success(`Triggered ${runs.length} run(s)`);
    } catch {
      toast.error('Failed to trigger scenario');
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

  return (
    <div className={embedded ? 'space-y-6' : 'p-6 space-y-6'}>
      {!embedded && (
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-text-primary">Scenarios</h1>
            <p className="text-sm text-text-muted mt-0.5">Automate multi-step check-and-resolve workflows</p>
          </div>
          <div className="flex gap-2">
            <button onClick={load} className="p-2 text-text-muted hover:text-text-primary hover:bg-bg-secondary rounded-lg transition-colors">
              <RefreshCw className={clsx('w-4 h-4', isLoading && 'animate-spin')} />
            </button>
            <button
              onClick={handleOpenCreate}
              className="flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-lg hover:bg-accent/80 text-sm transition-colors"
            >
              <Plus className="w-4 h-4" />
              New Scenario
            </button>
          </div>
        </div>
      )}

      {embedded && (
        <div className="flex items-center justify-end gap-2">
          <button onClick={load} className="p-2 text-text-muted hover:text-text-primary hover:bg-bg-secondary rounded-lg transition-colors">
            <RefreshCw className={clsx('w-4 h-4', isLoading && 'animate-spin')} />
          </button>
          <button
            onClick={handleOpenCreate}
            className="flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-lg hover:bg-accent/80 text-sm transition-colors"
          >
            <Plus className="w-4 h-4" />
            New Scenario
          </button>
        </div>
      )}

      {/* Form panel */}
      {showForm && (
        <div className="bg-bg-secondary border border-border rounded-xl p-6 space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-text-primary">{editingScenario ? 'Edit Scenario' : 'New Scenario'}</h2>
            <div className="flex gap-2">
              <button
                onClick={() => { setShowForm(false); setEditingScenario(null); }}
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

          {/* Basic fields */}
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
              <label className="text-xs font-medium text-text-muted uppercase">Status</label>
              <select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value as ScenarioStatus })}
                className="w-full px-3 py-2 text-sm bg-bg-tertiary border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent"
              >
                <option value="draft">Draft</option>
                <option value="active">Active</option>
                <option value="disabled">Disabled</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-text-muted uppercase">Trigger Type</label>
              <select
                value={form.triggerType}
                onChange={(e) => setForm({ ...form, triggerType: e.target.value as ScenarioTriggerType, triggerConfig: {} })}
                className="w-full px-3 py-2 text-sm bg-bg-tertiary border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent"
              >
                {Object.entries(TRIGGER_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </div>

            {/* Conditional trigger config */}
            {form.triggerType === 'group_join' && (
              <div className="space-y-1">
                <label className="text-xs font-medium text-text-muted uppercase">Trigger Groups</label>
                <GroupTreeMultiSelect
                  selectedIds={form.triggerConfig.groupIds ?? []}
                  onChange={(ids) => setForm({ ...form, triggerConfig: { ...form.triggerConfig, groupIds: ids } })}
                />
              </div>
            )}
            {form.triggerType === 'schedule_failure' && (
              <div className="space-y-1">
                <label className="text-xs font-medium text-text-muted uppercase">Schedule</label>
                <select
                  value={form.triggerConfig.scheduleId ?? ''}
                  onChange={(e) => setForm({ ...form, triggerConfig: { scheduleId: e.target.value ? parseInt(e.target.value, 10) : undefined } })}
                  className="w-full px-3 py-2 text-sm bg-bg-tertiary border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent"
                >
                  <option value="">Select schedule...</option>
                  {schedules.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            )}

            <div className="space-y-1">
              <label className="text-xs font-medium text-text-muted uppercase">Target</label>
              <div className="flex gap-2">
                {(['all', 'group', 'device'] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setForm({ ...form, targetType: t, targetIds: [] })}
                    className={clsx(
                      'flex-1 py-2 text-sm rounded-lg border transition-colors',
                      form.targetType === t ? 'bg-accent/10 border-accent text-accent' : 'border-border text-text-muted hover:border-accent/50',
                    )}
                  >
                    {t === 'all' ? 'All devices' : t === 'group' ? 'By group' : 'By device'}
                  </button>
                ))}
              </div>
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

            <div className="space-y-1">
              <label className="text-xs font-medium text-text-muted uppercase">Timeout (seconds)</label>
              <input
                type="number"
                value={form.timeoutSeconds}
                onChange={(e) => setForm({ ...form, timeoutSeconds: parseInt(e.target.value, 10) || 3600 })}
                className="w-full px-3 py-2 text-sm bg-bg-tertiary border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent"
              />
            </div>

            <div className="space-y-1 md:col-span-2">
              <label className="text-xs font-medium text-text-muted uppercase">Description</label>
              <textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                rows={2}
                className="w-full px-3 py-2 text-sm bg-bg-tertiary border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent resize-none"
              />
            </div>
          </div>

          {/* Retry policy */}
          <div className="border-t border-border pt-4">
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
                  className="w-full px-3 py-2 text-sm bg-bg-tertiary border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-text-muted uppercase">Retry Delay (seconds)</label>
                <input
                  type="number"
                  min={0}
                  value={form.retryPolicy.retryDelaySeconds}
                  onChange={(e) => setForm({ ...form, retryPolicy: { ...form.retryPolicy, retryDelaySeconds: parseInt(e.target.value, 10) || 60 } })}
                  className="w-full px-3 py-2 text-sm bg-bg-tertiary border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent"
                />
              </div>
            </div>
          </div>

          {/* Notifications */}
          <div className="flex flex-wrap gap-6 pt-2 border-t border-border">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.notifyOnSuccess}
                onChange={(e) => setForm({ ...form, notifyOnSuccess: e.target.checked })}
                className="rounded"
              />
              <span className="text-sm text-text-primary">Notify on success</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.notifyOnFailure}
                onChange={(e) => setForm({ ...form, notifyOnFailure: e.target.checked })}
                className="rounded"
              />
              <span className="text-sm text-text-primary">Notify on failure</span>
            </label>
          </div>

          {/* Variables */}
          <div className="border-t border-border pt-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-text-primary">Variables</h3>
              <button
                onClick={addVariable}
                className="flex items-center gap-1 px-3 py-1.5 text-xs bg-bg-tertiary border border-border rounded-lg text-text-muted hover:text-text-primary hover:border-accent/50 transition-colors"
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
                      className="flex-1 px-3 py-1.5 text-sm bg-bg-tertiary border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent font-mono"
                    />
                    <input
                      value={v.value}
                      onChange={(e) => updateVariable(i, 'value', e.target.value)}
                      placeholder="Value"
                      className="flex-1 px-3 py-1.5 text-sm bg-bg-tertiary border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent"
                    />
                    <button
                      onClick={() => removeVariable(i)}
                      className="p-1.5 text-text-muted hover:text-red-400 hover:bg-red-400/10 rounded transition-colors"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Steps */}
          <div className="border-t border-border pt-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-text-primary">Steps *</h3>
              <button
                onClick={addStep}
                className="flex items-center gap-1 px-3 py-1.5 text-xs bg-bg-tertiary border border-border rounded-lg text-text-muted hover:text-text-primary hover:border-accent/50 transition-colors"
              >
                <Plus className="w-3 h-3" />
                Add Step
              </button>
            </div>
            {form.steps.length === 0 ? (
              <p className="text-xs text-text-muted">No steps yet. Add at least one step.</p>
            ) : (
              <div className="space-y-3">
                {form.steps.map((step, i) => (
                  <div key={i} className="bg-bg-tertiary border border-border rounded-lg p-4 space-y-3">
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
                          className="w-full px-3 py-1.5 text-sm bg-bg-secondary border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-text-muted uppercase">Check Script</label>
                        <select
                          value={step.checkScriptId ?? ''}
                          onChange={(e) => updateStep(i, { checkScriptId: e.target.value ? parseInt(e.target.value, 10) : null })}
                          className="w-full px-3 py-1.5 text-sm bg-bg-secondary border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent"
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
                          className="w-full px-3 py-1.5 text-sm bg-bg-secondary border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent"
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
                            className="w-full px-3 py-1.5 text-sm bg-bg-secondary border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent"
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
                            className="w-full px-3 py-1.5 text-sm bg-bg-secondary border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent"
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
      )}

      {/* Scenarios list */}
      {isLoading ? (
        <div className="flex items-center justify-center h-48">
          <RefreshCw className="w-5 h-5 animate-spin text-text-muted" />
        </div>
      ) : scenarios.length === 0 ? (
        <div className="p-12 text-center text-text-muted bg-bg-secondary border border-border rounded-xl">
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
          {scenarios.map((scenario) => {
            const expanded = expandedId === scenario.id;
            const stepCount = scenario.steps?.length ?? 0;
            return (
              <div key={scenario.id} className="bg-bg-secondary border border-border rounded-xl overflow-hidden">
                <div className="flex items-center gap-4 px-4 py-3">
                  <button
                    onClick={() => setExpandedId(expanded ? null : scenario.id)}
                    className="text-text-muted hover:text-text-primary transition-colors"
                  >
                    {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-text-primary">{scenario.name}</span>
                      <ScenarioStatusBadge status={scenario.status} />
                      <TriggerBadge type={scenario.triggerType} />
                    </div>
                    <div className="flex items-center gap-3 text-xs text-text-muted mt-0.5 flex-wrap">
                      <span>{stepCount} step{stepCount !== 1 ? 's' : ''}</span>
                      <span>
                        {scenario.targetType === 'all'
                          ? 'All devices'
                          : `${(scenario.targetIds ?? []).length} ${scenario.targetType}(s)`}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {scenario.triggerType === 'manual' && (
                      <button
                        onClick={() => handleTrigger(scenario)}
                        className="p-1.5 text-text-muted hover:text-accent hover:bg-accent/10 rounded transition-colors"
                        title="Trigger now"
                      >
                        <Play className="w-4 h-4" />
                      </button>
                    )}
                    <button
                      onClick={() => handleToggle(scenario)}
                      className="text-text-muted hover:text-accent transition-colors"
                      title={scenario.status === 'active' ? 'Disable' : 'Enable'}
                    >
                      {scenario.status === 'active' ? <ToggleRight className="w-5 h-5 text-green-400" /> : <ToggleLeft className="w-5 h-5" />}
                    </button>
                    <button
                      onClick={() => handleOpenEdit(scenario)}
                      className="p-1.5 text-text-muted hover:text-text-primary hover:bg-bg-tertiary rounded transition-colors"
                    >
                      <Edit className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(scenario)}
                      className="p-1.5 text-text-muted hover:text-red-400 hover:bg-red-400/10 rounded transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                {expanded && (
                  <div className="border-t border-border px-4 py-3 bg-bg-tertiary/50 space-y-3">
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
                            <div key={step.id} className="flex items-center gap-3 px-3 py-2 bg-bg-secondary rounded-lg border border-border">
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
    </div>
  );
}

// ── Inline Group Tree Multi-Select (same pattern as ScriptSchedulesPage) ──

function GroupTreeMultiSelect({ selectedIds, onChange }: { selectedIds: number[]; onChange: (ids: number[]) => void }) {
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
