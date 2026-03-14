import { create } from 'zustand';
import type { DeviceGroup, DeviceGroupTreeNode } from '@obliance/shared';
import { groupsApi } from '../api/groups.api';

// ── localStorage persistence for collapsed groups ──
const COLLAPSED_STORAGE_KEY = 'ov-group-collapsed';

function loadCollapsed(): Set<number> {
  try {
    const raw = localStorage.getItem(COLLAPSED_STORAGE_KEY);
    if (raw) return new Set(JSON.parse(raw) as number[]);
  } catch { /* ignore */ }
  return new Set();
}

function saveCollapsed(ids: Set<number>): void {
  localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify([...ids]));
}

/** Walk tree recursively to find all ancestor IDs of a target group. */
function findAncestorIds(nodes: DeviceGroupTreeNode[], targetId: number, path: number[] = []): number[] | null {
  for (const node of nodes) {
    if (node.id === targetId) return path;
    const result = findAncestorIds(node.children, targetId, [...path, node.id]);
    if (result !== null) return result;
  }
  return null;
}

interface DeviceGroupStats {
  onlineCount: number;
  offlineCount: number;
  total: number;
}

interface GroupStore {
  groups: Map<number, DeviceGroup>;
  tree: DeviceGroupTreeNode[];
  groupStats: Record<number, DeviceGroupStats>;
  collapsedGroupIds: Set<number>;
  isLoading: boolean;

  // Actions
  fetchGroups: () => Promise<void>;
  fetchTree: () => Promise<void>;
  addGroup: (group: DeviceGroup) => void;
  updateGroup: (id: number, data: Partial<DeviceGroup>) => void;
  removeGroup: (id: number) => void;

  // Collapse/expand actions
  toggleGroupExpanded: (groupId: number) => void;
  expandGroup: (groupId: number) => void;
  expandAncestors: (groupId: number) => void;
  isGroupExpanded: (groupId: number) => boolean;

  // Getters
  getGroup: (id: number) => DeviceGroup | undefined;
  getGroupList: () => DeviceGroup[];
  getRootGroups: () => DeviceGroup[];
  getGroupStats: (id: number) => DeviceGroupStats | undefined;
}

export const useGroupStore = create<GroupStore>((set, get) => ({
  groups: new Map(),
  tree: [],
  groupStats: {},
  collapsedGroupIds: loadCollapsed(),
  isLoading: false,

  fetchGroups: async () => {
    set({ isLoading: true });
    try {
      const list = await groupsApi.list();
      const groups = new Map<number, DeviceGroup>();
      list.forEach((g) => groups.set(g.id, g));
      set({ groups, isLoading: false });
    } catch {
      set({ isLoading: false });
    }
  },

  fetchTree: async () => {
    try {
      const tree = await groupsApi.tree();
      // Derive stats from tree nodes if they carry device counts
      const groupStats: Record<number, DeviceGroupStats> = {};
      function walkTree(nodes: DeviceGroupTreeNode[]) {
        for (const node of nodes) {
          const onlineCount = (node as any).onlineCount ?? 0;
          const offlineCount = (node as any).offlineCount ?? 0;
          groupStats[node.id] = {
            onlineCount,
            offlineCount,
            total: onlineCount + offlineCount,
          };
          if (node.children?.length) walkTree(node.children);
        }
      }
      walkTree(tree);
      set({ tree, groupStats });
    } catch {
      // ignore
    }
  },

  addGroup: (group) => {
    set((state) => {
      const groups = new Map(state.groups);
      groups.set(group.id, group);
      return { groups };
    });
  },

  updateGroup: (id, data) => {
    set((state) => {
      const groups = new Map(state.groups);
      const existing = groups.get(id);
      if (existing) {
        groups.set(id, { ...existing, ...data });
      }
      return { groups };
    });
  },

  removeGroup: (id) => {
    set((state) => {
      const groups = new Map(state.groups);
      groups.delete(id);
      return { groups };
    });
  },

  // ── Collapse/expand ──

  toggleGroupExpanded: (groupId) => {
    const collapsed = new Set(get().collapsedGroupIds);
    if (collapsed.has(groupId)) {
      collapsed.delete(groupId);
    } else {
      collapsed.add(groupId);
    }
    saveCollapsed(collapsed);
    set({ collapsedGroupIds: collapsed });
  },

  expandGroup: (groupId) => {
    const collapsed = new Set(get().collapsedGroupIds);
    if (collapsed.has(groupId)) {
      collapsed.delete(groupId);
      saveCollapsed(collapsed);
      set({ collapsedGroupIds: collapsed });
    }
  },

  expandAncestors: (groupId) => {
    const tree = get().tree;
    const ancestors = findAncestorIds(tree, groupId, []);
    if (!ancestors || ancestors.length === 0) return;

    const collapsed = new Set(get().collapsedGroupIds);
    let changed = false;
    for (const id of ancestors) {
      if (collapsed.has(id)) {
        collapsed.delete(id);
        changed = true;
      }
    }
    // Also expand the target group itself
    if (collapsed.has(groupId)) {
      collapsed.delete(groupId);
      changed = true;
    }
    if (changed) {
      saveCollapsed(collapsed);
      set({ collapsedGroupIds: collapsed });
    }
  },

  isGroupExpanded: (groupId) => !get().collapsedGroupIds.has(groupId),

  // ── Getters ──

  getGroup: (id) => get().groups.get(id),
  getGroupList: () => Array.from(get().groups.values()),
  getRootGroups: () =>
    Array.from(get().groups.values()).filter((g) => g.parentId === null),
  getGroupStats: (id) => get().groupStats[id],
}));
