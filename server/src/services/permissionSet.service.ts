import { db } from '../db';

interface PermissionSetRow {
  id: number;
  name: string;
  slug: string;
  capabilities: string | string[];
  is_default: boolean;
  created_at: Date;
}

export interface PermissionSet {
  id: number;
  name: string;
  slug: string;
  capabilities: string[];
  isDefault: boolean;
  createdAt: string;
}

interface CapabilityDef {
  key: string;
  label: string;
}

const AVAILABLE_CAPABILITIES: CapabilityDef[] = [
  { key: 'monitoring', label: 'Monitoring' },
  { key: 'devices.manage', label: 'Device Management' },
  { key: 'groups.manage', label: 'Group Management' },
  { key: 'scripts.manage', label: 'Script Management' },
  { key: 'scripts.execute', label: 'Execute Commands' },
  { key: 'compliance', label: 'Compliance' },
  { key: 'remote', label: 'Remote Access' },
  { key: 'files', label: 'File Management' },
  { key: 'power', label: 'Power Control' },
  { key: 'updates', label: 'Update Management' },
  { key: 'reports', label: 'Reports' },
  { key: 'settings', label: 'Settings' },
  { key: 'users.manage', label: 'User Management' },
];

function rowToPermissionSet(row: PermissionSetRow): PermissionSet {
  const caps = typeof row.capabilities === 'string'
    ? JSON.parse(row.capabilities)
    : row.capabilities;
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    capabilities: caps,
    isDefault: row.is_default,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  };
}

export const permissionSetService = {
  async getAll(): Promise<PermissionSet[]> {
    const rows = await db('permission_sets')
      .orderBy('is_default', 'desc')
      .orderBy('name', 'asc') as PermissionSetRow[];
    return rows.map(rowToPermissionSet);
  },

  async getBySlug(slug: string): Promise<PermissionSet | null> {
    const row = await db('permission_sets').where({ slug }).first() as PermissionSetRow | undefined;
    return row ? rowToPermissionSet(row) : null;
  },

  async create(data: { name: string; slug: string; capabilities: string[] }): Promise<PermissionSet> {
    const [row] = await db('permission_sets')
      .insert({
        name: data.name,
        slug: data.slug,
        capabilities: JSON.stringify(data.capabilities),
        is_default: false,
      })
      .returning('*') as PermissionSetRow[];
    return rowToPermissionSet(row);
  },

  async update(id: number, data: { name?: string; capabilities?: string[] }): Promise<PermissionSet | null> {
    const existing = await db('permission_sets').where({ id }).first() as PermissionSetRow | undefined;
    if (!existing) return null;

    const update: Record<string, unknown> = {};
    if (data.name !== undefined) update.name = data.name;
    if (data.capabilities !== undefined) update.capabilities = JSON.stringify(data.capabilities);

    if (Object.keys(update).length > 0) {
      await db('permission_sets').where({ id }).update(update);
    }

    const row = await db('permission_sets').where({ id }).first() as PermissionSetRow;
    return rowToPermissionSet(row);
  },

  async delete(id: number): Promise<{ success: boolean; error?: string }> {
    const existing = await db('permission_sets').where({ id }).first() as PermissionSetRow | undefined;
    if (!existing) return { success: false, error: 'Permission set not found' };
    if (existing.is_default) return { success: false, error: 'Cannot delete default permission sets' };

    await db('permission_sets').where({ id }).del();
    return { success: true };
  },

  getAvailableCapabilities(): CapabilityDef[] {
    return AVAILABLE_CAPABILITIES;
  },
};
