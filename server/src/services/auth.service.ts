import { db } from '../db';
import { hashPassword, comparePassword } from '../utils/crypto';
import type { User, UserPreferences } from '@obliance/shared';
import { logger } from '../utils/logger';

interface UserRow {
  id: number;
  username: string;
  password_hash: string | null;
  display_name: string | null;
  role: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
  preferences?: UserPreferences | null;
  email?: string | null;
  preferred_language?: string;
  enrollment_version?: number;
  totp_enabled?: boolean;
  email_otp_enabled?: boolean;
  foreign_source?: string | null;
  foreign_id?: number | null;
  foreign_source_url?: string | null;
  avatar?: string | null;
}

function rowToUser(row: UserRow): User {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role as User['role'],
    isActive: row.is_active,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    preferences: row.preferences ?? {},
    email: row.email ?? null,
    preferredLanguage: row.preferred_language ?? 'en',
    enrollmentVersion: row.enrollment_version ?? 0,
    totpEnabled: row.totp_enabled ?? false,
    emailOtpEnabled: row.email_otp_enabled ?? false,
    hasPassword: row.password_hash !== null && row.password_hash !== '',
    foreignSource: row.foreign_source ?? null,
    foreignId: row.foreign_id ?? null,
    foreignSourceUrl: row.foreign_source_url ?? null,
    avatar: row.avatar ?? null,
  };
}

export class AccountLinkRequiredError extends Error {
  conflictingUsername: string;
  constructor(conflictingUsername: string) {
    super(`Account link required for username: ${conflictingUsername}`);
    this.name = 'AccountLinkRequiredError';
    this.conflictingUsername = conflictingUsername;
  }
}

export const authService = {
  async authenticate(username: string, password: string): Promise<User | null> {
    const row = await db<UserRow>('users')
      .where({ username, is_active: true })
      .first();

    if (!row) return null;
    if (!row.password_hash) return null;

    const valid = await comparePassword(password, row.password_hash);
    if (!valid) return null;

    return rowToUser(row);
  },

  async getUserById(id: number): Promise<User | null> {
    const row = await db<UserRow>('users').where({ id }).first();
    if (!row) return null;
    return rowToUser(row);
  },

  async createUser(
    username: string,
    password: string,
    role: string = 'user',
    displayName?: string,
  ): Promise<User> {
    const passwordHash = await hashPassword(password);

    const [row] = await db<UserRow>('users')
      .insert({
        username,
        password_hash: passwordHash,
        display_name: displayName || null,
        role,
      })
      .returning('*');

    return rowToUser(row);
  },

  async ensureDefaultAdmin(username: string, password: string): Promise<void> {
    const existing = await db('users').where({ role: 'admin' }).first();
    if (existing) return;

    await this.createUser(username, password, 'admin', 'Administrator');
    logger.info(`Default admin user "${username}" created`);
  },

  async findOrCreateForeignUser(
    foreignSource: string,
    foreignId: number,
    foreignSourceUrl: string,
    info: { username: string; email?: string | null },
  ): Promise<{ user: User; isFirstLogin: boolean }> {
    const link = await db('sso_foreign_users')
      .where({ foreign_source: foreignSource, foreign_user_id: foreignId })
      .first() as { local_user_id: number } | undefined;

    if (link) {
      const existing = await db<UserRow>('users').where({ id: link.local_user_id }).first();
      if (existing) {
        await db('users').where({ id: existing.id }).update({
          username: info.username,
          email: info.email ?? existing.email,
          foreign_source_url: foreignSourceUrl,
          updated_at: new Date(),
        });
        const updated = await db<UserRow>('users').where({ id: existing.id }).first() as UserRow;
        return { user: rowToUser(updated), isFirstLogin: false };
      }
    }

    const anyCollision = await db('users')
      .where({ username: info.username })
      .first() as (UserRow & { password_hash: string | null }) | undefined;

    if (anyCollision) {
      if (!anyCollision.password_hash) {
        await db('sso_foreign_users')
          .insert({ foreign_source: foreignSource, foreign_user_id: foreignId, local_user_id: anyCollision.id })
          .onConflict(['foreign_source', 'foreign_user_id'])
          .merge({ local_user_id: anyCollision.id });
        await db('users').where({ id: anyCollision.id }).update({
          email: info.email ?? anyCollision.email,
          foreign_source_url: foreignSourceUrl,
          updated_at: new Date(),
        });
        const updated = await db<UserRow>('users').where({ id: anyCollision.id }).first() as UserRow;
        return { user: rowToUser(updated), isFirstLogin: false };
      }
      throw new AccountLinkRequiredError(info.username);
    }

    const [row] = await db<UserRow>('users')
      .insert({
        username: info.username,
        password_hash: null,
        display_name: info.username,
        role: 'user',
        is_active: true,
        email: info.email ?? null,
        preferred_language: 'en',
        enrollment_version: 0,
        foreign_source: foreignSource,
        foreign_id: foreignId,
        foreign_source_url: foreignSourceUrl,
      })
      .returning('*');

    await db('sso_foreign_users').insert({
      foreign_source: foreignSource,
      foreign_user_id: foreignId,
      local_user_id: row.id,
    });

    return { user: rowToUser(row), isFirstLogin: true };
  },
};
