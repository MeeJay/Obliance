import { db } from '../db';
import type { CustomSection } from '@obliance/shared';

function rowToSection(r: any): CustomSection {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    name: r.name,
    description: r.description ?? null,
    command: r.command,
    platform: r.platform,
    runtime: r.runtime,
    usePty: !!r.use_pty,
    targetType: r.target_type,
    targetIds: typeof r.target_ids === 'string' ? JSON.parse(r.target_ids || '[]') : (r.target_ids || []),
    createdBy: r.created_by ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export const customSectionService = {
  async list(tenantId: number): Promise<CustomSection[]> {
    const rows = await db('custom_sections').where({ tenant_id: tenantId }).orderBy('name');
    return rows.map(rowToSection);
  },

  async getById(id: number, tenantId: number): Promise<CustomSection | null> {
    const row = await db('custom_sections').where({ id, tenant_id: tenantId }).first();
    return row ? rowToSection(row) : null;
  },

  async create(tenantId: number, data: Omit<CustomSection, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>, userId: number): Promise<CustomSection> {
    const [row] = await db('custom_sections').insert({
      tenant_id: tenantId,
      name: data.name,
      description: data.description ?? null,
      command: data.command,
      platform: data.platform ?? 'all',
      runtime: data.runtime ?? 'bash',
      use_pty: data.usePty ?? true,
      target_type: data.targetType ?? 'all',
      target_ids: JSON.stringify(data.targetIds ?? []),
      created_by: userId,
    }).returning('*');
    return rowToSection(row);
  },

  async update(id: number, tenantId: number, data: Partial<Omit<CustomSection, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>>): Promise<CustomSection | null> {
    const updates: any = { updated_at: new Date() };
    if (data.name !== undefined) updates.name = data.name;
    if (data.description !== undefined) updates.description = data.description;
    if (data.command !== undefined) updates.command = data.command;
    if (data.platform !== undefined) updates.platform = data.platform;
    if (data.runtime !== undefined) updates.runtime = data.runtime;
    if (data.usePty !== undefined) updates.use_pty = data.usePty;
    if (data.targetType !== undefined) updates.target_type = data.targetType;
    if (data.targetIds !== undefined) updates.target_ids = JSON.stringify(data.targetIds);
    await db('custom_sections').where({ id, tenant_id: tenantId }).update(updates);
    return this.getById(id, tenantId);
  },

  async delete(id: number, tenantId: number): Promise<void> {
    await db('custom_sections').where({ id, tenant_id: tenantId }).delete();
  },

  /**
   * Resolve the list of custom sections that apply to a specific device,
   * filtered by platform match and target (all / group / device).
   */
  async listForDevice(deviceId: number, tenantId: number): Promise<CustomSection[]> {
    const device = await db('devices').where({ id: deviceId, tenant_id: tenantId }).first();
    if (!device) return [];

    const all = await db('custom_sections').where({ tenant_id: tenantId });

    // Resolve ancestor groups of this device for target matching
    let ancestorGroupIds: number[] = [];
    if (device.group_id) {
      const rows = await db('device_group_closure').where({ descendant_id: device.group_id }).pluck('ancestor_id');
      ancestorGroupIds = [device.group_id, ...rows];
    }

    const matches: CustomSection[] = [];
    for (const r of all) {
      const sec = rowToSection(r);
      // Platform filter
      if (sec.platform !== 'all' && sec.platform !== device.os_type) continue;
      // Target filter
      if (sec.targetType === 'all') {
        matches.push(sec);
      } else if (sec.targetType === 'device') {
        if (sec.targetIds.includes(deviceId)) matches.push(sec);
      } else if (sec.targetType === 'group') {
        if (sec.targetIds.some((gid) => ancestorGroupIds.includes(gid))) matches.push(sec);
      }
    }
    return matches;
  },
};
