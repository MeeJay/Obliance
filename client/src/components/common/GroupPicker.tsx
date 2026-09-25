import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight, ChevronDown, Folder, Search, X } from 'lucide-react';
import type { DeviceGroupTreeNode } from '@obliance/shared';
import { cn } from '@/utils/cn';
import { useClickOutside } from '@/hooks/useClickOutside';
import { useNativeBack } from '@/hooks/useNativeBack';
import { useCanHover, useLayoutMode } from '@/hooks/useMediaQuery';
import { Drawer } from './Drawer';
import { IconButton } from './IconButton';

interface GroupPickerProps {
 value: number | null;
 onChange: (groupId: number | null) => void;
 tree: DeviceGroupTreeNode[];
 placeholder?: string;
 excludeId?: number;
 /** When set, only show groups whose kind matches this value */
 kindFilter?: string;
 /** Title of the phone bottom sheet (defaults to "Select a group"). The
  *  placeholder is only the trigger's empty-state label (callers often pass
  *  "None (root level)", which would be a misleading sheet title). */
 sheetTitle?: string;
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
 'flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-sm transition-colors coarse:min-h-10',
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
 // Touch: an invisible 36×40 hit area around the 14 px chevron so
 // expanding does not select the group by accident (layout unchanged).
 className="relative shrink-0 cursor-pointer coarse:after:absolute coarse:after:left-1/2 coarse:after:top-1/2 coarse:after:h-10 coarse:after:w-9 coarse:after:-translate-x-1/2 coarse:after:-translate-y-1/2 coarse:after:content-['']"
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

/**
 * Single-select group tree picker.
 * Desktop / tablet: dropdown under the trigger (unchanged). Phone (< 768 px):
 * the list opens as a bottom sheet (Drawer) so it is neither clipped by a
 * modal's overflow nor covered by the soft keyboard. The search field is
 * only auto-focused with a mouse — on touch it would raise the keyboard
 * over the list.
 */
export function GroupPicker({ value, onChange, tree, placeholder, excludeId, kindFilter, sheetTitle }: GroupPickerProps) {
 const { t } = useTranslation();
 const canHover = useCanHover();
 const isPhone = useLayoutMode() === 'phone';
 const [open, setOpen] = useState(false);
 const [filter, setFilter] = useState('');
 const containerRef = useRef<HTMLDivElement>(null);
 const inputRef = useRef<HTMLInputElement>(null);
 const placeholderText = placeholder ?? t('groupPicker.placeholder', 'Select a group');

 const selectedName = value ? findGroupName(tree, value) : null;

 // Dropdown: close on outside tap (pointerdown — mouse, touch, pen), Escape
 // and Android back. The phone sheet (Drawer) handles all three itself.
 const popoverOpen = open && !isPhone;
 useClickOutside(containerRef, () => setOpen(false), popoverOpen);
 useNativeBack(() => { setOpen(false); }, popoverOpen, { escape: true });

 // Focus search on open (mouse / trackpad only)
 useEffect(() => {
 if (open && canHover && inputRef.current) {
 inputRef.current.focus();
 }
 }, [open, canHover]);

 const handleSelect = (id: number | null) => {
 onChange(id);
 setOpen(false);
 setFilter('');
 };

 const search = (
 <div className="flex shrink-0 items-center gap-2 px-3 py-2">
 <Search size={14} className="text-text-muted shrink-0" />
 <input
 ref={inputRef}
 type="text"
 value={filter}
 onChange={(e) => setFilter(e.target.value)}
 placeholder={t('groups.searchPlaceholder', 'Search groups...')}
 autoCapitalize="off"
 autoCorrect="off"
 spellCheck={false}
 enterKeyHint="search"
 className="flex-1 min-w-0 bg-transparent text-sm text-text-primary placeholder:text-text-muted focus:outline-none coarse:min-h-10"
 />
 {filter && (
 <IconButton
 label={t('groupPicker.clearSearch', 'Clear search')}
 onClick={() => setFilter('')}
 icon={<X size={14} />}
 variant="plain"
 touchTarget="overlay"
 showTooltip={false}
 className="p-0"
 />
 )}
 </div>
 );

 const options = (
 <div className="min-h-0 overflow-y-auto p-1">
 {/* No group option */}
 <button
 type="button"
 onClick={() => handleSelect(null)}
 className={cn(
 'flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-sm transition-colors coarse:min-h-10',
 value === null
 ? 'bg-accent/10 text-accent'
 : 'text-text-secondary hover:bg-bg-hover',
 )}
 >
 <span className="w-3.5 shrink-0" />
 <span className="italic">{t('monitors.form.noGroup', 'No group')}</span>
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
 );

 return (
 <div ref={containerRef} className="relative">
 {/* Trigger button */}
 <button
 type="button"
 onClick={() => setOpen(!open)}
 aria-expanded={open}
 aria-haspopup={isPhone ? 'dialog' : 'listbox'}
 className="flex w-full items-center justify-between gap-2 rounded-md bg-bg-tertiary px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent coarse:min-h-10"
 >
 <span className={cn('min-w-0 truncate', !selectedName && 'text-text-muted')}>
 {selectedName || placeholderText}
 </span>
 <ChevronDown size={14} className={cn('shrink-0 transition-transform', open && 'rotate-180')} />
 </button>

 {/* Phone: bottom sheet (search pinned, list scrolls). */}
 {isPhone ? (
 <Drawer
 open={open}
 onClose={() => setOpen(false)}
 side="bottom"
 title={sheetTitle ?? t('groupPicker.title', 'Select a group')}
 bodyClassName="flex flex-col p-0"
 >
 {search}
 {options}
 </Drawer>
 ) : open && (
 /* Dropdown */
 <div className="absolute z-50 mt-1 w-full rounded-md bg-bg-secondary shadow-lg max-h-64 overflow-hidden flex flex-col">
 {/* Search filter */}
 {search}

 {/* Options */}
 {options}
 </div>
 )}
 </div>
 );
}
