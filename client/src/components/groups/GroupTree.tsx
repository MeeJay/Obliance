import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useGroupStore } from '@/store/groupStore';
import { GroupNode } from './GroupNode';

interface GroupTreeProps {
  selectedGroupId?: number | null;
  onSelectGroup?: (groupId: number | null) => void;
  searchQuery?: string;
}

/**
 * Renders the full device-group tree, backed by groupStore.
 * Used in group management / picker contexts.
 * (The Sidebar has its own inline tree implementation.)
 */
export function GroupTree({
  selectedGroupId,
  onSelectGroup,
  searchQuery = '',
}: GroupTreeProps) {
  const { tree, fetchTree, expandAncestors } = useGroupStore();
  const location = useLocation();

  useEffect(() => {
    fetchTree();
  }, [fetchTree]);

  // Auto-expand ancestors when navigating to a group detail page
  useEffect(() => {
    const match = location.pathname.match(/^\/group\/(\d+)$/);
    if (match) {
      const groupId = Number(match[1]);
      expandAncestors(groupId);
    }
  }, [location.pathname, expandAncestors]);

  // Filter root nodes when searching
  const hasMatchingInSubtree = (n: import('@obliance/shared').DeviceGroupTreeNode): boolean => {
    if (n.name.toLowerCase().includes(searchQuery.toLowerCase())) return true;
    return n.children.some(hasMatchingInSubtree);
  };

  const visibleTree = searchQuery ? tree.filter(hasMatchingInSubtree) : tree;

  if (visibleTree.length === 0) {
    return (
      <div className="py-4 text-center text-sm text-text-muted">
        {searchQuery ? 'No matching groups' : 'No groups yet'}
      </div>
    );
  }

  return (
    <div className="space-y-0.5">
      {visibleTree.map((node) => (
        <GroupNode
          key={node.id}
          node={node}
          selectedGroupId={selectedGroupId}
          onSelectGroup={onSelectGroup}
          searchQuery={searchQuery}
        />
      ))}
    </div>
  );
}

// Keep this export so any legacy import of DraggableMonitor doesn't break at module level
export function DraggableMonitor() {
  return null;
}
