import { useNavigate, useLocation } from 'react-router-dom';
import { ChevronRight, Folder, FolderOpen } from 'lucide-react';
import { useDroppable } from '@dnd-kit/core';
import type { DeviceGroupTreeNode } from '@obliance/shared';
import { cn } from '@/utils/cn';
import { useGroupStore } from '@/store/groupStore';

interface GroupNodeProps {
  node: DeviceGroupTreeNode;
  depth?: number;
  selectedGroupId?: number | null;
  onSelectGroup?: (groupId: number | null) => void;
  dndEnabled?: boolean;
  searchQuery?: string;
}

export function GroupNode({
  node,
  depth = 0,
  selectedGroupId,
  onSelectGroup,
  dndEnabled = false,
  searchQuery = '',
}: GroupNodeProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { isGroupExpanded, toggleGroupExpanded } = useGroupStore();
  const expanded = isGroupExpanded(node.id);

  const isSearching = searchQuery.length > 0;

  const hasMatchingInSubtree = (n: DeviceGroupTreeNode): boolean => {
    if (n.name.toLowerCase().includes(searchQuery.toLowerCase())) return true;
    return n.children.some(hasMatchingInSubtree);
  };

  const visibleChildren = isSearching
    ? node.children.filter(hasMatchingInSubtree)
    : node.children;

  const effectiveExpanded = isSearching ? true : expanded;
  const hasContent = node.children.length > 0;
  const isSelected = selectedGroupId === node.id;

  const onlineCount = node.onlineCount ?? 0;
  const offlineCount = node.offlineCount ?? 0;
  const total = node.total ?? 0;

  const { setNodeRef, isOver } = useDroppable({
    id: `drop-group-${node.id}`,
    data: { groupId: node.id },
    disabled: !dndEnabled,
  });

  return (
    <div
      ref={dndEnabled ? setNodeRef : undefined}
      className={cn(
        'transition-colors rounded-md',
        isOver && 'bg-accent/10 ring-1 ring-accent/30',
      )}
    >
      {(() => {
        const isActive = location.pathname === `/group/${node.id}`;
        return (
          <div
            className={cn(
              'flex w-full items-center gap-1.5 rounded-md text-sm transition-colors',
              isActive || isSelected
                ? 'bg-bg-active text-text-primary'
                : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary',
            )}
            style={{ paddingLeft: `${depth * 16 + 8}px` }}
          >
            {/* Chevron + folder icon */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (hasContent) toggleGroupExpanded(node.id);
                onSelectGroup?.(isSelected ? null : node.id);
              }}
              className="flex items-center gap-1 shrink-0 py-1.5 pr-0.5"
            >
              {hasContent ? (
                <ChevronRight
                  size={14}
                  className={cn('shrink-0 transition-transform', effectiveExpanded && 'rotate-90')}
                />
              ) : (
                <span className="w-3.5 shrink-0" />
              )}
              {effectiveExpanded && hasContent ? (
                <FolderOpen size={14} className="shrink-0 text-accent" />
              ) : (
                <Folder size={14} className="shrink-0 text-accent" />
              )}
            </button>

            {/* Name + device counts */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                navigate(`/group/${node.id}`);
              }}
              className="flex items-center gap-1.5 flex-1 min-w-0 py-1.5 pr-2"
            >
              <span className="truncate flex-1 text-left">{node.name}</span>

              {total > 0 && (
                <span className="shrink-0 text-xs text-text-muted flex items-center gap-0.5">
                  {offlineCount > 0 ? (
                    <span className="text-status-down">{offlineCount}</span>
                  ) : (
                    <span className="text-status-up">{onlineCount}</span>
                  )}
                  <span className="text-text-muted opacity-60">/{total}</span>
                </span>
              )}
            </button>
          </div>
        );
      })()}

      {/* Children */}
      {effectiveExpanded && visibleChildren.length > 0 && (
        <div>
          {visibleChildren.map((child) => (
            <GroupNode
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedGroupId={selectedGroupId}
              onSelectGroup={onSelectGroup}
              dndEnabled={dndEnabled}
              searchQuery={searchQuery}
            />
          ))}
        </div>
      )}
    </div>
  );
}
