import { useState, useEffect, useMemo, useCallback, useRef, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ChevronRight, FolderOpen, Search, PanelLeftClose, PanelLeftOpen, Monitor, FolderX,
  Plus, Pencil, X, Check,
} from 'lucide-react';
import {
  DndContext, PointerSensor, useSensor, useSensors, closestCenter,
  useDraggable, useDroppable,
  type DragEndEvent,
} from '@dnd-kit/core';
import { groupsApi } from '@/api/groups.api';
import { deviceApi } from '@/api/device.api';
import type { DeviceGroupTreeNode } from '@obliance/shared';
import { SocketEvents } from '@obliance/shared';
import { getSocket } from '@/socket/socketClient';
import { clsx } from 'clsx';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { anonymize } from '@/utils/anonymize';

interface GroupSidePanelProps {
  groupId: number | null;
  onGroupChange: (id: number | null) => void;
  className?: string;
}

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
  node, depth, selectedGroupId, onSelect, onEdit,
  expandedIds, toggleExpand, canDnd,
}: {
  node: DeviceGroupTreeNode;
  depth: number;
  selectedGroupId: number | null;
  onSelect: (id: number) => void;
  onEdit: (id: number) => void;
  expandedIds: Set<number>;
  toggleExpand: (id: number) => void;
  canDnd: boolean;
}) {
  const isSelected = node.id === selectedGroupId;
  const hasChildren = node.children.length > 0;
  const isExpanded = expandedIds.has(node.id);
  const isAncestor = hasSelectedDescendant(node, selectedGroupId);
  const count = countDevicesRecursive(node);

  // Drag handle applies to the whole row when DnD is enabled.
  const drag = useDraggable({
    id: `group-${node.id}`,
    data: { type: 'group', groupId: node.id },
    disabled: !canDnd,
  });
  // The row is also a drop target — dropping another group here reparents
  // the dragged one under this node.
  const drop = useDroppable({
    id: `group-target-${node.id}`,
    data: { type: 'group-target', groupId: node.id },
    disabled: !canDnd,
  });

  const rowRef = (el: HTMLElement | null) => {
    drag.setNodeRef(el);
    drop.setNodeRef(el);
  };

  return (
    <>
      <div
        ref={rowRef}
        {...drag.attributes}
        {...drag.listeners}
        className={clsx(
          'group/row flex w-full items-center gap-1.5 rounded-md py-1 pr-1 text-left text-sm transition-colors',
          'hover:bg-accent/5',
          isSelected && 'bg-accent/10 font-medium',
          drag.isDragging && 'opacity-40',
          drop.isOver && !drag.isDragging && 'ring-1 ring-accent/70 bg-accent/10',
          canDnd && 'cursor-grab active:cursor-grabbing',
        )}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
        title={node.name}
      >
        {/* Expand / collapse chevron */}
        <span
          className={clsx('flex h-4 w-4 shrink-0 items-center justify-center', !hasChildren && 'invisible')}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            if (hasChildren) toggleExpand(node.id);
          }}
          role="button"
          tabIndex={-1}
        >
          <ChevronRight
            size={14}
            className={clsx('text-text-muted transition-transform duration-150', isExpanded && 'rotate-90')}
          />
        </span>

        {/* Click-to-select layer — stops pointer before dnd sensor activates
            when it's a short click, since the sensor has a 5 px threshold. */}
        <button
          type="button"
          onClick={() => onSelect(node.id)}
          onPointerDown={(e) => e.stopPropagation()}
          className="flex min-w-0 flex-1 items-center gap-1.5"
        >
          <FolderOpen
            size={15}
            className={clsx('shrink-0', isSelected || isAncestor ? 'text-accent' : 'text-text-muted')}
          />
          <span className="truncate text-text-primary">{anonymize(node.name)}</span>
          <span className="ml-auto shrink-0 text-xs text-text-muted">{count}</span>
        </button>

        {/* Pencil — visible on hover, opens the existing GroupEditPage. */}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onEdit(node.id); }}
          onPointerDown={(e) => e.stopPropagation()}
          className="opacity-0 group-hover/row:opacity-100 transition-opacity shrink-0 p-0.5 rounded text-text-muted hover:text-text-primary hover:bg-bg-tertiary"
          title="Group settings"
        >
          <Pencil size={12} />
        </button>
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
              expandedIds={expandedIds}
              toggleExpand={toggleExpand}
              canDnd={canDnd}
            />
          ))}
        </div>
      )}
    </>
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
      toast.success('Group created');
      onCreated();
      onClose();
    } catch {
      toast.error('Failed to create group');
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
        placeholder="New group name"
        className="w-full rounded-md border border-border bg-bg-secondary py-1 px-2 text-xs text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
      />
      <select
        value={parentId ?? ''}
        onChange={(e) => setParentId(e.target.value === '' ? null : parseInt(e.target.value, 10))}
        className="w-full rounded-md border border-border bg-bg-secondary py-1 px-2 text-xs text-text-primary focus:border-accent focus:outline-none"
      >
        <option value="">(root — no parent)</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>{o.label}</option>
        ))}
      </select>
      <div className="flex items-center justify-end gap-1">
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-bg-secondary"
          title="Cancel (Esc)"
        >
          <X size={14} />
        </button>
        <button
          type="submit"
          disabled={saving || !name.trim()}
          className="p-1 rounded text-green-400 hover:bg-bg-secondary disabled:opacity-40"
          title="Create"
        >
          <Check size={14} />
        </button>
      </div>
    </form>
  );
}

// ── Main panel ───────────────────────────────────────────────────────────────

export function GroupSidePanel({ groupId, onGroupChange, className }: GroupSidePanelProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(getInitialCollapsed);
  const [width, setWidth] = useState<number>(getInitialWidth);
  const [tree, setTree] = useState<DeviceGroupTreeNode[]>([]);
  const [fleet, setFleet] = useState<FleetCounts>({ online: 0, offline: 0, warning: 0, critical: 0, total: 0 });
  const [search, setSearch] = useState('');
  const [expandedIds, setExpandedIds] = useState<Set<number>>(() => getInitialExpanded() ?? new Set());
  const [creating, setCreating] = useState(false);

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

  // ── Drag and drop — reparent only (reorder handled on GroupEditPage) ──
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;
    const draggedId = (active.data.current as any)?.groupId as number | undefined;
    const targetData = over.data.current as any;
    if (typeof draggedId !== 'number') return;

    // Drop on root (= drop zone for "All Devices") → parentId = null
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

    // No-op if already under that parent
    const currentParent = getNodeParentId(tree, draggedId) ?? null;
    if (currentParent === targetParentId) return;

    try {
      await groupsApi.move(draggedId, targetParentId);
      toast.success('Group moved');
      fetchTree();
    } catch {
      toast.error('Failed to move group');
    }
  };

  // ── Drop zone for "root" (dragging onto "All Devices" = make root) ──
  const rootDrop = useDroppable({
    id: 'group-target-root',
    data: { type: 'root-target' },
  });

  // ── Resize handle ───────────────────────────────────────────────────
  const resizing = useRef(false);
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
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
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);
  const startResize = () => {
    resizing.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  // ── Collapsed bar ───────────────────────────────────────────────────
  if (collapsed) {
    return (
      <div
        className={clsx(
          'flex w-10 shrink-0 flex-col items-center border-r border-border bg-bg-secondary pt-3',
          className,
        )}
      >
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className="rounded p-1 text-text-muted hover:bg-accent/10 hover:text-text-primary"
          title={t('groupPanel.expand')}
        >
          <PanelLeftOpen size={18} />
        </button>
      </div>
    );
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <div
        style={{ width: `${width}px` }}
        className={clsx(
          'relative flex shrink-0 flex-col border-r border-border bg-bg-secondary',
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
              className="rounded p-1 text-text-muted hover:bg-accent/10 hover:text-accent"
              title="New group"
            >
              <Plus size={16} />
            </button>
            <button
              type="button"
              onClick={() => setCollapsed(true)}
              className="rounded p-1 text-text-muted hover:bg-accent/10 hover:text-text-primary"
              title={t('groupPanel.collapse')}
            >
              <PanelLeftClose size={16} />
            </button>
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
            <span className="flex items-center gap-1 text-xs text-text-muted">
              <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
              {fleet.online}
            </span>
          )}
          {fleet.offline > 0 && (
            <span className="flex items-center gap-1 text-xs text-text-muted">
              <span className="inline-block h-2 w-2 rounded-full bg-gray-400" />
              {fleet.offline}
            </span>
          )}
          {fleet.warning > 0 && (
            <span className="flex items-center gap-1 text-xs text-text-muted">
              <span className="inline-block h-2 w-2 rounded-full bg-yellow-500" />
              {fleet.warning}
            </span>
          )}
          {fleet.critical > 0 && (
            <span className="flex items-center gap-1 text-xs text-text-muted">
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
              className="w-full rounded-md border border-border bg-bg-secondary py-1 pl-7 pr-2 text-xs text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
            />
          </div>
        </div>

        {/* Tree */}
        <div className="flex-1 overflow-y-auto px-1.5 pb-2">
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
                'hover:bg-accent/5',
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
              'hover:bg-accent/5',
              groupId === -1 && 'bg-accent/10 font-medium',
            )}
            title={t('groupPanel.ungroupedHint', 'Devices that don\'t belong to any group yet')}
          >
            <FolderX size={15} className={clsx('shrink-0', groupId === -1 ? 'text-accent' : 'text-text-muted')} />
            <span className="text-text-primary">{t('groupPanel.ungrouped', 'Ungrouped')}</span>
          </button>

          {/* Group tree — drag any group onto another to reparent. */}
          {filteredTree.map((node) => (
            <TreeNode
              key={node.id}
              node={node}
              depth={0}
              selectedGroupId={groupId}
              onSelect={(id) => onGroupChange(id)}
              onEdit={(id) => navigate(`/group/${id}/edit`)}
              expandedIds={expandedIds}
              toggleExpand={toggleExpand}
              canDnd={!search}
            />
          ))}
        </div>

        {/* Resize handle — thin grab zone on the right edge, cursor changes
            on hover so it's discoverable without being visually noisy. */}
        <div
          onMouseDown={startResize}
          className="absolute top-0 right-0 h-full w-1 cursor-col-resize hover:bg-accent/40"
          title="Drag to resize"
        />
      </div>
    </DndContext>
  );
}
