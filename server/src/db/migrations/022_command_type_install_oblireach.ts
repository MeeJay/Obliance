import type { Knex } from 'knex';

// Add 'install_oblireach' to the command_type PostgreSQL enum.
// This was present in the TypeScript types but missing from the DB enum,
// causing an INSERT error when trying to send the install command.

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`ALTER TYPE command_type ADD VALUE IF NOT EXISTS 'install_oblireach'`);
}

// PostgreSQL does not support removing enum values — intentionally a no-op.
export async function down(_knex: Knex): Promise<void> {}
