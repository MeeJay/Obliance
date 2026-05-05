import { useEffect, useState, useCallback } from 'react';
import { Plus, Edit, Trash2, RefreshCw, Play, ToggleLeft, ToggleRight, ChevronDown, ChevronUp, ChevronRight, FolderOpen, Check, Minus, ArrowUp, ArrowDown, Zap, X, Download, History, Terminal, AlertCircle, CheckCircle2, Clock, Loader2, GitBranch } from 'lucide-react';
import { ScenarioGraphEditor } from '@/components/scenarios/ScenarioGraphEditor';
import { scenarioApi } from '@/api/scenario.api';
import { scriptApi } from '@/api/script.api';
import { groupsApi } from '@/api/groups.api';
import { useGroupStore } from '@/store/groupStore';
import { getSocket } from '@/socket/socketClient';
import type { Scenario, ScenarioTriggerType, ScenarioStatus, ScenarioRun, Script, ScriptSchedule, DeviceGroupTreeNode, AutomationNotificationBinding, Device } from '@obliance/shared';
import { deviceApi } from '@/api/device.api';
import { NotificationChannelBindings } from '@/components/automation/NotificationChannelBindings';
import { ToggleSwitch } from '@/components/common/ToggleSwitch';
import { DeviceMultiSelect } from '@/components/common/DeviceMultiSelect';
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
};

const TRIGGER_COLORS: Record<ScenarioTriggerType, string> = {
  session_login: 'text-blue-400 bg-blue-400/10 border-blue-400/30',
  machine_boot: 'text-purple-400 bg-purple-400/10 border-purple-400/30',
  agent_approved: 'text-green-400 bg-green-400/10 border-green-400/30',
  group_join: 'text-orange-400 bg-orange-400/10 border-orange-400/30',
  schedule_failure: 'text-red-400 bg-red-400/10 border-red-400/30',
  schedule_cron: 'text-purple-400 bg-purple-400/10 border-purple-400/30',
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
  notificationChannels: AutomationNotificationBinding[];
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
  notificationChannels: [],
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

  // Live refresh on scenario run / step updates emitted by the orchestrator.
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const debounced = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => load(), 400);
    };
    socket.on('SCENARIO_RUN_UPDATED', debounced);
    socket.on('SCENARIO_STEP_UPDATED', debounced);
    return () => {
      socket.off('SCENARIO_RUN_UPDATED', debounced);
      socket.off('SCENARIO_STEP_UPDATED', debounced);
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
      notificationChannels: full.notificationChannels ?? [],
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
        notificationChannels: form.notificationChannels,
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
    setTriggerLoading(true);
    setTriggerSearch('');
    setTriggerModalScenario(scenario);
    try {
      // 1) Pre-selection from the server (resolves group → devices via the
      //    closure table). Falls back to the configured device list.
      let preselected: number[] = [];
      try {
        preselected = await scenarioApi.resolvedTargets(scenario.id);
      } catch {
        preselected = scenario.targetType === 'device' ? (scenario.targetIds ?? []) : [];
      }
      setTriggerDeviceIds(preselected);

      // 2) Device pool scoped to the scenario's target. listPaginated with
      //    pageSize=5000 covers fleets up to 5k without truncating; the
      //    old fetch was capped at 100 (legacy /devices default), which
      //    masked half a 500-device target group.
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
              onClick={handleOpenTemplates}
              className="flex items-center gap-2 px-4 py-2 border border-border text-text-primary rounded-lg hover:bg-bg-secondary text-sm transition-colors"
            >
              <Download className="w-4 h-4" />
              Import from template
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
            onClick={handleOpenTemplates}
            className="flex items-center gap-2 px-4 py-2 border border-border text-text-primary rounded-lg hover:bg-bg-secondary text-sm transition-colors"
          >
            <Download className="w-4 h-4" />
            Import from template
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

      {/* Template import modal */}
      {showTemplateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowTemplateModal(false)}>
          <div
            className="bg-bg-primary border border-border rounded-xl shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h2 className="text-lg font-semibold text-text-primary">Import from template</h2>
              <button
                onClick={() => setShowTemplateModal(false)}
                className="p-1 text-text-muted hover:text-text-primary transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-3">
              {loadingTemplates ? (
                <div className="flex items-center justify-center py-12">
                  <RefreshCw className="w-5 h-5 animate-spin text-text-muted" />
                </div>
              ) : templates.length === 0 ? (
                <p className="text-sm text-text-muted text-center py-12">No templates available.</p>
              ) : selectedTemplate ? (
                <div className="space-y-4">
                  <button
                    onClick={() => setSelectedTemplate(null)}
                    className="text-sm text-accent hover:underline"
                  >
                    &larr; Back to templates
                  </button>
                  <div className="bg-bg-secondary border border-border rounded-lg p-4">
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
                            className="w-full px-3 py-2 text-sm bg-bg-tertiary border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent"
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
                    className="bg-bg-secondary border border-border rounded-lg p-4 hover:border-accent/50 transition-colors"
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
                        className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs bg-accent text-white rounded-lg hover:bg-accent/80 transition-colors"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Import
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
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
                onChange={(e) => {
                  const next = e.target.value as ScenarioTriggerType;
                  // Event-driven triggers fire on a specific device; the
                  // sensible default is to run the action on that same
                  // device. The admin can still flip to All / Group /
                  // Device later if they want a broadcast.
                  const eventDriven = ['session_login', 'machine_boot', 'agent_approved', 'group_join'].includes(next);
                  setForm({
                    ...form,
                    triggerType: next,
                    triggerConfig: {},
                    ...(eventDriven ? { targetType: 'self', targetIds: [] } : {}),
                  });
                }}
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
                <label className="text-xs font-medium text-text-muted uppercase">
                  Fire when joining…
                </label>
                <GroupTreeMultiSelect
                  selectedIds={form.triggerConfig.groupIds ?? []}
                  onChange={(ids) => setForm({ ...form, triggerConfig: { ...form.triggerConfig, groupIds: ids } })}
                />
                <p className="text-[11px] text-text-muted">
                  Leave empty to fire on any group join. Otherwise the trigger only fires
                  when a device joins one of these groups (or any descendant).
                </p>
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
                      { v: 'self',   l: 'Originating device' },
                      { v: 'all',    l: 'All devices' },
                      { v: 'group',  l: 'By group' },
                      { v: 'device', l: 'By device' },
                    ]
                  : [
                      { v: 'all',    l: 'All devices' },
                      { v: 'group',  l: 'By group' },
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
                          form.targetType === t.v ? 'bg-accent/10 border-accent text-accent' : 'border-border text-text-muted hover:border-accent/50',
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
                  {form.triggerType === 'session_login'  && ' (the agent reporting the new session).'}
                  {form.triggerType === 'machine_boot'   && ' (the agent that just booted).'}
                  {form.triggerType === 'group_join'     && ' (the device that just joined the group).'}
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
            <ToggleSwitch
              checked={form.notifyOnSuccess}
              onChange={(v) => setForm({ ...form, notifyOnSuccess: v })}
              label="Notify on success"
            />
            <ToggleSwitch
              checked={form.notifyOnFailure}
              onChange={(v) => setForm({ ...form, notifyOnFailure: v })}
              label="Notify on failure"
            />
          </div>

          {/* Notification channels */}
          <div className="pt-4 border-t border-border">
            <NotificationChannelBindings
              value={form.notificationChannels}
              onChange={(next) => setForm({ ...form, notificationChannels: next })}
            />
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

          {/* Structure — v2-only. The graph editor is the single source
              of truth for nodes and edges. The legacy step editor has
              been retired now that every scenario flows through the v2
              engine; we keep the React Flow callback below to jump
              straight from the metadata form into the canvas. */}
          <div className="border-t border-border pt-4">
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-text-primary">Structure</h3>
                <p className="text-xs text-text-muted mt-0.5">
                  Save this form first, then click the <span className="font-mono px-1 py-0 rounded bg-bg-tertiary border border-border">GitBranch</span> icon on the scenario card to design the check / resolve / branch flow visually.
                </p>
              </div>
              {editingScenario && (
                <button
                  onClick={() => { setShowForm(false); setEditingScenario(null); setGraphEditorScenarioId(editingScenario.id); }}
                  className="px-3 py-1.5 text-sm bg-accent/10 border border-accent/30 text-accent rounded-lg hover:bg-accent/20 transition-colors inline-flex items-center gap-1.5"
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
                className="flex items-center gap-1 px-3 py-1.5 text-xs bg-bg-tertiary border border-border rounded-lg text-text-muted hover:text-text-primary hover:border-accent/50 transition-colors"
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
            // Prefer the COUNT returned by the list endpoint (`stepCount`);
            // fall back to the detail-view `steps` array when the scenario
            // was loaded via getById (edit form).
            const stepCount = scenario.stepCount ?? scenario.steps?.length ?? 0;
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
                      onClick={() => setHistoryForScenario(scenario)}
                      className="p-1.5 text-text-muted hover:text-accent hover:bg-accent/10 rounded transition-colors"
                      title="Run history"
                    >
                      <History className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setGraphEditorScenarioId(scenario.id)}
                      className="p-1.5 text-text-muted hover:text-accent hover:bg-accent/10 rounded transition-colors"
                      title="Edit graph"
                    >
                      <GitBranch className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleOpenEdit(scenario)}
                      className="p-1.5 text-text-muted hover:text-text-primary hover:bg-bg-tertiary rounded transition-colors"
                      title="Edit metadata"
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

      {triggerModalScenario && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => !isTriggering && setTriggerModalScenario(null)}>
          <div className="bg-bg-secondary border border-border rounded-xl max-w-2xl w-full max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-border flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-text-primary">Run scenario</h2>
                <p className="text-xs text-text-muted mt-0.5">{triggerModalScenario.name}</p>
              </div>
              <button onClick={() => !isTriggering && setTriggerModalScenario(null)} className="p-1 text-text-muted hover:text-text-primary">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="px-6 py-4 space-y-3 overflow-y-auto flex-1">
              <label className="text-xs font-medium text-text-muted uppercase">Target devices</label>
              <input
                type="text"
                value={triggerSearch}
                onChange={(e) => setTriggerSearch(e.target.value)}
                placeholder="Search devices..."
                className="w-full px-3 py-2 text-sm bg-bg-tertiary border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent"
              />
              <div className="border border-border rounded-lg bg-bg-tertiary max-h-80 overflow-y-auto">
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
                        className="flex items-center gap-2 px-3 py-2 border-b border-border cursor-pointer hover:bg-bg-secondary"
                        onClick={() => {
                          if (allSelected) setTriggerDeviceIds((prev) => prev.filter((id) => !devices.some((d) => d.id === id)));
                          else setTriggerDeviceIds((prev) => Array.from(new Set([...prev, ...devices.map((d) => d.id)])));
                        }}
                      >
                        <div className={clsx('w-4 h-4 rounded border flex items-center justify-center', allSelected ? 'bg-accent border-accent' : 'border-border')}>
                          {allSelected && <Check className="w-3 h-3 text-white" />}
                        </div>
                        <span className="text-xs text-text-muted">Select all ({devices.length})</span>
                      </div>
                      {devices.map((d) => {
                        const selected = triggerDeviceIds.includes(d.id);
                        return (
                          <div
                            key={d.id}
                            className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-bg-secondary"
                            onClick={() => {
                              setTriggerDeviceIds((prev) => selected ? prev.filter((id) => id !== d.id) : [...prev, d.id]);
                            }}
                          >
                            <div className={clsx('w-4 h-4 rounded border flex items-center justify-center', selected ? 'bg-accent border-accent' : 'border-border')}>
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
              <p className="text-xs text-text-muted">{triggerDeviceIds.length} device(s) selected</p>
            </div>
            <div className="px-6 py-4 border-t border-border flex justify-end gap-2">
              <button
                onClick={() => setTriggerModalScenario(null)}
                disabled={isTriggering}
                className="px-4 py-2 text-sm text-text-muted hover:text-text-primary rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmTrigger}
                disabled={isTriggering || triggerDeviceIds.length === 0}
                className="px-4 py-2 text-sm bg-accent text-white rounded-lg hover:bg-accent/90 disabled:opacity-50 transition-colors flex items-center gap-2"
              >
                <Play className="w-4 h-4" />
                {isTriggering ? 'Running...' : 'Run'}
              </button>
            </div>
          </div>
        </div>
      )}

      {historyForScenario && (
        <ScenarioHistoryModal
          scenario={historyForScenario}
          onClose={() => setHistoryForScenario(null)}
        />
      )}

      {/* v2 graph editor — full-viewport modal with the React Flow canvas */}
      {graphEditorScenarioId != null && (
        <div className="fixed inset-0 z-50 bg-bg-primary">
          <ScenarioGraphEditor
            scenarioId={graphEditorScenarioId}
            onClose={() => setGraphEditorScenarioId(null)}
          />
        </div>
      )}
    </div>
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
      case 'success':   return 'text-green-400 bg-green-400/10 border-green-400/30';
      case 'failure':   return 'text-red-400 bg-red-400/10 border-red-400/30';
      case 'cancelled': return 'text-gray-400 bg-gray-400/10 border-gray-400/30';
      case 'running':   return 'text-blue-400 bg-blue-400/10 border-blue-400/30';
      case 'pending':   return 'text-yellow-400 bg-yellow-400/10 border-yellow-400/30';
      default:          return 'text-text-muted bg-bg-tertiary border-border';
    }
  };
  const statusIcon = (s: string) => {
    switch (s) {
      case 'success':   return <CheckCircle2 className="w-3 h-3" />;
      case 'failure':   return <AlertCircle className="w-3 h-3" />;
      case 'running':   return <Loader2 className="w-3 h-3 animate-spin" />;
      case 'pending':   return <Clock className="w-3 h-3" />;
      default:          return <Minus className="w-3 h-3" />;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="bg-bg-primary border border-border rounded-xl w-full max-w-5xl max-h-[90vh] flex flex-col shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-border flex-shrink-0">
          <div>
            <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
              <History className="w-4 h-4" />
              Run history — {scenario.name}
            </h3>
            <p className="text-xs text-text-muted mt-0.5">
              {loading ? 'Loading...' : `${runs.length} run${runs.length !== 1 ? 's' : ''}`}
            </p>
          </div>
          <button onClick={onClose} className="p-1 text-text-muted hover:text-text-primary rounded">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-hidden flex">
          {/* Left: run list */}
          <div className="w-1/2 border-r border-border overflow-y-auto">
            {loading ? (
              <div className="p-8 text-center text-xs text-text-muted">Loading...</div>
            ) : runs.length === 0 ? (
              <div className="p-8 text-center text-xs text-text-muted">
                No runs yet. Trigger the scenario to create one.
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
                        'w-full px-3 py-2 flex items-start gap-2 text-left text-xs transition-colors',
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

          {/* Right: selected run detail */}
          <div className="w-1/2 overflow-y-auto p-3">
            {!selectedRunId ? (
              <div className="flex items-center justify-center h-full text-xs text-text-muted">
                Pick a run to see step-by-step output.
              </div>
            ) : detailLoading ? (
              <div className="flex items-center justify-center h-full">
                <Loader2 className="w-4 h-4 animate-spin text-text-muted" />
              </div>
            ) : !selectedRun ? (
              <div className="flex items-center justify-center h-full text-xs text-text-muted">
                Run no longer exists.
              </div>
            ) : (
              <div className="space-y-2">
                {selectedRun.errorMessage && (
                  <div className="p-2 rounded border border-red-400/30 bg-red-400/10 text-[11px] text-red-400 font-mono whitespace-pre-wrap">
                    {selectedRun.errorMessage}
                  </div>
                )}
                {(selectedRun.stepRuns ?? []).length === 0 ? (
                  <div className="text-xs text-text-muted">No step runs recorded.</div>
                ) : (
                  (selectedRun.stepRuns ?? []).map((sr) => (
                    <div key={sr.id} className="border border-border rounded-lg overflow-hidden">
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
      </div>
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
