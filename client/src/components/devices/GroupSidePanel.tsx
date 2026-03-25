import { useState, useEffect, useMemo, useCallback } from 'react';
import { ChevronRight, FolderOpen, Search, PanelLeftClose, PanelLeftOpen, Monitor } from 'lucide-react';
import { groupsApi } from '@/api/groups.api';
import { deviceApi } from '@/api/device.api';
import type { DeviceGroupTreeNode } from '@obliance/shared';
import { SocketEvents } from '@obliance/shared';
import { getSocket } from '@/socket/socketClient';
import { clsx } from 'clsx';

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

const STORAGE_KEY = 'obliance:groupPanelCollapsed';

function getInitialCollapsed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

/** Check if a node or any descendant matches the given group id */
function hasSelectedDescendant(node: DeviceGroupTreeNode, selectedId: number | null): boolean {
  if (selectedId == null) return false;
  if (node.id === selectedId) return true;
  return node.children.some((c) => hasSelectedDescendant(c, selectedId));
}

/** Filter tree nodes by search query (keeps parents whose children match) */
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

/** Compute total device count across all root nodes */
function totalDeviceCount(nodes: DeviceGroupTreeNode[]): number {
  return nodes.reduce((sum, n) => sum + (n.deviceCount ?? n.total ?? 0), 0);
}

function TreeNode({
  node,
  depth,
  selectedGroupId,
  onSelect,
  expandedIds,
  toggleExpand,
}: {
  node: DeviceGroupTreeNode;
  depth: number;
  selectedGroupId: number | null;
  onSelect: (id: number) => void;
  expandedIds: Set<number>;
  toggleExpand: (id: number) => void;
}) {
  const isSelected = node.id === selectedGroupId;
  const hasChildren = node.children.length > 0;
  const isExpanded = expandedIds.has(node.id);
  const isAncestor = hasSelectedDescendant(node, selectedGroupId);
  const count = node.deviceCount ?? node.total ?? 0;

  return (
    <>
      <button
        type="button"
        onClick={() => onSelect(node.id)}
        className={clsx(
          'flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left text-sm transition-colors',
          'hover:bg-accent/5',
          isSelected && 'bg-accent/10 font-medium',
        )}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
        title={node.name}
      >
        {/* Expand / collapse chevron */}
        <span
          className={clsx('flex h-4 w-4 shrink-0 items-center justify-center', !hasChildren && 'invisible')}
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

        <FolderOpen
          size={15}
          className={clsx('shrink-0', isSelected || isAncestor ? 'text-accent' : 'text-text-muted')}
        />

        <span className="truncate text-text-primary">{node.name}</span>

        <span className="ml-auto shrink-0 text-xs text-text-muted">{count}</span>
      </button>

      {hasChildren && isExpanded && (
        <div>
          {node.children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedGroupId={selectedGroupId}
              onSelect={onSelect}
              expandedIds={expandedIds}
              toggleExpand={toggleExpand}
            />
          ))}
        </div>
      )}
    </>
  );
}

/** Collect all node ids from a tree (for auto-expand) */
function collectIds(nodes: DeviceGroupTreeNode[]): number[] {
  const ids: number[] = [];
  for (const n of nodes) {
    ids.push(n.id);
    if (n.children.length > 0) ids.push(...collectIds(n.children));
  }
  return ids;
}

export function GroupSidePanel({ groupId, onGroupChange, className }: GroupSidePanelProps) {
  const [collapsed, setCollapsed] = useState(getInitialCollapsed);
  const [tree, setTree] = useState<DeviceGroupTreeNode[]>([]);
  const [fleet, setFleet] = useState<FleetCounts>({ online: 0, offline: 0, warning: 0, critical: 0, total: 0 });
  const [search, setSearch] = useState('');
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

  // Persist collapsed state
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(collapsed));
    } catch { /* noop */ }
  }, [collapsed]);

  // Fetch tree
  const fetchTree = useCallback(async () => {
    try {
      const data = await groupsApi.tree();
      setTree(data);
      // Auto-expand all on first load
      setExpandedIds((prev) => {
        if (prev.size === 0) return new Set(collectIds(data));
        return prev;
      });
    } catch { /* silent */ }
  }, []);

  // Fetch fleet summary
  const fetchSummary = useCallback(async () => {
    try {
      const s = await deviceApi.getSummary();
      setFleet({ online: s.online, offline: s.offline, warning: s.warning, critical: s.critical, total: s.total });
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    fetchTree();
    fetchSummary();
  }, [fetchTree, fetchSummary]);

  // Socket events for group changes
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
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const filteredTree = useMemo(() => filterTree(tree, search), [tree, search]);
  const total = useMemo(() => totalDeviceCount(tree), [tree]);

  // Collapsed state: thin vertical bar
  if (collapsed) {
    return (
      <div
        className={clsx(
          'flex w-10 shrink-0 flex-col items-center border-r border-border bg-bg-secondary pt-3 transition-all duration-200',
          className,
        )}
      >
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className="rounded p-1 text-text-muted hover:bg-accent/10 hover:text-text-primary"
          title="Expand groups panel"
        >
          <PanelLeftOpen size={18} />
        </button>
      </div>
    );
  }

  return (
    <div
      className={clsx(
        'flex w-[260px] shrink-0 flex-col border-r border-border bg-bg-secondary transition-all duration-200',
        className,
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
        <h3 className="text-sm font-semibold text-text-primary">Groups</h3>
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          className="rounded p-1 text-text-muted hover:bg-accent/10 hover:text-text-primary"
          title="Collapse groups panel"
        >
          <PanelLeftClose size={16} />
        </button>
      </div>

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
            placeholder="Filter groups..."
            className="w-full rounded-md border border-border bg-bg-secondary py-1 pl-7 pr-2 text-xs text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
          />
        </div>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto px-1.5 pb-2">
        {/* All Devices */}
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
          <span className="text-text-primary">All Devices</span>
          <span className="ml-auto text-xs text-text-muted">{total}</span>
        </button>

        {/* Group tree */}
        {filteredTree.map((node) => (
          <TreeNode
            key={node.id}
            node={node}
            depth={0}
            selectedGroupId={groupId}
            onSelect={(id) => onGroupChange(id)}
            expandedIds={expandedIds}
            toggleExpand={toggleExpand}
          />
        ))}
      </div>
    </div>
  );
}
