import { useEffect, useRef, useState } from 'react';
import { ChevronRight, FolderOpen, X } from 'lucide-react';
import { groupsApi } from '@/api/groups.api';
import type { DeviceGroupTreeNode } from '@obliance/shared';
import { useTranslation } from 'react-i18next';
import { clsx } from 'clsx';

interface GroupTreePickerProps {
  value: number | null;
  onChange: (groupId: number | null, breadcrumb: string[]) => void;
  className?: string;
}

export function GroupTreePicker({ value, onChange, className }: GroupTreePickerProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [tree, setTree] = useState<DeviceGroupTreeNode[]>([]);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    groupsApi.tree().then(setTree).catch(() => {});
  }, []);

  // Resolve selected name from tree
  useEffect(() => {
    if (!value) { setSelectedName(null); return; }
    const find = (nodes: DeviceGroupTreeNode[]): string | null => {
      for (const n of nodes) {
        if (n.id === value) return n.name;
        const child = find(n.children);
        if (child) return child;
      }
      return null;
    };
    setSelectedName(find(tree));
  }, [value, tree]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const toggle = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const buildBreadcrumb = (nodes: DeviceGroupTreeNode[], targetId: number, path: string[] = []): string[] | null => {
    for (const n of nodes) {
      const current = [...path, n.name];
      if (n.id === targetId) return current;
      const found = buildBreadcrumb(n.children, targetId, current);
      if (found) return found;
    }
    return null;
  };

  const select = (id: number) => {
    const breadcrumb = buildBreadcrumb(tree, id) ?? [];
    onChange(id, breadcrumb);
    setOpen(false);
  };

  const clear = () => {
    onChange(null, []);
    setOpen(false);
  };

  const renderNode = (node: DeviceGroupTreeNode, depth: number) => {
    const hasChildren = node.children.length > 0;
    const isExpanded = expanded.has(node.id);
    const isSelected = value === node.id;
    const count = node.total ?? node.deviceCount ?? 0;

    return (
      <div key={node.id}>
        <button
          onClick={() => hasChildren ? toggle(node.id) : select(node.id)}
          onDoubleClick={() => select(node.id)}
          className={clsx(
            'w-full flex items-center gap-1.5 px-2 py-1.5 text-xs rounded transition-colors text-left',
            isSelected ? 'bg-accent/20 text-accent' : 'text-text-primary hover:bg-bg-tertiary',
          )}
          style={{ paddingLeft: `${8 + depth * 16}px` }}
        >
          {hasChildren ? (
            <ChevronRight className={clsx('w-3 h-3 transition-transform shrink-0', isExpanded && 'rotate-90')} />
          ) : (
            <span className="w-3" />
          )}
          <FolderOpen className="w-3.5 h-3.5 text-text-muted shrink-0" />
          <span className="truncate flex-1">{node.name}</span>
          <span className="text-text-muted text-[10px] shrink-0">{count}</span>
          {hasChildren && (
            <button
              onClick={(e) => { e.stopPropagation(); select(node.id); }}
              className="text-[10px] text-accent hover:underline shrink-0 ml-1"
            >
              {t('devices.filters.select')}
            </button>
          )}
        </button>
        {hasChildren && isExpanded && node.children.map((c) => renderNode(c, depth + 1))}
      </div>
    );
  };

  return (
    <div ref={ref} className={clsx('relative', className)}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-1.5 text-sm bg-bg-secondary border border-border rounded-lg text-text-primary hover:border-accent/50 transition-colors min-w-[120px]"
      >
        <FolderOpen className="w-3.5 h-3.5 text-text-muted shrink-0" />
        <span className="truncate">{selectedName ?? t('devices.filters.allGroups')}</span>
        {value && (
          <X
            className="w-3 h-3 text-text-muted hover:text-text-primary shrink-0 ml-auto"
            onClick={(e) => { e.stopPropagation(); clear(); }}
          />
        )}
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 w-64 max-h-80 overflow-y-auto bg-bg-secondary border border-border rounded-lg shadow-lg p-1">
          <button
            onClick={clear}
            className={clsx(
              'w-full flex items-center gap-1.5 px-2 py-1.5 text-xs rounded transition-colors text-left',
              !value ? 'bg-accent/20 text-accent' : 'text-text-primary hover:bg-bg-tertiary',
            )}
          >
            <span className="w-3" />
            <FolderOpen className="w-3.5 h-3.5 text-text-muted" />
            {t('devices.filters.allGroups')}
          </button>
          {tree.map((n) => renderNode(n, 0))}
        </div>
      )}
    </div>
  );
}
