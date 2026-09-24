import { useEffect, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight, FolderOpen, Check, Minus } from 'lucide-react';
import { clsx } from 'clsx';
import { groupsApi } from '@/api/groups.api';
import type { DeviceGroupTreeNode } from '@obliance/shared';

interface Props {
 selectedIds: number[];
 onChange: (ids: number[]) => void;
}

type CheckState = 'all' | 'some' | 'none';

/**
 * Inline group tree multi-select shared by the automation forms (schedule
 * target, scenario target, on-demand script run). Selecting a group also
 * selects all its descendants.
 *
 * Touch (docs/obli-mobile.md §5.4): the whole row toggles the selection, rows
 * are 40 px tall on coarse pointers and the expand chevron gets a bigger hit
 * area. Desktop rendering is the same as the three former copies.
 */
export function GroupTreeMultiSelect({ selectedIds, onChange }: Props) {
 const { t } = useTranslation();
 const [tree, setTree] = useState<DeviceGroupTreeNode[]>([]);
 const [expanded, setExpanded] = useState<Set<number>>(new Set());

 useEffect(() => {
 groupsApi.tree().then((nodes) => {
 setTree(nodes);
 // Auto-expand everything on first load
 const all = new Set<number>();
 const walk = (list: DeviceGroupTreeNode[]) => { for (const n of list) { all.add(n.id); walk(n.children); } };
 walk(nodes);
 setExpanded(all);
 }).catch(() => {});
 }, []);

 // Collect all descendant IDs of a node
 const getDescendantIds = (node: DeviceGroupTreeNode): number[] => {
 const ids: number[] = [];
 for (const c of node.children) { ids.push(c.id, ...getDescendantIds(c)); }
 return ids;
 };

 const selected = new Set(selectedIds);

 const getCheckState = (node: DeviceGroupTreeNode): CheckState => {
 const descendants = getDescendantIds(node);
 const selfSelected = selected.has(node.id);
 if (descendants.length === 0) return selfSelected ? 'all' : 'none';
 const allIds = [node.id, ...descendants];
 const selectedCount = allIds.filter((id) => selected.has(id)).length;
 if (selectedCount === allIds.length) return 'all';
 if (selectedCount > 0) return 'some';
 return 'none';
 };

 const toggleNode = (node: DeviceGroupTreeNode) => {
 const allIds = [node.id, ...getDescendantIds(node)];
 const next = getCheckState(node) === 'all'
 ? new Set(selectedIds.filter((id) => !allIds.includes(id)))
 : new Set([...selectedIds, ...allIds]);
 onChange(Array.from(next));
 };

 const toggleExpand = (id: number) => {
 setExpanded((prev) => {
 const next = new Set(prev);
 if (next.has(id)) next.delete(id); else next.add(id);
 return next;
 });
 };

 const onCheckboxKey = (e: KeyboardEvent<HTMLButtonElement>) => {
 // Space/Enter already click the button; stop the row from seeing it twice.
 if (e.key === ' ' || e.key === 'Enter') e.stopPropagation();
 };

 const renderNode = (node: DeviceGroupTreeNode, depth: number) => {
 const hasChildren = node.children.length > 0;
 const isExpanded = expanded.has(node.id);
 const state = getCheckState(node);
 const count = node.total ?? node.deviceCount ?? 0;

 return (
 <div key={node.id}>
 {/* The whole row toggles the selection (big tap target on touch);
 the chevron and the checkbox stop propagation so they act once. */}
 <div
 onClick={() => toggleNode(node)}
 className={clsx(
 'flex items-center gap-1.5 py-1.5 transition-colors rounded hover:bg-bg-hover cursor-pointer coarse:min-h-10',
 state === 'all' && 'bg-accent/5',
 )}
 style={{ paddingLeft: `${8 + depth * 20}px`, paddingRight: 8 }}
 >
 <button
 type="button"
 onClick={(e) => { e.stopPropagation(); if (hasChildren) toggleExpand(node.id); }}
 aria-label={isExpanded ? t('automations.groupTree.collapse', 'Collapse') : t('automations.groupTree.expand', 'Expand')}
 aria-expanded={hasChildren ? isExpanded : undefined}
 tabIndex={hasChildren ? 0 : -1}
 className={clsx(
 'shrink-0 p-0.5 coarse:p-2.5 rounded text-text-muted hover:text-text-primary transition-colors',
 !hasChildren && 'invisible',
 )}
 >
 <ChevronRight className={clsx('w-3 h-3 transition-transform', isExpanded && 'rotate-90')} />
 </button>

 <button
 type="button"
 role="checkbox"
 aria-checked={state === 'all' ? true : state === 'some' ? 'mixed' : false}
 aria-label={node.name}
 onClick={(e) => { e.stopPropagation(); toggleNode(node); }}
 onKeyDown={onCheckboxKey}
 className={clsx(
 'w-4 h-4 coarse:w-5 coarse:h-5 rounded border flex items-center justify-center shrink-0 transition-colors',
 state === 'all' ? 'bg-accent border-accent text-white' :
 state === 'some' ? 'bg-accent/30 border-accent text-white' :
 'border-transparent hover:border-accent/50',
 )}
 >
 {state === 'all' && <Check className="w-3 h-3" />}
 {state === 'some' && <Minus className="w-3 h-3" />}
 </button>

 <FolderOpen className={clsx('w-3.5 h-3.5 shrink-0', state !== 'none' ? 'text-accent' : 'text-text-muted')} />
 <span
 className={clsx(
 'flex-1 min-w-0 text-sm truncate cursor-pointer',
 state !== 'none' ? 'text-text-primary font-medium' : 'text-text-primary',
 )}
 >
 {node.name}
 </span>
 <span className="text-text-muted text-[10px] shrink-0">{count}</span>
 </div>
 {hasChildren && isExpanded && node.children.map((c) => renderNode(c, depth + 1))}
 </div>
 );
 };

 if (tree.length === 0) {
 return <p className="text-sm text-text-muted py-2">{t('automations.groupTree.empty', 'No groups available')}</p>;
 }

 return (
 <div className="rounded-lg bg-bg-tertiary max-h-60 coarse:max-h-80 overflow-y-auto overscroll-contain py-1">
 {tree.map((n) => renderNode(n, 0))}
 </div>
 );
}
