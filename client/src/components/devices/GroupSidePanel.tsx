import { useState, useEffect, useMemo, useCallback, useRef, createContext, useContext, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ChevronRight, FolderOpen, Search, PanelLeftClose, PanelLeftOpen, Monitor, FolderX,
  Plus, Pencil, X, Check, GripVertical, Building2, FolderInput, Settings2, FolderTree,
} from 'lucide-react';
import {
  DndContext, closestCenter,
  useDraggable, useDroppable,
  type DragEndEvent,
} from '@dnd-kit/core';
import { groupsApi } from '@/api/groups.api';
import { deviceApi } from '@/api/device.api';
import type { DeviceGroupTreeNode } from '@obliance/shared';
import { SocketEvents, isMasterTenant, MASTER_TENANT_ID } from '@obliance/shared';
import { getSocket } from '@/socket/socketClient';
import { useTenantStore } from '@/store/tenantStore';
import { clsx } from 'clsx';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { anonymize } from '@/utils/anonymize';
import { useDndSensors } from '@/hooks/useDndSensors';
import { useCanHover } from '@/hooks/useMediaQuery';
import { ActionMenu } from '@/components/common/ActionMenu';
import { IconButton } from '@/components/common/IconButton';
import { Modal } from '@/components/common/Modal';

interface GroupSidePanelProps {
  groupId: number | null;
  onGroupChange: (id: number | null) => void;
  className?: string;
  /**
   * 'panel' (default): the resizable / collapsible inline column of /devices
   * (desktop with a mouse ≥ lg, any pointer ≥ xl). 'drawer': full-width
   * content of the off-canvas groups drawer used below lg and on touch
   * screens below xl (DevicesPageLayout) — no collapse, no resize, a close
   * button instead (docs/obli-mobile.md §4 / §5.8).
   */
  variant?: 'panel' | 'drawer';
  /** Drawer variant: closes the drawer (header × button). */
  onClose?: () => void;
}

/** True while a group is being dragged — the drop-between zones grow on
 *  touch screens so a finger can hit them. */
const DraggingContext = createContext(false);

interface FleetCounts {
  online: number;
  offline: number;
  warning: number;
  critical: number;
  total: number;
}

const COLLAPSED_KEY = 'obliance:groupPanelCollapsed';
const EXPANDED_KEY  = 'obliance:groupPanelExpanded';
const WIDTH_KEY     = 'obliance:groupPanelWidth';
// Per-tenant collapse state for master view. Persisted as Set<tenantId>
// of tenants that are CURRENTLY collapsed (default = expanded so a fresh
// admin sees the buckets unfolded). Stored apart from EXPANDED_KEY,
// which tracks group expansion.
const TENANT_COLLAPSED_KEY = 'obliance:groupPanelCollapsedTenants';
const DEFAULT_WIDTH = 260;
const MIN_WIDTH = 180;
const MAX_WIDTH = 520;

function getInitialCollapsed(): boolean {
  try { return localStorage.getItem(COLLAPSED_KEY) === 'true'; } catch { return false; }
}
function getInitialExpanded(): Set<number> | null {
  try {
    const raw = localStorage.getItem(EXPANDED_KEY);
    if (!raw) return null;
    return new Set(JSON.parse(raw) as number[]);
  } catch { return null; }
}
function getInitialWidth(): number {
  try {
    const raw = localStorage.getItem(WIDTH_KEY);
    const n = raw ? parseInt(raw, 10) : NaN;
    if (Number.isFinite(n) && n >= MIN_WIDTH && n <= MAX_WIDTH) return n;
  } catch {}
  return DEFAULT_WIDTH;
}
function getInitialCollapsedTenants(): Set<number> {
  try {
    const raw = localStorage.getItem(TENANT_COLLAPSED_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as number[]);
  } catch { return new Set(); }
}

// ── Tree helpers ─────────────────────────────────────────────────────────────

function hasSelectedDescendant(node: DeviceGroupTreeNode, selectedId: number | null): boolean {
  if (selectedId == null) return false;
  if (node.id === selectedId) return true;
  return node.children.some((c) => hasSelectedDescendant(c, selectedId));
}

function filterTree(nodes: DeviceGroupTreeNode[], query: string): DeviceGroupTreeNode[] {
  if (!query) return nodes;
  const lower = query.toLowerCase();
  return nodes.reduce<DeviceGroupTreeNode[]>((acc, node) => {
    const childMatches = filterTree(node.children, query);
    if (node.name.toLowerCase().includes(lower) || childMatches.length > 0) {
      acc.push({ ...node, children: childMatches.length > 0 ? childMatches : node.children.filter((c) => c.name.toLowerCase().includes(lower)) });
    }
    return acc;
  }, []);
}

function countDevicesRecursive(node: DeviceGroupTreeNode): number {
  const self = node.total ?? node.deviceCount ?? 0;
  if (self > 0) return self;
  let total = node.deviceCount ?? 0;
  for (const child of node.children) total += countDevicesRecursive(child);
  return total;
}

function totalDeviceCount(nodes: DeviceGroupTreeNode[]): number {
  return nodes.reduce((sum, n) => sum + countDevicesRecursive(n), 0);
}

function isDescendantOf(nodes: DeviceGroupTreeNode[], ancestorId: number, candidateId: number): boolean {
  const findIn = (ns: DeviceGroupTreeNode[]): boolean => {
    for (const n of ns) {
      if (n.id === candidateId) return true;
      if (findIn(n.children)) return true;
    }
    return false;
  };
  for (const node of nodes) {
    if (node.id === ancestorId) return findIn(node.children);
    if (isDescendantOf(node.children, ancestorId, candidateId)) return true;
  }
  return false;
}

function findNode(nodes: DeviceGroupTreeNode[], id: number): DeviceGroupTreeNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    const found = findNode(n.children, id);
    if (found) return found;
  }
  return null;
}

function getNodeParentId(nodes: DeviceGroupTreeNode[], id: number, parent: number | null = null): number | null | undefined {
  for (const n of nodes) {
    if (n.id === id) return parent;
    const p = getNodeParentId(n.children, id, n.id);
    if (p !== undefined) return p;
  }
  return undefined;
}

// ── Tree node — draggable + droppable together ──────────────────────────────

function TreeNode({
  node, depth, selectedGroupId, onSelect, onEdit, onMove,
  expandedIds, toggleExpand, canDnd,
}: {
  node: DeviceGroupTreeNode;
  depth: number;
  selectedGroupId: number | null;
  onSelect: (id: number) => void;
  onEdit: (id: number) => void;
  /** Opens the "Move to…" picker — the tap alternative to drag-and-drop. */
  onMove: (node: DeviceGroupTreeNode) => void;
  expandedIds: Set<number>;
  toggleExpand: (id: number) => void;
  canDnd: boolean;
}) {
  const { t } = useTranslation();
  const canHover = useCanHover();
  const isSelected = node.id === selectedGroupId;
  const hasChildren = node.children.length > 0;
  const isExpanded = expandedIds.has(node.id);
  const isAncestor = hasSelectedDescendant(node, selectedGroupId);
  const count = countDevicesRecursive(node);

  // Drag is bound ONLY to the explicit grip handle — previously the
  // whole row was draggable, which (a) hid the affordance (no visible
  // grip icon, you had to discover the cursor change) and (b) made
  // accidental drags during click-to-select common. The grip is also
  // why we previously could only re-parent into a group: there was
  // nowhere to drop "between" siblings. The DropBetween zone above
  // each row + the row itself as into-group drop target now cover
  // both reorder AND reparent.
  const drag = useDraggable({
    id: `group-${node.id}`,
    data: { type: 'group', groupId: node.id },
    disabled: !canDnd,
  });
  const drop = useDroppable({
    id: `group-target-${node.id}`,
    data: { type: 'group-target', groupId: node.id },
    disabled: !canDnd,
  });

  return (
    <>
      {/* Drop-between zone — appears between each pair of sibling
          rows. Lets you reorder without entering the parent group AND
          drop a sub-group BACK to root level when its siblings live
          at depth 0. The zone has zero height idle and 8px while a
          drag is active so the layout doesn't shift on hover. */}
      {canDnd && (
        <DropBetween
          parentId={node.parentId ?? null}
          insertBeforeId={node.id}
          depth={depth}
        />
      )}

      <div
        ref={drop.setNodeRef}
        className={clsx(
          'group/row flex w-full items-center gap-1.5 rounded-md py-1 pr-1 text-left text-sm transition-colors',
          'hover:bg-accent/5 coarse:min-h-10',
          isSelected && 'bg-accent/10 font-medium',
          drag.isDragging && 'opacity-40',
          drop.isOver && !drag.isDragging && 'ring-1 ring-accent/70 bg-accent/10',
        )}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
        title={canHover ? node.name : undefined}
      >
        {/* Drag grip — explicit, visible on hover (always visible on touch,
            where it is dragged with a long-press — useDndSensors). dnd-kit
            listeners attach HERE so click-to-select on the rest of the row
            is never confused with a drag. cursor-grab/grabbing convey the
            affordance even before hover. */}
        {canDnd ? (
          <span
            ref={drag.setNodeRef}
            {...drag.attributes}
            {...drag.listeners}
            aria-label={t('groupPanel.dragHint', 'Drag to reorder or move to another group')}
            className={clsx(
              'flex h-4 w-3 shrink-0 items-center justify-center text-text-muted/60 hover:text-text-primary cursor-grab active:cursor-grabbing transition-opacity',
              'can-hover:opacity-0 can-hover:group-hover/row:opacity-100',
              'touch-none select-none [-webkit-touch-callout:none] coarse:h-8 coarse:w-5',
            )}
            title={canHover ? t('groupPanel.dragHint', 'Drag to reorder or move to another group') : undefined}
          >
            <GripVertical size={12} />
          </span>
        ) : (
          <span className="w-3 shrink-0 coarse:w-5" />
        )}

        {/* Expand / collapse chevron — 32px box on touch with an invisible
            40px hit area around it (no extra row width). */}
        <span
          className={clsx(
            'flex h-4 w-4 shrink-0 items-center justify-center coarse:h-8 coarse:w-8 coarse:rounded',
            "relative coarse:after:absolute coarse:after:-inset-1 coarse:after:content-['']",
            !hasChildren && 'invisible',
          )}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            if (hasChildren) toggleExpand(node.id);
          }}
          role="button"
          aria-label={isExpanded ? t('groupPicker.collapse', 'Collapse') : t('groupPicker.expand', 'Expand')}
          aria-expanded={hasChildren ? isExpanded : undefined}
          tabIndex={-1}
        >
          <ChevronRight
            size={14}
            className={clsx('text-text-muted transition-transform duration-150', isExpanded && 'rotate-90')}
          />
        </span>

        <button
          type="button"
          onClick={() => onSelect(node.id)}
          className="flex min-w-0 flex-1 items-center gap-1.5 coarse:self-stretch"
        >
          <FolderOpen
            size={15}
            className={clsx('shrink-0', isSelected || isAncestor ? 'text-accent' : 'text-text-muted')}
          />
          <span className="truncate text-text-primary">{anonymize(node.name)}</span>
          <span className="ml-auto shrink-0 text-xs text-text-muted">{count}</span>
        </button>

        {canHover ? (
          /* Pencil — visible on hover, opens the existing GroupEditPage. */
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onEdit(node.id); }}
            className="can-hover:opacity-0 can-hover:group-hover/row:opacity-100 transition-opacity shrink-0 p-0.5 rounded text-text-muted hover:text-text-primary hover:bg-bg-tertiary"
            title={t('groupPanel.settings', 'Group settings')}
            aria-label={t('groupPanel.settings', 'Group settings')}
          >
            <Pencil size={12} />
          </button>
        ) : (
          /* Touch: no hover to reveal the pencil — a "⋯" row menu holds the
             settings link and "Move to…", the tap path for reparenting
             (drag-and-drop is never the only way — docs §5.3). */
          <ActionMenu
            triggerSize="xs"
            triggerClassName="shrink-0"
            sheetTitle={anonymize(node.name)}
            items={[
              {
                key: 'settings',
                icon: <Settings2 className="w-4 h-4" />,
                label: t('groupPanel.settings', 'Group settings'),
                onClick: () => onEdit(node.id),
              },
              {
                key: 'move',
                icon: <FolderInput className="w-4 h-4" />,
                label: t('groupPanel.moveTo', 'Move to…'),
                onClick: () => onMove(node),
                hidden: !canDnd,
              },
            ]}
          />
        )}
      </div>

      {hasChildren && isExpanded && (
        <div>
          {node.children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedGroupId={selectedGroupId}
              onSelect={onSelect}
              onEdit={onEdit}
              onMove={onMove}
              expandedIds={expandedIds}
              toggleExpand={toggleExpand}
              canDnd={canDnd}
            />
          ))}
          {/* Tail drop-between for the last child slot — lets you drop
              after the last sibling without overshooting onto the
              parent's next row. */}
          {canDnd && (
            <DropBetween parentId={node.id} insertBeforeId={null} depth={depth + 1} />
          )}
        </div>
      )}
    </>
  );
}

// ── Drop-between zone ────────────────────────────────────────────────
//
// 2 px idle bar that sits between two sibling rows. While a drag is
// in flight dnd-kit pumps `isOver` so we expand to a 6 px highlighted
// strip — same visual language as VSCode / Finder reorder. Carries
// the future parent + insertion index in its `data` so the drop
// handler can recompute sortOrder for the parent's child list.
//
// Set `insertBeforeId = null` to mean "insert at the END of this
// parent's children" (used by the tail zone after the last child).
function DropBetween({ parentId, insertBeforeId, depth }: { parentId: number | null; insertBeforeId: number | null; depth: number }) {
  const dragging = useContext(DraggingContext);
  const drop = useDroppable({
    id: `group-between-${parentId ?? 'root'}-${insertBeforeId ?? 'tail'}`,
    data: { type: 'between', parentId, insertBeforeId },
  });
  return (
    <div
      ref={drop.setNodeRef}
      className={clsx(
        'transition-all',
        drop.isOver ? 'h-1.5 my-0.5 bg-accent rounded-full mx-2' : 'h-0.5',
        // Touch: a 2px strip is impossible to hit with a finger — the
        // zones grow while a drag is in flight (mouse layout unchanged).
        dragging && 'coarse:h-3',
      )}
      style={{ marginLeft: `${8 + depth * 16}px` }}
      aria-hidden
    />
  );
}

// ── Create-group mini modal ──────────────────────────────────────────────────

function CreateGroupInline({
  tree, onClose, onCreated,
}: {
  tree: DeviceGroupTreeNode[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  // Flatten the tree for a plain <select>. Cheap and covers most admins
  // who don't need a full tree picker for a new-group form.
  const options = useMemo(() => {
    const out: { id: number; label: string }[] = [];
    const walk = (nodes: DeviceGroupTreeNode[], depth: number) => {
      for (const n of nodes) {
        out.push({ id: n.id, label: `${'— '.repeat(depth)}${n.name}` });
        walk(n.children, depth + 1);
      }
    };
    walk(tree, 0);
    return out;
  }, [tree]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      await groupsApi.create({ name: trimmed, parentId });
      toast.success(t('groups.created', 'Group created'));
      onCreated();
      onClose();
    } catch {
      toast.error(t('groups.failedCreate', 'Failed to create group'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="border-b border-border bg-bg-tertiary/40 px-3 py-2 space-y-2">
      <input
        autoFocus
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
        placeholder={t('groupPanel.newGroupName', 'New group name')}
        className="w-full rounded-md border border-border bg-bg-secondary py-1 px-2 text-xs text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
      />
      <select
        value={parentId ?? ''}
        onChange={(e) => setParentId(e.target.value === '' ? null : parseInt(e.target.value, 10))}
        className="w-full rounded-md border border-border bg-bg-secondary py-1 px-2 text-xs text-text-primary focus:border-accent focus:outline-none"
      >
        <option value="">{t('groupPanel.rootNoParent', '(root — no parent)')}</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>{o.label}</option>
        ))}
      </select>
      {/* Touch: the icon-only Cancel / Create buttons get a visible label
          and a 40px height (their meaning was only in title=). */}
      <div className="flex items-center justify-end gap-1 coarse:gap-2">
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-bg-secondary coarse:inline-flex coarse:items-center coarse:gap-1.5 coarse:min-h-10 coarse:px-3"
          title={t('groupPanel.cancelEsc', 'Cancel (Esc)')}
          aria-label={t('common.cancel', 'Cancel')}
        >
          <X size={14} />
          <span className="hidden coarse:inline text-sm">{t('common.cancel', 'Cancel')}</span>
        </button>
        <button
          type="submit"
          disabled={saving || !name.trim()}
          className="p-1 rounded text-green-400 hover:bg-bg-secondary disabled:opacity-40 coarse:inline-flex coarse:items-center coarse:gap-1.5 coarse:min-h-10 coarse:px-3"
          title={t('common.create', 'Create')}
          aria-label={t('common.create', 'Create')}
        >
          <Check size={14} />
          <span className="hidden coarse:inline text-sm">{t('common.create', 'Create')}</span>
        </button>
      </div>
    </form>
  );
}

// ── Main panel ───────────────────────────────────────────────────────────────

export function GroupSidePanel({ groupId, onGroupChange, className, variant = 'panel', onClose }: GroupSidePanelProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const isDrawer = variant === 'drawer';
  // Group being reparented through the "Move to…" picker (tap path).
  const [moveTarget, setMoveTarget] = useState<DeviceGroupTreeNode | null>(null);
  // True while a group is dragged (drop zones grow on touch).
  const [dragging, setDragging] = useState(false);
  const [collapsed, setCollapsed] = useState(getInitialCollapsed);
  const [width, setWidth] = useState<number>(getInitialWidth);
  const [tree, setTree] = useState<DeviceGroupTreeNode[]>([]);
  const [fleet, setFleet] = useState<FleetCounts>({ online: 0, offline: 0, warning: 0, critical: 0, total: 0 });
  const [search, setSearch] = useState('');
  const [expandedIds, setExpandedIds] = useState<Set<number>>(() => getInitialExpanded() ?? new Set());
  const [creating, setCreating] = useState(false);
  const [collapsedTenants, setCollapsedTenants] = useState<Set<number>>(getInitialCollapsedTenants);
  const currentTenantId = useTenantStore((s) => s.currentTenantId);
  const allTenants = useTenantStore((s) => s.tenants);
  const isMaster = isMasterTenant(currentTenantId);

  // ── Persistence ─────────────────────────────────────────────────────
  useEffect(() => {
    try { localStorage.setItem(EXPANDED_KEY, JSON.stringify([...expandedIds])); } catch {}
  }, [expandedIds]);
  useEffect(() => {
    try { localStorage.setItem(COLLAPSED_KEY, String(collapsed)); } catch {}
  }, [collapsed]);
  useEffect(() => {
    try { localStorage.setItem(WIDTH_KEY, String(width)); } catch {}
  }, [width]);
  useEffect(() => {
    try { localStorage.setItem(TENANT_COLLAPSED_KEY, JSON.stringify([...collapsedTenants])); } catch {}
  }, [collapsedTenants]);
  const toggleTenantCollapsed = useCallback((tenantId: number) => {
    setCollapsedTenants((prev) => {
      const next = new Set(prev);
      if (next.has(tenantId)) next.delete(tenantId); else next.add(tenantId);
      return next;
    });
  }, []);

  // ── Data fetching ───────────────────────────────────────────────────
  const fetchTree = useCallback(async () => {
    try {
      const data = await groupsApi.tree();
      setTree(data);
      setExpandedIds((prev) => {
        const stored = getInitialExpanded();
        if (stored !== null) return prev;
        if (prev.size === 0) return new Set(data.map((n) => n.id));
        return prev;
      });
    } catch { /* silent */ }
  }, []);
  const fetchSummary = useCallback(async () => {
    try {
      const s = await deviceApi.getSummary();
      setFleet({ online: s.online, offline: s.offline, warning: s.warning, critical: s.critical, total: s.total });
    } catch { /* silent */ }
  }, []);
  useEffect(() => { fetchTree(); fetchSummary(); }, [fetchTree, fetchSummary]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const handler = () => { fetchTree(); };
    socket.on(SocketEvents.GROUP_CREATED, handler);
    socket.on(SocketEvents.GROUP_UPDATED, handler);
    socket.on(SocketEvents.GROUP_DELETED, handler);
    socket.on(SocketEvents.GROUP_MOVED, handler);
    return () => {
      socket.off(SocketEvents.GROUP_CREATED, handler);
      socket.off(SocketEvents.GROUP_UPDATED, handler);
      socket.off(SocketEvents.GROUP_DELETED, handler);
      socket.off(SocketEvents.GROUP_MOVED, handler);
    };
  }, [fetchTree]);

  const toggleExpand = useCallback((id: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const filteredTree = useMemo(() => filterTree(tree, search), [tree, search]);
  const treeTotal = useMemo(() => totalDeviceCount(tree), [tree]);
  const total = fleet.total > 0 ? fleet.total : treeTotal;

  // On master tenant, bucket the visible tree by tenant so an admin
  // sees one collapsible header per tenant instead of N "DC" / N "Caisses"
  // groups merged into a flat list. Master tenant comes first, the rest
  // alpha-sorted. `tenantId` lives on every group row (DeviceGroup), and
  // the master GET /groups/tree response already attaches `tenantName`.
  const tenantBuckets = useMemo(() => {
    if (!isMaster) return null;
    const byTenant = new Map<number, { tenantName: string; nodes: DeviceGroupTreeNode[] }>();
    for (const node of filteredTree) {
      const tid = node.tenantId;
      const tname =
        node.tenantName
        ?? allTenants.find((t) => t.id === tid)?.name
        ?? `Tenant ${tid}`;
      if (!byTenant.has(tid)) byTenant.set(tid, { tenantName: tname, nodes: [] });
      byTenant.get(tid)!.nodes.push(node);
    }
    // Make sure tenants without any group still show up as empty buckets
    // (otherwise a fresh tenant would be invisible from the sidebar until
    // its first group is created).
    for (const t of allTenants) {
      if (!byTenant.has(t.id)) byTenant.set(t.id, { tenantName: t.name, nodes: [] });
    }
    return [...byTenant.entries()].sort(([aId, a], [bId, b]) => {
      if (aId === MASTER_TENANT_ID) return -1;
      if (bId === MASTER_TENANT_ID) return 1;
      return a.tenantName.localeCompare(b.tenantName);
    });
  }, [filteredTree, isMaster, allTenants]);

  // ── Drag and drop — reparent only (reorder handled on GroupEditPage) ──
  // Mouse (5px, as before) + touch (long-press) + keyboard — docs §5.3.
  const sensors = useDndSensors();

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;
    const draggedId = (active.data.current as any)?.groupId as number | undefined;
    const targetData = over.data.current as any;
    if (typeof draggedId !== 'number') return;

    // Three drop kinds: 'root-target' / 'group-target' (re-parent only),
    // 'between' (reorder OR re-parent + insert at a precise sibling
    // position). The latter is what makes the sidebar feel like a real
    // tree editor — you drop in the gap between two siblings and the
    // group lands there in sort order.
    if (targetData?.type === 'between') {
      const newParent: number | null = (targetData.parentId ?? null) as number | null;
      const insertBeforeId: number | null = (targetData.insertBeforeId ?? null) as number | null;
      // Reject moving a group into its own subtree.
      if (newParent !== null && (newParent === draggedId || isDescendantOf(tree, draggedId, newParent))) return;

      // Compute the target sibling list (sans the dragged group) and the
      // insertion index. `insertBeforeId === null` → tail-append.
      const siblings = newParent === null ? tree : findNode(tree, newParent)?.children ?? [];
      const ordered = siblings.filter((s) => s.id !== draggedId).map((s) => s.id);
      const insertIdx = insertBeforeId === null
        ? ordered.length
        : Math.max(0, ordered.indexOf(insertBeforeId));
      ordered.splice(insertIdx, 0, draggedId);

      try {
        const currentParent = getNodeParentId(tree, draggedId) ?? null;
        if (currentParent !== newParent) {
          await groupsApi.move(draggedId, newParent);
        }
        // Reorder is per-tenant and only respects same-parent rows, so
        // we always send the full target sibling list.
        await groupsApi.reorder(ordered.map((id, idx) => ({ id, sortOrder: idx })));
        toast.success(t('groups.moved', 'Group moved'));
        fetchTree();
      } catch {
        toast.error(t('groups.failedMove', 'Failed to move group'));
      }
      return;
    }

    let targetParentId: number | null;
    if (targetData?.type === 'root-target') {
      targetParentId = null;
    } else if (targetData?.type === 'group-target') {
      targetParentId = targetData.groupId as number;
      if (targetParentId === draggedId) return;
      if (isDescendantOf(tree, draggedId, targetParentId)) return;
    } else {
      return;
    }

    const currentParent = getNodeParentId(tree, draggedId) ?? null;
    if (currentParent === targetParentId) return;

    try {
      await groupsApi.move(draggedId, targetParentId);
      toast.success(t('groups.moved', 'Group moved'));
      fetchTree();
    } catch {
      toast.error(t('groups.failedMove', 'Failed to move group'));
    }
  };

  // Tap alternative to drag-and-drop ("Move to…" in the touch row menu).
  const moveGroupTo = async (draggedId: number, newParent: number | null) => {
    const currentParent = getNodeParentId(tree, draggedId) ?? null;
    if (currentParent === newParent) { setMoveTarget(null); return; }
    if (newParent !== null && (newParent === draggedId || isDescendantOf(tree, draggedId, newParent))) return;
    try {
      await groupsApi.move(draggedId, newParent);
      toast.success(t('groups.moved', 'Group moved'));
      setMoveTarget(null);
      fetchTree();
    } catch {
      toast.error(t('groups.failedMove', 'Failed to move group'));
    }
  };

  // ── Drop zone for "root" (dragging onto "All Devices" = make root) ──
  const rootDrop = useDroppable({
    id: 'group-target-root',
    data: { type: 'root-target' },
  });

  // ── Resize handle ───────────────────────────────────────────────────
  const resizing = useRef(false);
  // Pointer events (not mouse events) so the handle also works with a pen
  // or a finger on a touch laptop / large tablet (≥ lg).
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!resizing.current) return;
      const next = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, e.clientX));
      setWidth(next);
    };
    const onUp = () => {
      if (resizing.current) {
        resizing.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, []);
  const startResize = () => {
    resizing.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  // ── Collapsed bar (inline panel only — the drawer is never collapsed) ─
  if (collapsed && !isDrawer) {
    return (
      <div
        className={clsx(
          'flex h-full w-10 shrink-0 flex-col items-center border-r border-border bg-bg-secondary pt-3',
          className,
        )}
      >
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className="rounded p-1 text-text-muted hover:bg-accent/10 hover:text-text-primary coarse:min-h-10 coarse:min-w-10"
          title={t('groupPanel.expand')}
          aria-label={t('groupPanel.expand')}
        >
          <PanelLeftOpen size={18} />
        </button>
      </div>
    );
  }

  const renderTreeNode = (node: DeviceGroupTreeNode, depth: number) => (
    <TreeNode
      key={node.id}
      node={node}
      depth={depth}
      selectedGroupId={groupId}
      onSelect={(id) => onGroupChange(id)}
      onEdit={(id) => navigate(`/group/${id}/edit`)}
      onMove={setMoveTarget}
      expandedIds={expandedIds}
      toggleExpand={toggleExpand}
      canDnd={!search}
    />
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={() => setDragging(true)}
      onDragCancel={() => setDragging(false)}
      onDragEnd={(e) => { setDragging(false); void handleDragEnd(e); }}
    >
      <DraggingContext.Provider value={dragging}>
      <div
        style={isDrawer ? undefined : { width: `${width}px` }}
        className={clsx(
          // h-full so the panel always spans the parent's full height
          // (the page layout). Without it, the flex column would shrink
          // to its content's height while the tree is still loading,
          // and "snap" to full height after the API call resolved —
          // visually the sidebar would briefly look like a short box.
          isDrawer
            ? 'relative flex h-full w-full flex-col bg-bg-secondary'
            : 'relative flex h-full shrink-0 flex-col border-r border-border bg-bg-secondary',
          className,
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
          <h3 className="text-sm font-semibold text-text-primary">{t('groupPanel.title')}</h3>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setCreating((v) => !v)}
              className="rounded p-1 text-text-muted hover:bg-accent/10 hover:text-accent coarse:min-h-10 coarse:min-w-10 coarse:inline-flex coarse:items-center coarse:justify-center"
              title={t('groups.new', 'New group')}
              aria-label={t('groups.new', 'New group')}
            >
              <Plus size={16} />
            </button>
            {isDrawer ? (
              <IconButton
                label={t('common.close', 'Close')}
                icon={<X size={16} />}
                size="sm"
                variant="plain"
                onClick={onClose}
              />
            ) : (
              <button
                type="button"
                onClick={() => setCollapsed(true)}
                className="rounded p-1 text-text-muted hover:bg-accent/10 hover:text-text-primary coarse:min-h-10 coarse:min-w-10 coarse:inline-flex coarse:items-center coarse:justify-center"
                title={t('groupPanel.collapse')}
                aria-label={t('groupPanel.collapse')}
              >
                <PanelLeftClose size={16} />
              </button>
            )}
          </div>
        </div>

        {/* Create form (inline) */}
        {creating && (
          <CreateGroupInline
            tree={tree}
            onClose={() => setCreating(false)}
            onCreated={fetchTree}
          />
        )}

        {/* Fleet summary bar */}
        <div className="flex items-center gap-3 border-b border-border px-3 py-2">
          {fleet.online > 0 && (
            <span className="flex items-center gap-1 text-xs text-text-muted" aria-label={`${t('deviceStatus.online')}: ${fleet.online}`}>
              <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
              {fleet.online}
            </span>
          )}
          {fleet.offline > 0 && (
            <span className="flex items-center gap-1 text-xs text-text-muted" aria-label={`${t('deviceStatus.offline')}: ${fleet.offline}`}>
              <span className="inline-block h-2 w-2 rounded-full bg-gray-400" />
              {fleet.offline}
            </span>
          )}
          {fleet.warning > 0 && (
            <span className="flex items-center gap-1 text-xs text-text-muted" aria-label={`${t('deviceStatus.warning')}: ${fleet.warning}`}>
              <span className="inline-block h-2 w-2 rounded-full bg-yellow-500" />
              {fleet.warning}
            </span>
          )}
          {fleet.critical > 0 && (
            <span className="flex items-center gap-1 text-xs text-text-muted" aria-label={`${t('deviceStatus.critical')}: ${fleet.critical}`}>
              <span className="inline-block h-2 w-2 rounded-full bg-red-500" />
              {fleet.critical}
            </span>
          )}
        </div>

        {/* Search */}
        <div className="px-3 py-2">
          <div className="relative">
            <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('groupPanel.filterPlaceholder')}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              className="w-full rounded-md border border-border bg-bg-secondary py-1 pl-7 pr-2 text-xs text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none coarse:py-2"
            />
          </div>
        </div>

        {/* Tree */}
        <div className="flex-1 overflow-y-auto overscroll-contain px-1.5 pb-2">
          {/* All Devices — doubles as a drop target for "promote to root". */}
          <div
            ref={rootDrop.setNodeRef}
            className={clsx(
              rootDrop.isOver && 'ring-1 ring-accent/70 rounded-md',
            )}
          >
            <button
              type="button"
              onClick={() => onGroupChange(null)}
              className={clsx(
                'flex w-full items-center gap-1.5 rounded-md py-1 pl-2 pr-2 text-left text-sm transition-colors',
                'hover:bg-accent/5 coarse:min-h-10',
                groupId === null && 'bg-accent/10 font-medium',
              )}
            >
              <Monitor size={15} className={clsx('shrink-0', groupId === null ? 'text-accent' : 'text-text-muted')} />
              <span className="text-text-primary">{t('groupPanel.allDevices')}</span>
              <span className="ml-auto text-xs text-text-muted">{total}</span>
            </button>
          </div>

          {/* Ungrouped */}
          <button
            type="button"
            onClick={() => onGroupChange(-1)}
            className={clsx(
              'flex w-full items-center gap-1.5 rounded-md py-1 pl-2 pr-2 text-left text-sm transition-colors',
              'hover:bg-accent/5 coarse:min-h-10',
              groupId === -1 && 'bg-accent/10 font-medium',
            )}
            title={t('groupPanel.ungroupedHint', 'Devices that don\'t belong to any group yet')}
          >
            <FolderX size={15} className={clsx('shrink-0', groupId === -1 ? 'text-accent' : 'text-text-muted')} />
            <span className="text-text-primary">{t('groupPanel.ungrouped', 'Ungrouped')}</span>
          </button>

          {/* Group tree — drag any group onto another to reparent.
              On master tenant we wrap each tenant's groups in its own
              collapsible bucket so an admin doesn't see N "DC" entries
              merged into a flat list when every child tenant has the
              same group naming convention. */}
          {tenantBuckets ? (
            tenantBuckets.map(([tid, { tenantName, nodes }]) => {
              const tenantCollapsed = collapsedTenants.has(tid);
              const tenantTotal = nodes.reduce((s, n) => s + countDevicesRecursive(n), 0);
              return (
                <div key={tid} className="mt-1">
                  <button
                    type="button"
                    onClick={() => toggleTenantCollapsed(tid)}
                    className="group/tenant flex w-full items-center gap-1.5 rounded-md py-1 pl-1 pr-2 text-left text-xs uppercase tracking-wide font-semibold transition-colors hover:bg-accent/5 coarse:min-h-10"
                    title={tenantName}
                    aria-expanded={!tenantCollapsed}
                  >
                    <ChevronRight
                      size={14}
                      className={clsx(
                        'shrink-0 text-text-muted transition-transform duration-150',
                        !tenantCollapsed && 'rotate-90',
                      )}
                    />
                    <Building2 size={13} className="shrink-0 text-accent" />
                    <span className="truncate text-accent">{anonymize(tenantName)}</span>
                    <span className="ml-auto text-[10px] text-text-muted">{tenantTotal}</span>
                  </button>
                  {!tenantCollapsed && (
                    nodes.length === 0 ? (
                      <div className="pl-7 py-0.5 text-[11px] italic text-text-muted">
                        {t('groupPanel.tenantEmpty', 'No groups yet')}
                      </div>
                    ) : (
                      nodes.map((node) => renderTreeNode(node, 1))
                    )
                  )}
                </div>
              );
            })
          ) : (
            filteredTree.map((node) => renderTreeNode(node, 0))
          )}
        </div>

        {/* Resize handle — thin grab zone on the right edge, cursor changes
            on hover so it's discoverable without being visually noisy.
            Pointer events + touch-none so a pen / finger can drag it too
            (wider invisible grab zone on touch). Not in the drawer. */}
        {!isDrawer && (
          <div
            onPointerDown={(e) => { e.preventDefault(); startResize(); }}
            className="absolute top-0 right-0 h-full w-1 cursor-col-resize hover:bg-accent/40 touch-none coarse:w-3 coarse:-right-1"
            title={t('groupPanel.dragToResize', 'Drag to resize')}
            aria-hidden
          />
        )}
      </div>
      </DraggingContext.Provider>

      <MoveGroupModal
        group={moveTarget}
        tree={tree}
        onClose={() => setMoveTarget(null)}
        onPick={(parentId) => { if (moveTarget) void moveGroupTo(moveTarget.id, parentId); }}
      />
    </DndContext>
  );
}

// ── "Move to…" picker (tap alternative to drag-and-drop) ──────────────────────
//
// Lists every valid new parent for `group`: the root level plus every group
// of the same tenant except the group itself and its own descendants.

function MoveGroupModal({
  group, tree, onClose, onPick,
}: {
  group: DeviceGroupTreeNode | null;
  tree: DeviceGroupTreeNode[];
  onClose: () => void;
  onPick: (parentId: number | null) => void;
}) {
  const { t } = useTranslation();
  const options = useMemo(() => {
    if (!group) return [];
    const out: { id: number; name: string; depth: number }[] = [];
    const walk = (nodes: DeviceGroupTreeNode[], depth: number) => {
      for (const n of nodes) {
        if (n.id === group.id) continue; // skip itself + its whole subtree
        if (n.tenantId !== group.tenantId) continue; // never across tenants
        out.push({ id: n.id, name: n.name, depth });
        walk(n.children, depth + 1);
      }
    };
    walk(tree, 0);
    return out;
  }, [group, tree]);
  const currentParent = group?.parentId ?? null;

  const rowCls = (active: boolean) => clsx(
    'flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors min-h-10',
    active ? 'bg-accent/10 text-accent font-medium' : 'text-text-primary hover:bg-bg-tertiary',
  );

  return (
    <Modal
      open={group != null}
      onClose={onClose}
      size="sm"
      phoneLayout="sheet"
      icon={<FolderInput className="w-4 h-4 text-accent" />}
      title={group ? t('groupPanel.moveTitle', 'Move "{{name}}" to…', { name: anonymize(group.name) }) : ''}
      bodyClassName="px-2 py-2"
    >
      <button type="button" className={rowCls(currentParent === null)} onClick={() => onPick(null)}>
        <FolderTree size={15} className="shrink-0 text-text-muted" />
        <span className="truncate">{t('groupPanel.rootLevel', 'Root level (no parent)')}</span>
      </button>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          className={rowCls(currentParent === o.id)}
          style={{ paddingLeft: `${8 + o.depth * 14}px` }}
          onClick={() => onPick(o.id)}
        >
          <FolderOpen size={15} className="shrink-0 text-text-muted" />
          <span className="truncate">{anonymize(o.name)}</span>
        </button>
      ))}
    </Modal>
  );
}

