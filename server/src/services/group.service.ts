import { db } from '../db';
import type { DeviceGroup, DeviceGroupTreeNode, DeviceGroupConfig } from '@obliance/shared';

interface GroupRow {
  id: number;
  tenant_id: number;
  parent_id: number | null;
  name: string;
  slug: string;
  description: string | null;
  sort_order: number;
  group_notifications: boolean;
  group_config: DeviceGroupConfig | null;
  uuid: string;
  created_at: Date;
  updated_at: Date;
}

function rowToGroup(row: GroupRow): DeviceGroup {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    parentId: row.parent_id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    sortOrder: row.sort_order,
    groupNotifications: row.group_notifications,
    groupConfig: row.group_config
      ? (typeof row.group_config === 'string' ? JSON.parse(row.group_config) : row.group_config)
      : {},
    uuid: row.uuid,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

async function ensureUniqueSlug(slug: string, excludeId?: number): Promise<string> {
  let candidate = slug;
  let i = 1;
  while (true) {
    const q = db('device_groups').where({ slug: candidate });
    if (excludeId) q.whereNot({ id: excludeId });
    const exists = await q.first();
    if (!exists) return candidate;
    candidate = `${slug}-${i++}`;
  }
}

export const groupService = {
  async getAll(tenantId: number): Promise<DeviceGroup[]> {
    const rows = await db<GroupRow>('device_groups').where({ tenant_id: tenantId }).orderBy('sort_order').orderBy('name');
    return rows.map(rowToGroup);
  },

  async getById(id: number): Promise<DeviceGroup | null> {
    const row = await db<GroupRow>('device_groups').where({ id }).first();
    return row ? rowToGroup(row) : null;
  },

  async create(data: {
    name: string;
    description?: string | null;
    parentId?: number | null;
    sortOrder?: number;
    groupNotifications?: boolean;
    groupConfig?: DeviceGroupConfig;
  }, tenantId: number): Promise<DeviceGroup> {
    const slug = await ensureUniqueSlug(slugify(data.name));

    const [row] = await db<GroupRow>('device_groups')
      .insert({
        name: data.name,
        slug,
        description: data.description ?? null,
        parent_id: data.parentId ?? null,
        sort_order: data.sortOrder ?? 0,
        group_notifications: data.groupNotifications ?? false,
        group_config: data.groupConfig ?? {},
        tenant_id: tenantId,
      })
      .returning('*');

    // Maintain closure table
    // Self-reference (depth 0)
    await db('device_group_closure').insert({
      ancestor_id: row.id,
      descendant_id: row.id,
      depth: 0,
    });

    // Copy ancestor paths from parent
    if (data.parentId) {
      await db.raw(
        `INSERT INTO device_group_closure (ancestor_id, descendant_id, depth)
         SELECT gc.ancestor_id, ?, gc.depth + 1
         FROM device_group_closure gc
         WHERE gc.descendant_id = ?`,
        [row.id, data.parentId],
      );
    }

    return rowToGroup(row);
  },

  async update(
    id: number,
    data: {
      name?: string;
      description?: string | null;
      sortOrder?: number;
      groupNotifications?: boolean;
      groupConfig?: DeviceGroupConfig;
    },
  ): Promise<DeviceGroup | null> {
    const updateData: Record<string, unknown> = { updated_at: new Date() };

    if (data.name !== undefined) {
      updateData.name = data.name;
      updateData.slug = await ensureUniqueSlug(slugify(data.name), id);
    }
    if (data.description !== undefined) updateData.description = data.description;
    if (data.sortOrder !== undefined) updateData.sort_order = data.sortOrder;
    if (data.groupNotifications !== undefined) updateData.group_notifications = data.groupNotifications;
    if (data.groupConfig !== undefined) updateData.group_config = JSON.stringify(data.groupConfig);

    const [row] = await db<GroupRow>('device_groups')
      .where({ id })
      .update(updateData)
      .returning('*');

    return row ? rowToGroup(row) : null;
  },

  async move(id: number, newParentId: number | null): Promise<DeviceGroup | null> {
    // Get current group
    const group = await db<GroupRow>('device_groups').where({ id }).first();
    if (!group) return null;

    // Prevent circular reference: newParentId must not be a descendant of id
    if (newParentId !== null) {
      const isDescendant = await db('device_group_closure')
        .where({ ancestor_id: id, descendant_id: newParentId })
        .first();
      if (isDescendant) {
        throw new Error('Cannot move group into its own descendant');
      }
    }

    // Get all descendants of the subtree (including self)
    const subtreeIds = await db('device_group_closure')
      .where({ ancestor_id: id })
      .select('descendant_id');
    const descIds = subtreeIds.map((r) => r.descendant_id);

    // Remove all closure entries where ancestor is NOT in the subtree
    // but descendant IS in the subtree (these are the "outside" links)
    await db('device_group_closure')
      .whereIn('descendant_id', descIds)
      .whereNotIn('ancestor_id', descIds)
      .del();

    // Reconnect: for each ancestor of newParent, create links to every node in subtree
    if (newParentId !== null) {
      await db.raw(
        `INSERT INTO device_group_closure (ancestor_id, descendant_id, depth)
         SELECT p.ancestor_id, s.descendant_id, p.depth + s.depth + 1
         FROM device_group_closure p
         CROSS JOIN device_group_closure s
         WHERE p.descendant_id = ?
           AND s.ancestor_id = ?`,
        [newParentId, id],
      );
    }

    // Update the parent_id column
    const [row] = await db<GroupRow>('device_groups')
      .where({ id })
      .update({ parent_id: newParentId, updated_at: new Date() })
      .returning('*');

    return row ? rowToGroup(row) : null;
  },

  async delete(id: number): Promise<boolean> {
    // CASCADE in the DB handles closure table and child groups
    const count = await db('device_groups').where({ id }).del();
    return count > 0;
  },

  // ── Tree queries using closure table ──

  async getAncestors(groupId: number): Promise<DeviceGroup[]> {
    const rows = await db<GroupRow>('device_groups')
      .join('device_group_closure', 'device_groups.id', 'device_group_closure.ancestor_id')
      .where('device_group_closure.descendant_id', groupId)
      .where('device_group_closure.depth', '>', 0)
      .orderBy('device_group_closure.depth', 'desc')
      .select('device_groups.*');
    return rows.map(rowToGroup);
  },

  async getDescendantIds(groupId: number): Promise<number[]> {
    const rows = await db('device_group_closure')
      .where({ ancestor_id: groupId })
      .select('descendant_id');
    return rows.map((r) => r.descendant_id);
  },

  async getChildren(parentId: number | null): Promise<DeviceGroup[]> {
    const query = db<GroupRow>('device_groups').orderBy('sort_order').orderBy('name');
    if (parentId === null) {
      query.whereNull('parent_id');
    } else {
      query.where({ parent_id: parentId });
    }
    const rows = await query;
    return rows.map(rowToGroup);
  },

  async getTree(tenantId: number): Promise<DeviceGroupTreeNode[]> {
    const allGroups = await this.getAll(tenantId);
    const groupMap = new Map<number, DeviceGroupTreeNode>();

    // Count devices per group (direct members only)
    const countRows = await db('devices')
      .where({ tenant_id: tenantId, approval_status: 'approved' })
      .whereNot({ status: 'pending_uninstall' })
      .whereNotNull('group_id')
      .groupBy('group_id')
      .select('group_id', db.raw('count(*) as total'))
      .select(
        db.raw("count(*) filter (where status = 'online') as online_count"),
        db.raw("count(*) filter (where status = 'offline') as offline_count"),
        db.raw("count(*) filter (where status = 'warning') as warning_count"),
        db.raw("count(*) filter (where status = 'critical') as critical_count"),
      );
    const directCounts = new Map<number, { total: number; online: number; offline: number; warning: number; critical: number }>();
    for (const row of countRows) {
      directCounts.set(row.group_id, {
        total: parseInt(row.total), online: parseInt(row.online_count),
        offline: parseInt(row.offline_count), warning: parseInt(row.warning_count),
        critical: parseInt(row.critical_count),
      });
    }

    // Initialize nodes with direct counts
    for (const g of allGroups) {
      const dc = directCounts.get(g.id) ?? { total: 0, online: 0, offline: 0, warning: 0, critical: 0 };
      groupMap.set(g.id, {
        ...g, children: [],
        deviceCount: dc.total, total: dc.total,
        onlineCount: dc.online, offlineCount: dc.offline,
        warningCount: dc.warning, criticalCount: dc.critical,
      });
    }

    // Build tree
    const roots: DeviceGroupTreeNode[] = [];
    for (const node of groupMap.values()) {
      if (node.parentId && groupMap.has(node.parentId)) {
        groupMap.get(node.parentId)!.children.push(node);
      } else {
        roots.push(node);
      }
    }

    // Accumulate counts from children (bottom-up)
    function accumulate(node: DeviceGroupTreeNode): { total: number; online: number; offline: number; warning: number; critical: number } {
      let totals = {
        total: node.deviceCount ?? 0, online: node.onlineCount ?? 0,
        offline: node.offlineCount ?? 0, warning: node.warningCount ?? 0,
        critical: node.criticalCount ?? 0,
      };
      for (const child of node.children) {
        const childTotals = accumulate(child);
        totals.total += childTotals.total;
        totals.online += childTotals.online;
        totals.offline += childTotals.offline;
        totals.warning += childTotals.warning;
        totals.critical += childTotals.critical;
      }
      node.total = totals.total;
      node.onlineCount = totals.online;
      node.offlineCount = totals.offline;
      node.warningCount = totals.warning;
      node.criticalCount = totals.critical;
      return totals;
    }
    for (const root of roots) accumulate(root);

    return roots;
  },

  /** Batch-update sortOrder for multiple groups at once */
  async reorder(items: { id: number; sortOrder: number }[]): Promise<void> {
    await db.transaction(async (trx) => {
      for (const item of items) {
        await trx('device_groups')
          .where({ id: item.id })
          .update({ sort_order: item.sortOrder, updated_at: new Date() });
      }
    });
  },

  /**
   * Find the nearest ancestor (or self) with group_notifications = true.
   * Uses the closure table, ordered by depth ASC (self = depth 0 first).
   * Returns the group if found, null otherwise.
   */
  async findGroupNotificationAncestor(groupId: number): Promise<DeviceGroup | null> {
    const row = await db<GroupRow>('device_groups')
      .join('device_group_closure', 'device_groups.id', 'device_group_closure.ancestor_id')
      .where('device_group_closure.descendant_id', groupId)
      .where('device_groups.group_notifications', true)
      .orderBy('device_group_closure.depth', 'asc')
      .first('device_groups.*');
    return row ? rowToGroup(row) : null;
  },
};
