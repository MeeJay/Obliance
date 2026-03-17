import type { Knex } from 'knex';

/**
 * Extend the remote_protocol ENUM to include 'cmd' and 'powershell'.
 *
 * PostgreSQL does not support removing values from an ENUM, but adding new
 * values is safe and does not require a table rewrite.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`ALTER TYPE remote_protocol ADD VALUE IF NOT EXISTS 'cmd'`);
  await knex.raw(`ALTER TYPE remote_protocol ADD VALUE IF NOT EXISTS 'powershell'`);
}

export async function down(_knex: Knex): Promise<void> {
  // PostgreSQL does not support removing ENUM values.
  // A full rollback would require recreating the type — out of scope here.
}
