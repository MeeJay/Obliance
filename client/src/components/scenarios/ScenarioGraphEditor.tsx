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
import { Save, Plus, Trash2, X, AlertCircle, Play, CheckCircle2, XCircle, Loader2, ChevronDown, ChevronRight, Terminal as TerminalIcon, Copy, Files, FlaskConical, ClipboardPaste, Crosshair } from 'lucide-react';
import { clsx } from 'clsx';
import toast from 'react-hot-toast';
import { scenarioApi } from '@/api/scenario.api';
import { scriptApi } from '@/api/script.api';
import { deviceApi } from '@/api/device.api';
import { getSocket } from '@/socket/socketClient';
import type { ScenarioNodeType, ScenarioEdgeCondition, Script, Device, ScriptCategory } from '@obliance/shared';
import { SocketEvents } from '@obliance/shared';
import { NODE_TYPES, NODE_TYPE_BY_KEY, isTriggerType, type NodeTypeMeta, type NodeFieldDef } from './scenarioNodeRegistry';

// ── Aggregated run status across N parallel device runs ─────────────────────
// Multi-device test runs spawn one scenario_run per device. The editor
// tracks live state per run+device, then collapses each node down to a
// single visible status using the priority below — failed dominates so
// admins immediately see when one machine in the batch broke. Order:
//   failed > running > success > skipped > null.
type DeviceNodeStatus = 'running' | 'success' | 'failed' | 'skipped';
function aggregateNodeStatus(perDevice: Map<number, DeviceNodeStatus>): DeviceNodeStatus | null {
  if (perDevice.size === 0) return null;
  let hasRunning = false; let hasSuccess = false;
  for (const v of perDevice.values()) {
    if (v === 'failed') return 'failed';
    if (v === 'running') hasRunning = true;
    else if (v === 'success') hasSuccess = true;
  }
  if (hasRunning) return 'running';
  if (hasSuccess) return 'success';
  return null;
}

// Per-node, per-device output captured from the live socket events. Used
// by the output panel to render a script-history-like view: one row per
// agent, expand to see stdout/stderr/exit code.
interface DeviceNodeResult {
  deviceId: number;
  status: DeviceNodeStatus;
  exitCode: number | null;
  stdout: string | null;
  stderr: string | null;
  errorMessage: string | null;
  finishedAt?: string | null;
}

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
  /** Validation warning surfaced by the editor's graph linter — orphan,
   *  dead-end, missing config, etc. Painted as a ⚠️ badge by CustomNode. */
  warning?: string;
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
        {d.warning && (
          <span title={d.warning} className="shrink-0">
            <AlertCircle className="w-3 h-3 text-amber-400" />
          </span>
        )}
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
  const [scriptCategories, setScriptCategories] = useState<ScriptCategory[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  // Live run viewer state — multi-device aware. activeRunIds is a set
  // of every run we're currently tracking (the most recent batch + any
  // older still-running ones from the active-runs hydrate). runDevices
  // maps each run id to the device it targets so the per-node status
  // map (nodeStatusByDevice) and output panel can label rows correctly.
  const [activeRunIds, setActiveRunIds] = useState<Set<string>>(new Set());
  const [runDevices, setRunDevices] = useState<Map<string, number>>(new Map());
  const [nodeStatusByDevice, setNodeStatusByDevice] = useState<Map<number, Map<number, DeviceNodeStatus>>>(new Map());
  const [nodeOutputs, setNodeOutputs] = useState<Map<number, Map<number, DeviceNodeResult>>>(new Map());
  const [showRunPicker, setShowRunPicker] = useState(false);
  /** Run-picker mode: 'graph' = walk from triggers, 'from' = mid-graph
   *  entry, 'single' = run only one node. nodeClientId is the React
   *  Flow id (e.g. `db-42`); we parse the numeric DB id at submit time. */
  const [runMode, setRunMode] = useState<
    | { kind: 'graph' }
    | { kind: 'from'; nodeClientId: string }
    | { kind: 'single'; nodeClientId: string }
  >({ kind: 'graph' });
  /** Right-click context menu state. */
  const [nodeMenu, setNodeMenu] = useState<{ x: number; y: number; nodeId: string } | null>(null);
  const [paneMenu, setPaneMenu] = useState<{ x: number; y: number; flowX: number; flowY: number } | null>(null);
  const [showOutputPanel, setShowOutputPanel] = useState(true);
  /** Most recent node id with output — drives which node the output panel
   *  shows by default. When the user explicitly selects a node, the panel
   *  prefers the selection. */
  const [lastActiveNodeId, setLastActiveNodeId] = useState<number | null>(null);

  // Load the graph + scripts + script categories + devices + any
  // currently-running test runs in one go. The active-runs query
  // re-seeds the per-node status map so closing and re-opening the
  // editor mid-run lands us back on a canvas that mirrors the live
  // engine state instead of a blank slate.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      scenarioApi.getGraph(scenarioId),
      scriptApi.list(),
      scriptApi.listCategories().catch(() => [] as ScriptCategory[]),
      deviceApi.listPaginated({ pageSize: 5000, approvalStatus: 'approved' }).then((r) => r.items).catch(() => [] as Device[]),
      scenarioApi.getActiveRuns(scenarioId).catch(() => ({ runs: [], nodeRuns: [] })),
    ]).then(([graph, scriptList, catList, deviceList, active]) => {
      if (cancelled) return;
      setScripts(scriptList);
      setScriptCategories(catList);
      setDevices(deviceList);

      // Hydrate live-run state from the active-runs response. Only
      // 'running' runs feed activeRunIds — finished ones still
      // contribute to the per-node status map so the user sees the
      // outcome of the last batch even after every run wrapped up.
      const newActive = new Set<string>();
      const newRunDevices = new Map<string, number>();
      for (const r of active.runs) {
        newRunDevices.set(r.id, r.deviceId);
        if (r.status === 'running') newActive.add(r.id);
      }
      const newNodeStatus = new Map<number, Map<number, DeviceNodeStatus>>();
      const newNodeOutputs = new Map<number, Map<number, DeviceNodeResult>>();
      for (const nr of active.nodeRuns) {
        const deviceId = newRunDevices.get(nr.runId);
        if (deviceId == null) continue;
        const status: DeviceNodeStatus = nr.status === 'running' ? 'running'
          : nr.status === 'failed'  ? 'failed'
          : nr.status === 'skipped' ? 'skipped'
          : 'success';
        if (!newNodeStatus.has(nr.nodeId)) newNodeStatus.set(nr.nodeId, new Map());
        newNodeStatus.get(nr.nodeId)!.set(deviceId, status);
        if (nr.stdout || nr.stderr || nr.errorMessage || nr.exitCode != null || status !== 'running') {
          if (!newNodeOutputs.has(nr.nodeId)) newNodeOutputs.set(nr.nodeId, new Map());
          newNodeOutputs.get(nr.nodeId)!.set(deviceId, {
            deviceId, status,
            exitCode: nr.exitCode,
            stdout: nr.stdout, stderr: nr.stderr,
            errorMessage: nr.errorMessage,
            finishedAt: nr.finishedAt,
          });
        }
      }
      setActiveRunIds(newActive);
      setRunDevices(newRunDevices);
      setNodeStatusByDevice(newNodeStatus);
      setNodeOutputs(newNodeOutputs);
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

  // Live viewer subscription — multi-device aware. The editor is
  // permanently subscribed (no activeRunIds gate) so a run kicked off
  // by another tab, or a freshly-hydrated active run, immediately
  // paints. Each event carries a runId we use to match the right
  // device via runDevices.
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const onNode = (payload: {
      runId: string; nodeId: number; status: string;
      exitCode: number | null; stdout: string | null; stderr: string | null;
      errorMessage: string | null; deviceId: number | null;
    }) => {
      const deviceId = payload.deviceId ?? runDevicesRef.current.get(payload.runId);
      if (deviceId == null) return;
      // Filter to scenarios we actually care about — runs not in our
      // tracking sets are foreign (other scenario, other tab). The
      // refs below hold the latest state without re-binding the socket
      // every render.
      if (!runDevicesRef.current.has(payload.runId)) return;
      const status = (payload.status === 'running' ? 'running'
        : payload.status === 'failed'  ? 'failed'
        : payload.status === 'skipped' ? 'skipped'
        : 'success') as DeviceNodeStatus;

      setNodeStatusByDevice((prev) => {
        const next = new Map(prev);
        const inner = new Map(next.get(payload.nodeId) ?? new Map());
        inner.set(deviceId, status);
        next.set(payload.nodeId, inner);
        return next;
      });
      // Capture stdout/stderr for the output panel. Only update on
      // states that carry payload — running events don't.
      if (status !== 'running') {
        setNodeOutputs((prev) => {
          const next = new Map(prev);
          const inner = new Map(next.get(payload.nodeId) ?? new Map());
          inner.set(deviceId, {
            deviceId, status,
            exitCode: payload.exitCode,
            stdout: payload.stdout, stderr: payload.stderr,
            errorMessage: payload.errorMessage,
            finishedAt: new Date().toISOString(),
          });
          next.set(payload.nodeId, inner);
          return next;
        });
      }
      setLastActiveNodeId(payload.nodeId);
    };
    const onRun = (payload: { id: string; status: string }) => {
      if (!runDevicesRef.current.has(payload.id)) return;
      if (payload.status === 'success' || payload.status === 'failure') {
        // Drop this run from the active set; the per-node status map
        // keeps its last result so the canvas stays painted.
        setActiveRunIds((prev) => {
          const next = new Set(prev);
          next.delete(payload.id);
          return next;
        });
      }
    };
    socket.on(SocketEvents.SCENARIO_NODE_UPDATED, onNode);
    socket.on(SocketEvents.SCENARIO_RUN_UPDATED, onRun);
    return () => {
      socket.off(SocketEvents.SCENARIO_NODE_UPDATED, onNode);
      socket.off(SocketEvents.SCENARIO_RUN_UPDATED, onRun);
    };
  }, []);

  // Refs that mirror runDevices/activeRunIds — needed inside the
  // socket listener whose closure is captured once at mount. Without
  // the ref, the listener would race with its own stale state map.
  const runDevicesRef = useRef<Map<string, number>>(runDevices);
  useEffect(() => { runDevicesRef.current = runDevices; }, [runDevices]);

  /** Fire a test run on N devices. Mode controls whether we walk from a
   *  trigger, jump mid-graph, or run a single node. Replaces the older
   *  single-device startTestRun. */
  const startTestRun = async (deviceIds: number[]) => {
    if (deviceIds.length === 0) return;
    try {
      // Reset any leftover output for the affected nodes — the new
      // batch overwrites the previous one to avoid the panel showing
      // stale rows from a prior test.
      const opts: { startNodeId?: number; singleNode?: boolean } = {};
      if (runMode.kind === 'from' || runMode.kind === 'single') {
        const dbId = parseDbNodeId(runMode.nodeClientId);
        if (!Number.isFinite(dbId)) {
          // Unsaved nodes carry `cn-*` ids and have no DB row yet.
          toast.error('Save the graph before running this node');
          return;
        }
        opts.startNodeId = dbId;
        if (runMode.kind === 'single') opts.singleNode = true;
      }
      const result = await scenarioApi.startGraphRun(scenarioId, deviceIds, opts);
      // Add the new run ids to active tracking. Socket events for these
      // ids will now be picked up by the live viewer.
      setActiveRunIds((prev) => {
        const next = new Set(prev);
        for (const id of result.runIds) next.add(id);
        return next;
      });
      setRunDevices((prev) => {
        const next = new Map(prev);
        for (let i = 0; i < result.runIds.length; i++) {
          next.set(result.runIds[i], deviceIds[i]);
        }
        return next;
      });
      setShowRunPicker(false);
      setRunMode({ kind: 'graph' });
      const label = runMode.kind === 'single' ? 'Single-node test' : runMode.kind === 'from' ? 'Run from node' : 'Run';
      toast.success(`${label} started on ${deviceIds.length} device${deviceIds.length > 1 ? 's' : ''} — watch the graph`);
      setShowOutputPanel(true);
    } catch {
      toast.error('Failed to start run');
    }
  };

  /** Resolve a numeric db-id from the editor's React Flow node id.
   *  Unsaved nodes have `cn-*` ids and return NaN. */
  const parseDbNodeId = (clientId: string | null): number => {
    if (!clientId) return NaN;
    const m = /^db-(\d+)$/.exec(clientId);
    return m ? parseInt(m[1], 10) : NaN;
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

  // Clipboard buffer for Ctrl+C / Ctrl+V. Stored in component state
  // (not the OS clipboard) so a copy here doesn't pollute the user's
  // real clipboard, and so the pasted node carries our exact config /
  // type without any serialization round-trip.
  const [clipboardNode, setClipboardNode] = useState<{ scenarioType: ScenarioNodeType; label: string; config: Record<string, unknown> } | null>(null);

  // Keyboard shortcuts —
  //   Ctrl+D / Cmd+D : duplicate selected node (clones config + label)
  //   Ctrl+C / Cmd+C : copy selected node into the editor clipboard
  //   Ctrl+V / Cmd+V : paste the clipboard at the centre of the viewport
  //   Delete / Backspace : delete selection (node OR edge)
  // All shortcuts no-op when the focus is inside an input / textarea /
  // select so they don't fight the user's normal text editing.
  useEffect(() => {
    const isTypingTarget = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      if (!el) return false;
      if (/input|textarea|select/i.test(el.tagName)) return true;
      if (el.isContentEditable) return true;
      return false;
    };
    const cloneFromSelection = () => {
      if (!selectedNode) return null;
      return {
        scenarioType: selectedNode.data.scenarioType,
        label: selectedNode.data.label,
        config: { ...(selectedNode.data.config ?? {}) },
      };
    };
    const insertNode = (snap: { scenarioType: ScenarioNodeType; label: string; config: Record<string, unknown> }, atOffset = 40) => {
      const id = `cn-${Math.random().toString(36).slice(2)}`;
      // Anchor the new node either next to the selection (duplicate /
      // copy-paste with selection) or at the viewport centre (paste
      // with no selection).
      let position = { x: 240, y: 120 };
      if (selectedNode) {
        position = { x: selectedNode.position.x + atOffset, y: selectedNode.position.y + atOffset };
      } else {
        try {
          const wrap = canvasWrapRef.current;
          if (wrap) {
            const r = wrap.getBoundingClientRect();
            const flow = rf.screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
            position = { x: flow.x, y: flow.y };
          }
        } catch { /* fallback */ }
      }
      setNodes((nds) => [...nds, {
        id, type: 'custom', position,
        data: { scenarioType: snap.scenarioType, label: snap.label, config: snap.config },
      }]);
      setDirty(true);
    };

    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const ctrl = e.ctrlKey || e.metaKey;

      if (ctrl && e.key.toLowerCase() === 'd') {
        const snap = cloneFromSelection();
        if (!snap) return;
        e.preventDefault();
        insertNode({ ...snap, label: `${snap.label} (copy)` });
        return;
      }
      if (ctrl && e.key.toLowerCase() === 'c') {
        const snap = cloneFromSelection();
        if (!snap) return;
        e.preventDefault();
        setClipboardNode(snap);
        toast.success('Node copied');
        return;
      }
      if (ctrl && e.key.toLowerCase() === 'v') {
        if (!clipboardNode) return;
        e.preventDefault();
        insertNode(clipboardNode);
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedNode) {
          e.preventDefault();
          setNodes((nds) => nds.filter((n) => n.id !== selectedNode.id));
          setEdges((eds) => eds.filter((edg) => edg.source !== selectedNode.id && edg.target !== selectedNode.id));
          setSelectedNode(null);
          setDirty(true);
        } else if (selectedEdge) {
          e.preventDefault();
          setEdges((eds) => eds.filter((edg) => edg.id !== selectedEdge.id));
          setSelectedEdge(null);
          setDirty(true);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedNode, selectedEdge, clipboardNode, rf]);

  // Inline validation — produce a warning per node so the canvas can
  // surface graph-design issues before save. Walks the graph once per
  // edit; the result is consumed by CustomNode to paint a ⚠️ badge
  // and the right sidebar to list everything in one place.
  const validationWarnings = useMemo(() => {
    const out = new Map<string, string>();
    const incoming = new Map<string, number>();
    const outgoing = new Map<string, number>();
    for (const e of edges) {
      incoming.set(e.target, (incoming.get(e.target) ?? 0) + 1);
      outgoing.set(e.source, (outgoing.get(e.source) ?? 0) + 1);
    }
    for (const n of nodes) {
      const meta = NODE_TYPE_BY_KEY[n.data.scenarioType as ScenarioNodeType];
      if (!meta) continue;
      const isTrigger = meta.category === 'trigger';
      const isTerminator = meta.category === 'terminator';
      // Orphans — non-trigger nodes that nothing points to are dead code.
      if (!isTrigger && !(incoming.get(n.id) ?? 0)) {
        out.set(n.id, 'Unreachable: no incoming edge');
        continue;
      }
      // Dead-ends — non-terminator nodes that go nowhere will silently
      // succeed-end the run, which is rarely the intent.
      if (!isTerminator && !(outgoing.get(n.id) ?? 0)) {
        out.set(n.id, 'Dead-end: no outgoing edge');
        continue;
      }
      // Per-type config sanity checks.
      const cfg = (n.data.config ?? {}) as Record<string, unknown>;
      if (n.data.scenarioType === 'run_script' && !cfg.scriptId) {
        out.set(n.id, 'No script selected');
      }
      if (n.data.scenarioType === 'run_command' && !cfg.commandType) {
        out.set(n.id, 'No command type set');
      }
      if (n.data.scenarioType === 'trigger_schedule_cron' && !cfg.cronExpression) {
        out.set(n.id, 'No cron expression set');
      }
    }
    return out;
  }, [nodes, edges]);

  // Repaint validation status on the rendered nodes so CustomNode sees
  // it. Re-runs whenever validation changes — cheap because we only
  // mutate `data.warning` in-place.
  useEffect(() => {
    setNodes((nds) => nds.map((n) => {
      const w = validationWarnings.get(n.id);
      const cur = (n.data as any).warning;
      if (w === cur) return n;
      return { ...n, data: { ...n.data, warning: w } };
    }));
  }, [validationWarnings]);

  // Project the aggregated per-device status map onto the React Flow
  // nodes' `data.runStatus`. CustomNode reads this for its ring colour.
  // Pure derivation: every change to nodeStatusByDevice resyncs every
  // node so a node that newly sees a 'failed' from one device flips red.
  useEffect(() => {
    setNodes((nds) => nds.map((n) => {
      const dbId = parseDbNodeId(n.id);
      if (!Number.isFinite(dbId)) return n;
      const inner = nodeStatusByDevice.get(dbId);
      const agg = inner ? aggregateNodeStatus(inner) : null;
      const target = agg === 'skipped' ? null : agg;
      const cur = (n.data as NodeData).runStatus ?? null;
      if (cur === target) return n;
      return { ...n, data: { ...n.data, runStatus: target as NodeData['runStatus'] } };
    }));
  }, [nodeStatusByDevice]);

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

  // Validation before save: at least one trigger node. Multiple
  // triggers are intentionally supported in v2 — a scenario can mix a
  // manual trigger, several cron schedules, and event triggers
  // (machine_boot, session_login, …) so the same workflow fires from
  // different entry points without duplicating its body.
  const validate = (): string | null => {
    const triggers = nodes.filter((n) => isTriggerType(n.data.scenarioType));
    if (triggers.length === 0) return 'Graph needs at least one trigger node';
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
          onPaneClick={() => { setSelectedNode(null); setSelectedEdge(null); setNodeMenu(null); setPaneMenu(null); }}
          // Right-click handlers — open the context menu at the cursor
          // and select the targeted node. RF doesn't preventDefault for
          // us, so we have to suppress the browser's native menu here.
          onNodeContextMenu={(e: React.MouseEvent, n: Node) => {
            e.preventDefault();
            setSelectedNode(n as Node<NodeData>);
            setSelectedEdge(null);
            setPaneMenu(null);
            setNodeMenu({ x: e.clientX, y: e.clientY, nodeId: n.id });
          }}
          onPaneContextMenu={(e: React.MouseEvent | MouseEvent) => {
            const ev = e as React.MouseEvent;
            ev.preventDefault();
            setNodeMenu(null);
            // Translate the click point into flow coordinates so "Add
            // node here" drops the node exactly under the cursor.
            let flowX = 0; let flowY = 0;
            try {
              const p = rf.screenToFlowPosition({ x: ev.clientX, y: ev.clientY });
              flowX = p.x; flowY = p.y;
            } catch { /* RF not ready */ }
            setPaneMenu({ x: ev.clientX, y: ev.clientY, flowX, flowY });
          }}
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
              {activeRunIds.size > 0 && (
                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-blue-400/10 border border-blue-400/30 text-blue-400 text-[11px] font-mono">
                  <Loader2 className="w-3 h-3 animate-spin" /> {activeRunIds.size} run{activeRunIds.size > 1 ? 's' : ''}
                </span>
              )}
              <button onClick={() => { setRunMode({ kind: 'graph' }); setShowRunPicker(true); }} disabled={dirty}
                title={dirty
                  ? 'Save the graph first'
                  : 'Pick one or more devices and run this scenario from its triggers (works even when the scenario is disabled — runs are test-only)'}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-bg-secondary/90 border border-border text-text-primary hover:bg-bg-hover transition-colors text-[12px] font-medium disabled:opacity-50">
                <Play className="w-3.5 h-3.5" /> Run on device(s)
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

      {/* ── Run picker modal — pick devices, fire the v2 engine ─────── */}
      {showRunPicker && (
        <RunPickerModal
          devices={devices}
          mode={runMode}
          onCancel={() => { setShowRunPicker(false); setRunMode({ kind: 'graph' }); }}
          onPick={startTestRun}
        />
      )}

      {/* ── Node right-click menu ───────────────────────────────────── */}
      {nodeMenu && (() => {
        const target = nodes.find((n) => n.id === nodeMenu.nodeId);
        if (!target) return null;
        const close = () => setNodeMenu(null);
        return (
          <ContextMenu x={nodeMenu.x} y={nodeMenu.y} onClose={close}>
            <ContextMenuItem icon={<Play className="w-3.5 h-3.5" />}
              label="Run from this node…" hint="Bypass triggers — execute this node and continue the graph"
              disabled={dirty || target.id.startsWith('cn-')}
              onClick={() => { setRunMode({ kind: 'from', nodeClientId: target.id }); setShowRunPicker(true); close(); }} />
            <ContextMenuItem icon={<FlaskConical className="w-3.5 h-3.5" />}
              label="Run only this node…" hint="One-shot — engine stops after this node finishes"
              disabled={dirty || target.id.startsWith('cn-') || isTriggerType(target.data.scenarioType)}
              onClick={() => { setRunMode({ kind: 'single', nodeClientId: target.id }); setShowRunPicker(true); close(); }} />
            <ContextMenuDivider />
            <ContextMenuItem icon={<Files className="w-3.5 h-3.5" />} label="Duplicate" hint="Ctrl+D"
              onClick={() => {
                const snap = { scenarioType: target.data.scenarioType, label: `${target.data.label} (copy)`, config: { ...(target.data.config ?? {}) } };
                const id = `cn-${Math.random().toString(36).slice(2)}`;
                setNodes((nds) => [...nds, {
                  id, type: 'custom',
                  position: { x: target.position.x + 40, y: target.position.y + 40 },
                  data: snap,
                }]);
                setDirty(true); close();
              }} />
            <ContextMenuItem icon={<Copy className="w-3.5 h-3.5" />} label="Copy" hint="Ctrl+C"
              onClick={() => {
                setClipboardNode({
                  scenarioType: target.data.scenarioType,
                  label: target.data.label,
                  config: { ...(target.data.config ?? {}) },
                });
                toast.success('Node copied'); close();
              }} />
            <ContextMenuItem icon={<TerminalIcon className="w-3.5 h-3.5" />} label="Show output"
              hint="Open the output panel for this node"
              onClick={() => {
                const dbId = parseDbNodeId(target.id);
                if (Number.isFinite(dbId)) setLastActiveNodeId(dbId);
                setShowOutputPanel(true); close();
              }} />
            <ContextMenuDivider />
            <ContextMenuItem icon={<Trash2 className="w-3.5 h-3.5 text-red-400" />} label="Delete" hint="Del" danger
              onClick={() => {
                setNodes((nds) => nds.filter((n) => n.id !== target.id));
                setEdges((eds) => eds.filter((edg) => edg.source !== target.id && edg.target !== target.id));
                if (selectedNode?.id === target.id) setSelectedNode(null);
                setDirty(true); close();
              }} />
          </ContextMenu>
        );
      })()}

      {/* ── Empty-pane right-click menu ─────────────────────────────── */}
      {paneMenu && (() => {
        const close = () => setPaneMenu(null);
        const dropAt = paneMenu;
        const dropNode = (meta: NodeTypeMeta) => {
          const id = `cn-${Math.random().toString(36).slice(2)}`;
          setNodes((nds) => [...nds, {
            id, type: 'custom',
            position: { x: dropAt.flowX, y: dropAt.flowY },
            data: { scenarioType: meta.type, label: meta.label, config: { ...meta.defaultConfig } },
          }]);
          setDirty(true); close();
        };
        return (
          <ContextMenu x={paneMenu.x} y={paneMenu.y} onClose={close}>
            <div className="px-3 py-1 text-[10px] font-mono uppercase tracking-wider text-text-muted">Add a node here</div>
            {(['trigger', 'action', 'logic', 'terminator'] as const).map((cat) => (
              <div key={cat}>
                <div className="px-3 py-0.5 text-[9px] font-mono uppercase tracking-[0.18em] text-text-muted/60">{cat}</div>
                {palette[cat].map((m: NodeTypeMeta) => (
                  <ContextMenuItem key={m.type} icon={<Plus className="w-3.5 h-3.5" />} label={m.label} hint={m.hint}
                    onClick={() => dropNode(m)} />
                ))}
              </div>
            ))}
            <ContextMenuDivider />
            {clipboardNode && (
              <ContextMenuItem icon={<ClipboardPaste className="w-3.5 h-3.5" />} label="Paste node here" hint="Ctrl+V"
                onClick={() => {
                  const id = `cn-${Math.random().toString(36).slice(2)}`;
                  setNodes((nds) => [...nds, {
                    id, type: 'custom',
                    position: { x: dropAt.flowX, y: dropAt.flowY },
                    data: clipboardNode,
                  }]);
                  setDirty(true); close();
                }} />
            )}
            <ContextMenuItem icon={<Crosshair className="w-3.5 h-3.5" />} label="Fit view"
              onClick={() => { try { rf.fitView({ padding: 0.2, duration: 200 }); } catch {} close(); }} />
          </ContextMenu>
        );
      })()}

      {/* ── Output panel — script-history-style per-device output ────── */}
      {showOutputPanel && nodeOutputs.size > 0 && (
        <NodeOutputPanel
          nodes={nodes}
          devices={devices}
          outputs={nodeOutputs}
          statusByDevice={nodeStatusByDevice}
          focusNodeClientId={selectedNode?.id ?? (lastActiveNodeId != null ? `db-${lastActiveNodeId}` : null)}
          onSelectNode={(clientId) => {
            const n = nodes.find((nn) => nn.id === clientId);
            if (n) setSelectedNode(n);
          }}
          onClose={() => setShowOutputPanel(false)}
        />
      )}

      {/* ── Sidebar ─────────────────────────────────────────────────── */}
      <div className="w-72 shrink-0 border-l border-border bg-bg-secondary overflow-y-auto">
        {selectedNode ? (
          <NodeConfigForm
            node={selectedNode}
            scripts={scripts}
            categories={scriptCategories}
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
  node, scripts, categories, onChange,
}: {
  node: Node<NodeData>;
  scripts: Script[];
  categories: ScriptCategory[];
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
            <>
              <ScriptPicker
                scripts={scripts}
                categories={categories}
                value={(cfg[f.key] as number | null | undefined) ?? null}
                onChange={(id) => setField(f.key, id)}
              />
              <ScriptInspector
                script={scripts.find((s) => s.id === (cfg[f.key] as number | undefined))}
              />
            </>
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

// ── Script inspector ─────────────────────────────────────────────────────────
// Fold-out panel showing the picked script's metadata + a 25-line preview.
// Helps the admin remember the script's exit code contract without leaving
// the editor for the script library.
function ScriptInspector({ script }: { script: Script | undefined }) {
  const [contentExpanded, setContentExpanded] = useState(false);
  if (!script) {
    return (
      <div className="mt-2 px-2 py-1.5 text-[11px] text-text-muted/70 italic border border-dashed border-border rounded">
        Pick a script above to inspect its contract.
      </div>
    );
  }
  const exitHint =
    script.purpose === 'check'    ? '0 = condition met (no resolve needed) · non-zero = problem detected, branch will fire resolve' :
    script.purpose === 'resolve'  ? '0 = remediation succeeded · non-zero = remediation failed (scenario step fails)' :
    script.purpose === 'compliance' ? '0 = compliant · non-zero = non-compliant' :
                                       `Expected exit code: ${script.expectedExitCode ?? 0} (anything else fails the node)`;
  const preview = script.content?.split('\n').slice(0, contentExpanded ? Number.MAX_SAFE_INTEGER : 25);
  const more = (script.content?.split('\n').length ?? 0) > 25;
  return (
    <div className="mt-2 rounded-lg border border-border bg-bg-tertiary overflow-hidden">
      <div className="px-3 py-2 border-b border-border space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-mono uppercase tracking-wider text-text-muted">Inspector</span>
          {script.purpose && (
            <span className={clsx(
              'text-[10px] px-1.5 rounded-full border',
              script.purpose === 'check'      && 'text-blue-400 bg-blue-400/10 border-blue-400/30',
              script.purpose === 'resolve'    && 'text-orange-400 bg-orange-400/10 border-orange-400/30',
              script.purpose === 'compliance' && 'text-purple-400 bg-purple-400/10 border-purple-400/30',
              script.purpose === 'execute'    && 'text-gray-400 bg-gray-400/10 border-gray-400/30',
              script.purpose === 'metric'     && 'text-cyan-400 bg-cyan-400/10 border-cyan-400/30',
            )}>{script.purpose}</span>
          )}
          <span className="text-[10px] text-text-muted">{script.platform} · {script.runtime}</span>
        </div>
        <div className="text-[12px] text-text-primary font-medium truncate">{script.name}</div>
        {script.description && (
          <div className="text-[11px] text-text-muted">{script.description}</div>
        )}
        <div className="text-[11px] text-text-muted leading-snug">
          <span className="text-text-primary font-medium">Exit codes — </span>{exitHint}
        </div>
        {script.parameters && script.parameters.length > 0 && (
          <div className="text-[11px] text-text-muted">
            <span className="text-text-primary font-medium">Parameters: </span>
            {script.parameters.map((p) => p.name).join(', ')}
          </div>
        )}
      </div>
      <div className="p-2">
        <pre className="text-[10px] font-mono text-text-secondary whitespace-pre overflow-x-auto max-h-48 leading-tight">
          {(preview ?? []).join('\n')}
        </pre>
        {more && (
          <button onClick={() => setContentExpanded((e) => !e)}
            className="mt-1 text-[10px] text-accent hover:underline">
            {contentExpanded ? 'Show less' : `Show all ${script.content.split('\n').length} lines`}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Hierarchical script picker ──────────────────────────────────────────────
// Mirrors the Script Library page tree: scripts are grouped by category
// and indented under their parentScript so admins land on the same
// vocabulary they use elsewhere. Includes a search box because the dump
// from `scriptApi.list()` can run into hundreds of rows on big tenants.
function ScriptPicker({
  scripts, categories, value, onChange,
}: {
  scripts: Script[];
  categories: ScriptCategory[];
  value: number | null;
  onChange: (id: number | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  // Close on outside click; opening focuses the search input.
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    setTimeout(() => inputRef.current?.focus(), 0);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const selected = scripts.find((s) => s.id === value);
  const catNameById = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);

  // Filter by search across name + category. Empty query keeps the full
  // tree so the structure is visible by default.
  const q = query.trim().toLowerCase();
  const filtered = q
    ? scripts.filter((s) => {
        const name = s.name.toLowerCase();
        const cat = (s.categoryId ? catNameById.get(s.categoryId) : 'Uncategorized')?.toLowerCase() ?? '';
        return name.includes(q) || cat.includes(q);
      })
    : scripts;

  // Group → tree (category → root scripts → child scripts via parentScriptId).
  const grouped = new Map<string, Script[]>();
  for (const s of filtered) {
    const key = s.categoryId ? (catNameById.get(s.categoryId) ?? 'Uncategorized') : 'Uncategorized';
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(s);
  }
  const sortedGroups = [...grouped.entries()].sort(([a], [b]) => {
    if (a === 'Uncategorized') return 1;
    if (b === 'Uncategorized') return -1;
    return a.localeCompare(b);
  });

  return (
    <div ref={wrapRef} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)}
        className="w-full px-2 py-1 text-sm bg-bg-primary border border-border rounded text-left text-text-primary focus:outline-none focus:border-accent flex items-center gap-2">
        {selected ? (
          <span className="flex-1 truncate">
            {selected.name}
            {selected.purpose && selected.purpose !== 'execute' && (
              <span className="text-text-muted text-[11px] ml-1">· {selected.purpose}</span>
            )}
          </span>
        ) : (
          <span className="flex-1 text-text-muted">— Pick a script —</span>
        )}
        <ChevronDown className={clsx('w-3.5 h-3.5 text-text-muted transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="absolute z-30 left-0 right-0 mt-1 bg-bg-secondary border border-border rounded-lg shadow-xl max-h-[360px] flex flex-col overflow-hidden">
          <div className="p-2 border-b border-border">
            <input ref={inputRef} value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder="Search scripts…"
              className="w-full px-2 py-1 text-sm bg-bg-primary border border-border rounded text-text-primary focus:outline-none focus:border-accent" />
          </div>
          <div className="overflow-y-auto flex-1">
            {value != null && (
              <button type="button" onClick={() => { onChange(null); setOpen(false); }}
                className="w-full text-left px-3 py-1.5 text-[11px] text-text-muted hover:bg-bg-hover border-b border-border/40">
                Clear selection
              </button>
            )}
            {sortedGroups.length === 0 ? (
              <div className="px-3 py-2 text-[12px] text-text-muted">No script matches.</div>
            ) : sortedGroups.map(([catName, list]) => {
              // Build the tree within this category: parent scripts at
              // depth 0, children indented under their parent. Same logic
              // as ScriptLibraryPage so layout is consistent.
              const idsInCat = new Set(list.map((s) => s.id));
              const childrenOf = new Map<number | null, Script[]>();
              for (const s of list) {
                const key = s.parentScriptId != null && idsInCat.has(s.parentScriptId)
                  ? s.parentScriptId
                  : null;
                if (!childrenOf.has(key)) childrenOf.set(key, []);
                childrenOf.get(key)!.push(s);
              }
              const renderTree = (parentKey: number | null, depth: number): React.ReactNode[] => {
                const arr = childrenOf.get(parentKey) ?? [];
                return arr.flatMap((s) => [
                  <button
                    key={s.id} type="button"
                    onClick={() => { onChange(s.id); setOpen(false); }}
                    className={clsx(
                      'w-full text-left px-2 py-1 text-[12px] hover:bg-bg-hover transition-colors flex items-center gap-2',
                      value === s.id && 'bg-accent/10',
                    )}
                    style={{ paddingLeft: `${10 + depth * 14}px` }}>
                    <span className="text-text-primary truncate">{s.name}</span>
                    <span className="text-text-muted/70 text-[10px] ml-auto">{s.platform}/{s.runtime}</span>
                    {s.purpose && s.purpose !== 'execute' && (
                      <span className="text-[9px] font-mono text-text-muted/80 px-1 rounded border border-border">{s.purpose}</span>
                    )}
                  </button>,
                  ...renderTree(s.id, depth + 1),
                ]);
              };
              return (
                <div key={catName}>
                  <div className="px-3 py-1 text-[10px] font-mono uppercase tracking-wider text-text-muted bg-bg-tertiary/50 border-b border-border/40">
                    {catName} · {list.length}
                  </div>
                  {renderTree(null, 0)}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Run picker modal ─────────────────────────────────────────────────────────
// Modal for picking N devices to fire a test run on. Multi-select with a
// search box; the title adapts to the run mode (whole graph vs from-node
// vs single-node). Modal is portaled to document.body via inline fixed
// positioning so it escapes the editor's stacking context and can't be
// hidden behind the React Flow canvas.
function RunPickerModal({
  devices, mode, onCancel, onPick,
}: {
  devices: Device[];
  mode: { kind: 'graph' } | { kind: 'from'; nodeClientId: string } | { kind: 'single'; nodeClientId: string };
  onCancel: () => void;
  onPick: (deviceIds: number[]) => void;
}) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const filtered = devices.filter((d) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return [d.hostname, d.displayName, d.ipLocal, d.osName, d.uuid]
      .filter(Boolean)
      .some((f) => String(f).toLowerCase().includes(q));
  });

  const toggle = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleAll = () => {
    setSelected((prev) => prev.size === filtered.length ? new Set() : new Set(filtered.map((d) => d.id)));
  };

  const title = mode.kind === 'graph' ? 'Run on devices'
              : mode.kind === 'from'  ? 'Run from this node — pick devices'
              :                          'Run only this node — pick devices';
  const subtitle = mode.kind === 'graph' ? 'Fires the graph from its triggers on the selected devices.'
                : mode.kind === 'from'  ? 'Skips the trigger walk and starts from the selected node, then continues the graph normally.'
                :                          'Executes the selected node once on each device, then ends the run with success.';

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-bg-primary/70 backdrop-blur-sm" onClick={onCancel}>
      <div className="w-[480px] max-h-[80vh] flex flex-col bg-bg-secondary border border-border rounded-xl shadow-xl overflow-hidden"
           onClick={(e) => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-text-primary">{title}</div>
            <div className="text-[11px] text-text-muted mt-0.5">{subtitle}</div>
          </div>
          <button onClick={onCancel} className="text-text-muted hover:text-text-primary">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-4 py-2 border-b border-border flex items-center gap-2">
          <input
            value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by hostname, IP, OS, UUID…"
            className="flex-1 px-2 py-1 text-sm bg-bg-primary border border-border rounded text-text-primary focus:outline-none focus:border-accent"
          />
          <button type="button" onClick={toggleAll}
            className="text-[11px] px-2 py-1 rounded bg-bg-tertiary border border-border text-text-muted hover:text-text-primary">
            {selected.size === filtered.length && filtered.length > 0 ? 'Clear' : 'All'}
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="px-4 py-3 text-sm text-text-muted">No matching device</div>
          ) : (
            filtered.slice(0, 500).map((d) => {
              const checked = selected.has(d.id);
              return (
                <button key={d.id} onClick={() => toggle(d.id)}
                  className={clsx(
                    'w-full text-left px-4 py-2 text-sm flex items-center gap-3 transition-colors border-b border-border/50 last:border-b-0',
                    checked ? 'bg-accent/10' : 'hover:bg-bg-hover',
                  )}>
                  <input type="checkbox" readOnly checked={checked} className="accent-accent" />
                  <div className="flex-1 min-w-0">
                    <div className="text-text-primary truncate">{d.displayName || d.hostname}</div>
                    <div className="text-[11px] text-text-muted truncate">{d.osName || d.osType} · {d.ipLocal || '—'}</div>
                  </div>
                </button>
              );
            })
          )}
          {filtered.length > 500 && (
            <div className="px-4 py-2 text-[11px] text-text-muted">Showing first 500 — narrow your search.</div>
          )}
        </div>
        <div className="px-4 py-3 border-t border-border flex items-center justify-between">
          <span className="text-[11px] text-text-muted">{selected.size} selected</span>
          <div className="flex items-center gap-2">
            <button onClick={onCancel}
              className="px-3 py-1.5 text-[12px] bg-bg-tertiary text-text-muted hover:text-text-primary rounded transition-colors">
              Cancel
            </button>
            <button
              onClick={() => onPick([...selected])}
              disabled={selected.size === 0}
              className="px-3 py-1.5 text-[12px] bg-accent text-white rounded hover:bg-accent/80 transition-colors disabled:opacity-50 inline-flex items-center gap-1.5">
              <Play className="w-3.5 h-3.5" /> Run on {selected.size} device{selected.size > 1 ? 's' : ''}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Right-click context menu primitives ─────────────────────────────────────
function ContextMenu({ x, y, onClose, children }: { x: number; y: number; onClose: () => void; children: React.ReactNode }) {
  // Close on outside click + escape. Position is clamped on render below
  // so the menu stays inside the viewport even when right-clicking near
  // the edge.
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      const root = document.getElementById('scenario-ctx-menu');
      if (root && !root.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    setTimeout(() => document.addEventListener('mousedown', onDoc), 0);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);
  // Clamp so the menu is fully visible (rough; real browsers reflow if
  // we're off by a few pixels — the bottom/right anchor below is enough).
  const left = Math.min(x, window.innerWidth - 240);
  const top  = Math.min(y, window.innerHeight - 360);
  return (
    <div id="scenario-ctx-menu"
         style={{ position: 'fixed', left, top, zIndex: 90 }}
         className="min-w-[220px] bg-bg-secondary border border-border rounded-lg shadow-xl overflow-hidden">
      <div className="py-1">{children}</div>
    </div>
  );
}
function ContextMenuItem({
  icon, label, hint, onClick, disabled, danger,
}: {
  icon?: React.ReactNode;
  label: string;
  hint?: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button" onClick={disabled ? undefined : onClick} disabled={disabled}
      className={clsx(
        'w-full text-left px-3 py-1.5 text-[12px] flex items-center gap-2 transition-colors',
        disabled ? 'opacity-40 cursor-not-allowed' : 'hover:bg-bg-hover',
        danger && !disabled && 'hover:bg-red-400/10',
      )}>
      {icon}
      <span className={clsx('flex-1 truncate', danger && 'text-red-400')}>{label}</span>
      {hint && <span className="text-[10px] text-text-muted/70 font-mono">{hint}</span>}
    </button>
  );
}
function ContextMenuDivider() {
  return <div className="h-px bg-border my-1" />;
}

// ── Output panel — script-history-style multi-device viewer ────────────────
// Bottom-anchored floating panel showing the selected node's per-device
// outputs. Each device row is collapsible to view stdout/stderr/exit code,
// mirroring the schedule history ergonomics.
function NodeOutputPanel({
  nodes, devices, outputs, statusByDevice, focusNodeClientId, onSelectNode, onClose,
}: {
  nodes: Node<NodeData>[];
  devices: Device[];
  outputs: Map<number, Map<number, DeviceNodeResult>>;
  statusByDevice: Map<number, Map<number, DeviceNodeStatus>>;
  focusNodeClientId: string | null;
  onSelectNode: (clientId: string) => void;
  onClose: () => void;
}) {
  const deviceLabel = (id: number) => {
    const d = devices.find((x) => x.id === id);
    if (!d) return `device #${id}`;
    return d.displayName || d.hostname || `device #${id}`;
  };
  // Pick which node to display. Prefer the explicit focus (selection or
  // last-active); fall back to the first node that has outputs.
  const focusDbId = focusNodeClientId ? Number(/^db-(\d+)$/.exec(focusNodeClientId)?.[1] ?? NaN) : NaN;
  const candidateIds = [...outputs.keys()];
  const activeDbId = Number.isFinite(focusDbId) && outputs.has(focusDbId) ? focusDbId : candidateIds[0];
  const node = nodes.find((n) => n.id === `db-${activeDbId}`);
  const meta = node ? NODE_TYPE_BY_KEY[node.data.scenarioType as ScenarioNodeType] : undefined;
  const perDevice = activeDbId != null ? (outputs.get(activeDbId) ?? new Map()) : new Map();
  const liveStatus = activeDbId != null ? (statusByDevice.get(activeDbId) ?? new Map()) : new Map();
  const allDeviceIds = Array.from(new Set([...perDevice.keys(), ...liveStatus.keys()])).sort((a, b) => a - b);
  const [expanded, setExpanded] = useState<number | null>(null);

  return (
    <div className="absolute left-3 right-[300px] bottom-3 z-20 max-h-[42%] flex flex-col bg-bg-secondary/95 backdrop-blur border border-border rounded-xl shadow-xl overflow-hidden">
      <div className="px-3 py-2 border-b border-border flex items-center gap-2">
        <TerminalIcon className="w-3.5 h-3.5 text-accent" />
        <span className="text-[11px] font-mono uppercase tracking-wider text-text-muted">Output</span>
        {/* Node switcher — quick jump between any node that has output. */}
        <select
          value={activeDbId ?? ''} onChange={(e) => onSelectNode(`db-${e.target.value}`)}
          className="text-[11px] bg-bg-primary border border-border rounded px-1.5 py-0.5 text-text-primary focus:outline-none focus:border-accent">
          {candidateIds.map((dbId) => {
            const n = nodes.find((nn) => nn.id === `db-${dbId}`);
            const m = n ? NODE_TYPE_BY_KEY[n.data.scenarioType as ScenarioNodeType] : undefined;
            return <option key={dbId} value={dbId}>{n?.data.label || m?.label || `node ${dbId}`}</option>;
          })}
        </select>
        {meta && <span className="text-[10px] text-text-muted/60">· {meta.label}</span>}
        <div className="flex-1" />
        <button onClick={onClose} className="text-text-muted hover:text-text-primary">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {allDeviceIds.length === 0 ? (
          <div className="px-3 py-3 text-[12px] text-text-muted">No output yet.</div>
        ) : allDeviceIds.map((deviceId) => {
          const result = perDevice.get(deviceId);
          const status = (result?.status ?? liveStatus.get(deviceId) ?? 'running') as DeviceNodeStatus;
          const isOpen = expanded === deviceId;
          return (
            <div key={deviceId} className="border-b border-border/40 last:border-b-0">
              <button onClick={() => setExpanded((cur) => cur === deviceId ? null : deviceId)}
                className="w-full text-left px-3 py-1.5 flex items-center gap-2 text-[12px] hover:bg-bg-hover transition-colors">
                {isOpen ? <ChevronDown className="w-3.5 h-3.5 text-text-muted" /> : <ChevronRight className="w-3.5 h-3.5 text-text-muted" />}
                <DeviceStatusDot status={status} />
                <span className="text-text-primary truncate flex-1">{deviceLabel(deviceId)}</span>
                {result?.exitCode != null && (
                  <span className={clsx(
                    'text-[10px] font-mono px-1.5 py-0 rounded border',
                    result.exitCode === 0
                      ? 'text-green-400 bg-green-400/10 border-green-400/30'
                      : 'text-red-400 bg-red-400/10 border-red-400/30',
                  )}>
                    exit {result.exitCode}
                  </span>
                )}
              </button>
              {isOpen && result && (
                <div className="px-3 pb-2 space-y-2">
                  {result.errorMessage && (
                    <div className="text-[11px] text-red-400 bg-red-400/10 border border-red-400/30 rounded px-2 py-1.5">
                      {result.errorMessage}
                    </div>
                  )}
                  {result.stdout && (
                    <div>
                      <div className="text-[10px] font-mono uppercase text-text-muted mb-1">stdout</div>
                      <pre className="text-[11px] font-mono text-text-secondary whitespace-pre-wrap bg-bg-primary border border-border rounded p-2 max-h-64 overflow-y-auto">{result.stdout}</pre>
                    </div>
                  )}
                  {result.stderr && (
                    <div>
                      <div className="text-[10px] font-mono uppercase text-text-muted mb-1">stderr</div>
                      <pre className="text-[11px] font-mono text-red-400/90 whitespace-pre-wrap bg-bg-primary border border-border rounded p-2 max-h-64 overflow-y-auto">{result.stderr}</pre>
                    </div>
                  )}
                  {!result.stdout && !result.stderr && !result.errorMessage && (
                    <div className="text-[11px] text-text-muted italic">No output captured.</div>
                  )}
                </div>
              )}
              {isOpen && !result && (
                <div className="px-3 pb-2 text-[11px] text-text-muted italic">Waiting on agent…</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
function DeviceStatusDot({ status }: { status: DeviceNodeStatus }) {
  if (status === 'running') return <Loader2 className="w-3 h-3 text-blue-400 animate-spin shrink-0" />;
  if (status === 'success') return <CheckCircle2 className="w-3 h-3 text-green-400 shrink-0" />;
  if (status === 'failed')  return <XCircle className="w-3 h-3 text-red-400 shrink-0" />;
  return <span className="w-3 h-3 rounded-full bg-text-muted/30 shrink-0" />;
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
