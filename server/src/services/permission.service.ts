import { db } from '../db';
import type { PermissionLevel, UserPermissions } from '@obliance/shared';

export const permissionService = {
  /**
   * Get all team IDs a user belongs to.
   */
  async getUserTeamIds(userId: number): Promise<number[]> {
    const rows = await db('team_memberships')
      .where({ user_id: userId })
      .select('team_id');
    return rows.map((r) => r.team_id);
  },

  /**
   * Check if user (via any of their teams) has canCreate permission.
   */
  async canCreate(userId: number, isAdmin: boolean): Promise<boolean> {
    if (isAdmin) return true;
    const row = await db('user_teams')
      .join('team_memberships', 'user_teams.id', 'team_memberships.team_id')
      .where('team_memberships.user_id', userId)
      .where('user_teams.can_create', true)
      .first();
    return !!row;
  },

  /**
   * Get the effective permission level for a user on a specific device.
   * Returns 'rw', 'ro', or null (no access).
   *
   * Resolution order (highest level wins):
   *  - Direct device permission (scope='device', scope_id=deviceId)
   *  - Group permission via closure table on devices.group_id
   *  - **API key claim**: when devices.group_id IS NULL, the device
   *    inherits the scope of the API key's default_group_id. This is
   *    what makes a pre-approval device "belong" to a group even
   *    though approveDevice() hasn't run yet — an API key targeting
   *    the "Linux" group implicitly claims its enrolling devices
   *    for the Linux team's scope.
   *  - **Ungrouped scope**: when devices.group_id IS NULL and no API
   *    key claim resolves, a team_permissions row with
   *    scope='ungrouped' grants access.
   */
  async getDevicePermission(
    userId: number,
    deviceId: number,
    isAdmin: boolean,
  ): Promise<PermissionLevel | null> {
    if (isAdmin) return 'rw';

    const deviceRow = await db('devices')
      .where({ id: deviceId })
      .select('group_id', 'api_key_id')
      .first();
    if (!deviceRow) return null;

    // Direct device permission
    const directLevel = await this._getHighestPermission(userId, 'device', deviceId);

    let groupLevel: PermissionLevel | null = null;
    if (deviceRow.group_id) {
      // Group permission (inherited via closure table)
      groupLevel = await this._getGroupPermissionViaClosure(userId, deviceRow.group_id);
    } else {
      // Ungrouped device — try the API-key default_group_id first,
      // fall back to a literal scope='ungrouped' grant. The API-key
      // path covers the typical "enroll into a key targeting a
      // group" flow; the ungrouped path covers keys with no default
      // group set (orphan devices).
      if (deviceRow.api_key_id) {
        const key = await db('agent_api_keys')
          .where({ id: deviceRow.api_key_id })
          .select('default_group_id')
          .first() as { default_group_id: number | null } | undefined;
        if (key?.default_group_id) {
          groupLevel = await this._getGroupPermissionViaClosure(userId, key.default_group_id);
        }
      }
      if (!groupLevel) {
        groupLevel = await this._getHighestPermission(userId, 'ungrouped', 0);
      }
    }

    // Return highest: rw > ro > null
    return this._highest(directLevel, groupLevel);
  },

  /**
   * Check if user can read a device.
   */
  async canReadDevice(userId: number, deviceId: number, isAdmin: boolean): Promise<boolean> {
    const perm = await this.getDevicePermission(userId, deviceId, isAdmin);
    return perm !== null;
  },

  /**
   * Check if user can write (edit/delete) a device.
   */
  async canWriteDevice(userId: number, deviceId: number, isAdmin: boolean): Promise<boolean> {
    const perm = await this.getDevicePermission(userId, deviceId, isAdmin);
    return perm === 'rw';
  },

  /**
   * Check if user has a specific capability on a device.
   * Admins always have all capabilities.
   * Checks both direct device permissions and inherited group permissions.
   */
  /**
   * Tenant-wide capability check — resolves the user's per-tenant role
   * (`user_tenants.role`, now a permission_set slug) and looks up the
   * matching `permission_sets.capabilities`. Tenant admins bypass the
   * check entirely. Tenant role drives WHAT the user can do; team
   * membership (handled by canUseCapability) drives WHERE they can
   * do it.
   */
  async userHasTenantCapability(userId: number, tenantId: number, capability: string): Promise<boolean> {
    const ut = await db('user_tenants')
      .where({ user_id: userId, tenant_id: tenantId })
      .first() as { role: string } | undefined;
    if (!ut) return false;
    if (ut.role === 'admin') return true;
    const set = await db('permission_sets').where({ slug: ut.role }).first() as { capabilities: unknown } | undefined;
    if (!set) return false;
    const caps = typeof set.capabilities === 'string' ? JSON.parse(set.capabilities) : set.capabilities;
    return Array.isArray(caps) && caps.includes(capability);
  },

  /**
   * Bulk variant — returns every capability granted to the user on a
   * given tenant via their permission_set. Used by /auth/me so the
   * client can render gates without round-trips. Tenant admins get
   * the union of every defined capability (open-all).
   */
  async listUserTenantCapabilities(userId: number, tenantId: number): Promise<string[]> {
    const ut = await db('user_tenants')
      .where({ user_id: userId, tenant_id: tenantId })
      .first() as { role: string } | undefined;
    if (!ut) return [];
    if (ut.role === 'admin') {
      // Union of every defined cap so the client renders all gates as
      // open. The matrix can grow without us having to enumerate the
      // exhaustive list here.
      const all = await db('permission_sets').select('capabilities') as Array<{ capabilities: unknown }>;
      const set = new Set<string>();
      for (const row of all) {
        const caps = typeof row.capabilities === 'string' ? JSON.parse(row.capabilities) : row.capabilities;
        if (Array.isArray(caps)) for (const c of caps) set.add(String(c));
      }
      return [...set];
    }
    const set = await db('permission_sets').where({ slug: ut.role }).first() as { capabilities: unknown } | undefined;
    if (!set) return [];
    const caps = typeof set.capabilities === 'string' ? JSON.parse(set.capabilities) : set.capabilities;
    return Array.isArray(caps) ? caps.map(String) : [];
  },

  async canUseCapability(userId: number, deviceId: number, isAdmin: boolean, capability: string): Promise<boolean> {
    if (isAdmin) return true;

    const deviceRow = await db('devices').where({ id: deviceId }).select('group_id').first();
    if (!deviceRow) return false;

    // Check direct device permissions
    const directPerms = await db('team_permissions as tp')
      .join('team_memberships as tm', 'tm.team_id', 'tp.team_id')
      .where({ 'tm.user_id': userId, 'tp.scope': 'device', 'tp.scope_id': deviceId })
      .select('tp.capabilities');

    for (const row of directPerms) {
      const caps = typeof row.capabilities === 'string' ? JSON.parse(row.capabilities) : (row.capabilities ?? []);
      if (caps.includes(capability)) return true;
    }

    // Check group permissions (via closure table)
    if (deviceRow.group_id) {
      const groupPerms = await db('team_permissions as tp')
        .join('team_memberships as tm', 'tm.team_id', 'tp.team_id')
        .join('device_group_closure as dgc', 'dgc.ancestor_id', 'tp.scope_id')
        .where({ 'tm.user_id': userId, 'tp.scope': 'group', 'dgc.descendant_id': deviceRow.group_id })
        .select('tp.capabilities');

      for (const row of groupPerms) {
        const caps = typeof row.capabilities === 'string' ? JSON.parse(row.capabilities) : (row.capabilities ?? []);
        if (caps.includes(capability)) return true;
      }
    }

    return false;
  },

  /**
   * Get effective permission for a user on a group.
   * Checks direct group permissions + ancestor permissions via closure table.
   */
  async getGroupPermission(
    userId: number,
    groupId: number,
    isAdmin: boolean,
  ): Promise<PermissionLevel | null> {
    if (isAdmin) return 'rw';
    return this._getGroupPermissionViaClosure(userId, groupId);
  },

  async canReadGroup(userId: number, groupId: number, isAdmin: boolean): Promise<boolean> {
    const perm = await this.getGroupPermission(userId, groupId, isAdmin);
    return perm !== null;
  },

  async canWriteGroup(userId: number, groupId: number, isAdmin: boolean): Promise<boolean> {
    const perm = await this.getGroupPermission(userId, groupId, isAdmin);
    return perm === 'rw';
  },

  /**
   * Get all device IDs visible to a user.
   * Returns 'all' for admins.
   */
  async getVisibleDeviceIds(userId: number, isAdmin: boolean): Promise<number[] | 'all'> {
    if (isAdmin) return 'all';

    const teamIds = await this.getUserTeamIds(userId);
    if (teamIds.length === 0) return [];

    // Devices via group permissions (inherited through closure table)
    const groupDevices = await db('devices')
      .join('device_group_closure', 'device_group_closure.descendant_id', 'devices.group_id')
      .join('team_permissions', function () {
        this.on('team_permissions.scope_id', 'device_group_closure.ancestor_id')
          .andOn(db.raw("team_permissions.scope = 'group'"));
      })
      .whereIn('team_permissions.team_id', teamIds)
      .select('devices.id');

    // Devices via direct device permissions
    const directDevices = await db('team_permissions')
      .whereIn('team_id', teamIds)
      .where('scope', 'device')
      .select('scope_id as id');

    // Devices pre-approval claimed via their api_key's default_group:
    // when group_id IS NULL but the enrolling API key targets a group
    // the user's team has scope on, the device is treated as if it
    // already lived in that group. Covers the typical
    // "Linux-key enrols a device, Linux-team needs to approve it"
    // case where group_id is only set at approveDevice() time.
    const apiKeyClaimedDevices = await db('devices')
      .join('agent_api_keys', 'agent_api_keys.id', 'devices.api_key_id')
      .join('device_group_closure', 'device_group_closure.descendant_id', 'agent_api_keys.default_group_id')
      .join('team_permissions', function () {
        this.on('team_permissions.scope_id', 'device_group_closure.ancestor_id')
          .andOn(db.raw("team_permissions.scope = 'group'"));
      })
      .whereNull('devices.group_id')
      .whereNotNull('agent_api_keys.default_group_id')
      .whereIn('team_permissions.team_id', teamIds)
      .select('devices.id');

    // Devices in the catch-all "Ungrouped" bucket — group_id IS NULL
    // AND no api_key default group claim — visible to teams that
    // hold an explicit scope='ungrouped' permission.
    const hasUngroupedScope = await db('team_permissions')
      .whereIn('team_id', teamIds)
      .where('scope', 'ungrouped')
      .first();
    let ungroupedDevices: Array<{ id: number }> = [];
    if (hasUngroupedScope) {
      ungroupedDevices = await db('devices')
        .whereNull('group_id')
        .select('id');
    }

    const ids = new Set<number>();
    for (const r of groupDevices) ids.add(r.id);
    for (const r of directDevices) ids.add(r.id);
    for (const r of apiKeyClaimedDevices) ids.add(r.id);
    for (const r of ungroupedDevices) ids.add(r.id);

    return [...ids];
  },

  /**
   * Get all group IDs visible to a user.
   * A group is visible if the user has any permission on it, any ancestor has permission,
   * or any device inside it has a direct permission.
   * Returns 'all' for admins.
   */
  async getVisibleGroupIds(userId: number, isAdmin: boolean): Promise<number[] | 'all'> {
    if (isAdmin) return 'all';

    const teamIds = await this.getUserTeamIds(userId);
    if (teamIds.length === 0) return [];

    // Groups with direct or ancestor group permissions → includes descendants
    const groupPerms = await db('team_permissions')
      .whereIn('team_id', teamIds)
      .where('scope', 'group')
      .select('scope_id');
    const permGroupIds = groupPerms.map((r) => r.scope_id);

    // All descendants of those groups
    let descendantIds: number[] = [];
    if (permGroupIds.length > 0) {
      const descRows = await db('device_group_closure')
        .whereIn('ancestor_id', permGroupIds)
        .select('descendant_id');
      descendantIds = descRows.map((r) => r.descendant_id);
    }

    // Groups that contain devices with direct device permissions
    const devicePerms = await db('team_permissions')
      .whereIn('team_id', teamIds)
      .where('scope', 'device')
      .select('scope_id');
    const deviceIds = devicePerms.map((r) => r.scope_id);

    let deviceGroupIds: number[] = [];
    if (deviceIds.length > 0) {
      const dgRows = await db('devices')
        .whereIn('id', deviceIds)
        .whereNotNull('group_id')
        .select('group_id');
      deviceGroupIds = dgRows.map((r) => r.group_id);
    }

    // Ancestor groups of deviceGroupIds (for tree navigation)
    let ancestorIds: number[] = [];
    if (deviceGroupIds.length > 0) {
      const ancRows = await db('device_group_closure')
        .whereIn('descendant_id', deviceGroupIds)
        .select('ancestor_id');
      ancestorIds = ancRows.map((r) => r.ancestor_id);
    }

    // Also ancestor groups of permGroupIds (for tree navigation)
    if (permGroupIds.length > 0) {
      const ancRows = await db('device_group_closure')
        .whereIn('descendant_id', permGroupIds)
        .select('ancestor_id');
      ancestorIds = [...ancestorIds, ...ancRows.map((r) => r.ancestor_id)];
    }

    const ids = new Set<number>();
    for (const id of descendantIds) ids.add(id);
    for (const id of deviceGroupIds) ids.add(id);
    for (const id of ancestorIds) ids.add(id);

    return [...ids];
  },

  /**
   * Build the full UserPermissions object for the current user.
   * Sent to the client on login/session check so the UI can adapt.
   */
  async getUserPermissions(userId: number, isAdmin: boolean, tenantId?: number): Promise<UserPermissions> {
    if (isAdmin) {
      return { canCreate: true, teams: [], permissions: {}, tenantCapabilities: [] };
    }

    const teamIds = await this.getUserTeamIds(userId);
    const canCreate = await this.canCreate(userId, false);

    const perms = await db('team_permissions')
      .whereIn('team_id', teamIds)
      .select('scope', 'scope_id', 'level');

    const permissions: Record<string, PermissionLevel> = {};
    for (const p of perms) {
      const key = `${p.scope}:${p.scope_id}`;
      const existing = permissions[key];
      if (!existing || (existing === 'ro' && p.level === 'rw')) {
        permissions[key] = p.level;
      }
    }

    // tenantCapabilities now resolves via permission_sets (slug = the
    // user's user_tenants.role). Requires a tenant context; callers
    // hitting /auth/me / /auth/login pass the active tenant id. Empty
    // when no tenant has been resolved yet (very early session repair
    // path).
    const tenantCapabilities = tenantId != null
      ? await this.listUserTenantCapabilities(userId, tenantId)
      : [];

    return { canCreate, teams: teamIds, permissions, tenantCapabilities };
  },

  /**
   * Get user IDs that have at least read access to a specific device.
   * Used for Socket.io broadcasts.
   */
  async getUsersWithDeviceAccess(deviceId: number): Promise<number[]> {
    const deviceRow = await db('devices').where({ id: deviceId }).select('group_id').first();
    if (!deviceRow) return [];

    // Users via direct device permission
    const directUsers = await db('team_memberships')
      .join('team_permissions', 'team_memberships.team_id', 'team_permissions.team_id')
      .where('team_permissions.scope', 'device')
      .where('team_permissions.scope_id', deviceId)
      .select('team_memberships.user_id');

    const userIds = new Set<number>(directUsers.map((r) => r.user_id));

    // Users via group permission (inherited)
    if (deviceRow.group_id) {
      const groupUsers = await db('team_memberships')
        .join('team_permissions', 'team_memberships.team_id', 'team_permissions.team_id')
        .join('device_group_closure', 'device_group_closure.ancestor_id', 'team_permissions.scope_id')
        .where('team_permissions.scope', 'group')
        .where('device_group_closure.descendant_id', deviceRow.group_id)
        .select('team_memberships.user_id');
      for (const r of groupUsers) userIds.add(r.user_id);
    }

    return [...userIds];
  },

  // ── Private helpers ──

  /**
   * Get the highest permission level from all teams for a specific scope+scopeId.
   */
  async _getHighestPermission(
    userId: number,
    scope: string,
    scopeId: number,
  ): Promise<PermissionLevel | null> {
    const rows = await db('team_permissions')
      .join('team_memberships', 'team_permissions.team_id', 'team_memberships.team_id')
      .where('team_memberships.user_id', userId)
      .where('team_permissions.scope', scope)
      .where('team_permissions.scope_id', scopeId)
      .select('team_permissions.level');

    if (rows.length === 0) return null;
    return rows.some((r) => r.level === 'rw') ? 'rw' : 'ro';
  },

  /**
   * Get the highest group permission for a user on a group,
   * checking all ancestors via closure table.
   */
  async _getGroupPermissionViaClosure(
    userId: number,
    groupId: number,
  ): Promise<PermissionLevel | null> {
    const rows = await db('team_permissions')
      .join('team_memberships', 'team_permissions.team_id', 'team_memberships.team_id')
      .join('device_group_closure', 'device_group_closure.ancestor_id', 'team_permissions.scope_id')
      .where('team_memberships.user_id', userId)
      .where('team_permissions.scope', 'group')
      .where('device_group_closure.descendant_id', groupId)
      .select('team_permissions.level');

    if (rows.length === 0) return null;
    return rows.some((r) => r.level === 'rw') ? 'rw' : 'ro';
  },

  _highest(a: PermissionLevel | null, b: PermissionLevel | null): PermissionLevel | null {
    if (a === 'rw' || b === 'rw') return 'rw';
    if (a === 'ro' || b === 'ro') return 'ro';
    return null;
  },
};
