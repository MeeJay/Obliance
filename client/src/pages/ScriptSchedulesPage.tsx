import { useEffect, useState, useCallback } from 'react';
import { Plus, Calendar, Clock, Play, Edit, Trash2, RefreshCw, ToggleLeft, ToggleRight, Terminal, ChevronDown, ChevronUp, ChevronRight, FolderOpen, Check, Minus } from 'lucide-react';
import { scriptApi } from '@/api/script.api';
import { groupsApi } from '@/api/groups.api';
import { useGroupStore } from '@/store/groupStore';
import type { Script, ScriptSchedule, ScheduleTargetType, DeviceGroupTreeNode } from '@obliance/shared';
import toast from 'react-hot-toast';
import { clsx } from 'clsx';

interface ScheduleFormData {
  name: string;
  description: string;
  scriptId: number | null;
  targetType: ScheduleTargetType;
  targetIds: number[];
  scheduleMode: 'cron' | 'once';
  cronExpression: string;
  fireOnceAt: string;
  timezone: string;
  catchupEnabled: boolean;
  catchupMax: number;
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

export function ScriptSchedulesPage({ embedded }: { embedded?: boolean } = {}) {
  const [schedules, setSchedules] = useState<ScriptSchedule[]>([]);
  const [scripts, setScripts] = useState<Script[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<ScriptSchedule | null>(null);
  const [form, setForm] = useState<ScheduleFormData>(defaultForm);
  const [isSaving, setIsSaving] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const { fetchGroups } = useGroupStore();

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const [schedList, scriptList] = await Promise.all([
        scriptApi.listSchedules(),
        scriptApi.list(),
      ]);
      setSchedules(schedList);
      setScripts(scriptList);
    } catch {
      toast.error('Failed to load schedules');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
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
      fireOnceAt: schedule.fireOnceAt ? schedule.fireOnceAt.slice(0, 16) : '',
      timezone: schedule.timezone,
      catchupEnabled: schedule.catchupEnabled,
      catchupMax: schedule.catchupMax,
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

    setIsSaving(true);
    try {
      const payload = {
        name: form.name,
        description: form.description || null,
        scriptId: form.scriptId,
        targetType: form.targetType,
        targetIds: form.targetIds,
        cronExpression: form.scheduleMode === 'cron' ? form.cronExpression : null,
        fireOnceAt: form.scheduleMode === 'once' ? new Date(form.fireOnceAt).toISOString() : null,
        timezone: form.timezone,
        catchupEnabled: form.catchupEnabled,
        catchupMax: form.catchupMax,
        enabled: form.enabled,
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
          <button onClick={load} className="p-2 text-text-muted hover:text-text-primary hover:bg-bg-secondary rounded-lg transition-colors">
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
            ) : (
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
            )}
            <div className="space-y-1">
              <label className="text-xs font-medium text-text-muted uppercase">Timezone</label>
              <input
                value={form.timezone}
                onChange={(e) => setForm({ ...form, timezone: e.target.value })}
                className="w-full px-3 py-2 text-sm bg-bg-tertiary border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent"
                placeholder="e.g. Europe/Paris"
              />
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

          <div className="flex flex-wrap gap-6 pt-2 border-t border-border">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
                className="rounded"
              />
              <span className="text-sm text-text-primary">Enabled</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.catchupEnabled}
                onChange={(e) => setForm({ ...form, catchupEnabled: e.target.checked })}
                className="rounded"
              />
              <span className="text-sm text-text-primary">Enable catchup</span>
            </label>
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
                    onClick={() => setExpandedId(expanded ? null : schedule.id)}
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
                      <span className="flex items-center gap-1">
                        <Play className="w-3 h-3" />
                        {schedule.targetType === 'all'
                          ? 'All devices'
                          : `${(schedule.targetIds ?? []).length} ${schedule.targetType}(s)`}
                      </span>
                      <span className="flex items-center gap-1 font-mono">
                        <Clock className="w-3 h-3" />
                        {schedule.cronExpression ?? 'One-time'}
                      </span>
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
                      <p className="text-sm text-text-primary">{schedule.catchupEnabled ? `Yes (max ${schedule.catchupMax})` : 'No'}</p>
                    </div>
                    {schedule.description && (
                      <div className="md:col-span-4">
                        <p className="text-xs text-text-muted uppercase font-medium mb-0.5">Description</p>
                        <p className="text-sm text-text-primary">{schedule.description}</p>
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
