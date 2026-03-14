import { useState, useRef, useEffect } from 'react';
import { ChevronRight, ChevronDown, Folder, Search, X } from 'lucide-react';
import type { DeviceGroupTreeNode } from '@obliance/shared';
import { cn } from '@/utils/cn';

interface GroupPickerProps {
  value: number | null;
  onChange: (groupId: number | null) => void;
  tree: DeviceGroupTreeNode[];
  placeholder?: string;
  excludeId?: number;
  /** When set, only show groups whose kind matches this value */
  kindFilter?: string;
}

/** Find a group name by ID in the tree recursively */
function findGroupName(tree: DeviceGroupTreeNode[], id: number): string | null {
  for (const node of tree) {
    if (node.id === id) return node.name;
    const found = findGroupName(node.children, id);
    if (found) return found;
  }
  return null;
}

/** Check if any node in the tree matches the filter (and optionally the kindFilter) */
function treeContainsMatch(tree: DeviceGroupTreeNode[], filter: string, excludeId?: number, kindFilter?: string): boolean {
  for (const node of tree) {
    if (node.id === excludeId) continue;
    if (kindFilter && node.kind !== kindFilter) {
      if (treeContainsMatch(node.children, filter, excludeId, kindFilter)) return true;
      continue;
    }
    if (node.name.toLowerCase().includes(filter)) return true;
    if (treeContainsMatch(node.children, filter, excludeId, kindFilter)) return true;
  }
  return false;
}

interface TreeNodeProps {
  node: DeviceGroupTreeNode;
  depth: number;
  selectedId: number | null;
  onSelect: (id: number | null) => void;
  filter: string;
  excludeId?: number;
  kindFilter?: string;
}

function TreeNode({ node, depth, selectedId, onSelect, filter, excludeId, kindFilter }: TreeNodeProps) {
  const [expanded, setExpanded] = useState(true);

  if (excludeId && node.id === excludeId) return null;

  // If kindFilter is set and this node doesn't match, skip rendering the node itself
  // but still render children (they might match)
  const kindMatch = !kindFilter || node.kind === kindFilter;

  const matchesSelf = kindMatch && node.name.toLowerCase().includes(filter);
  const childrenMatch = treeContainsMatch(node.children, filter, excludeId, kindFilter);
  if (!matchesSelf && !childrenMatch) return null;

  const hasVisibleChildren = node.children.some((c) => {
    if (excludeId && c.id === excludeId) return false;
    const cKindMatch = !kindFilter || c.kind === kindFilter;
    if (!filter && !kindFilter) return true;
    if (cKindMatch && (!filter || c.name.toLowerCase().includes(filter))) return true;
    return treeContainsMatch(c.children, filter, excludeId, kindFilter);
  });

  const children = (
    <div>
      {node.children.map((child) => (
        <TreeNode
          key={child.id}
          node={child}
          depth={kindMatch ? depth + 1 : depth}
          selectedId={selectedId}
          onSelect={onSelect}
          filter={filter}
          excludeId={excludeId}
          kindFilter={kindFilter}
        />
      ))}
    </div>
  );

  // If this node's kind doesn't match the filter, render only its children (transparent wrapper)
  if (!kindMatch) {
    return childrenMatch ? children : null;
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => onSelect(node.id)}
        className={cn(
          'flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-sm transition-colors',
          selectedId === node.id
            ? 'bg-accent/10 text-accent'
            : 'text-text-primary hover:bg-bg-hover',
        )}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        {hasVisibleChildren ? (
          <span
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(!expanded);
            }}
            className="shrink-0 cursor-pointer"
          >
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </span>
        ) : (
          <span className="w-3.5 shrink-0" />
        )}
        <Folder size={14} className="shrink-0 text-accent" />
        <span className="truncate">{node.name}</span>
      </button>

      {expanded && hasVisibleChildren && children}
    </div>
  );
}

export function GroupPicker({ value, onChange, tree, placeholder = 'Select a group', excludeId, kindFilter }: GroupPickerProps) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedName = value ? findGroupName(tree, value) : null;

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Focus search on open
  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
    }
  }, [open]);

  const handleSelect = (id: number | null) => {
    onChange(id);
    setOpen(false);
    setFilter('');
  };

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between rounded-md border border-border bg-bg-tertiary px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
      >
        <span className={cn(!selectedName && 'text-text-muted')}>
          {selectedName || placeholder}
        </span>
        <ChevronDown size={14} className={cn('transition-transform', open && 'rotate-180')} />
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-md border border-border bg-bg-secondary shadow-lg max-h-64 overflow-hidden flex flex-col">
          {/* Search filter */}
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <Search size={14} className="text-text-muted shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Search groups..."
              className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-muted focus:outline-none"
            />
            {filter && (
              <button type="button" onClick={() => setFilter('')}>
                <X size={14} className="text-text-muted hover:text-text-primary" />
              </button>
            )}
          </div>

          {/* Options */}
          <div className="overflow-y-auto p-1">
            {/* No group option */}
            <button
              type="button"
              onClick={() => handleSelect(null)}
              className={cn(
                'flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-sm transition-colors',
                value === null
                  ? 'bg-accent/10 text-accent'
                  : 'text-text-secondary hover:bg-bg-hover',
              )}
            >
              <span className="w-3.5 shrink-0" />
              <span className="italic">No group</span>
            </button>

            {tree.map((node) => (
              <TreeNode
                key={node.id}
                node={node}
                depth={0}
                selectedId={value}
                onSelect={handleSelect}
                filter={filter.toLowerCase()}
                excludeId={excludeId}
                kindFilter={kindFilter}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
