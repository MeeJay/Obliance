import { db } from '../db';
import { hashPassword } from '../utils/crypto';
import type { User, UserRole, UserTenantAssignment } from '@obliance/shared';

interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  display_name: string | null;
  role: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

function rowToUser(row: UserRow): User {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role as UserRole,
    isActive: row.is_active,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    email: (row as any).email ?? null,
    preferences: (row as any).preferences ?? {},
    preferredLanguage: (row as any).preferred_language ?? 'en',
    enrollmentVersion: (row as any).enrollment_version ?? 0,
    totpEnabled: (row as any).totp_enabled ?? false,
    emailOtpEnabled: (row as any).email_otp_enabled ?? false,
    foreignSource: (row as any).foreign_source ?? null,
    foreignId: (row as any).foreign_id ?? null,
    foreignSourceUrl: (row as any).foreign_source_url ?? null,
    hasPassword: (row as any).has_password ?? true,
  };
}

export const userService = {
  async getAll(): Promise<User[]> {
    const rows = await db<UserRow>('users').orderBy('username');
    return rows.map(rowToUser);
  },

  async getById(id: number): Promise<User | null> {
    const row = await db<UserRow>('users').where({ id }).first();
    return row ? rowToUser(row) : null;
  },

  async create(data: {
    username: string;
    password: string;
    displayName?: string | null;
    role?: UserRole;
  }): Promise<User> {
    const passwordHash = await hashPassword(data.password);

    const [row] = await db<UserRow>('users')
      .insert({
        username: data.username,
        password_hash: passwordHash,
        display_name: data.displayName || null,
        role: data.role || 'user',
      })
      .returning('*');

    return rowToUser(row);
  },

  async update(id: number, data: {
    username?: string;
    displayName?: string | null;
    role?: UserRole;
    isActive?: boolean;
  }): Promise<User | null> {
    const updateData: Record<string, unknown> = { updated_at: new Date() };
    if (data.username !== undefined) updateData.username = data.username;
    if (data.displayName !== undefined) updateData.display_name = data.displayName;
    if (data.role !== undefined) updateData.role = data.role;
    if (data.isActive !== undefined) updateData.is_active = data.isActive;

    const [row] = await db<UserRow>('users')
      .where({ id })
      .update(updateData)
      .returning('*');

    return row ? rowToUser(row) : null;
  },

  async changePassword(id: number, newPassword: string): Promise<boolean> {
    const passwordHash = await hashPassword(newPassword);
    const count = await db('users')
      .where({ id })
      .update({ password_hash: passwordHash, updated_at: new Date() });
    return count > 0;
  },

  async delete(id: number): Promise<boolean> {
    const count = await db('users').where({ id }).del();
    return count > 0;
  },

  /** Returns all tenants with this user's membership status and role. */
  async getUserTenantAssignments(userId: number): Promise<UserTenantAssignment[]> {
    const rows = await db('tenants as t')
      .leftJoin('user_tenants as ut', function () {
        this.on('ut.tenant_id', '=', 't.id').andOnVal('ut.user_id', '=', userId);
      })
      .select(
        't.id as tenantId',
        't.name as tenantName',
        't.slug as tenantSlug',
        db.raw('(ut.user_id IS NOT NULL) as is_member'),
        db.raw("COALESCE(ut.role, 'member') as role"),
      )
      .orderBy('t.name');

    return rows.map((r) => ({
      tenantId: r.tenantId,
      tenantName: r.tenantName,
      tenantSlug: r.tenantSlug,
      isMember: Boolean(r.is_member),
      role: r.role as 'admin' | 'member',
    }));
  },

  /** Bulk-replaces all tenant memberships for a user. */
  async setUserTenantAssignments(
    userId: number,
    assignments: { tenantId: number; role: 'admin' | 'member' }[],
  ): Promise<void> {
    await db.transaction(async (trx) => {
      await trx('user_tenants').where({ user_id: userId }).del();
      if (assignments.length > 0) {
        await trx('user_tenants').insert(
          assignments.map((a) => ({
            user_id: userId,
            tenant_id: a.tenantId,
            role: a.role,
            created_at: new Date(),
          })),
        );
      }
    });
  },
};
