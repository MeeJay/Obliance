import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`ALTER TYPE command_type ADD VALUE IF NOT EXISTS 'install_updates'`);
}

export async function down(): Promise<void> {
  // Cannot remove enum values in PostgreSQL
}
