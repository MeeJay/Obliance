import { useState, useEffect, type FormEvent } from 'react';
import { Plus, Pencil, Trash2, FolderTree, GripVertical, Bell } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import type { DeviceGroup, DeviceGroupTreeNode } from '@obliance/shared';
import { groupsApi } from '@/api/groups.api';
import { useGroupStore } from '@/store/groupStore';
import { Button } from '@/components/common/Button';
import { Input } from '@/components/common/Input';
import { GroupPicker } from '@/components/common/GroupPicker';
import { SettingsPanel } from '@/components/settings/SettingsPanel';
import { NotificationBindingsPanel } from '@/components/notifications/NotificationBindingsPanel';
import { MaintenanceWindowList } from '@/components/maintenance/MaintenanceWindowList';
import { cn } from '@/utils/cn';
import toast from 'react-hot-toast';

interface GroupFormData {
  name: string;
  description: string;
  parentId: number | null;
  groupNotifications: boolean;
}

const emptyForm: GroupFormData = {
  name: '',
  description: '',
  parentId: null,
  groupNotifications: false,
};

/** Flatten the tree to an ordered list */
interface FlatNode {
  node: DeviceGroupTreeNode;
  depth: number;
  parentId: number | null;
  siblingIndex: number;
}

function flattenTree(nodes: DeviceGroupTreeNode[], depth = 0, parentId: number | null = null): FlatNode[] {
  const result: FlatNode[] = [];
  nodes.forEach((node, idx) => {
    result.push({ node, depth, parentId, siblingIndex: idx });
    result.push(...flattenTree(node.children, depth + 1, node.id));
  });
  return result;
}

/** Check if candidateId is a descendant of ancestorId in the tree */
function isDescendantOf(nodes: DeviceGroupTreeNode[], ancestorId: number, candidateId: number): boolean {
  for (const node of nodes) {
    if (node.id === ancestorId) {
      return findInChildren(node.children, candidateId);
    }
    if (isDescendantOf(node.children, ancestorId, candidateId)) return true;
  }
  return false;
}

function findInChildren(nodes: DeviceGroupTreeNode[], id: number): boolean {
  for (const node of nodes) {
    if (node.id === id) return true;
    if (findInChildren(node.children, id)) return true;
  }
  return false;
}

function findNodeById(nodes: DeviceGroupTreeNode[], id: number): DeviceGroupTreeNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const found = findNodeById(node.children, id);
    if (found) return found;
  }
  return null;
}

export function GroupManagePage() {
  const { fetchGroups, fetchTree, tree } = useGroupStore();
  const { t } = useTranslation();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<GroupFormData>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [draggingNode, setDraggingNode] = useState<DeviceGroupTreeNode | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
  );

  useEffect(() => {
    fetchGroups();
    fetchTree();
  }, [fetchGroups, fetchTree]);

  const openCreate = (parentId: number | null = null) => {
    setEditingId(null);
    setForm({ ...emptyForm, parentId });
    setShowForm(true);
  };

  const openEdit = (group: DeviceGroup) => {
    setEditingId(group.id);
    setForm({
      name: group.name,
      description: group.description || '',
      parentId: group.parentId,
      groupNotifications: group.groupNotifications,
    });
    setShowForm(true);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (editingId) {
        await groupsApi.update(editingId, {
          name: form.name,
          description: form.description || null,
          groupNotifications: form.groupNotifications,
        });
        toast.success(t('groups.updated'));
      } else {
        await groupsApi.create({
          name: form.name,
          description: form.description || null,
          parentId: form.parentId,
        });
        toast.success(t('groups.created'));
      }
      setShowForm(false);
      setForm(emptyForm);
      setEditingId(null);
      fetchGroups();
      fetchTree();
    } catch {
      toast.error(editingId ? t('groups.failedUpdate') : t('groups.failedCreate'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number, name: string) => {
    if (!confirm(t('groups.confirmDelete', { name }))) {
      return;
    }
    try {
      await groupsApi.delete(id);
      toast.success(t('groups.deleted'));
      fetchGroups();
      fetchTree();
    } catch {
      toast.error(t('groups.failedDelete'));
    }
  };

  const flatNodes = flattenTree(tree);

  const handleDragStart = (event: DragStartEvent) => {
    const data = event.active.data.current;
    if (data?.node) {
      setDraggingNode(data.node as DeviceGroupTreeNode);
    }
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const draggedNodeCopy = draggingNode;
    setDraggingNode(null);
    const { over } = event;
    if (!over || !draggedNodeCopy) return;

    const overData = over.data.current;
    if (!overData) return;

    const draggedId = draggedNodeCopy.id;

    // Drop ON a group → reparent as child
    if (overData.type === 'group-target') {
      const targetGroupId = overData.groupId as number;
      if (targetGroupId === draggedId) return;
      if (targetGroupId === draggedNodeCopy.parentId) return;
      if (isDescendantOf(tree, draggedId, targetGroupId)) return;

      try {
        await groupsApi.move(draggedId, targetGroupId);
        toast.success(t('groups.moved'));
        fetchGroups();
        fetchTree();
      } catch {
        toast.error(t('groups.failedMove'));
      }
      return;
    }

    // Drop BETWEEN items → reorder (and possibly reparent)
    if (overData.type === 'between') {
      const targetParentId = overData.parentId as number | null;
      const insertIndex = overData.insertIndex as number;

      // Don't allow dropping into own descendant
      if (targetParentId !== null && isDescendantOf(tree, draggedId, targetParentId)) return;

      // If moving to a different parent, do a move first
      if (draggedNodeCopy.parentId !== targetParentId) {
        try {
          await groupsApi.move(draggedId, targetParentId);
        } catch {
          toast.error(t('groups.failedMove'));
          return;
        }
      }

      // Now reorder siblings at the target parent level
      const parentChildren = targetParentId === null
        ? tree
        : (findNodeById(tree, targetParentId)?.children || []);
      const siblings = parentChildren.filter((n) => n.id !== draggedId);

      // Build new order with dragged item inserted
      const finalOrder: number[] = [];
      const clampedIndex = Math.min(insertIndex, siblings.length);
      for (let i = 0; i < siblings.length; i++) {
        if (i === clampedIndex) finalOrder.push(draggedId);
        finalOrder.push(siblings[i].id);
      }
      if (clampedIndex >= siblings.length) finalOrder.push(draggedId);

      const reorderItems = finalOrder.map((id, idx) => ({ id, sortOrder: idx }));

      try {
        await groupsApi.reorder(reorderItems);
        if (draggedNodeCopy.parentId === targetParentId) {
          toast.success(t('groups.reordered'));
        }
        fetchGroups();
        fetchTree();
      } catch {
        toast.error(t('groups.failedReorder'));
      }
    }
  };

  return (
    <div className="p-6 min-w-0">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-text-primary">{t('nav.groups')}</h1>
        <Button size="sm" onClick={() => openCreate()}>
          <Plus size={16} className="mr-1.5" />
          {t('groups.new')}
        </Button>
      </div>

      {/* Form */}
      {showForm && (
        <div className="mb-6 rounded-lg border border-border bg-bg-secondary p-5">
          <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wide mb-4">
            {editingId ? t('groups.edit') : t('groups.new')}
          </h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              label={t('groups.form.name')}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder={t('groups.form.namePlaceholder')}
              required
            />
            <Input
              label={t('groups.form.description')}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder={t('groups.form.descriptionPlaceholder')}
            />
            {!editingId && (
              <div className="space-y-1">
                <label className="block text-sm font-medium text-text-secondary">
                  {t('groups.form.parent')}
                </label>
                <GroupPicker
                  value={form.parentId}
                  onChange={(parentId) => setForm({ ...form, parentId })}
                  tree={tree}
                  placeholder={t('groups.form.parentNone')}
                  excludeId={editingId ?? undefined}
                />
              </div>
            )}
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="group-notifications"
                  checked={form.groupNotifications}
                  onChange={(e) => setForm({ ...form, groupNotifications: e.target.checked })}
                  className="h-4 w-4 rounded border-border bg-bg-tertiary text-accent focus:ring-accent"
                />
                <label htmlFor="group-notifications" className="text-sm text-text-secondary">
                  {t('groups.form.groupNotifications')}
                </label>
              </div>
              <p className="text-xs text-text-muted ml-6">
                {t('groups.form.groupNotificationsDesc')}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Button type="submit" loading={saving}>
                {editingId ? t('groups.save') : t('common.create')}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setShowForm(false);
                  setEditingId(null);
                  setForm(emptyForm);
                }}
              >
                {t('common.cancel')}
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* Group settings panel (when editing an existing group) */}
      {showForm && editingId && (
        <div className="mb-6">
          <SettingsPanel
            scope="group"
            scopeId={editingId}
            title={`Settings for "${form.name}"`}
          />
        </div>
      )}

      {/* Notification bindings (when editing an existing group) */}
      {showForm && editingId && (
        <div className="mb-6">
          <NotificationBindingsPanel
            scope="group"
            scopeId={editingId}
            title={`Notifications for "${form.name}"`}
          />
        </div>
      )}

      {/* Maintenance Windows (when editing an existing group) */}
      {showForm && editingId && (
        <div className="mb-6 rounded-lg border border-border bg-bg-secondary p-4">
          <MaintenanceWindowList
            scopeType="group"
            scopeId={editingId}
            scopeOptions={[{ id: editingId, name: form.name, type: 'group' }]}
            channels={[]}
            defaultScopeType="group"
            defaultScopeId={editingId}
            title={`Maintenance for "${form.name}"`}
          />
        </div>
      )}

      {/* Tree view with DnD */}
      <div className="rounded-lg border border-border bg-bg-secondary">
        {tree.length === 0 ? (
          <div className="py-12 text-center">
            <FolderTree size={32} className="mx-auto mb-3 text-text-muted" />
            <p className="text-text-muted">{t('groups.noGroups')}</p>
            <p className="text-sm text-text-muted mt-1">
              {t('groups.noGroupsDesc')}
            </p>
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            <div className="py-2">
              {/* Drop zone at the very top (insert as first root at index 0) */}
              <DropBetween
                id="between-root-top"
                parentId={null}
                insertIndex={0}
                isActive={draggingNode !== null}
              />

              {flatNodes.map((flatNode, i) => {
                const nextFlat = flatNodes[i + 1];

                // Determine where a "drop after this item" should insert:
                // Walk back up: if nextFlat is shallower or absent, we need
                // drop-zones for each level we're leaving.
                const dropZonesAfter: { id: string; parentId: number | null; insertIndex: number }[] = [];

                if (!nextFlat || nextFlat.depth <= flatNode.depth) {
                  // We need a between-zone at the current level and every level
                  // we're "closing" on the way back up to the next node's depth.
                  const targetDepth = nextFlat ? nextFlat.depth : 0;
                  // Walk from current node upward through ancestors
                  let curNode = flatNode;
                  for (let d = flatNode.depth; d >= targetDepth; d--) {
                    dropZonesAfter.push({
                      id: `between-${flatNode.node.id}-after-d${d}`,
                      parentId: curNode.parentId,
                      insertIndex: curNode.siblingIndex + 1,
                    });
                    // Find the ancestor at depth d-1 so we get the right siblingIndex
                    if (d > targetDepth) {
                      const ancestor = flatNodes.find(
                        (fn) => fn.node.id === curNode.parentId,
                      );
                      if (ancestor) curNode = ancestor;
                    }
                  }
                } else {
                  // Next node is deeper (child of this node) — just one zone
                  // to insert as first child of this node
                  dropZonesAfter.push({
                    id: `between-${flatNode.node.id}-child0`,
                    parentId: flatNode.node.id,
                    insertIndex: 0,
                  });
                }

                return (
                  <div key={flatNode.node.id}>
                    <DraggableGroupRow
                      node={flatNode.node}
                      depth={flatNode.depth}
                      openCreate={openCreate}
                      openEdit={openEdit}
                      handleDelete={handleDelete}
                      draggedId={draggingNode?.id ?? null}
                    />

                    {/* If this group has no children, show "drop as child" zone */}
                    {flatNode.node.children.length === 0 && draggingNode !== null && draggingNode.id !== flatNode.node.id && (
                      <DropOnGroup
                        groupId={flatNode.node.id}
                        depth={flatNode.depth}
                      />
                    )}

                    {/* Drop-between zones after this item */}
                    {dropZonesAfter.map((dz) => (
                      <DropBetween
                        key={dz.id}
                        id={dz.id}
                        parentId={dz.parentId}
                        insertIndex={dz.insertIndex}
                        isActive={draggingNode !== null}
                      />
                    ))}
                  </div>
                );
              })}
            </div>

            <DragOverlay dropAnimation={null}>
              {draggingNode && (
                <div className="flex items-center gap-2 rounded-md bg-bg-secondary border border-accent px-3 py-2 text-sm shadow-lg">
                  <GripVertical size={14} className="text-accent" />
                  <FolderTree size={16} className="text-accent" />
                  <span className="text-text-primary">{draggingNode.name}</span>
                </div>
              )}
            </DragOverlay>
          </DndContext>
        )}
      </div>
    </div>
  );
}

/** A draggable group row — also acts as a drop target for reparenting */
function DraggableGroupRow({
  node,
  depth,
  openCreate,
  openEdit,
  handleDelete,
  draggedId,
}: {
  node: DeviceGroupTreeNode;
  depth: number;
  openCreate: (parentId: number | null) => void;
  openEdit: (group: DeviceGroup) => void;
  handleDelete: (id: number, name: string) => void;
  draggedId: number | null;
}) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({
    id: `group-drag-${node.id}`,
    data: { node },
  });

  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `group-drop-on-${node.id}`,
    data: { type: 'group-target', groupId: node.id },
    disabled: draggedId === node.id || draggedId === null,
  });

  return (
    <div
      ref={(el) => {
        setDragRef(el);
        setDropRef(el);
      }}
      className={cn(
        'flex items-center gap-2 rounded-md px-3 py-2 hover:bg-bg-hover group transition-colors',
        isDragging && 'opacity-30',
        isOver && draggedId !== null && draggedId !== node.id && 'bg-accent/10 ring-1 ring-accent/30',
      )}
      style={{ paddingLeft: `${depth * 24 + 12}px` }}
    >
      <div
        {...attributes}
        {...listeners}
        className="text-text-muted opacity-0 group-hover:opacity-100 cursor-grab active:cursor-grabbing touch-none"
      >
        <GripVertical size={14} />
      </div>
      <FolderTree size={16} className="text-accent shrink-0" />
      <span className="flex-1 text-sm text-text-primary">{node.name}</span>
      {node.groupNotifications && (
        <span className="inline-flex items-center gap-0.5 rounded-full bg-yellow-500/10 px-2 py-0.5 text-[10px] font-medium text-yellow-500">
          <Bell size={10} />
          {t('groups.groupedBadge')}
        </span>
      )}
      <button
        onClick={() => openCreate(node.id)}
        className="p-1 text-text-muted hover:text-accent opacity-0 group-hover:opacity-100"
        title="Add sub-group"
      >
        <Plus size={14} />
      </button>
      <button
        onClick={() => openEdit(node)}
        className="p-1 text-text-muted hover:text-text-primary opacity-0 group-hover:opacity-100"
        title={t('common.edit')}
      >
        <Pencil size={14} />
      </button>
      <button
        onClick={() => handleDelete(node.id, node.name)}
        className="p-1 text-text-muted hover:text-status-down opacity-0 group-hover:opacity-100"
        title={t('common.delete')}
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}

/**
 * Drop zone between items for reordering.
 * Fixed 2px height — the droppable area extends via an invisible overlay
 * so the layout never shifts when dragging starts.
 */
function DropBetween({
  id,
  parentId,
  insertIndex,
  isActive,
}: {
  id: string;
  parentId: number | null;
  insertIndex: number;
  isActive: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id,
    data: { type: 'between', parentId, insertIndex },
    disabled: !isActive,
  });

  return (
    <div className="relative h-0.5">
      {/* Invisible hit area — tall enough to target, positioned without affecting layout */}
      <div
        ref={setNodeRef}
        className="absolute inset-x-0 -top-3 -bottom-3 z-10"
      />
      {/* Visual indicator — only shown when hovered */}
      {isOver && (
        <div className="absolute inset-x-3 top-0 h-0.5 rounded-full bg-accent" />
      )}
    </div>
  );
}

/**
 * Drop zone ON an empty group (for reparenting as child).
 * Zero-height container with absolute overlay — no layout shift.
 */
function DropOnGroup({
  groupId,
  depth,
}: {
  groupId: number;
  depth: number;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `group-child-drop-${groupId}`,
    data: { type: 'group-target', groupId },
  });

  return (
    <div className="relative h-0">
      <div
        ref={setNodeRef}
        className="absolute inset-x-0 -top-1 h-6 z-10"
      />
      {isOver && (
        <div
          className="absolute inset-x-3 top-0 h-5 rounded bg-accent/15 text-accent text-[10px] flex items-center z-20 pointer-events-none"
          style={{ paddingLeft: `${(depth + 1) * 24 + 12}px` }}
        >
          Move here as child
        </div>
      )}
    </div>
  );
}
