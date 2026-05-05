import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  Panel,
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
  Handle,
  Position,
  useReactFlow,
  type Node,
  type Edge,
  type NodeChange,
  type EdgeChange,
  type Connection,
  type NodeTypes,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Save, Plus, Trash2, X, AlertCircle, Play, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { clsx } from 'clsx';
import toast from 'react-hot-toast';
import { scenarioApi } from '@/api/scenario.api';
import { scriptApi } from '@/api/script.api';
import { deviceApi } from '@/api/device.api';
import { getSocket } from '@/socket/socketClient';
import type { ScenarioNodeType, ScenarioEdgeCondition, Script, Device } from '@obliance/shared';
import { SocketEvents } from '@obliance/shared';
import { NODE_TYPES, NODE_TYPE_BY_KEY, isTriggerType, type NodeTypeMeta, type NodeFieldDef } from './scenarioNodeRegistry';

// Phase 1C — graph editor for v2 scenarios. Wraps @xyflow/react with our
// 16 node types, an inline config sidebar, and a save handler that posts
// PUT /scenarios/:id/graph in the clientId-keyed shape the backend
// expects. Keeps the v1 editor deprecation door open: if the server
// returns 0 nodes, we synthesise a minimal "trigger → end_success" graph
// so the user always lands in a usable canvas.

// ── Internal data shapes ─────────────────────────────────────────────────────
// React Flow stores nodes/edges with an `id` (string) and a `data` blob.
// We keep our app payload (`type`, `label`, `config`, condition) on
// `data` and let RF own positioning. clientId for save = node.id.

interface NodeData extends Record<string, unknown> {
  scenarioType: ScenarioNodeType;
  label: string;
  config: Record<string, unknown>;
  /** Live run viewer: set when SCENARIO_NODE_UPDATED arrives for this
   *  node during an active run. Drives the colored ring on the canvas. */
  runStatus?: 'running' | 'success' | 'failed' | null;
}

interface EdgeData extends Record<string, unknown> {
  condition: ScenarioEdgeCondition;
}

// ── Custom node component — single renderer parameterised by registry ───────
function CustomNode({ data, selected }: NodeProps) {
  const d = data as NodeData;
  const meta = NODE_TYPE_BY_KEY[d.scenarioType];
  const isTrigger = meta?.category === 'trigger';
  const isTerminator = meta?.category === 'terminator';

  // Live status overlay — the editor sets data.runStatus from
  // SCENARIO_NODE_UPDATED socket events, and we paint the matching
  // ring + small badge in the corner.
  const statusRing =
    d.runStatus === 'running' ? 'ring-2 ring-blue-400 ring-offset-1 ring-offset-bg-primary animate-pulse' :
    d.runStatus === 'success' ? 'ring-2 ring-green-400 ring-offset-1 ring-offset-bg-primary' :
    d.runStatus === 'failed'  ? 'ring-2 ring-red-400 ring-offset-1 ring-offset-bg-primary' :
    '';

  // Inline handle styling — bigger + accent fill so the user actually
  // sees something to grab when they want to draw an edge. The
  // default RF size (~6px transparent) is too small to find with a
  // mouse on a dense graph.
  const handleStyle: React.CSSProperties = {
    width: 12, height: 12, background: 'rgb(var(--c-accent))',
    border: '2px solid rgb(var(--c-bg-primary))',
  };

  return (
    <div className={clsx(
      'rounded-lg bg-bg-secondary border-2 px-3 py-2 min-w-[180px] shadow-md relative',
      meta?.accent ?? 'border-text-muted',
      selected && 'ring-2 ring-accent ring-offset-1 ring-offset-bg-primary',
      !selected && statusRing,
    )}>
      {!isTrigger && (
        <Handle type="target" position={Position.Left} style={handleStyle} />
      )}
      <div className="flex items-center gap-1.5 mb-0.5">
        <div className="text-[10px] font-mono uppercase tracking-wider text-text-muted flex-1">
          {meta?.label ?? d.scenarioType}
        </div>
        {d.runStatus === 'running' && <Loader2 className="w-3 h-3 text-blue-400 animate-spin shrink-0" />}
        {d.runStatus === 'success' && <CheckCircle2 className="w-3 h-3 text-green-400 shrink-0" />}
        {d.runStatus === 'failed'  && <XCircle className="w-3 h-3 text-red-400 shrink-0" />}
      </div>
      <div className="text-[13px] font-semibold text-text-primary truncate">
        {d.label || meta?.label || d.scenarioType}
      </div>
      {!isTerminator && (
        // No `id` on the handle — single source port per node, defaults
        // are sufficient. Setting an explicit id requires every edge
        // to carry a sourceHandle that matches, which we don't generate.
        <Handle type="source" position={Position.Right} style={handleStyle} />
      )}
    </div>
  );
}

const NODE_TYPES_RF: NodeTypes = { custom: CustomNode };

// ── Palette item — clickable to "drop" a new node on the canvas ─────────────
function PaletteItem({ meta, onAdd }: { meta: NodeTypeMeta; onAdd: () => void }) {
  return (
    <button
      onClick={onAdd}
      className={clsx(
        'w-full text-left px-3 py-2 rounded-md border-2 border-dashed bg-bg-tertiary hover:bg-bg-hover transition-colors mb-1.5',
        meta.accent,
      )}
      title={meta.hint}
    >
      <div className="text-[12px] font-semibold text-text-primary">{meta.label}</div>
      <div className="text-[10px] font-mono text-text-muted truncate">{meta.hint}</div>
    </button>
  );
}

// ── Per-condition rule editor (branch_exit_code) ────────────────────────────
function EdgeConditionEditor({ value, onChange }: { value: ScenarioEdgeCondition; onChange: (v: ScenarioEdgeCondition) => void }) {
  const kind = value?.kind ?? 'always';
  return (
    <div className="space-y-2">
      <select
        value={kind}
        onChange={(e) => {
          const k = e.target.value;
          if (k === 'always') onChange({ kind: 'always' });
          else if (k === 'default') onChange({ kind: 'default' });
          else if (k === 'exit_code_eq') onChange({ kind: 'exit_code_eq', value: 0 });
          else if (k === 'exit_code_neq') onChange({ kind: 'exit_code_neq', value: 0 });
          else if (k === 'exit_code_in') onChange({ kind: 'exit_code_in', values: [0] });
        }}
        className="w-full px-2 py-1 text-sm bg-bg-primary border border-border rounded text-text-primary focus:outline-none focus:border-accent"
      >
        <option value="always">Always</option>
        <option value="default">Default (no other edge matched)</option>
        <option value="exit_code_eq">Exit code equals…</option>
        <option value="exit_code_neq">Exit code not equal to…</option>
        <option value="exit_code_in">Exit code in…</option>
      </select>
      {kind === 'exit_code_eq' && (
        <input type="number" value={(value as any).value ?? 0}
          onChange={(e) => onChange({ kind: 'exit_code_eq', value: parseInt(e.target.value, 10) || 0 })}
          className="w-full px-2 py-1 text-sm bg-bg-primary border border-border rounded text-text-primary" />
      )}
      {kind === 'exit_code_neq' && (
        <input type="number" value={(value as any).value ?? 0}
          onChange={(e) => onChange({ kind: 'exit_code_neq', value: parseInt(e.target.value, 10) || 0 })}
          className="w-full px-2 py-1 text-sm bg-bg-primary border border-border rounded text-text-primary" />
      )}
      {kind === 'exit_code_in' && (
        <input type="text"
          value={((value as any).values ?? []).join(',')}
          onChange={(e) => onChange({ kind: 'exit_code_in', values: e.target.value.split(',').map((x) => parseInt(x.trim(), 10)).filter((x) => !Number.isNaN(x)) })}
          placeholder="e.g. 1,2,3"
          className="w-full px-2 py-1 text-sm bg-bg-primary border border-border rounded text-text-primary" />
      )}
    </div>
  );
}

// ── Main editor ──────────────────────────────────────────────────────────────
function ScenarioGraphEditorInner({ scenarioId, onClose }: { scenarioId: number; onClose?: () => void }) {
  const rf = useReactFlow();
  // Ref to the canvas wrapper so addNode can convert "screen centre"
  // to flow coordinates via rf.screenToFlowPosition. Without an actual
  // bounding rect to anchor to, viewport math returns 0/0 and every
  // new node lands at the top-left.
  const canvasWrapRef = useRef<HTMLDivElement | null>(null);
  const [nodes, setNodes] = useState<Node<NodeData>[]>([]);
  const [edges, setEdges] = useState<Edge<EdgeData>[]>([]);
  const [selectedNode, setSelectedNode] = useState<Node<NodeData> | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<Edge<EdgeData> | null>(null);
  const [scripts, setScripts] = useState<Script[]>([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  // Live run viewer state — set when the user fires a "Run on device".
  // The editor listens for SCENARIO_NODE_UPDATED for this run and paints
  // the matching nodes. Tracking dbId → clientId so the events (which
  // carry DB ids) can resolve to React Flow's own node ids.
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [showRunPicker, setShowRunPicker] = useState(false);

  // Load the graph + scripts on mount.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      scenarioApi.getGraph(scenarioId),
      scriptApi.list(),
    ]).then(([graph, scriptList]) => {
      if (cancelled) return;
      setScripts(scriptList);
      // Empty graph (shouldn't happen post-migration but the editor must
      // recover gracefully) — synthesise a minimal "trigger → end_success".
      if (graph.nodes.length === 0) {
        const trigId = `cn-${Math.random().toString(36).slice(2)}`;
        const endId  = `cn-${Math.random().toString(36).slice(2)}`;
        setNodes([
          { id: trigId, type: 'custom', position: { x: 0, y: 0 },
            data: { scenarioType: 'trigger_manual', label: 'Trigger', config: {} } },
          { id: endId, type: 'custom', position: { x: 320, y: 0 },
            data: { scenarioType: 'end_success', label: 'Done', config: {} } },
        ]);
        setEdges([{ id: `e-${trigId}-${endId}`, source: trigId, target: endId,
          data: { condition: { kind: 'always' } }, label: 'always' }]);
        setDirty(true);
      } else {
        setNodes(graph.nodes.map((n) => ({
          id: `db-${n.id}`,
          type: 'custom',
          position: { x: n.positionX, y: n.positionY },
          data: { scenarioType: n.type, label: n.label ?? '', config: n.config ?? {} },
        })));
        setEdges(graph.edges.map((e) => ({
          id: `de-${e.id}`,
          source: `db-${e.sourceNodeId}`,
          target: `db-${e.targetNodeId}`,
          data: { condition: e.condition },
          label: edgeConditionLabel(e.condition),
          style: { stroke: edgeStrokeColor(e.condition), strokeWidth: 1.6 },
        })));
      }
      setLoading(false);
    }).catch((err) => {
      console.error(err);
      toast.error('Failed to load graph');
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [scenarioId]);

  // After nodes load, frame the whole graph in the viewport. RF's own
  // `fitView` prop only runs on first render — by the time our async
  // load finishes, the canvas already rendered with [] nodes so fitView
  // had nothing to fit. Calling it here once nodes appear gives the
  // user a sensible initial zoom/pan instead of nodes stuck off-screen.
  useEffect(() => {
    if (loading) return;
    if (nodes.length === 0) return;
    const t = setTimeout(() => {
      try { rf.fitView({ padding: 0.2, duration: 200 }); } catch { /* RF not ready */ }
    }, 50);
    return () => clearTimeout(t);
  }, [loading, nodes.length, rf]);

  // Live viewer subscription — when an activeRunId is set, listen for
  // SCENARIO_NODE_UPDATED events and paint the matching node with
  // running/success/failed. Cleans up automatically on unmount or
  // when the active run id changes.
  useEffect(() => {
    if (!activeRunId) return;
    const socket = getSocket();
    if (!socket) return;
    const onNode = (payload: { runId: string; nodeId: number; status: string }) => {
      if (payload.runId !== activeRunId) return;
      const targetClientId = `db-${payload.nodeId}`;
      setNodes((nds) => nds.map((n) => n.id === targetClientId
        ? { ...n, data: { ...n.data, runStatus: payload.status as NodeData['runStatus'] } }
        : n));
    };
    const onRun = (payload: { id: string; status: string }) => {
      if (payload.id !== activeRunId) return;
      if (payload.status === 'success' || payload.status === 'failure') {
        toast.success(`Run ${payload.status === 'success' ? 'succeeded' : 'failed'}`);
        // Clear the activeRunId after a short delay so the user sees the
        // final state on the canvas before the rings fade.
        setTimeout(() => setActiveRunId(null), 5000);
      }
    };
    socket.on(SocketEvents.SCENARIO_NODE_UPDATED, onNode);
    socket.on(SocketEvents.SCENARIO_RUN_UPDATED, onRun);
    return () => {
      socket.off(SocketEvents.SCENARIO_NODE_UPDATED, onNode);
      socket.off(SocketEvents.SCENARIO_RUN_UPDATED, onRun);
    };
  }, [activeRunId]);

  const startTestRun = async (deviceId: number) => {
    try {
      // Reset any leftover paint from a previous run.
      setNodes((nds) => nds.map((n) => ({ ...n, data: { ...n.data, runStatus: null } })));
      const result = await scenarioApi.startGraphRun(scenarioId, deviceId);
      setActiveRunId(result.runId);
      setShowRunPicker(false);
      toast.success('Run started — watch the graph');
    } catch {
      toast.error('Failed to start run');
    }
  };

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setNodes((nds) => applyNodeChanges(changes, nds) as Node<NodeData>[]);
    setDirty(true);
  }, []);
  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setEdges((eds) => applyEdgeChanges(changes, eds) as Edge<EdgeData>[]);
    setDirty(true);
  }, []);
  const onConnect = useCallback((conn: Connection) => {
    setEdges((eds) => addEdge({
      ...conn, id: `e-${Math.random().toString(36).slice(2)}`,
      data: { condition: { kind: 'always' } as ScenarioEdgeCondition },
      label: 'always',
      style: { stroke: '#888', strokeWidth: 1.6 },
    } as Edge, eds) as Edge<EdgeData>[]);
    setDirty(true);
  }, []);

  const addNode = (meta: NodeTypeMeta) => {
    const id = `cn-${Math.random().toString(36).slice(2)}`;
    // Spawn at the centre of what the user is currently viewing —
    // computed from the canvas wrapper's bounding rect via RF's
    // screenToFlowPosition helper. Falls back to (240, 120) if the
    // wrapper isn't mounted yet.
    let position = { x: 240, y: 120 };
    try {
      const wrap = canvasWrapRef.current;
      if (wrap) {
        const r = wrap.getBoundingClientRect();
        const screenX = r.left + r.width / 2;
        const screenY = r.top + r.height / 2;
        const flow = rf.screenToFlowPosition({ x: screenX, y: screenY });
        position = { x: flow.x + Math.random() * 40 - 20, y: flow.y + Math.random() * 40 - 20 };
      }
    } catch { /* fall back to default */ }
    setNodes((nds) => [...nds, {
      id,
      type: 'custom',
      position,
      data: { scenarioType: meta.type, label: meta.label, config: { ...meta.defaultConfig } },
    }]);
    setDirty(true);
  };

  const deleteSelected = () => {
    if (selectedNode) {
      setNodes((nds) => nds.filter((n) => n.id !== selectedNode.id));
      setEdges((eds) => eds.filter((e) => e.source !== selectedNode.id && e.target !== selectedNode.id));
      setSelectedNode(null);
      setDirty(true);
    } else if (selectedEdge) {
      setEdges((eds) => eds.filter((e) => e.id !== selectedEdge.id));
      setSelectedEdge(null);
      setDirty(true);
    }
  };

  const updateNodeData = (nodeId: string, patch: Partial<NodeData>) => {
    setNodes((nds) => nds.map((n) => n.id === nodeId ? { ...n, data: { ...n.data, ...patch } } : n));
    setSelectedNode((cur: Node<NodeData> | null) => cur && cur.id === nodeId ? { ...cur, data: { ...cur.data, ...patch } } : cur);
    setDirty(true);
  };

  const updateEdgeData = (edgeId: string, condition: ScenarioEdgeCondition) => {
    const style = { stroke: edgeStrokeColor(condition), strokeWidth: 1.6 };
    setEdges((eds) => eds.map((e) => e.id === edgeId ? { ...e, data: { condition }, label: edgeConditionLabel(condition), style } : e));
    setSelectedEdge((cur: Edge<EdgeData> | null) => cur && cur.id === edgeId ? { ...cur, data: { condition }, label: edgeConditionLabel(condition), style } : cur);
    setDirty(true);
  };

  // Validation before save: exactly one trigger, every node reachable
  // from the trigger, every dangling edge cleaned up.
  const validate = (): string | null => {
    const triggers = nodes.filter((n) => isTriggerType(n.data.scenarioType));
    if (triggers.length === 0) return 'Graph needs exactly one trigger node';
    if (triggers.length > 1)  return 'Graph cannot have more than one trigger node';
    return null;
  };

  const handleSave = async () => {
    const err = validate();
    if (err) { toast.error(err); return; }
    setSaving(true);
    try {
      await scenarioApi.saveGraph(scenarioId, {
        nodes: nodes.map((n) => ({
          clientId: n.id,
          type: n.data.scenarioType,
          label: n.data.label || null,
          config: n.data.config,
          positionX: Math.round(n.position.x),
          positionY: Math.round(n.position.y),
        })),
        edges: edges.map((e, i) => ({
          sourceClientId: e.source,
          targetClientId: e.target,
          sourceHandle: e.sourceHandle ?? null,
          condition: (e.data?.condition as ScenarioEdgeCondition) ?? { kind: 'always' },
          sortOrder: i,
        })),
      });
      // Reload from server so client ids switch from `cn-*` (locally
      // generated) to `db-*` (matching real DB ids). Required so the
      // live run viewer can map SCENARIO_NODE_UPDATED events (which
      // carry DB ids) back to the React Flow nodes on screen.
      const fresh = await scenarioApi.getGraph(scenarioId);
      setNodes(fresh.nodes.map((n) => ({
        id: `db-${n.id}`,
        type: 'custom',
        position: { x: n.positionX, y: n.positionY },
        data: { scenarioType: n.type, label: n.label ?? '', config: n.config ?? {} },
      })));
      setEdges(fresh.edges.map((e) => ({
        id: `de-${e.id}`,
        source: `db-${e.sourceNodeId}`,
        target: `db-${e.targetNodeId}`,
        data: { condition: e.condition },
        label: edgeConditionLabel(e.condition),
      })));
      toast.success('Graph saved');
      setDirty(false);
    } catch {
      toast.error('Failed to save graph');
    } finally {
      setSaving(false);
    }
  };

  const palette = useMemo(() => {
    const byCategory: Record<string, NodeTypeMeta[]> = { trigger: [], action: [], logic: [], terminator: [] };
    for (const m of NODE_TYPES) byCategory[m.category].push(m);
    return byCategory;
  }, []);

  if (loading) {
    return <div className="flex items-center justify-center h-full text-text-muted">Loading graph…</div>;
  }

  return (
    <div className="flex bg-bg-primary" style={{ height: '100%', width: '100%' }}>
      {/* ── Canvas — explicit dimensions are required by React Flow.
          Without them the canvas falls back to 0px and pan / zoom /
          drag handlers don't bind correctly (they rely on a real
          bounding rect). h-full doesn't always cascade through flex
          containers when the parent itself is `position: fixed`. */}
      <div ref={canvasWrapRef} className="flex-1 relative min-w-0" style={{ height: '100%' }}>
        <ReactFlow
          // Re-key on scenarioId so opening a different scenario
          // forces a fresh mount with a re-measured wrapper rect —
          // RF caches dimensions on mount, and a stale 0×0 measurement
          // breaks every interaction silently.
          key={scenarioId}
          // Explicit dimensions belt-and-braces — relying on the parent
          // h-full alone has caused 0×0 measurements in fixed-modal
          // contexts where the parent's height isn't applied yet at
          // RF's first measurement tick.
          style={{ width: '100%', height: '100%' }}
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={(_e: React.MouseEvent, n: Node) => { setSelectedNode(n as Node<NodeData>); setSelectedEdge(null); }}
          onEdgeClick={(_e: React.MouseEvent, e: Edge) => { setSelectedEdge(e as Edge<EdgeData>); setSelectedNode(null); }}
          onPaneClick={() => { setSelectedNode(null); setSelectedEdge(null); }}
          nodeTypes={NODE_TYPES_RF}
          // Dark colour mode — without this the Controls panel ships
          // with a white background + black icons, unreadable on our
          // dark theme. RF v12 supports this prop natively.
          colorMode="dark"
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.1}
          maxZoom={2.5}
          deleteKeyCode={null}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={20} size={1} color="rgba(255,255,255,0.06)" />
          <Controls />
          {/* MiniMap retiré : il causait une boucle de rendu avec des
              `<rect>` x/y NaN tant que les nodes n'avaient pas leur
              dimension mesurée par le ResizeObserver de RF, et il
              affichait un blob rouge confus quand plusieurs nodes
              étaient proches. Le canvas + Controls + le panel
              indicateur "X nodes · Y edges" suffisent pour la nav. */}
          {/* Toolbar via RF's Panel component — positioned WITHIN the
              flow viewport so RF correctly handles z-index layering
              and pointer-events propagation. The previous absolute-
              positioned overlay used to occlude the trigger node at
              (0,0) and capture clicks meant for the canvas. */}
          <Panel position="top-left" className="!m-3">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-bg-secondary/90 backdrop-blur border border-border">
              {dirty && <span className="text-[11px] text-amber-400 font-mono">unsaved</span>}
              {!dirty && <span className="text-[11px] text-text-muted font-mono">saved</span>}
              <span className="text-text-muted/40">·</span>
              <span className="text-[11px] text-text-muted font-mono">{nodes.length} nodes · {edges.length} edges</span>
            </div>
          </Panel>
          <Panel position="top-right" className="!m-3">
            <div className="flex items-center gap-2">
              {(selectedNode || selectedEdge) && (
                <button onClick={deleteSelected}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-400/10 border border-red-400/30 text-red-400 hover:bg-red-400/20 transition-colors text-[12px] font-medium">
                  <Trash2 className="w-3.5 h-3.5" /> Delete
                </button>
              )}
              <button onClick={() => setShowRunPicker(true)} disabled={dirty}
                title={dirty ? 'Save the graph first' : 'Pick a device and run this scenario'}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-bg-secondary/90 border border-border text-text-primary hover:bg-bg-hover transition-colors text-[12px] font-medium disabled:opacity-50">
                <Play className="w-3.5 h-3.5" /> Run on device
              </button>
              <button onClick={handleSave} disabled={saving || !dirty}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-white hover:bg-accent/80 transition-colors text-[12px] font-medium disabled:opacity-50">
                <Save className="w-3.5 h-3.5" /> {saving ? 'Saving…' : 'Save graph'}
              </button>
              {onClose && (
                <button onClick={onClose} className="p-1.5 rounded-lg bg-bg-secondary/90 border border-border hover:bg-bg-hover transition-colors">
                  <X className="w-4 h-4 text-text-muted" />
                </button>
              )}
            </div>
          </Panel>
        </ReactFlow>
      </div>

      {/* ── Run picker modal — pick a device, fire the v2 engine ────── */}
      {showRunPicker && (
        <RunPickerModal onCancel={() => setShowRunPicker(false)} onPick={startTestRun} />
      )}

      {/* ── Sidebar ─────────────────────────────────────────────────── */}
      <div className="w-72 shrink-0 border-l border-border bg-bg-secondary overflow-y-auto">
        {selectedNode ? (
          <NodeConfigForm
            node={selectedNode}
            scripts={scripts}
            onChange={(patch) => updateNodeData(selectedNode.id, patch)}
          />
        ) : selectedEdge ? (
          <div className="p-4 space-y-3">
            <div className="text-xs font-mono uppercase tracking-wider text-text-muted">Edge condition</div>
            <EdgeConditionEditor
              value={(selectedEdge.data?.condition as ScenarioEdgeCondition) ?? { kind: 'always' }}
              onChange={(v) => updateEdgeData(selectedEdge.id, v)}
            />
          </div>
        ) : (
          <div className="p-3">
            <div className="text-xs font-mono uppercase tracking-wider text-text-muted mb-2">Add node</div>
            {(['trigger', 'action', 'logic', 'terminator'] as const).map((cat) => (
              <div key={cat} className="mb-3">
                <div className="text-[10px] font-mono uppercase tracking-[0.14em] text-text-muted/60 mb-1.5 flex items-center gap-1">
                  <Plus className="w-2.5 h-2.5" /> {cat}
                </div>
                {palette[cat].map((m) => <PaletteItem key={m.type} meta={m} onAdd={() => addNode(m)} />)}
              </div>
            ))}
            <div className="mt-4 px-2 py-2 rounded-md bg-bg-tertiary text-[11px] text-text-muted flex gap-2">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>Tip: drag from a node's right port to another node's left port to connect them.</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Selected-node config form ───────────────────────────────────────────────
function NodeConfigForm({
  node, scripts, onChange,
}: {
  node: Node<NodeData>;
  scripts: Script[];
  onChange: (patch: Partial<NodeData>) => void;
}) {
  const meta = NODE_TYPE_BY_KEY[node.data.scenarioType as ScenarioNodeType];
  const cfg = (node.data.config ?? {}) as Record<string, unknown>;

  const setField = (key: string, value: unknown) => {
    onChange({ config: { ...cfg, [key]: value } });
  };

  return (
    <div className="p-4 space-y-3">
      <div>
        <div className="text-[10px] font-mono uppercase tracking-wider text-text-muted">Node</div>
        <div className="text-[14px] font-semibold text-text-primary">{meta?.label}</div>
        <div className="text-[11px] text-text-muted">{meta?.hint}</div>
      </div>
      <label className="block">
        <span className="text-xs text-text-muted mb-1 block">Label (shown on canvas)</span>
        <input
          type="text"
          value={node.data.label}
          onChange={(e) => onChange({ label: e.target.value })}
          className="w-full px-2 py-1 text-sm bg-bg-primary border border-border rounded text-text-primary focus:outline-none focus:border-accent"
        />
      </label>
      {meta?.fields.map((f: NodeFieldDef) => (
        <label key={f.key} className="block">
          <span className="text-xs text-text-muted mb-1 block">{f.label}{f.required && <span className="text-red-400 ml-1">*</span>}</span>
          {f.kind === 'text' && (
            <input type="text" value={(cfg[f.key] as string) ?? ''} placeholder={f.placeholder}
              onChange={(e) => setField(f.key, e.target.value)}
              className="w-full px-2 py-1 text-sm bg-bg-primary border border-border rounded text-text-primary focus:outline-none focus:border-accent" />
          )}
          {f.kind === 'number' && (
            <input type="number" value={(cfg[f.key] as number) ?? ''} placeholder={f.placeholder}
              onChange={(e) => setField(f.key, e.target.value === '' ? null : parseInt(e.target.value, 10))}
              className="w-full px-2 py-1 text-sm bg-bg-primary border border-border rounded text-text-primary focus:outline-none focus:border-accent" />
          )}
          {f.kind === 'textarea' && (
            <textarea rows={3} value={(cfg[f.key] as string) ?? ''} placeholder={f.placeholder}
              onChange={(e) => setField(f.key, e.target.value)}
              className="w-full px-2 py-1 text-sm bg-bg-primary border border-border rounded text-text-primary focus:outline-none focus:border-accent resize-none" />
          )}
          {f.kind === 'cron' && (
            <>
              <input type="text" value={(cfg[f.key] as string) ?? ''} placeholder={f.placeholder}
                onChange={(e) => setField(f.key, e.target.value)}
                className="w-full px-2 py-1 text-sm bg-bg-primary border border-border rounded text-text-primary focus:outline-none focus:border-accent font-mono" />
              {/* Same preset list as ScriptSchedulesPage so admins use one
                  vocabulary across the whole product. */}
              <div className="flex flex-wrap gap-1 mt-1">
                {[
                  { label: 'Every hour',    value: '0 * * * *' },
                  { label: '02:00 daily',   value: '0 2 * * *' },
                  { label: 'Mon 09:00',     value: '0 9 * * 1' },
                  { label: 'Sun midnight',  value: '0 0 * * 0' },
                  { label: 'Every 15 min',  value: '*/15 * * * *' },
                ].map((p) => (
                  <button
                    key={p.value} type="button"
                    onClick={() => setField(f.key, p.value)}
                    className="text-[10px] px-1.5 py-0.5 bg-bg-tertiary border border-border rounded hover:border-accent/50 text-text-muted hover:text-text-primary transition-colors"
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </>
          )}
          {f.kind === 'script' && (
            <select value={(cfg[f.key] as number | undefined) ?? ''}
              onChange={(e) => setField(f.key, e.target.value ? parseInt(e.target.value, 10) : null)}
              className="w-full px-2 py-1 text-sm bg-bg-primary border border-border rounded text-text-primary focus:outline-none focus:border-accent">
              <option value="">— Pick a script —</option>
              {scripts.map((s) => <option key={s.id} value={s.id}>{s.name}{s.purpose && s.purpose !== 'execute' ? ` · ${s.purpose}` : ''}</option>)}
            </select>
          )}
          {f.kind === 'channels' && (
            <div className="text-[11px] text-text-muted italic px-2 py-1 border border-border rounded bg-bg-primary">
              Configure notification channels in tenant settings; this node will use the scenario's globally bound channels.
            </div>
          )}
        </label>
      ))}
    </div>
  );
}

// ── Run picker modal ─────────────────────────────────────────────────────────
// Lightweight modal that lets the admin pick which device to run the
// scenario on. Loads the visible device list once; for fleets >5k the
// search box trims the dropdown client-side.
function RunPickerModal({ onCancel, onPick }: { onCancel: () => void; onPick: (deviceId: number) => void }) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');

  useEffect(() => {
    deviceApi.listPaginated({ pageSize: 5000, approvalStatus: 'approved' })
      .then((r) => setDevices(r.items))
      .catch(() => setDevices([]))
      .finally(() => setLoading(false));
  }, []);

  const filtered = devices.filter((d) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return [d.hostname, d.displayName, d.ipLocal, d.osName, d.uuid]
      .filter(Boolean)
      .some((f) => String(f).toLowerCase().includes(q));
  });

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-bg-primary/70 backdrop-blur-sm">
      <div className="w-[420px] max-h-[80vh] flex flex-col bg-bg-secondary border border-border rounded-xl shadow-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <div className="text-sm font-semibold text-text-primary">Run on device</div>
          <button onClick={onCancel} className="text-text-muted hover:text-text-primary">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-4 py-2 border-b border-border">
          <input
            value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by hostname, IP, OS, UUID…"
            className="w-full px-2 py-1 text-sm bg-bg-primary border border-border rounded text-text-primary focus:outline-none focus:border-accent"
          />
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="px-4 py-3 text-sm text-text-muted">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="px-4 py-3 text-sm text-text-muted">No matching device</div>
          ) : (
            filtered.slice(0, 200).map((d) => (
              <button key={d.id} onClick={() => onPick(d.id)}
                className="w-full text-left px-4 py-2 text-sm hover:bg-bg-hover transition-colors border-b border-border/50 last:border-b-0">
                <div className="text-text-primary truncate">{d.displayName || d.hostname}</div>
                <div className="text-[11px] text-text-muted truncate">{d.osName || d.osType} · {d.ipLocal || '—'}</div>
              </button>
            ))
          )}
          {filtered.length > 200 && (
            <div className="px-4 py-2 text-[11px] text-text-muted">Showing first 200 — narrow your search.</div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function edgeConditionLabel(c?: ScenarioEdgeCondition): string {
  if (!c) return 'always';
  switch (c.kind) {
    case 'always':       return 'always';
    case 'default':      return 'default';
    case 'exit_code_eq': return `= ${c.value}`;
    case 'exit_code_neq': return `≠ ${c.value}`;
    case 'exit_code_in': return `in [${c.values.join(',')}]`;
  }
}

// Visual hint for the canvas: success-style green edges for the happy
// path (exit_code_eq:0), red for default (= "everything else / fail"),
// muted otherwise. Helps admins read big graphs at a glance.
function edgeStrokeColor(c?: ScenarioEdgeCondition): string {
  if (!c) return '#888';
  if (c.kind === 'default') return '#ef4444';                // red
  if (c.kind === 'exit_code_eq' && c.value === 0) return '#22c55e'; // green
  if (c.kind === 'exit_code_neq' && c.value === 0) return '#ef4444'; // red
  return '#888';
}

// ── Public wrapper — provides the React Flow context ────────────────────────
export function ScenarioGraphEditor(props: { scenarioId: number; onClose?: () => void }) {
  return (
    <ReactFlowProvider>
      <ScenarioGraphEditorInner {...props} />
    </ReactFlowProvider>
  );
}
