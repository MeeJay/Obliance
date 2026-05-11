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
import { Save, Plus, Trash2, X, AlertCircle, Play, CheckCircle2, XCircle, Loader2, ChevronDown, ChevronRight, Terminal as TerminalIcon, Copy, Files, FlaskConical, ClipboardPaste, Crosshair, History, ToggleLeft, ToggleRight } from 'lucide-react';
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
// single visible status. Priority order:
// running > failed > success > skipped
//
// Why running wins over failed: the user explicitly asked that a node
// stay "in progress" as long as ANY device is still working — even if
// another device already failed. Once every device has finished, the
// terminal status surfaces (failed if any device failed, otherwise
// success). Mirrors the schedule-history "running 1 / failed 2" badge
// pattern: the worst non-terminal state dominates while live, the
// worst terminal state dominates once the batch is done.
type DeviceNodeStatus = 'running' | 'success' | 'failed' | 'skipped';
function aggregateNodeStatus(perDevice: Map<number, DeviceNodeStatus>): DeviceNodeStatus | null {
 if (perDevice.size === 0) return null;
 let hasRunning = false; let hasFailed = false; let hasSuccess = false;
 for (const v of perDevice.values()) {
 if (v === 'running') hasRunning = true;
 else if (v === 'failed') hasFailed = true;
 else if (v === 'success') hasSuccess = true;
 }
 if (hasRunning) return 'running';
 if (hasFailed) return 'failed';
 if (hasSuccess) return 'success';
 return null;
}

/**
 * One historical entry in the node-run timeline — produced for every
 * (nodeRunId, runId, deviceId) tuple. The output panel groups these
 * by their parent runId, sorted by startedAt desc, so admins can scroll
 * back through past runs of the same node and see how each device
 * behaved at each invocation. Filtering by hostname flattens the
 * grouping into a per-agent feed across runs.
 */
interface NodeRunEntry {
 nodeRunId: string;
 runId: string;
 nodeId: number;
 deviceId: number;
 status: DeviceNodeStatus;
 exitCode: number | null;
 stdout: string | null;
 stderr: string | null;
 errorMessage: string | null;
 startedAt: string;
 finishedAt: string | null;
}

/** Run-level metadata used by the output panel to label each grouping
 * with a date + trigger source ("manual · 14:32" / "schedule_cron · 03:00"). */
interface RunMeta {
 runId: string;
 deviceId: number;
 startedAt: string;
 finishedAt: string | null;
 status: string;
 triggerSource: string | null;
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
 * node during an active run. Drives the colored ring on the canvas. */
 runStatus?: 'running' | 'success' | 'failed' | null;
 /** Validation warning surfaced by the editor's graph linter — orphan,
 * dead-end, missing config, etc. Painted as a ⚠️ badge by CustomNode. */
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
 // SCENARIO_NODE_UPDATED socket events. The status ring takes
 // priority over the selection ring (an actively-running node is
 // more important to surface than the user's current focus). When
 // there's no run state, the selection ring takes over.
 const statusRing =
 d.runStatus === 'running' ? 'ring-4 ring-blue-400 ring-offset-2 ring-offset-bg-primary animate-pulse shadow-lg shadow-blue-400/30' :
 d.runStatus === 'success' ? 'ring-4 ring-green-400 ring-offset-2 ring-offset-bg-primary shadow-lg shadow-green-400/30' :
 d.runStatus === 'failed' ? 'ring-4 ring-red-400 ring-offset-2 ring-offset-bg-primary shadow-lg shadow-red-400/30' :
 '';
 const hasStatus = !!d.runStatus;

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
 'rounded-lg bg-bg-secondary border-2 px-3 py-2 min-w-[180px] shadow-md relative transition-all',
 meta?.accent ?? 'border-text-muted',
 // Status ring wins over selection ring — admins need to spot
 // running/failed nodes regardless of what's currently selected.
 hasStatus && statusRing,
 !hasStatus && selected && 'ring-2 ring-accent ring-offset-1 ring-offset-bg-primary',
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
 {d.runStatus === 'failed' && <XCircle className="w-3 h-3 text-red-400 shrink-0" />}
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
 className="w-full px-2 py-1 text-sm bg-bg-primary rounded text-text-primary focus:outline-none focus:border-accent"
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
 className="w-full px-2 py-1 text-sm bg-bg-primary rounded text-text-primary" />
 )}
 {kind === 'exit_code_neq' && (
 <input type="number" value={(value as any).value ?? 0}
 onChange={(e) => onChange({ kind: 'exit_code_neq', value: parseInt(e.target.value, 10) || 0 })}
 className="w-full px-2 py-1 text-sm bg-bg-primary rounded text-text-primary" />
 )}
 {kind === 'exit_code_in' && (
 <input type="text"
 value={((value as any).values ?? []).join(',')}
 onChange={(e) => onChange({ kind: 'exit_code_in', values: e.target.value.split(',').map((x) => parseInt(x.trim(), 10)).filter((x) => !Number.isNaN(x)) })}
 placeholder="e.g. 1,2,3"
 className="w-full px-2 py-1 text-sm bg-bg-primary rounded text-text-primary" />
 )}
 </div>
 );
}

// ── Main editor ──────────────────────────────────────────────────────────────
function ScenarioGraphEditorInner({ scenarioId, onClose, onStatusChanged }: { scenarioId: number; onClose?: () => void; onStatusChanged?: (next: 'draft' | 'active' | 'disabled') => void }) {
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
 // Scenario status mirror for the toolbar toggle. Loaded from
 // scenarioApi.getById on mount so the toggle reflects DB state and
 // can flip it without leaving the editor. `null` = unknown / not
 // loaded yet (toggle is disabled).
 const [scenarioStatus, setScenarioStatus] = useState<'draft' | 'active' | 'disabled' | null>(null);
 const [statusToggling, setStatusToggling] = useState(false);
 // Inline script editor — opened from the +New / Edit buttons next
 // to a run_script node's script picker. Lets admins author / tweak
 // scripts without leaving the graph. On save the modal updates the
 // local `scripts` state and auto-selects the saved script back into
 // the originating node's config.
 const [scriptEditorReq, setScriptEditorReq] = useState<
 { mode: 'create' | 'edit'; fieldKey: string; nodeId: string; script?: Script } | null
 >(null);
 // Devices the scenario *actually* targets (resolved through
 // targetType + targetIds + group closure). The picker pins these
 // to the top of the list so the user doesn't have to hunt for
 // them in a fleet of hundreds.
 const [targetedDeviceIds, setTargetedDeviceIds] = useState<Set<number>>(new Set());
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
 /** Per-nodeRun history — keyed by nodeRunId so updates from socket
 * events can patch the right row without duplicating it. The output
 * panel buckets these by runId for the grouped view. */
 const [nodeRunHistory, setNodeRunHistory] = useState<Map<string, NodeRunEntry>>(new Map());
 /** Run-level metadata for the panel's group headers (date, trigger). */
 const [runMetaByRunId, setRunMetaByRunId] = useState<Map<string, RunMeta>>(new Map());
 const [showRunPicker, setShowRunPicker] = useState(false);
 const [showHistoryPanel, setShowHistoryPanel] = useState(false);
 const [historyRuns, setHistoryRuns] = useState<Array<{
 id: string; deviceId: number; status: string; startedAt: string; finishedAt: string | null; errorMessage: string | null;
 }>>([]);
 const [historyLoading, setHistoryLoading] = useState(false);
 /** Run-picker mode: 'graph' = walk from triggers, 'from' = mid-graph
 * entry, 'single' = run only one node. nodeClientId is the React
 * Flow id (e.g. `db-42`); we parse the numeric DB id at submit time. */
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
 * shows by default. When the user explicitly selects a node, the panel
 * prefers the selection. */
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
 // Pull 24h of run history on open so the per-node output panel
 // can surface past runs immediately. The user wants to click a
 // node and see every device it ran on with stdout/stderr —
 // bumping the window from the default 60 min to 24h covers a
 // typical dev/admin workday.
 scenarioApi.getActiveRuns(scenarioId, 24 * 60).catch(() => ({ runs: [], nodeRuns: [] })),
 // Resolve the scenario's actual target device set (target_type +
 // target_ids + group closure) so the run picker can highlight
 // them at the top of the list rather than forcing the user to
 // search through every approved device.
 scenarioApi.resolvedTargets(scenarioId).catch(() => [] as number[]),
 // Scenario metadata (status, name, etc.) so the toolbar toggle
 // can mirror DB state. Failure is non-fatal — the toggle stays
 // disabled but the editor still works.
 scenarioApi.getById(scenarioId).catch(() => null),
 ]).then(([graph, scriptList, catList, deviceList, active, targets, scenarioMeta]) => {
 if (cancelled) return;
 setScripts(scriptList);
 setScriptCategories(catList);
 setDevices(deviceList);
 setTargetedDeviceIds(new Set(targets));
 if (scenarioMeta) setScenarioStatus(scenarioMeta.status);

 // Hydrate live-run state from the active-runs response. Only
 // 'running' runs feed activeRunIds — finished ones still
 // contribute to the per-node status map so the user sees the
 // outcome of the last batch even after every run wrapped up.
 const newActive = new Set<string>();
 const newRunDevices = new Map<string, number>();
 const newRunMeta = new Map<string, RunMeta>();
 for (const r of active.runs) {
 newRunDevices.set(r.id, r.deviceId);
 if (r.status === 'running') newActive.add(r.id);
 newRunMeta.set(r.id, {
 runId: r.id,
 deviceId: r.deviceId,
 startedAt: r.startedAt,
 finishedAt: r.finishedAt,
 status: r.status,
 triggerSource: r.triggerSource ?? null,
 });
 }
 const newNodeStatus = new Map<number, Map<number, DeviceNodeStatus>>();
 const newRunHistory = new Map<string, NodeRunEntry>();
 for (const nr of active.nodeRuns) {
 const deviceId = newRunDevices.get(nr.runId);
 if (deviceId == null) continue;
 const status: DeviceNodeStatus = nr.status === 'running' ? 'running'
 : nr.status === 'failed' ? 'failed'
 : nr.status === 'skipped' ? 'skipped'
 : 'success';
 if (!newNodeStatus.has(nr.nodeId)) newNodeStatus.set(nr.nodeId, new Map());
 newNodeStatus.get(nr.nodeId)!.set(deviceId, status);
 // Append-style history map keyed by nodeRunId — every
 // historical visit of every node by every device ends up
 // here, ready to be grouped under its runId in the panel.
 newRunHistory.set(nr.id, {
 nodeRunId: nr.id,
 runId: nr.runId,
 nodeId: nr.nodeId,
 deviceId,
 status,
 exitCode: nr.exitCode,
 stdout: nr.stdout,
 stderr: nr.stderr,
 errorMessage: nr.errorMessage,
 startedAt: nr.startedAt,
 finishedAt: nr.finishedAt,
 });
 }
 setActiveRunIds(newActive);
 setRunDevices(newRunDevices);
 setRunMetaByRunId(newRunMeta);
 setNodeStatusByDevice(newNodeStatus);
 setNodeRunHistory(newRunHistory);
 // Empty graph (shouldn't happen post-migration but the editor must
 // recover gracefully) — synthesise a minimal "trigger → end_success".
 if (graph.nodes.length === 0) {
 const trigId = `cn-${Math.random().toString(36).slice(2)}`;
 const endId = `cn-${Math.random().toString(36).slice(2)}`;
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
 // paints. Filter strategy: events carrying our `scenarioId` are
 // accepted unconditionally — this avoids a race where the server
 // emits 'running' synchronously inside the start request, BEFORE
 // the HTTP 202 carrying the runIds has reached us. We auto-
 // populate runDevices from the payload so subsequent state lookups
 // (output panel, status aggregation) find the device id.
 useEffect(() => {
 const socket = getSocket();
 if (!socket) return;
 const onNode = (payload: {
 runId: string; nodeRunId?: string; nodeId: number; status: string;
 scenarioId?: number;
 exitCode: number | null; stdout: string | null; stderr: string | null;
 errorMessage: string | null; deviceId: number | null;
 }) => {
 // Accept events for our scenario (preferred filter) OR for a
 // run we already track. Foreign scenarios still get filtered
 // out so two editors open side by side don't bleed into each
 // other.
 const isOurScenario = payload.scenarioId === scenarioId;
 const isTrackedRun = runDevicesRef.current.has(payload.runId);
 if (!isOurScenario && !isTrackedRun) return;
 const deviceId = payload.deviceId ?? runDevicesRef.current.get(payload.runId);
 if (deviceId == null) return;
 // First time we see this runId? Track it so the rest of the
 // pipeline (active counter, output panel, run-end toast) works.
 if (!runDevicesRef.current.has(payload.runId)) {
 setRunDevices((prev) => {
 if (prev.has(payload.runId)) return prev;
 const next = new Map(prev);
 next.set(payload.runId, deviceId);
 return next;
 });
 if (payload.status === 'running') {
 setActiveRunIds((prev) => {
 if (prev.has(payload.runId)) return prev;
 const next = new Set(prev);
 next.add(payload.runId);
 return next;
 });
 }
 }
 const status = (payload.status === 'running' ? 'running'
 : payload.status === 'failed' ? 'failed'
 : payload.status === 'skipped' ? 'skipped'
 : 'success') as DeviceNodeStatus;

 setNodeStatusByDevice((prev) => {
 const next = new Map(prev);
 const inner = new Map(next.get(payload.nodeId) ?? new Map());
 inner.set(deviceId, status);
 next.set(payload.nodeId, inner);
 return next;
 });
 // Append-style history — keyed by nodeRunId so the same row
 // gets upserted as it transitions running → success/failed.
 // Without nodeRunId we fall back to a synthetic key so old
 // emissions (rare) still appear in the panel.
 const nodeRunKey = payload.nodeRunId ?? `${payload.runId}:${payload.nodeId}:${deviceId}`;
 const nowIso = new Date().toISOString();
 setNodeRunHistory((prev) => {
 const next = new Map(prev);
 const existing = next.get(nodeRunKey);
 next.set(nodeRunKey, {
 nodeRunId: nodeRunKey,
 runId: payload.runId,
 nodeId: payload.nodeId,
 deviceId,
 status,
 // Carry over stdout/stderr from the previous entry if the
 // new event doesn't have any (running → first running tick).
 exitCode: payload.exitCode ?? existing?.exitCode ?? null,
 stdout: payload.stdout ?? existing?.stdout ?? null,
 stderr: payload.stderr ?? existing?.stderr ?? null,
 errorMessage: payload.errorMessage ?? existing?.errorMessage ?? null,
 startedAt: existing?.startedAt ?? nowIso,
 finishedAt: status === 'running' ? null : nowIso,
 });
 return next;
 });
 // Make sure the panel has run-level metadata for this runId so
 // the group header shows a date + trigger source even if the
 // initial load missed it (e.g. the run started after open).
 setRunMetaByRunId((prev) => {
 if (prev.has(payload.runId)) return prev;
 const next = new Map(prev);
 next.set(payload.runId, {
 runId: payload.runId,
 deviceId,
 startedAt: nowIso,
 finishedAt: null,
 status: 'running',
 triggerSource: null,
 });
 return next;
 });
 setLastActiveNodeId(payload.nodeId);
 };
 const onRun = (payload: { id: string; status: string; scenarioId?: number }) => {
 // Accept by scenarioId or by tracked runId (same dual-filter
 // logic as onNode). Otherwise a foreign scenario in another tab
 // could drive our active set.
 const isOurScenario = payload.scenarioId === scenarioId;
 const isTrackedRun = runDevicesRef.current.has(payload.id);
 if (!isOurScenario && !isTrackedRun) return;
 if (payload.status === 'success' || payload.status === 'failure') {
 // Drop this run from the active set; the per-node status map
 // keeps its last result so the canvas stays painted.
 setActiveRunIds((prev) => {
 const next = new Set(prev);
 next.delete(payload.id);
 return next;
 });
 toast.success(`Run ${payload.status === 'success' ? 'succeeded' : 'failed'}`);
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
 * trigger, jump mid-graph, or run a single node.
 *
 * Dirty state handling: rather than blocking the run when the graph
 * has unsaved edits, we auto-save first. For 'from' / 'single' modes
 * the save reassigns DB ids (the server wipes and reinserts), so we
 * capture a snapshot of the targeted node BEFORE saving and re-
 * resolve its new id by matching (type, label, positionX, positionY)
 * against the freshly-loaded graph. */
 const startTestRun = async (deviceIds: number[]) => {
 if (deviceIds.length === 0) return;
 try {
 const opts: { startNodeId?: number; singleNode?: boolean } = {};

 // Snapshot the target node BEFORE the auto-save mutates ids.
 let targetSnapshot: { type: string; label: string; px: number; py: number } | null = null;
 if (runMode.kind === 'from' || runMode.kind === 'single') {
 const target = nodes.find((n) => n.id === runMode.nodeClientId);
 if (!target) {
 toast.error('Target node not found — was it deleted?');
 return;
 }
 targetSnapshot = {
 type: String(target.data.scenarioType),
 label: target.data.label ?? '',
 px: Math.round(target.position.x),
 py: Math.round(target.position.y),
 };
 }

 // Auto-save if dirty so the engine sees the user's latest
 // edits. A failed save aborts the run (handleSave already
 // toasts the error).
 let freshNodes: { id: number; type: string; label: string | null; positionX: number; positionY: number }[] | null = null;
 if (dirty) {
 const fresh = await handleSave(true);
 if (!fresh) return;
 freshNodes = fresh.nodes;
 toast.success('Graph saved — starting run');
 }

 // Resolve startNodeId. If we just saved, prefer the fresh
 // graph's node ids (post-save, the in-memory `db-*` ids on
 // selectedNode etc. are stale). Otherwise the in-memory id is
 // already a `db-*` we can parse directly.
 if (targetSnapshot) {
 let dbId: number | null = null;
 if (freshNodes) {
 const match = freshNodes.find((n) =>
 n.type === targetSnapshot!.type &&
 (n.label ?? '') === targetSnapshot!.label &&
 n.positionX === targetSnapshot!.px &&
 n.positionY === targetSnapshot!.py
 );
 if (match) dbId = match.id;
 } else {
 const parsed = parseDbNodeId(runMode.kind === 'graph' ? null : runMode.nodeClientId);
 if (Number.isFinite(parsed)) dbId = parsed;
 }
 if (dbId == null) {
 toast.error('Could not resolve the target node after save — try again from the right-click menu.');
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
 } catch (err) {
 // Surface the actual server error so the user can act on it
 // instead of staring at a generic "Failed to start run". axios
 // wraps the response under `err.response.data.error`; we fall
 // back to the message string and finally a generic label.
 const e = err as { response?: { data?: { error?: string } }; message?: string };
 const detail = e?.response?.data?.error || e?.message || 'Unknown error';
 console.error('startGraphRun failed', err);
 toast.error(`Failed to start run: ${detail}`);
 }
 };

 /** Resolve a numeric db-id from the editor's React Flow node id.
 * Unsaved nodes have `cn-*` ids and return NaN. */
 const parseDbNodeId = (clientId: string | null): number => {
 if (!clientId) return NaN;
 const m = /^db-(\d+)$/.exec(clientId);
 return m ? parseInt(m[1], 10) : NaN;
 };

 /** Toggle and (re)load the history drawer — extracted as a single
 * helper so the runs counter, the explicit History button, and the
 * auto-open-on-active-run effect all share one path. */
 const openHistoryPanel = useCallback(async (open: boolean) => {
 setShowHistoryPanel(open);
 if (!open) return;
 setHistoryLoading(true);
 try {
 const data = await scenarioApi.getActiveRuns(scenarioId, 24 * 60);
 setHistoryRuns(data.runs);
 } catch { /* silent */ }
 finally { setHistoryLoading(false); }
 }, [scenarioId]);

 /** Cancel a specific run, then refresh the history list so the user
 * sees the row flip to 'cancelled' immediately. */
 const cancelRun = async (runId: string) => {
 try {
 await scenarioApi.cancelRun(runId);
 toast.success('Run cancelled');
 await openHistoryPanel(true);
 } catch (err) {
 const e = err as { response?: { data?: { error?: string } }; message?: string };
 const detail = e?.response?.data?.error || e?.message || 'Unknown error';
 console.error('cancelRun failed', err);
 toast.error(`Failed to cancel run: ${detail}`);
 }
 };

 // React Flow fires onNodesChange/onEdgesChange for every internal
 // mutation, including:
 // - 'dimensions': fired once after the ResizeObserver measures each
 // node, immediately after a fresh load. Not a user edit.
 // - 'select': clicking a node to select it. Not a user edit.
 // - 'position' with `dragging: true`: incremental drag updates. Not
 // yet a user-confirmed move. We mark dirty on the FINAL drop only
 // (`dragging: false`) so a click-without-drag doesn't flip dirty.
 // Filtering these out means a freshly-loaded graph stays "saved" and
 // a click-only selection doesn't ghost-trigger the unsaved badge.
 const isUserNodeChange = (c: NodeChange): boolean => {
 if (c.type === 'dimensions' || c.type === 'select') return false;
 if (c.type === 'position') return c.dragging === false; // drop, not in-flight drag
 // 'add' / 'remove' / 'replace' are always user-initiated.
 return true;
 };
 const isUserEdgeChange = (c: EdgeChange): boolean => {
 if (c.type === 'select') return false;
 return true;
 };
 const onNodesChange = useCallback((changes: NodeChange[]) => {
 setNodes((nds) => applyNodeChanges(changes, nds) as Node<NodeData>[]);
 if (changes.some(isUserNodeChange)) setDirty(true);
 }, []);
 const onEdgesChange = useCallback((changes: EdgeChange[]) => {
 setEdges((eds) => applyEdgeChanges(changes, eds) as Edge<EdgeData>[]);
 if (changes.some(isUserEdgeChange)) setDirty(true);
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
 // Ctrl+D / Cmd+D : duplicate selected node (clones config + label)
 // Ctrl+C / Cmd+C : copy selected node into the editor clipboard
 // Ctrl+V / Cmd+V : paste the clipboard at the centre of the viewport
 // Delete / Backspace : delete selection (node OR edge)
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

 /**
 * Persist the current canvas to the server, then re-key the local
 * state with the freshly-assigned db ids. Returns the fresh graph so
 * callers (the auto-save-then-run path) can resolve a freshly saved
 * node's new id without an extra round-trip.
 *
 * `silent` skips the success toast — used when the save is part of a
 * larger action like "Run on device" so the user doesn't get a double
 * "saved → running" notification.
 */
 const handleSave = async (silent = false): Promise<{ nodes: { id: number; type: string; label: string | null; positionX: number; positionY: number }[] } | null> => {
 const err = validate();
 if (err) { toast.error(err); return null; }
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
 if (!silent) toast.success('Graph saved');
 setDirty(false);
 return {
 nodes: fresh.nodes.map((n) => ({
 id: n.id, type: n.type as string,
 label: n.label ?? null,
 positionX: n.positionX, positionY: n.positionY,
 })),
 };
 } catch {
 toast.error('Failed to save graph');
 return null;
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
 <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-bg-secondary/90 backdrop-blur border border-transparent">
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
 // Clickable counter — opens the same history panel
 // as the History button so a user watching live runs
 // can inspect them with a single click.
 <button
 onClick={() => openHistoryPanel(true)}
 title="Click to see active runs"
 className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-blue-400/10 border border-blue-400/30 text-blue-400 hover:bg-blue-400/20 text-[11px] font-mono transition-colors">
 <Loader2 className="w-3 h-3 animate-spin" /> {activeRunIds.size} run{activeRunIds.size > 1 ? 's' : ''}
 </button>
 )}
 <button
 onClick={() => openHistoryPanel(!showHistoryPanel)}
 title="Recent runs in the last 24 hours"
 className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-bg-secondary/90 border border-transparent text-text-primary hover:bg-bg-hover transition-colors text-[12px] font-medium">
 <History className="w-3.5 h-3.5" /> History
 </button>
 <button onClick={() => { setRunMode({ kind: 'graph' }); setShowRunPicker(true); }}
 title={dirty
 ? 'Auto-saves the graph, then opens the device picker (works even when the scenario is disabled — runs are test-only)'
 : 'Pick one or more devices and run this scenario from its triggers (works even when the scenario is disabled — runs are test-only)'}
 className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-bg-secondary/90 border border-transparent text-text-primary hover:bg-bg-hover transition-colors text-[12px] font-medium">
 <Play className="w-3.5 h-3.5" /> {dirty ? 'Save & run' : 'Run on device(s)'}
 </button>
 {/* Status toggle — flips between active and disabled
 without leaving the editor. Greyed out while loading
 or while a save is in flight. Draft scenarios go
 straight to active on first toggle (UX shortcut so
 the admin doesn't have to bounce back to the list
 page just to enable). */}
 {scenarioStatus !== null && (
 <button
 onClick={async () => {
 if (statusToggling) return;
 const next = scenarioStatus === 'active' ? 'disabled' : 'active';
 setStatusToggling(true);
 try {
 await scenarioApi.update(scenarioId, { status: next } as any);
 setScenarioStatus(next);
 onStatusChanged?.(next);
 toast.success(next === 'active' ? 'Scenario activated' : 'Scenario disabled');
 } catch (err: any) {
 toast.error(err?.response?.data?.error || 'Failed to update status');
 } finally {
 setStatusToggling(false);
 }
 }}
 disabled={statusToggling}
 title={scenarioStatus === 'active' ? 'Disable this scenario (triggers stop firing)' : 'Activate this scenario'}
 className={clsx(
 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border transition-colors text-[12px] font-medium disabled:opacity-50',
 scenarioStatus === 'active'
 ? 'bg-green-400/10 border-green-400/30 text-green-400 hover:bg-green-400/20'
 : 'bg-bg-secondary border-transparent text-text-muted hover:bg-bg-hover',
 )}
 >
 {scenarioStatus === 'active'
 ? <ToggleRight className="w-3.5 h-3.5" />
 : <ToggleLeft className="w-3.5 h-3.5" />}
 {scenarioStatus === 'active' ? 'Active' : scenarioStatus === 'disabled' ? 'Disabled' : 'Draft'}
 </button>
 )}
 <button onClick={() => handleSave()} disabled={saving || !dirty}
 className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-white hover:bg-accent/80 transition-colors text-[12px] font-medium disabled:opacity-50">
 <Save className="w-3.5 h-3.5" /> {saving ? 'Saving…' : 'Save graph'}
 </button>
 {onClose && (
 <button onClick={onClose} className="p-1.5 rounded-lg bg-bg-secondary/90 border border-transparent hover:bg-bg-hover transition-colors">
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
 targetedDeviceIds={targetedDeviceIds}
 mode={runMode}
 onCancel={() => { setShowRunPicker(false); setRunMode({ kind: 'graph' }); }}
 onPick={startTestRun}
 />
 )}

 {/* ── Inline script editor — create / edit without leaving graph ── */}
 {scriptEditorReq && (
 <InlineScriptEditor
 mode={scriptEditorReq.mode}
 initialScript={scriptEditorReq.script}
 categories={scriptCategories}
 onCancel={() => setScriptEditorReq(null)}
 onSaved={(saved) => {
 // Patch the local script list so the picker resolves the
 // freshly-saved row immediately.
 setScripts((prev) => {
 const next = prev.filter((s) => s.id !== saved.id);
 return [...next, saved].sort((a, b) => a.name.localeCompare(b.name));
 });
 // Auto-select the new/edited script back into the node
 // that opened the editor — admins expect "I just made this
 // script, of course it's now selected".
 const target = nodes.find((n) => n.id === scriptEditorReq.nodeId);
 if (target) {
 const cfg = (target.data.config ?? {}) as Record<string, unknown>;
 updateNodeData(scriptEditorReq.nodeId, {
 config: { ...cfg, [scriptEditorReq.fieldKey]: saved.id },
 });
 }
 setScriptEditorReq(null);
 }}
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
 label={dirty ? 'Save & run from this node…' : 'Run from this node…'}
 hint="Bypass triggers — execute this node and continue the graph"
 onClick={() => { setRunMode({ kind: 'from', nodeClientId: target.id }); setShowRunPicker(true); close(); }} />
 <ContextMenuItem icon={<FlaskConical className="w-3.5 h-3.5" />}
 label={dirty ? 'Save & run only this node…' : 'Run only this node…'}
 hint="One-shot — engine stops after this node finishes"
 disabled={isTriggerType(target.data.scenarioType)}
 onClick={() => { setRunMode({ kind: 'single', nodeClientId: target.id }); setShowRunPicker(true); close(); }} />
 {target.data.runStatus === 'running' && (
 // Cancel every active run that's currently parked on
 // this node. Walks the runs list, filters the ones
 // whose current_node_id maps back to this node, and
 // calls cancelRun on each.
 <ContextMenuItem icon={<XCircle className="w-3.5 h-3.5 text-red-400" />}
 label="Cancel runs on this node" hint="Mark all in-flight runs as cancelled"
 danger
 onClick={async () => {
 close();
 // Simplest UX: cancel every active run we know
 // about. The server only flips runs that are
 // actually running, so we don't accidentally hit
 // already-finished ones.
 const ids = [...activeRunIds];
 if (ids.length === 0) {
 toast.error('No active run to cancel');
 return;
 }
 let n = 0;
 for (const id of ids) {
 try { await scenarioApi.cancelRun(id); n++; } catch {}
 }
 toast.success(`Cancelled ${n} run${n > 1 ? 's' : ''}`);
 await openHistoryPanel(true);
 }} />
 )}
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

 {/* ── Recent runs drawer ─────────────────────────────────────── */}
 {showHistoryPanel && (
 <div className="absolute top-3 right-[300px] z-30 w-[340px] max-h-[60vh] flex flex-col bg-bg-secondary/95 backdrop-blur rounded-xl shadow-xl overflow-hidden">
 <div className="px-3 py-2 flex items-center gap-2">
 <History className="w-3.5 h-3.5 text-accent" />
 <span className="text-[11px] font-mono uppercase tracking-wider text-text-muted">Recent runs (24h)</span>
 <div className="flex-1" />
 <button onClick={() => setShowHistoryPanel(false)} className="text-text-muted hover:text-text-primary">
 <X className="w-4 h-4" />
 </button>
 </div>
 <div className="flex-1 overflow-y-auto">
 {historyLoading ? (
 <div className="px-3 py-3 text-[12px] text-text-muted flex items-center gap-2">
 <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…
 </div>
 ) : historyRuns.length === 0 ? (
 <div className="px-3 py-3 text-[12px] text-text-muted">No runs in the last 24 hours.</div>
 ) : (
 historyRuns.map((r) => {
 const dev = devices.find((d) => d.id === r.deviceId);
 const devLabel = dev?.displayName || dev?.hostname || `#${r.deviceId}`;
 const startedAt = new Date(r.startedAt);
 const ago = Math.round((Date.now() - startedAt.getTime()) / 60000);
 const isRunning = r.status === 'running' || r.status === 'pending';
 return (
 <div key={r.id} className="px-3 py-2 /40 last:border-b-0 flex items-start gap-2">
 <DeviceStatusDot status={
 r.status === 'running' ? 'running' :
 r.status === 'success' ? 'success' :
 r.status === 'failure' ? 'failed' :
 r.status === 'cancelled' ? 'failed' : 'success'
 } />
 <div className="flex-1 min-w-0">
 <div className="text-[12px] text-text-primary truncate">{devLabel}</div>
 <div className="text-[10px] text-text-muted flex items-center gap-2">
 <span>{ago < 1 ? 'just now' : ago < 60 ? `${ago} min ago` : `${Math.round(ago / 60)}h ago`}</span>
 <span>· {r.status}</span>
 </div>
 {r.errorMessage && (
 <div className="text-[11px] text-red-400 mt-1 break-words">{r.errorMessage}</div>
 )}
 </div>
 {isRunning && (
 <button
 onClick={() => cancelRun(r.id)}
 title="Cancel this run"
 className="shrink-0 p-1 text-text-muted hover:text-red-400 hover:bg-red-400/10 rounded transition-colors">
 <XCircle className="w-3.5 h-3.5" />
 </button>
 )}
 </div>
 );
 })
 )}
 </div>
 </div>
 )}

 {/* ── Output panel — script-history-style per-device output ────── */}
 {/* Always render when the user opened the panel, even if no
 outputs have arrived yet — a still-running node has no
 stdout/stderr captured but we still want the panel visible
 with a "Waiting on agent…" placeholder so the user knows
 where to look once the script finishes. */}
 {showOutputPanel && (
 <NodeOutputPanel
 nodes={nodes}
 devices={devices}
 history={nodeRunHistory}
 runMeta={runMetaByRunId}
 focusNodeClientId={selectedNode?.id ?? (lastActiveNodeId != null ? `db-${lastActiveNodeId}` : null)}
 onSelectNode={(clientId) => {
 const n = nodes.find((nn) => nn.id === clientId);
 if (n) setSelectedNode(n);
 }}
 onClose={() => setShowOutputPanel(false)}
 />
 )}

 {/* ── Sidebar ─────────────────────────────────────────────────── */}
 <div className="w-72 shrink-0 bg-bg-secondary overflow-y-auto">
 {selectedNode ? (
 <NodeConfigForm
 node={selectedNode}
 scripts={scripts}
 categories={scriptCategories}
 devices={devices}
 onChange={(patch) => updateNodeData(selectedNode.id, patch)}
 onOpenScriptEditor={(req) => setScriptEditorReq({ ...req, nodeId: selectedNode.id })}
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
 node, scripts, categories, devices, onChange, onOpenScriptEditor,
}: {
 node: Node<NodeData>;
 scripts: Script[];
 categories: ScriptCategory[];
 /** Approved devices in the current tenant — feeds the targetDevices
 *  picker so action nodes can be fanned out to a custom subset
 *  instead of running on the trigger target. */
 devices: Device[];
 onChange: (patch: Partial<NodeData>) => void;
 /** Optional — shows the +New / Edit shortcuts next to the script
 * picker. Parent provides the modal so the form stays presentational. */
 onOpenScriptEditor?: (req: { mode: 'create' | 'edit'; fieldKey: string; script?: Script }) => void;
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
 className="w-full px-2 py-1 text-sm bg-bg-primary rounded text-text-primary focus:outline-none focus:border-accent"
 />
 </label>
 {meta?.fields
 // Hide fields whose `showWhen` predicate evaluates false against
 // the current config — keeps the panel uncluttered (e.g. the
 // disk mount filter only shows when metric=disk).
 .filter((f: NodeFieldDef) => !f.showWhen || f.showWhen(cfg))
 .map((f: NodeFieldDef) => (
 <label key={f.key} className="block">
 <span className="text-xs text-text-muted mb-1 block">{f.label}{f.required && <span className="text-red-400 ml-1">*</span>}</span>
 {f.kind === 'text' && (
 <input type="text" value={(cfg[f.key] as string) ?? ''} placeholder={f.placeholder}
 onChange={(e) => setField(f.key, e.target.value)}
 className="w-full px-2 py-1 text-sm bg-bg-primary rounded text-text-primary focus:outline-none focus:border-accent" />
 )}
 {f.kind === 'number' && (
 <input type="number" value={(cfg[f.key] as number) ?? ''} placeholder={f.placeholder}
 onChange={(e) => setField(f.key, e.target.value === '' ? null : parseInt(e.target.value, 10))}
 className="w-full px-2 py-1 text-sm bg-bg-primary rounded text-text-primary focus:outline-none focus:border-accent" />
 )}
 {f.kind === 'select' && (
 <select
 value={(() => {
 const v = cfg[f.key];
 if (v === undefined || v === null) return '';
 return String(v);
 })()}
 onChange={(e) => {
 const raw = e.target.value;
 // Numeric-looking option values (cooldownSeconds presets)
 // come back as strings — coerce so the saved config has
 // the expected type.
 const looksNumeric = (f.options ?? []).every((o) => /^-?\d+$/.test(o.value)) && (f.options ?? []).length > 0;
 setField(f.key, looksNumeric && raw !== '' ? Number(raw) : raw);
 }}
 className="w-full px-2 py-1 text-sm bg-bg-primary rounded text-text-primary focus:outline-none focus:border-accent"
 >
 {(f.options ?? []).map((o) => (
 <option key={o.value} value={o.value}>{o.label}</option>
 ))}
 </select>
 )}
 {f.kind === 'textarea' && (
 <textarea rows={3} value={(cfg[f.key] as string) ?? ''} placeholder={f.placeholder}
 onChange={(e) => setField(f.key, e.target.value)}
 className="w-full px-2 py-1 text-sm bg-bg-primary rounded text-text-primary focus:outline-none focus:border-accent resize-none" />
 )}
 {f.kind === 'cron' && (
 <>
 <input type="text" value={(cfg[f.key] as string) ?? ''} placeholder={f.placeholder}
 onChange={(e) => setField(f.key, e.target.value)}
 className="w-full px-2 py-1 text-sm bg-bg-primary rounded text-text-primary focus:outline-none focus:border-accent font-mono" />
 {/* Same preset list as ScriptSchedulesPage so admins use one
 vocabulary across the whole product. */}
 <div className="flex flex-wrap gap-1 mt-1">
 {[
 { label: 'Every hour', value: '0 * * * *' },
 { label: '02:00 daily', value: '0 2 * * *' },
 { label: 'Mon 09:00', value: '0 9 * * 1' },
 { label: 'Sun midnight', value: '0 0 * * 0' },
 { label: 'Every 15 min', value: '*/15 * * * *' },
 ].map((p) => (
 <button
 key={p.value} type="button"
 onClick={() => setField(f.key, p.value)}
 className="text-[10px] px-1.5 py-0.5 bg-bg-tertiary rounded hover:border-accent/50 text-text-muted hover:text-text-primary transition-colors"
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
 {/* Inline create/edit shortcuts so admins don't have to
 bounce out of the graph editor every time they need
 to tweak a script. The "Edit" button only shows when
 a non-builtin script is selected (built-ins live in
 product code, not the DB). */}
 <div className="flex items-center gap-2 mt-1">
 <button
 type="button"
 onClick={() => onOpenScriptEditor?.({ mode: 'create', fieldKey: f.key })}
 className="text-[11px] px-2 py-0.5 rounded bg-accent/10 text-accent border border-accent/30 hover:bg-accent/20"
 >
 + New script
 </button>
 {(() => {
 const sel = scripts.find((s) => s.id === (cfg[f.key] as number | undefined));
 if (!sel || sel.isBuiltin) return null;
 return (
 <button
 type="button"
 onClick={() => onOpenScriptEditor?.({ mode: 'edit', script: sel, fieldKey: f.key })}
 className="text-[11px] px-2 py-0.5 rounded bg-bg-tertiary text-text-muted border border-transparent hover:text-text-primary"
 >
 Edit selected
 </button>
 );
 })()}
 </div>
 <ScriptInspector
 script={scripts.find((s) => s.id === (cfg[f.key] as number | undefined))}
 />
 </>
 )}
 {f.kind === 'channels' && (
 <div className="text-[11px] text-text-muted italic px-2 py-1 rounded bg-bg-primary">
 Configure notification channels in tenant settings; this node will use the scenario's globally bound channels.
 </div>
 )}
 {f.kind === 'targetDevices' && (
 <TargetDevicePicker
 mode={(cfg.targetMode as 'target' | 'devices' | undefined) ?? 'target'}
 deviceIds={Array.isArray(cfg[f.key]) ? (cfg[f.key] as number[]) : []}
 devices={devices}
 onChange={(mode, ids) => {
 // Mode + deviceIds are kept in sync as a single config edit so
 // the canvas only re-renders once per click. Switching back to
 // 'target' clears the deviceIds array — keeping a stale set
 // around would silently re-activate if the admin toggles back.
 onChange({
 config: {
 ...cfg,
 targetMode: mode,
 [f.key]: mode === 'devices' ? ids : [],
 },
 });
 }}
 />
 )}
 {f.hint && (
 <span className="block mt-1 text-[10px] text-text-muted italic leading-snug">{f.hint}</span>
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
 <div className="mt-2 px-2 py-1.5 text-[11px] text-text-muted/70 italic border border-dashed border-transparent rounded">
 Pick a script above to inspect its contract.
 </div>
 );
 }
 const exitHint =
 script.purpose === 'check' ? '0 = condition met (no resolve needed) · non-zero = problem detected, branch will fire resolve' :
 script.purpose === 'resolve' ? '0 = remediation succeeded · non-zero = remediation failed (scenario step fails)' :
 script.purpose === 'compliance' ? '0 = compliant · non-zero = non-compliant' :
 `Expected exit code: ${script.expectedExitCode ?? 0} (anything else fails the node)`;
 const preview = script.content?.split('\n').slice(0, contentExpanded ? Number.MAX_SAFE_INTEGER : 25);
 const more = (script.content?.split('\n').length ?? 0) > 25;
 return (
 <div className="mt-2 rounded-lg bg-bg-tertiary overflow-hidden">
 <div className="px-3 py-2 space-y-1">
 <div className="flex items-center gap-2 flex-wrap">
 <span className="text-[10px] font-mono uppercase tracking-wider text-text-muted">Inspector</span>
 {script.purpose && (
 <span className={clsx(
 'text-[10px] px-1.5 rounded-full border',
 script.purpose === 'check' && 'text-blue-400 bg-blue-400/10 border-blue-400/30',
 script.purpose === 'resolve' && 'text-orange-400 bg-orange-400/10 border-orange-400/30',
 script.purpose === 'compliance' && 'text-purple-400 bg-purple-400/10 border-purple-400/30',
 script.purpose === 'execute' && 'text-gray-400 bg-gray-400/10 border-gray-400/30',
 script.purpose === 'metric' && 'text-cyan-400 bg-cyan-400/10 border-cyan-400/30',
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

// ── Target device override picker ───────────────────────────────────────────
// Wraps the action-node `targetMode` + `targetDeviceIds` config in a
// two-state toggle. "Target" leaves the node as-is — at runtime the
// executor falls back to `run.device_id` (the device that fired the
// trigger). "Specific devices" opens a chip-multi-select restricted
// to approved devices in the current tenant. The server validates
// device ownership at execute time too — this picker is just UX.
function TargetDevicePicker({
 mode, deviceIds, devices, onChange,
}: {
 mode: 'target' | 'devices';
 deviceIds: number[];
 devices: Device[];
 onChange: (mode: 'target' | 'devices', ids: number[]) => void;
}) {
 const [search, setSearch] = useState('');
 const selected = useMemo(() => new Set(deviceIds.filter(Number.isFinite)), [deviceIds]);
 const filtered = useMemo(() => {
 const q = search.trim().toLowerCase();
 if (!q) return devices.slice(0, 100);
 return devices
 .filter((d) => {
 const hay = `${d.hostname ?? ''} ${d.displayName ?? ''} ${d.osType ?? ''}`.toLowerCase();
 return hay.includes(q);
 })
 .slice(0, 100);
 }, [devices, search]);

 const toggleDevice = (id: number) => {
 const next = new Set(selected);
 if (next.has(id)) next.delete(id);
 else next.add(id);
 onChange('devices', [...next]);
 };

 return (
 <div className="space-y-2">
 <div className="flex rounded overflow-hidden bg-bg-primary">
 <button
 type="button"
 onClick={() => onChange('target', [])}
 className={clsx(
 'flex-1 px-2 py-1 text-[11px] transition-colors',
 mode === 'target'
 ? 'bg-accent/20 text-accent font-medium'
 : 'text-text-muted hover:text-text-primary',
 )}
 >
 Trigger target
 </button>
 <button
 type="button"
 onClick={() => onChange('devices', deviceIds)}
 className={clsx(
 'flex-1 px-2 py-1 text-[11px] transition-colors',
 mode === 'devices'
 ? 'bg-accent/20 text-accent font-medium'
 : 'text-text-muted hover:text-text-primary',
 )}
 >
 Specific devices{mode === 'devices' && selected.size > 0 ? ` (${selected.size})` : ''}
 </button>
 </div>
 {mode === 'devices' && (
 <div className="space-y-1.5">
 <input
 type="text"
 value={search}
 onChange={(e) => setSearch(e.target.value)}
 placeholder="Search hostname / display name / OS…"
 className="w-full px-2 py-1 text-xs bg-bg-primary rounded text-text-primary focus:outline-none focus:border-accent"
 />
 {selected.size > 0 && (
 <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto p-1 bg-bg-primary/50 rounded">
 {[...selected].map((id) => {
 const d = devices.find((x) => x.id === id);
 const label = d ? (d.displayName || d.hostname || `#${id}`) : `#${id} (gone)`;
 return (
 <span
 key={id}
 className={clsx(
 'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border',
 d ? 'bg-accent/10 text-accent border-accent/30'
 : 'bg-red-400/10 text-red-400 border-red-400/30',
 )}
 >
 {label}
 <button
 type="button"
 onClick={() => toggleDevice(id)}
 className="hover:text-red-400"
 >
 <X className="w-2.5 h-2.5" />
 </button>
 </span>
 );
 })}
 </div>
 )}
 <div className="max-h-48 overflow-y-auto bg-bg-primary/50 rounded">
 {filtered.length === 0 ? (
 <div className="px-2 py-2 text-[11px] text-text-muted italic text-center">
 No devices match.
 </div>
 ) : (
 filtered.map((d) => {
 const checked = selected.has(d.id);
 return (
 <button
 key={d.id}
 type="button"
 onClick={() => toggleDevice(d.id)}
 className={clsx(
 'w-full flex items-center gap-2 px-2 py-1 text-[11px] text-left transition-colors',
 checked
 ? 'bg-accent/10 text-text-primary'
 : 'text-text-secondary hover:bg-bg-tertiary',
 )}
 >
 <span
 className={clsx(
 'inline-flex w-3 h-3 rounded items-center justify-center text-[8px] font-bold',
 checked ? 'bg-accent text-bg-primary' : 'border border-text-muted',
 )}
 >
 {checked ? '✓' : ''}
 </span>
 <span className="flex-1 truncate">
 {d.displayName || d.hostname}
 {d.displayName && d.hostname && d.displayName !== d.hostname && (
 <span className="text-text-muted ml-1">({d.hostname})</span>
 )}
 </span>
 <span className="text-text-muted text-[10px]">{d.osType}</span>
 </button>
 );
 })
 )}
 {devices.length > 100 && !search && (
 <div className="px-2 py-1 text-[10px] text-text-muted italic">
 Showing first 100 — type to search the rest.
 </div>
 )}
 </div>
 </div>
 )}
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
 // `Node` from @xyflow/react shadows the global DOM Node here, so
 // we cast to globalThis.Node for the contains() check.
 if (!wrapRef.current?.contains(e.target as globalThis.Node)) setOpen(false);
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
 className="w-full px-2 py-1 text-sm bg-bg-primary rounded text-left text-text-primary focus:outline-none focus:border-accent flex items-center gap-2">
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
 <div className="absolute z-30 left-0 right-0 mt-1 bg-bg-secondary rounded-lg shadow-xl max-h-[360px] flex flex-col overflow-hidden">
 <div className="p-2 ">
 <input ref={inputRef} value={query} onChange={(e) => setQuery(e.target.value)}
 placeholder="Search scripts…"
 className="w-full px-2 py-1 text-sm bg-bg-primary rounded text-text-primary focus:outline-none focus:border-accent" />
 </div>
 <div className="overflow-y-auto flex-1">
 {value != null && (
 <button type="button" onClick={() => { onChange(null); setOpen(false); }}
 className="w-full text-left px-3 py-1.5 text-[11px] text-text-muted hover:bg-bg-hover /40">
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
 <span className="text-[9px] font-mono text-text-muted/80 px-1 rounded">{s.purpose}</span>
 )}
 </button>,
 ...renderTree(s.id, depth + 1),
 ]);
 };
 return (
 <div key={catName}>
 <div className="px-3 py-1 text-[10px] font-mono uppercase tracking-wider text-text-muted bg-bg-tertiary/50 /40">
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
 devices, targetedDeviceIds, mode, onCancel, onPick,
}: {
 devices: Device[];
 /** IDs of devices the scenario actually targets via target_type +
 * target_ids. The picker pins these to a "Targeted" section at the
 * top with a coloured badge so the user lands on them first. */
 targetedDeviceIds: Set<number>;
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

 // Split filtered results into "targeted" (sorted by display name)
 // and "others" (everything else still selectable for ad-hoc test
 // runs). The user explicitly asked for the targeted set on top so
 // they don't scroll through hundreds of approved devices to find
 // the three the scenario actually applies to.
 const cmpName = (a: Device, b: Device) =>
 (a.displayName || a.hostname || '').localeCompare(b.displayName || b.hostname || '');
 const targeted = filtered.filter((d) => targetedDeviceIds.has(d.id)).sort(cmpName);
 const others = filtered.filter((d) => !targetedDeviceIds.has(d.id)).sort(cmpName);

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
 /** Convenience shortcut — select every targeted device that
 * matches the current search filter. Saves the user from clicking
 * 10 boxes when the scenario targets a 10-device group. */
 const selectAllTargeted = () => {
 setSelected((prev) => {
 const next = new Set(prev);
 for (const d of targeted) next.add(d.id);
 return next;
 });
 };

 const title = mode.kind === 'graph' ? 'Run on devices'
 : mode.kind === 'from' ? 'Run from this node — pick devices'
 : 'Run only this node — pick devices';
 const subtitle = mode.kind === 'graph' ? 'Fires the graph from its triggers on the selected devices.'
 : mode.kind === 'from' ? 'Skips the trigger walk and starts from the selected node, then continues the graph normally.'
 : 'Executes the selected node once on each device, then ends the run with success.';

 return (
 <div className="fixed inset-0 z-[80] flex items-center justify-center bg-bg-primary/70 backdrop-blur-sm" onClick={onCancel}>
 <div className="w-[480px] max-h-[80vh] flex flex-col bg-bg-secondary rounded-xl shadow-xl overflow-hidden"
 onClick={(e) => e.stopPropagation()}>
 <div className="px-4 py-3 flex items-center justify-between">
 <div>
 <div className="text-sm font-semibold text-text-primary">{title}</div>
 <div className="text-[11px] text-text-muted mt-0.5">{subtitle}</div>
 </div>
 <button onClick={onCancel} className="text-text-muted hover:text-text-primary">
 <X className="w-4 h-4" />
 </button>
 </div>
 <div className="px-4 py-2 flex items-center gap-2">
 <input
 value={query} onChange={(e) => setQuery(e.target.value)}
 placeholder="Filter by hostname, IP, OS, UUID…"
 className="flex-1 px-2 py-1 text-sm bg-bg-primary rounded text-text-primary focus:outline-none focus:border-accent"
 />
 <button type="button" onClick={toggleAll}
 className="text-[11px] px-2 py-1 rounded bg-bg-tertiary border border-transparent text-text-muted hover:text-text-primary">
 {selected.size === filtered.length && filtered.length > 0 ? 'Clear' : 'All'}
 </button>
 </div>
 <div className="flex-1 overflow-y-auto">
 {filtered.length === 0 ? (
 <div className="px-4 py-3 text-sm text-text-muted">No matching device</div>
 ) : (
 <>
 {/* "Targeted by scenario" section — pinned on top, with
 an accent badge per row + a one-click "Select all"
 shortcut. Hidden when the scenario has no resolved
 targets (e.g. targetType='all' on a small fleet
 where every device is targeted, or empty target_ids). */}
 {targeted.length > 0 && (
 <div>
 <div className="px-4 py-1.5 bg-accent/5 border-b border-accent/20 flex items-center gap-2">
 <span className="text-[10px] font-mono uppercase tracking-wider text-accent">
 Targeted by scenario · {targeted.length}
 </span>
 <div className="flex-1" />
 <button type="button" onClick={selectAllTargeted}
 className="text-[10px] px-2 py-0.5 rounded bg-accent/10 border border-accent/30 text-accent hover:bg-accent/20 transition-colors">
 Select all targeted
 </button>
 </div>
 {targeted.slice(0, 500).map((d) => {
 const checked = selected.has(d.id);
 return (
 <button key={d.id} onClick={() => toggle(d.id)}
 className={clsx(
 'w-full text-left px-4 py-2 text-sm flex items-center gap-3 transition-colors /50',
 checked ? 'bg-accent/10' : 'hover:bg-bg-hover',
 )}>
 <input type="checkbox" readOnly checked={checked} className="accent-accent" />
 <div className="flex-1 min-w-0">
 <div className="flex items-center gap-2">
 <span className="text-text-primary truncate">{d.displayName || d.hostname}</span>
 <span className="text-[9px] font-mono text-accent border border-accent/30 bg-accent/10 rounded px-1 py-0">
 targeted
 </span>
 </div>
 <div className="text-[11px] text-text-muted truncate">{d.osName || d.osType} · {d.ipLocal || '—'}</div>
 </div>
 </button>
 );
 })}
 </div>
 )}
 {/* "Other devices" — every other approved device in the
 tenant, still selectable so admins can fire ad-hoc
 test runs on a non-targeted machine without editing
 the scenario's target_ids. */}
 {others.length > 0 && (
 <div>
 <div className="px-4 py-1.5 bg-bg-tertiary/40 flex items-center">
 <span className="text-[10px] font-mono uppercase tracking-wider text-text-muted">
 {targeted.length > 0 ? 'Other devices' : 'All devices'} · {others.length}
 </span>
 </div>
 {others.slice(0, 500).map((d) => {
 const checked = selected.has(d.id);
 return (
 <button key={d.id} onClick={() => toggle(d.id)}
 className={clsx(
 'w-full text-left px-4 py-2 text-sm flex items-center gap-3 transition-colors /50',
 checked ? 'bg-accent/10' : 'hover:bg-bg-hover',
 )}>
 <input type="checkbox" readOnly checked={checked} className="accent-accent" />
 <div className="flex-1 min-w-0">
 <div className="text-text-primary truncate">{d.displayName || d.hostname}</div>
 <div className="text-[11px] text-text-muted truncate">{d.osName || d.osType} · {d.ipLocal || '—'}</div>
 </div>
 </button>
 );
 })}
 </div>
 )}
 </>
 )}
 {filtered.length > 1000 && (
 <div className="px-4 py-2 text-[11px] text-text-muted">Long list — narrow your search if needed.</div>
 )}
 </div>
 <div className="px-4 py-3 flex items-center justify-between">
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
 if (root && !root.contains(e.target as globalThis.Node)) onClose();
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
 const top = Math.min(y, window.innerHeight - 360);
 return (
 <div id="scenario-ctx-menu"
 style={{ position: 'fixed', left, top, zIndex: 90 }}
 className="min-w-[220px] bg-bg-secondary rounded-lg shadow-xl overflow-hidden">
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

// ── Output panel — runs grouped + per-device outputs + agent filter ────────
// Bottom-anchored floating panel. Two view modes:
// - **Grouped** (default): nodes' run history is broken down by parent
// run. Each run header shows its date + trigger source ("manual ·
// 14:32" / "schedule_cron · 03:00"). Devices that participated in
// that run sit underneath, expandable to view stdout / stderr.
// - **Filtered**: a non-empty agent filter flattens everything into a
// chronological per-row list keyed by hostname, with the run date
// on each line so the user can spot recurring failures on a single
// machine across runs.
//
// The panel is vertically resizable via a handle on its top edge —
// drag to enlarge for big stdout dumps, shrink to keep the canvas
// visible while a run is in progress. State is component-local so
// each re-open returns to the default size; persistence is intentionally
// not added (keeps the UI predictable across scenario switches).
function NodeOutputPanel({
 nodes, devices, history, runMeta, focusNodeClientId, onSelectNode, onClose,
}: {
 nodes: Node<NodeData>[];
 devices: Device[];
 history: Map<string, NodeRunEntry>;
 runMeta: Map<string, RunMeta>;
 focusNodeClientId: string | null;
 onSelectNode: (clientId: string) => void;
 onClose: () => void;
}) {
 const deviceLabel = (id: number) => {
 const d = devices.find((x) => x.id === id);
 if (!d) return `device #${id}`;
 return d.displayName || d.hostname || `device #${id}`;
 };

 // ── Resize state ────────────────────────────────────────────────
 // Default to ~38% of the viewport height; min 200px, max 80vh. The
 // pointer-move listener is attached only while the user holds down
 // the resize handle so we don't waste cycles when the panel is idle.
 const [panelHeight, setPanelHeight] = useState<number>(() => Math.round(window.innerHeight * 0.38));
 const dragStateRef = useRef<{ startY: number; startHeight: number } | null>(null);
 const onResizeStart = (e: React.MouseEvent) => {
 e.preventDefault();
 dragStateRef.current = { startY: e.clientY, startHeight: panelHeight };
 const onMove = (mv: MouseEvent) => {
 if (!dragStateRef.current) return;
 // Drag UP makes the panel taller, DOWN makes it shorter — the
 // panel is anchored to the bottom of the viewport, so the new
 // height is start - delta.
 const delta = mv.clientY - dragStateRef.current.startY;
 const next = Math.max(200, Math.min(window.innerHeight * 0.8, dragStateRef.current.startHeight - delta));
 setPanelHeight(next);
 };
 const onUp = () => {
 dragStateRef.current = null;
 document.removeEventListener('mousemove', onMove);
 document.removeEventListener('mouseup', onUp);
 };
 document.addEventListener('mousemove', onMove);
 document.addEventListener('mouseup', onUp);
 };

 // ── Active node + filter ───────────────────────────────────────
 const focusDbId = focusNodeClientId ? Number(/^db-(\d+)$/.exec(focusNodeClientId)?.[1] ?? NaN) : NaN;
 // Build the candidate node list: every node that has at least one
 // history entry, plus the focused node so it shows up even with
 // zero entries (still-running with no stdout yet).
 const nodeIdsInHistory = new Set<number>();
 for (const e of history.values()) nodeIdsInHistory.add(e.nodeId);
 if (Number.isFinite(focusDbId)) nodeIdsInHistory.add(focusDbId);
 const candidateIds = [...nodeIdsInHistory];
 // `activeDbId === 'all'` is the sentinel for "show every node's
 // outputs in this panel" — the user picks it from the dropdown when
 // they want a flat run-by-run view rather than zooming into a
 // specific node. Defaults to the focused node when one is set,
 // otherwise to "all" so opening the panel shows everything by
 // default.
 const [activeSelection, setActiveSelection] = useState<'all' | number>(
 Number.isFinite(focusDbId) ? focusDbId : 'all',
 );
 // Whenever the focus changes (selection / right-click "show output"),
 // realign the dropdown so the user sees the node they targeted.
 useEffect(() => {
 if (Number.isFinite(focusDbId)) setActiveSelection(focusDbId);
 }, [focusDbId]);
 const activeDbId: number | null = activeSelection === 'all'
 ? null
 : (typeof activeSelection === 'number' ? activeSelection : null);
 const node = activeDbId != null ? nodes.find((n) => n.id === `db-${activeDbId}`) : undefined;
 const meta = node ? NODE_TYPE_BY_KEY[node.data.scenarioType as ScenarioNodeType] : undefined;

 const [filter, setFilter] = useState('');
 const filterQ = filter.trim().toLowerCase();
 const filterIsActive = filterQ.length > 0;

 // ── Bucket the history entries — either for the focused node, or
 // every node when the user picked "All nodes".
 const entriesForNode: NodeRunEntry[] = activeDbId == null
 ? [...history.values()]
 : [...history.values()].filter((e) => e.nodeId === activeDbId);
 // Helper to label a node row when rendering across all nodes.
 const nodeLabelById = (id: number): string => {
 const n = nodes.find((nn) => nn.id === `db-${id}`);
 if (!n) return `node ${id}`;
 const m = NODE_TYPE_BY_KEY[n.data.scenarioType as ScenarioNodeType];
 return n.data.label || m?.label || `node ${id}`;
 };
 // Apply hostname filter first (operates on the entry's deviceId).
 const filteredEntries = filterIsActive
 ? entriesForNode.filter((e) => {
 const d = devices.find((x) => x.id === e.deviceId);
 const hay = `${d?.displayName ?? ''} ${d?.hostname ?? ''} ${d?.ipLocal ?? ''} ${d?.osName ?? ''}`.toLowerCase();
 return hay.includes(filterQ);
 })
 : entriesForNode;
 // Filtered (per-agent) view: newest first across all runs so a
 // recent failure surfaces at the top. Grouped view: each run's
 // entries are sorted ASC inside the group (execution order — node
 // 1 → node 2 → … → end_success), but the runs themselves are
 // ordered DESC by their first event so the latest run leads.
 const filteredDesc = [...filteredEntries].sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));

 // Group by **batch** — when the server uses the `<type>:batch:<id>`
 // convention in trigger_source, all device runs from a single
 // multi-device fire share that string and collapse under one
 // header ("Manual · 200 devices · 14:32"). Otherwise we fall back
 // to grouping by runId so older runs without a batch marker still
 // render as standalone groups.
 const groupKeyFor = (entry: NodeRunEntry): string => {
 const meta = runMeta.get(entry.runId);
 const src = meta?.triggerSource ?? null;
 if (src && src.includes(':batch:')) return `batch:${src}`;
 return `run:${entry.runId}`;
 };
 const groupedByBatch = new Map<string, NodeRunEntry[]>();
 for (const e of filteredEntries) {
 const k = groupKeyFor(e);
 if (!groupedByBatch.has(k)) groupedByBatch.set(k, []);
 groupedByBatch.get(k)!.push(e);
 }
 // Sort each group's entries chronologically ASC — execution order:
 // the canvas runs trigger → node1 → node2 → … → terminator, so the
 // panel mirrors that progression instead of flipping it.
 for (const arr of groupedByBatch.values()) {
 arr.sort((a, b) => (a.startedAt < b.startedAt ? -1 : 1));
 }
 const groupKeysSorted = [...groupedByBatch.keys()].sort((a, b) => {
 // Headers ordered by their FIRST entry desc — newest batch on top.
 const aFirst = groupedByBatch.get(a)![0];
 const bFirst = groupedByBatch.get(b)![0];
 return aFirst.startedAt < bFirst.startedAt ? 1 : -1;
 });

 // ── Expand state ───────────────────────────────────────────────
 // Keyed by nodeRunId so the same device row stays open across
 // re-renders, plus a separate set for collapsed BATCH groups so
 // the user can fold older batches and only keep the latest open.
 const [expanded, setExpanded] = useState<Set<string>>(new Set());
 const toggle = (k: string) => setExpanded((prev) => {
 const next = new Set(prev);
 next.has(k) ? next.delete(k) : next.add(k);
 return next;
 });
 /** Group keys explicitly collapsed by the user. By default the
 * most recent group is expanded and all others are collapsed
 * (computed below from the sorted list — the user can toggle
 * any of them). */
 const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
 const toggleGroup = (k: string) => setCollapsedGroups((prev) => {
 const next = new Set(prev);
 next.has(k) ? next.delete(k) : next.add(k);
 return next;
 });
 // Track which group keys we've seen so we can auto-collapse new
 // older groups as fresh runs arrive — without this, opening the
 // panel on a long-running scenario shows every past batch
 // expanded, drowning the latest batch in noise.
 const seenGroupsRef = useRef<Set<string>>(new Set());
 useEffect(() => {
 setCollapsedGroups((prev) => {
 let mutated = false;
 const next = new Set(prev);
 // First time we see a group AND it's not the freshest: collapse it.
 // (The freshest is index 0 in groupKeysSorted.)
 for (let i = 1; i < groupKeysSorted.length; i++) {
 const k = groupKeysSorted[i];
 if (!seenGroupsRef.current.has(k)) {
 next.add(k);
 mutated = true;
 }
 }
 for (const k of groupKeysSorted) seenGroupsRef.current.add(k);
 return mutated ? next : prev;
 });
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [groupKeysSorted.join('|')]);

 return (
 <div
 className="absolute left-3 right-[300px] bottom-3 z-20 flex flex-col bg-bg-secondary/95 backdrop-blur rounded-xl shadow-xl overflow-hidden"
 style={{ height: panelHeight }}>
 {/* Drag handle on top — visible 6px strip with a centred grip. */}
 <div
 onMouseDown={onResizeStart}
 title="Drag to resize"
 className="h-1.5 bg-border/40 hover:bg-accent/40 cursor-ns-resize transition-colors flex items-center justify-center">
 <div className="w-10 h-0.5 bg-text-muted/50 rounded-full" />
 </div>
 <div className="px-3 py-2 flex items-center gap-2 flex-wrap">
 <TerminalIcon className="w-3.5 h-3.5 text-accent" />
 <span className="text-[11px] font-mono uppercase tracking-wider text-text-muted">Output</span>
 <select
 value={activeSelection === 'all' ? '__all__' : String(activeSelection)}
 onChange={(e) => {
 const v = e.target.value;
 if (v === '__all__') {
 setActiveSelection('all');
 } else {
 const n = Number(v);
 setActiveSelection(n);
 onSelectNode(`db-${n}`);
 }
 }}
 className="text-[11px] bg-bg-primary rounded px-1.5 py-0.5 text-text-primary focus:outline-none focus:border-accent">
 <option value="__all__">— All nodes —</option>
 {candidateIds.map((dbId) => (
 <option key={dbId} value={dbId}>{nodeLabelById(dbId)}</option>
 ))}
 </select>
 {meta && <span className="text-[10px] text-text-muted/60">· {meta.label}</span>}
 {activeDbId == null && (
 <span className="text-[10px] text-text-muted/60">· every node, every run</span>
 )}
 <div className="flex-1" />
 <input
 value={filter}
 onChange={(e) => setFilter(e.target.value)}
 placeholder="Filter agents…"
 className="text-[11px] px-2 py-0.5 bg-bg-primary rounded text-text-primary placeholder-text-muted/60 focus:outline-none focus:border-accent w-[150px]"
 />
 <button onClick={onClose} className="text-text-muted hover:text-text-primary">
 <X className="w-4 h-4" />
 </button>
 </div>
 <div className="flex-1 overflow-y-auto">
 {filteredEntries.length === 0 ? (
 <div className="px-3 py-3 text-[12px] text-text-muted flex items-center gap-2">
 {filterIsActive ? (
 <span>No agent matches <code className="font-mono text-text-primary">{filter}</code> in this node's history.</span>
 ) : node ? (
 <>
 <Loader2 className="w-3.5 h-3.5 animate-spin text-text-muted/70 shrink-0" />
 <span>
 Waiting on agent for <span className="text-text-primary font-medium">{node.data.label || meta?.label || `node ${activeDbId}`}</span>…
 Output appears once the script finishes (no live stdout streaming yet).
 </span>
 </>
 ) : 'No output yet.'}
 </div>
 ) : filterIsActive ? (
 // ── Filtered view: flat per-agent feed across runs.
 // Each row is a (deviceId, runId) tuple with date + run badge,
 // so an admin filtering for `srv01` can see every visit of
 // that machine at a glance, regardless of which run fired it.
 filteredDesc.map((entry) => {
 const isOpen = expanded.has(entry.nodeRunId);
 const meta2 = runMeta.get(entry.runId);
 return (
 <NodeOutputRow
 key={entry.nodeRunId}
 entry={entry}
 deviceLabel={deviceLabel(entry.deviceId)}
 nodeLabel={activeDbId == null ? nodeLabelById(entry.nodeId) : undefined}
 runDate={meta2?.startedAt ?? entry.startedAt}
 runTrigger={meta2?.triggerSource ?? null}
 isOpen={isOpen}
 onToggle={() => toggle(entry.nodeRunId)}
 showRunBadge
 />
 );
 })
 ) : (
 // ── Grouped view: one section per BATCH (collapsible),
 // devices nested. A multi-device manual fire shows up as
 // one header "Manual · 200 devices · 14:32" instead of
 // 200 separate "1 device" rows. Only the latest batch is
 // expanded by default; older batches auto-collapse so the
 // panel stays focused on the freshest run.
 groupKeysSorted.map((groupKey) => {
 const entries = groupedByBatch.get(groupKey)!;
 // Aggregate group-level metadata from the first entry's
 // run meta (all entries in a batch share trigger_source).
 const firstMeta = runMeta.get(entries[0].runId);
 const startedAt = firstMeta?.startedAt ?? entries[0].startedAt;
 // Aggregate finishedAt — the LATEST finishedAt across all
 // device entries in the batch is the moment the whole
 // batch wrapped up. Null while any entry is still running.
 const allFinished = entries.every((e) => e.finishedAt != null);
 const finishedAt = allFinished
 ? entries.reduce<string | null>((acc, e) => (!acc || (e.finishedAt && e.finishedAt > acc)) ? e.finishedAt : acc, null)
 : null;
 const trigger = firstMeta?.triggerSource ?? null;
 // Count unique devices in the batch + a brief outcome
 // breakdown for the collapsed-state summary line.
 const deviceCount = new Set(entries.map((e) => e.deviceId)).size;
 const successCount = new Set(entries.filter((e) => e.status === 'success').map((e) => e.deviceId)).size;
 const failedCount = new Set(entries.filter((e) => e.status === 'failed').map((e) => e.deviceId)).size;
 const runningCount = new Set(entries.filter((e) => e.status === 'running').map((e) => e.deviceId)).size;
 const isCollapsed = collapsedGroups.has(groupKey);
 return (
 <div key={groupKey} className="/40 last:border-b-0">
 <button
 onClick={() => toggleGroup(groupKey)}
 className="w-full text-left px-3 py-1.5 bg-bg-tertiary/40 /40 flex items-center gap-2 text-[11px] hover:bg-bg-tertiary/70 transition-colors">
 {isCollapsed
 ? <ChevronRight className="w-3.5 h-3.5 text-text-muted shrink-0" />
 : <ChevronDown className="w-3.5 h-3.5 text-text-muted shrink-0" />}
 <span className="text-text-primary font-mono">{formatRunDate(startedAt)}</span>
 {trigger && (
 <span className="text-[10px] px-1.5 py-0 rounded bg-bg-primary text-text-muted truncate max-w-[220px]" title={trigger}>
 {trigger}
 </span>
 )}
 <span className="text-text-muted/60">·</span>
 <span className="text-text-muted">
 {deviceCount} device{deviceCount > 1 ? 's' : ''}
 </span>
 {/* Outcome chips — quick-glance summary while the
 group is collapsed. */}
 {successCount > 0 && (
 <span className="text-[10px] text-green-400">{successCount} ok</span>
 )}
 {failedCount > 0 && (
 <span className="text-[10px] text-red-400">{failedCount} failed</span>
 )}
 {runningCount > 0 && (
 <span className="text-[10px] text-blue-400 inline-flex items-center gap-1">
 <Loader2 className="w-2.5 h-2.5 animate-spin" /> {runningCount} running
 </span>
 )}
 {finishedAt && (
 <span className="text-text-muted/70 ml-auto">finished {formatRunDate(finishedAt)}</span>
 )}
 </button>
 {!isCollapsed && entries.map((entry) => {
 const isOpen = expanded.has(entry.nodeRunId);
 return (
 <NodeOutputRow
 key={entry.nodeRunId}
 entry={entry}
 deviceLabel={deviceLabel(entry.deviceId)}
 nodeLabel={activeDbId == null ? nodeLabelById(entry.nodeId) : undefined}
 runDate={null}
 runTrigger={null}
 isOpen={isOpen}
 onToggle={() => toggle(entry.nodeRunId)}
 />
 );
 })}
 </div>
 );
 })
 )}
 </div>
 </div>
 );
}

/** One agent line inside the output panel — same shape used by both
 * grouped and filtered views, the latter showing a run-date badge so
 * the row is self-describing without its parent group header. */
function NodeOutputRow({
 entry, deviceLabel, nodeLabel, runDate, runTrigger, isOpen, onToggle, showRunBadge,
}: {
 entry: NodeRunEntry;
 deviceLabel: string;
 /** Node label rendered as a chip on the row — used only when the
 * panel is in "all nodes" mode so admins can tell which step of
 * the graph produced the output. */
 nodeLabel?: string;
 runDate: string | null;
 runTrigger: string | null;
 isOpen: boolean;
 onToggle: () => void;
 showRunBadge?: boolean;
}) {
 return (
 <div className="/30 last:border-b-0">
 <button onClick={onToggle}
 className="w-full text-left px-3 py-1.5 flex items-center gap-2 text-[12px] hover:bg-bg-hover transition-colors">
 {isOpen ? <ChevronDown className="w-3.5 h-3.5 text-text-muted shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-text-muted shrink-0" />}
 <DeviceStatusDot status={entry.status} />
 {nodeLabel && (
 <span className="text-[10px] font-mono text-accent border border-accent/30 bg-accent/10 rounded px-1.5 py-0 shrink-0 truncate max-w-[120px]" title={nodeLabel}>
 {nodeLabel}
 </span>
 )}
 <span className="text-text-primary truncate flex-1">{deviceLabel}</span>
 {showRunBadge && runDate && (
 <span className="text-[10px] font-mono text-text-muted/80 shrink-0">{formatRunDate(runDate)}</span>
 )}
 {showRunBadge && runTrigger && (
 <span className="text-[10px] text-text-muted/70 truncate max-w-[120px] shrink-0" title={runTrigger}>
 · {runTrigger}
 </span>
 )}
 {entry.exitCode != null && (
 <span className={clsx(
 'text-[10px] font-mono px-1.5 py-0 rounded border shrink-0',
 entry.exitCode === 0
 ? 'text-green-400 bg-green-400/10 border-green-400/30'
 : 'text-red-400 bg-red-400/10 border-red-400/30',
 )}>
 exit {entry.exitCode}
 </span>
 )}
 </button>
 {isOpen && (
 <div className="px-3 pb-2 space-y-2">
 {entry.errorMessage && (
 <div className="text-[11px] text-red-400 bg-red-400/10 border border-red-400/30 rounded px-2 py-1.5">
 {entry.errorMessage}
 </div>
 )}
 {entry.stdout && (
 <div>
 <div className="text-[10px] font-mono uppercase text-text-muted mb-1">stdout</div>
 <pre className="text-[11px] font-mono text-text-secondary whitespace-pre-wrap bg-bg-primary rounded p-2 max-h-64 overflow-y-auto">{entry.stdout}</pre>
 </div>
 )}
 {entry.stderr && (
 <div>
 <div className="text-[10px] font-mono uppercase text-text-muted mb-1">stderr</div>
 <pre className="text-[11px] font-mono text-red-400/90 whitespace-pre-wrap bg-bg-primary rounded p-2 max-h-64 overflow-y-auto">{entry.stderr}</pre>
 </div>
 )}
 {!entry.stdout && !entry.stderr && !entry.errorMessage && (
 <div className="text-[11px] text-text-muted italic">
 {entry.status === 'running' ? 'Waiting on agent…' : 'No output captured.'}
 </div>
 )}
 </div>
 )}
 </div>
 );
}

/** Compact run-date formatter — date + HH:MM:SS in the user's locale. */
function formatRunDate(iso: string): string {
 try {
 const d = new Date(iso);
 const today = new Date();
 const sameDay = d.toDateString() === today.toDateString();
 if (sameDay) return d.toLocaleTimeString();
 return `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
 } catch { return iso; }
}
function DeviceStatusDot({ status }: { status: DeviceNodeStatus }) {
 if (status === 'running') return <Loader2 className="w-3 h-3 text-blue-400 animate-spin shrink-0" />;
 if (status === 'success') return <CheckCircle2 className="w-3 h-3 text-green-400 shrink-0" />;
 if (status === 'failed') return <XCircle className="w-3 h-3 text-red-400 shrink-0" />;
 return <span className="w-3 h-3 rounded-full bg-text-muted/30 shrink-0" />;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function edgeConditionLabel(c?: ScenarioEdgeCondition): string {
 if (!c) return 'always';
 switch (c.kind) {
 case 'always': return 'always';
 case 'default': return 'default';
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
 if (c.kind === 'default') return '#ef4444'; // red
 if (c.kind === 'exit_code_eq' && c.value === 0) return '#22c55e'; // green
 if (c.kind === 'exit_code_neq' && c.value === 0) return '#ef4444'; // red
 return '#888';
}

// ── Inline script editor — opened from a run_script node's picker ──────────
// Stripped-down form that covers the 80% case (name + content + runtime
// + platform + timeout). Anything more advanced (parameters, auto-
// remediate, parent script chains) still requires the dedicated
// /scripts page; the goal here is to author quickly without breaking
// the user's mental flow on the graph.
function InlineScriptEditor({
 mode, initialScript, categories, onCancel, onSaved,
}: {
 mode: 'create' | 'edit';
 initialScript?: Script;
 categories: ScriptCategory[];
 onCancel: () => void;
 onSaved: (saved: Script) => void;
}) {
 const [name, setName] = useState(initialScript?.name ?? '');
 const [description, setDescription] = useState(initialScript?.description ?? '');
 const [content, setContent] = useState(initialScript?.content ?? '');
 const [platform, setPlatform] = useState<string>(initialScript?.platform ?? 'all');
 const [runtime, setRuntime] = useState<string>(initialScript?.runtime ?? 'powershell');
 const [timeoutSeconds, setTimeoutSeconds] = useState<number>(initialScript?.timeoutSeconds ?? 300);
 const [expectedExitCode, setExpectedExitCode] = useState<number>(initialScript?.expectedExitCode ?? 0);
 const [runAs, setRunAs] = useState<'system' | 'user'>(initialScript?.runAs ?? 'system');
 const [purpose, setPurpose] = useState<string>(initialScript?.purpose ?? 'execute');
 const [categoryId, setCategoryId] = useState<number | null>(initialScript?.categoryId ?? null);
 const [saving, setSaving] = useState(false);

 const handleSave = async () => {
 if (!name.trim() || !content.trim()) {
 toast.error('Name and content are required');
 return;
 }
 setSaving(true);
 try {
 const payload = {
 name, description: description || null,
 platform, runtime, content,
 timeoutSeconds, expectedExitCode, runAs, purpose,
 tags: initialScript?.tags ?? [],
 categoryId,
 availableInReach: initialScript?.availableInReach ?? false,
 } as any;
 const saved = mode === 'create'
 ? await scriptApi.create(payload)
 : await scriptApi.update(initialScript!.id, payload);
 onSaved(saved);
 } catch (err: any) {
 toast.error(err?.response?.data?.error || 'Failed to save script');
 } finally {
 setSaving(false);
 }
 };

 return (
 <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
 <div className="bg-bg-secondary rounded-xl shadow-2xl w-full max-w-3xl mx-4 max-h-[90vh] flex flex-col">
 <div className="px-5 py-4 flex items-center justify-between">
 <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
 <TerminalIcon className="w-4 h-4 text-accent" />
 {mode === 'create' ? 'New script' : `Edit "${initialScript?.name}"`}
 </h3>
 <button onClick={onCancel} disabled={saving} className="p-1 text-text-muted hover:text-text-primary rounded">
 <X className="w-4 h-4" />
 </button>
 </div>
 <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
 <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
 <div>
 <label className="text-[10px] uppercase text-text-muted">Name *</label>
 <input value={name} onChange={(e) => setName(e.target.value)}
 className="w-full mt-1 px-3 py-1.5 text-sm bg-bg-tertiary rounded focus:outline-none focus:border-accent" />
 </div>
 <div>
 <label className="text-[10px] uppercase text-text-muted">Category</label>
 <select value={categoryId ?? ''} onChange={(e) => setCategoryId(e.target.value ? parseInt(e.target.value, 10) : null)}
 className="w-full mt-1 px-3 py-1.5 text-sm bg-bg-tertiary rounded focus:outline-none focus:border-accent">
 <option value="">— Uncategorised —</option>
 {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
 </select>
 </div>
 <div>
 <label className="text-[10px] uppercase text-text-muted">Platform</label>
 <select value={platform} onChange={(e) => setPlatform(e.target.value)}
 className="w-full mt-1 px-3 py-1.5 text-sm bg-bg-tertiary rounded focus:outline-none focus:border-accent">
 <option value="all">All</option>
 <option value="windows">Windows</option>
 <option value="linux">Linux</option>
 <option value="macos">macOS</option>
 <option value="freebsd">FreeBSD</option>
 </select>
 </div>
 <div>
 <label className="text-[10px] uppercase text-text-muted">Runtime</label>
 <select value={runtime} onChange={(e) => setRuntime(e.target.value)}
 className="w-full mt-1 px-3 py-1.5 text-sm bg-bg-tertiary rounded focus:outline-none focus:border-accent">
 <option value="powershell">PowerShell</option>
 <option value="bash">Bash</option>
 <option value="sh">sh</option>
 <option value="cmd">cmd</option>
 <option value="python">Python</option>
 </select>
 </div>
 <div>
 <label className="text-[10px] uppercase text-text-muted">Timeout (s)</label>
 <input type="number" value={timeoutSeconds}
 onChange={(e) => setTimeoutSeconds(parseInt(e.target.value, 10) || 300)}
 className="w-full mt-1 px-3 py-1.5 text-sm bg-bg-tertiary rounded focus:outline-none focus:border-accent" />
 </div>
 <div>
 <label className="text-[10px] uppercase text-text-muted">Expected exit code</label>
 <input type="number" value={expectedExitCode}
 onChange={(e) => setExpectedExitCode(parseInt(e.target.value, 10) || 0)}
 className="w-full mt-1 px-3 py-1.5 text-sm bg-bg-tertiary rounded focus:outline-none focus:border-accent" />
 </div>
 <div>
 <label className="text-[10px] uppercase text-text-muted">Run as</label>
 <select value={runAs} onChange={(e) => setRunAs(e.target.value as 'system' | 'user')}
 className="w-full mt-1 px-3 py-1.5 text-sm bg-bg-tertiary rounded focus:outline-none focus:border-accent">
 <option value="system">System</option>
 <option value="user">User session</option>
 </select>
 </div>
 <div>
 <label className="text-[10px] uppercase text-text-muted">Purpose</label>
 <select value={purpose} onChange={(e) => setPurpose(e.target.value)}
 className="w-full mt-1 px-3 py-1.5 text-sm bg-bg-tertiary rounded focus:outline-none focus:border-accent">
 <option value="execute">Execute</option>
 <option value="check">Check</option>
 <option value="resolve">Resolve</option>
 <option value="compliance">Compliance</option>
 <option value="metric">Metric</option>
 </select>
 </div>
 </div>
 <div>
 <label className="text-[10px] uppercase text-text-muted">Description</label>
 <input value={description} onChange={(e) => setDescription(e.target.value)}
 className="w-full mt-1 px-3 py-1.5 text-sm bg-bg-tertiary rounded focus:outline-none focus:border-accent" />
 </div>
 <div>
 <label className="text-[10px] uppercase text-text-muted">Content *</label>
 <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={14}
 className="w-full mt-1 px-3 py-2 text-xs bg-bg-tertiary rounded font-mono focus:outline-none focus:border-accent resize-none" />
 </div>
 </div>
 <div className="flex items-center justify-end gap-2 px-5 py-3 ">
 <button onClick={onCancel} disabled={saving}
 className="px-3 py-1.5 text-xs text-text-muted hover:text-text-primary disabled:opacity-50">
 Cancel
 </button>
 <button onClick={handleSave} disabled={saving}
 className="px-3 py-1.5 text-xs bg-accent text-white rounded hover:bg-accent/80 disabled:opacity-50">
 {saving ? 'Saving…' : (mode === 'create' ? 'Create script' : 'Save changes')}
 </button>
 </div>
 </div>
 </div>
 );
}

// ── Public wrapper — provides the React Flow context ────────────────────────
export function ScenarioGraphEditor(props: {
 scenarioId: number;
 onClose?: () => void;
 /** Fired when the user flips the activate/disable toggle so a
 * parent list page can re-render the row's status badge without
 * waiting for the user to close the editor and refresh. */
 onStatusChanged?: (next: 'draft' | 'active' | 'disabled') => void;
}) {
 return (
 <ReactFlowProvider>
 <ScenarioGraphEditorInner {...props} />
 </ReactFlowProvider>
 );
}
