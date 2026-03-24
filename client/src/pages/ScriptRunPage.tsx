import { useEffect, useState } from 'react';
import { Play, ChevronRight, FolderOpen, Check, Minus, Loader2 } from 'lucide-react';
import { scriptApi } from '@/api/script.api';
import { groupsApi } from '@/api/groups.api';
import type { Script, DeviceGroupTreeNode, ScheduleTargetType } from '@obliance/shared';
import toast from 'react-hot-toast';
import { clsx } from 'clsx';

export function ScriptRunPage({ embedded }: { embedded?: boolean } = {}) {
  const [scripts, setScripts] = useState<Script[]>([]);
  const [scriptId, setScriptId] = useState<number | null>(null);
  const [targetType, setTargetType] = useState<ScheduleTargetType>('all');
  const [targetIds, setTargetIds] = useState<number[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [lastResult, setLastResult] = useState<{ count: number; batchId?: string } | null>(null);

  useEffect(() => {
    scriptApi.list().then(setScripts).catch(() => {});
  }, []);

  const handleRun = async () => {
    if (!scriptId) { toast.error('Select a script'); return; }
    if (targetType === 'group' && targetIds.length === 0) { toast.error('Select at least one group'); return; }

    setIsRunning(true);
    setLastResult(null);
    try {
      const execs = await scriptApi.executeNow(scriptId, { targetType, targetIds });
      setLastResult({ count: execs.length, batchId: execs[0]?.batchId ?? undefined });
      toast.success(`Script launched on ${execs.length} device(s)`);
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to execute script');
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className={embedded ? 'space-y-6' : 'p-6 space-y-6'}>
      {!embedded && (
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Run Script</h1>
          <p className="text-sm text-text-muted mt-0.5">Execute a script on-demand across devices</p>
        </div>
      )}

      <div className="bg-bg-secondary border border-border rounded-xl p-6 space-y-5 max-w-2xl">
        {/* Script selection */}
        <div className="space-y-1">
          <label className="text-xs font-medium text-text-muted uppercase">Script</label>
          <select
            value={scriptId ?? ''}
            onChange={(e) => setScriptId(e.target.value ? parseInt(e.target.value, 10) : null)}
            className="w-full px-3 py-2 text-sm bg-bg-tertiary border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent"
          >
            <option value="">Select a script...</option>
            {scripts.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>

        {/* Target type */}
        <div className="space-y-1">
          <label className="text-xs font-medium text-text-muted uppercase">Target</label>
          <div className="flex gap-2">
            {(['all', 'group'] as const).map((t) => (
              <button
                key={t}
                onClick={() => { setTargetType(t); setTargetIds([]); }}
                className={clsx(
                  'flex-1 py-2 text-sm rounded-lg border transition-colors',
                  targetType === t ? 'bg-accent/10 border-accent text-accent' : 'border-border text-text-muted hover:border-accent/50',
                )}
              >
                {t === 'all' ? 'All devices' : 'By group'}
              </button>
            ))}
          </div>
        </div>

        {/* Group tree multi-select */}
        {targetType === 'group' && (
          <div className="space-y-1">
            <label className="text-xs font-medium text-text-muted uppercase">Groups</label>
            <RunGroupTree selectedIds={targetIds} onChange={setTargetIds} />
          </div>
        )}

        {/* Run button */}
        <button
          onClick={handleRun}
          disabled={isRunning || !scriptId}
          className={clsx(
            'flex items-center justify-center gap-2 w-full py-3 rounded-lg text-sm font-medium transition-colors',
            isRunning || !scriptId
              ? 'bg-bg-tertiary text-text-muted cursor-not-allowed'
              : 'bg-accent text-white hover:bg-accent/80',
          )}
        >
          {isRunning ? (
            <><Loader2 className="w-4 h-4 animate-spin" /> Running...</>
          ) : (
            <><Play className="w-4 h-4" /> Execute now</>
          )}
        </button>

        {/* Result */}
        {lastResult && (
          <div className="rounded-lg border border-green-400/30 bg-green-400/5 p-3 text-sm text-green-400">
            Script dispatched to {lastResult.count} device(s). Check the History tab for results.
          </div>
        )}
      </div>
    </div>
  );
}

// ── Reusable inline group tree (same pattern as ScriptSchedulesPage) ──

function RunGroupTree({ selectedIds, onChange }: { selectedIds: number[]; onChange: (ids: number[]) => void }) {
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
    setExpanded((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };

  const renderNode = (node: DeviceGroupTreeNode, depth: number) => {
    const hasChildren = node.children.length > 0;
    const isExpanded = expanded.has(node.id);
    const state = getCheckState(node);
    const count = node.total ?? node.deviceCount ?? 0;

    return (
      <div key={node.id}>
        <div
          className={clsx('flex items-center gap-1.5 py-1.5 transition-colors rounded hover:bg-bg-hover', state === 'all' && 'bg-accent/5')}
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
          <span className={clsx('flex-1 text-sm truncate cursor-pointer', state !== 'none' && 'font-medium')} onClick={() => toggleNode(node)}>
            {node.name}
          </span>
          <span className="text-text-muted text-[10px] shrink-0">{count}</span>
        </div>
        {hasChildren && isExpanded && node.children.map((c) => renderNode(c, depth + 1))}
      </div>
    );
  };

  if (tree.length === 0) return <p className="text-sm text-text-muted py-2">No groups available</p>;

  return (
    <div className="rounded-lg border border-border bg-bg-tertiary max-h-60 overflow-y-auto py-1">
      {tree.map((n) => renderNode(n, 0))}
    </div>
  );
}
