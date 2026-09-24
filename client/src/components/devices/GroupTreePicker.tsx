import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight, FolderOpen, X } from 'lucide-react';
import { groupsApi } from '@/api/groups.api';
import type { DeviceGroupTreeNode } from '@obliance/shared';
import { useTranslation } from 'react-i18next';
import { anonymize } from '@/utils/anonymize';
import { clsx } from 'clsx';
import { Drawer } from '@/components/common/Drawer';
import { useLayoutMode } from '@/hooks/useMediaQuery';
import { useClickOutside } from '@/hooks/useClickOutside';
import { useNativeBack } from '@/hooks/useNativeBack';
import { useAnchoredPosition } from '@/native/overlay';

interface GroupTreePickerProps {
 value: number | null;
 onChange: (groupId: number | null, breadcrumb: string[]) => void;
 className?: string;
}

// Mobile (docs/obli-mobile.md §5): the list is a viewport-clamped popover
// rendered in a portal (so it is never clipped by a scrolling modal body),
// and a bottom sheet on phones. The expand chevron is its own tap target, so
// a sub-group can be reached without the first tap selecting the parent and
// closing the list.
export function GroupTreePicker({ value, onChange, className }: GroupTreePickerProps) {
 const { t } = useTranslation();
 const layout = useLayoutMode();
 const asSheet = layout === 'phone';
 const [open, setOpen] = useState(false);
 const [tree, setTree] = useState<DeviceGroupTreeNode[]>([]);
 const [expanded, setExpanded] = useState<Set<number>>(new Set());
 const [selectedName, setSelectedName] = useState<string | null>(null);
 const ref = useRef<HTMLDivElement>(null);
 const triggerRef = useRef<HTMLButtonElement>(null);
 const popRef = useRef<HTMLDivElement>(null);

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

 const popoverOpen = open && !asSheet;
 const pos = useAnchoredPosition(triggerRef, popRef, popoverOpen, { placement: 'bottom', align: 'start', offset: 4 });
 // Close on outside click / tap (the list lives in a portal, so both the
 // trigger wrapper and the list count as "inside").
 useClickOutside([ref, popRef], () => setOpen(false), popoverOpen);
 useNativeBack(() => setOpen(false), popoverOpen, { escape: true });

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
 <div
 className={clsx(
 'w-full flex items-center gap-1.5 px-2 py-1.5 text-xs rounded transition-colors text-left',
 'coarse:min-h-10 coarse:text-sm',
 isSelected ? 'bg-accent/20 text-accent' : 'text-text-primary hover:bg-bg-tertiary',
 )}
 style={{ paddingLeft: `${8 + depth * (asSheet ? 12 : 16)}px` }}
 >
 {hasChildren ? (
 <button
 type="button"
 onClick={() => toggle(node.id)}
 aria-label={isExpanded ? t('groupPicker.collapse', 'Collapse') : t('groupPicker.expand', 'Expand')}
 aria-expanded={isExpanded}
 className="shrink-0 flex items-center justify-center rounded coarse:-my-2 coarse:h-9 coarse:w-9 coarse:-ml-2"
 >
 <ChevronRight className={clsx('w-3 h-3 transition-transform shrink-0 coarse:w-4 coarse:h-4', isExpanded && 'rotate-90')} />
 </button>
 ) : (
 <span className="w-3 shrink-0 coarse:w-9 coarse:-ml-2" />
 )}
 <button
 type="button"
 onClick={() => { select(node.id); if (hasChildren) toggle(node.id); }}
 className="flex min-w-0 flex-1 items-center gap-1.5 text-left coarse:self-stretch"
 >
 <FolderOpen className="w-3.5 h-3.5 text-text-muted shrink-0" />
 <span className="truncate flex-1">{anonymize(node.name)}</span>
 <span className="text-text-muted text-[10px] shrink-0">{count}</span>
 </button>
 </div>
 {hasChildren && isExpanded && node.children.map((c) => renderNode(c, depth + 1))}
 </div>
 );
 };

 const list = (
 <>
 <button
 type="button"
 onClick={clear}
 className={clsx(
 'w-full flex items-center gap-1.5 px-2 py-1.5 text-xs rounded transition-colors text-left',
 'coarse:min-h-10 coarse:text-sm',
 !value ? 'bg-accent/20 text-accent' : 'text-text-primary hover:bg-bg-tertiary',
 )}
 >
 <span className="w-3 coarse:w-7" />
 <FolderOpen className="w-3.5 h-3.5 text-text-muted" />
 {t('devices.filters.allGroups')}
 </button>
 {tree.map((n) => renderNode(n, 0))}
 </>
 );

 return (
 <div ref={ref} className={clsx('relative', className)}>
 <button
 ref={triggerRef}
 type="button"
 onClick={() => setOpen(!open)}
 aria-haspopup="listbox"
 aria-expanded={open}
 className="flex items-center gap-2 px-3 py-1.5 text-sm bg-bg-secondary rounded-lg text-text-primary hover:border-accent/50 transition-colors min-w-[120px] max-w-full coarse:min-h-10"
 >
 <FolderOpen className="w-3.5 h-3.5 text-text-muted shrink-0" />
 <span className="truncate">{anonymize(selectedName) || t('devices.filters.allGroups')}</span>
 {value && (
 <span
 role="button"
 tabIndex={0}
 aria-label={t('groupPicker.clear', 'Clear selection')}
 className="relative shrink-0 ml-auto flex items-center coarse:after:absolute coarse:after:-inset-3 coarse:after:content-['']"
 onClick={(e) => { e.stopPropagation(); clear(); }}
 onKeyDown={(e) => {
 if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); clear(); }
 }}
 >
 <X className="w-3 h-3 text-text-muted hover:text-text-primary coarse:w-4 coarse:h-4" />
 </span>
 )}
 </button>
 {popoverOpen && createPortal(
 <div
 ref={popRef}
 style={{
 position: 'fixed',
 top: pos?.top ?? 0,
 left: pos?.left ?? 0,
 maxHeight: pos ? Math.min(320, pos.maxHeight) : 320,
 visibility: pos ? 'visible' : 'hidden',
 }}
 className="z-[260] w-64 max-w-[calc(100vw-1rem)] max-h-80 overflow-y-auto overscroll-contain bg-bg-secondary rounded-lg shadow-lg p-1"
 >
 {list}
 </div>,
 document.body,
 )}
 <Drawer
 open={open && asSheet}
 onClose={() => setOpen(false)}
 side="bottom"
 size="lg"
 title={t('groupPicker.title', 'Choose a group')}
 ariaLabel={t('groupPicker.title', 'Choose a group')}
 overlayClassName="z-[260]"
 bodyClassName="px-2 pb-3 pt-0"
 >
 {list}
 </Drawer>
 </div>
 );
}
