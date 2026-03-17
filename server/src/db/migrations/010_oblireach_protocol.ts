import type { Knex } from 'knex';

// Migration 010 — Add 'oblireach' and 'cmd' / 'powershell' values to the
// remote_protocol enum so the Oblireach native streaming protocol and
// Windows shell variants can be stored in remote_sessions.protocol.

export async function up(knex: Knex): Promise<void> {
  // PostgreSQL does not allow removing enum values, but adding new ones is
  // safe and non-breaking.  Using raw SQL is the only way to ALTER an ENUM.
  await knex.raw(`
    ALTER TYPE remote_protocol ADD VALUE IF NOT EXISTS 'cmd';
    ALTER TYPE remote_protocol ADD VALUE IF NOT EXISTS 'powershell';
    ALTER TYPE remote_protocol ADD VALUE IF NOT EXISTS 'oblireach';
  `);
}

export async function down(_knex: Knex): Promise<void> {
  // PostgreSQL does not support removing enum values without recreating the
  // type.  This migration is intentionally irreversible.
}
