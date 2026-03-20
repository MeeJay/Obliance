import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`ALTER TYPE command_type ADD VALUE IF NOT EXISTS 'list_processes'`);
  await knex.raw(`ALTER TYPE command_type ADD VALUE IF NOT EXISTS 'kill_process'`);
}

export async function down(_knex: Knex): Promise<void> {
  // PostgreSQL does not support removing enum values
}
