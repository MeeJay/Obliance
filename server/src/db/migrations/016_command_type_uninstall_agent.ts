import type { Knex } from 'knex';

// Add uninstall_agent command type so the server can enqueue agent self-removal.
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`ALTER TYPE command_type ADD VALUE IF NOT EXISTS 'uninstall_agent'`);
}

export async function down(_knex: Knex): Promise<void> {
  // PostgreSQL does not support removing enum values.
}
