import { db } from '../db';
import type { UserTeam, TeamPermission } from '@obliance/shared';

interface TeamRow {
  id: number;
  uuid: string;
  name: string;
  description: string | null;
  can_create: boolean;
  tenant_id: number;
  tenant_name?: string; // populated by JOIN when fetching all tenants
  created_at: Date;
  updated_at: Date;
}

interface PermissionRow {
  id: number;
  team_id: number;
  tenant_id: number;
  scope: 'group' | 'device';
  scope_id: number;
  level: 'ro' | 'rw';
}

function rowToTeam(row: TeamRow): UserTeam {
  return {
    id: row.id,
    uuid: row.uuid,
    name: row.name,
    canCreate: row.can_create,
    tenantId: row.tenant_id,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function rowToPermission(row: any): TeamPermission {
  const caps = row.capabilities
    ? (typeof row.capabilities === 'string' ? JSON.parse(row.capabilities) : row.capabilities)
    : (row.level === 'rw' ? ['monitor', 'execute'] : ['monitor']);
  return {
    id: row.id,
    tenantId: row.tenant_id,
    teamId: row.team_id,
    scope: row.scope,
    scopeId: row.scope_id,
    level: row.level,
    capabilities: caps,
  };
}

export const teamService = {
  /**
   * Returns teams scoped to a tenant.
   * If tenantId is null (platform admin cross-tenant view), returns ALL teams across
   * all tenants, joined with tenant name.
   */
  async getAll(tenantId: number | null): Promise<UserTeam[]> {
    const query = db('user_teams')
      .join('tenants', 'user_teams.tenant_id', 'tenants.id')
      .select('user_teams.*', 'tenants.name as tenant_name')
      .orderBy('user_teams.name');
    if (tenantId !== null) {
      query.where('user_teams.tenant_id', tenantId);
    }
    const rows = await query;
    return rows.map(rowToTeam);
  },

  async getById(id: number): Promise<UserTeam | null> {
    const row = await db<TeamRow>('user_teams').where({ id }).first();
    return row ? rowToTeam(row) : null;
  },

  async create(data: { name: string; description?: string | null; canCreate?: boolean }, tenantId: number): Promise<UserTeam> {
    const [row] = await db<TeamRow>('user_teams')
      .insert({
        name: data.name,
        description: data.description ?? null,
        can_create: data.canCreate ?? false,
        tenant_id: tenantId,
      })
      .returning('*');
    return rowToTeam(row);
  },

  async update(
    id: number,
    data: { name?: string; description?: string | null; canCreate?: boolean },
  ): Promise<UserTeam | null> {
    const updateData: Record<string, unknown> = { updated_at: new Date() };
    if (data.name !== undefined) updateData.name = data.name;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.canCreate !== undefined) updateData.can_create = data.canCreate;

    const [row] = await db<TeamRow>('user_teams')
      .where({ id })
      .update(updateData)
      .returning('*');
    return row ? rowToTeam(row) : null;
  },

  async delete(id: number): Promise<boolean> {
    const count = await db('user_teams').where({ id }).del();
    return count > 0;
  },

  // ── Members ──

  async getMembers(teamId: number): Promise<number[]> {
    const rows = await db('team_memberships')
      .where({ team_id: teamId })
      .select('user_id');
    return rows.map((r) => r.user_id);
  },

  async setMembers(teamId: number, userIds: number[]): Promise<void> {
    await db.transaction(async (trx) => {
      await trx('team_memberships').where({ team_id: teamId }).del();
      if (userIds.length > 0) {
        await trx('team_memberships').insert(
          userIds.map((uid) => ({ team_id: teamId, user_id: uid })),
        );
      }
    });
  },

  async getUserTeams(userId: number): Promise<UserTeam[]> {
    const rows = await db<TeamRow>('user_teams')
      .join('team_memberships', 'user_teams.id', 'team_memberships.team_id')
      .where('team_memberships.user_id', userId)
      .select('user_teams.*')
      .orderBy('user_teams.name');
    return rows.map(rowToTeam);
  },

  // ── Permissions ──

  async getPermissions(teamId: number): Promise<TeamPermission[]> {
    const rows = await db<PermissionRow>('team_permissions')
      .where({ team_id: teamId })
      .orderBy('scope')
      .orderBy('scope_id');
    return rows.map(rowToPermission);
  },

  async setPermissions(
    teamId: number,
    permissions: Array<{ scope: 'group' | 'device'; scopeId: number; level: 'ro' | 'rw'; capabilities?: string[] }>,
  ): Promise<TeamPermission[]> {
    // Resolve tenant_id from the team
    const team = await db('user_teams').where({ id: teamId }).select('tenant_id').first();
    const tenantId = team?.tenant_id;

    return db.transaction(async (trx) => {
      await trx('team_permissions').where({ team_id: teamId }).del();
      if (permissions.length > 0) {
        await trx('team_permissions').insert(
          permissions.map((p) => ({
            team_id: teamId,
            tenant_id: tenantId,
            scope: p.scope,
            scope_id: p.scopeId,
            level: p.level,
            capabilities: JSON.stringify(p.capabilities ?? (p.level === 'rw' ? ['monitor', 'execute'] : ['monitor'])),
          })),
        );
      }
      const rows = await trx<PermissionRow>('team_permissions')
        .where({ team_id: teamId })
        .orderBy('scope')
        .orderBy('scope_id');
      return rows.map(rowToPermission);
    });
  },

  async addPermission(
    teamId: number,
    scope: 'group' | 'device',
    scopeId: number,
    level: 'ro' | 'rw',
  ): Promise<TeamPermission> {
    const [row] = await db<PermissionRow>('team_permissions')
      .insert({ team_id: teamId, scope, scope_id: scopeId, level })
      .onConflict(['team_id', 'scope', 'scope_id'])
      .merge({ level })
      .returning('*');
    return rowToPermission(row);
  },

  async removePermission(permissionId: number): Promise<boolean> {
    const count = await db('team_permissions').where({ id: permissionId }).del();
    return count > 0;
  },
};
