import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`ALTER TYPE os_type ADD VALUE IF NOT EXISTS 'freebsd'`);
  await knex.raw(`ALTER TYPE script_platform ADD VALUE IF NOT EXISTS 'freebsd'`);
}

export async function down(_knex: Knex): Promise<void> {
  // PostgreSQL does not support removing enum values
}
