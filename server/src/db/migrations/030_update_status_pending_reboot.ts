import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`ALTER TYPE update_status ADD VALUE IF NOT EXISTS 'pending_reboot'`);
}

export async function down(_knex: Knex): Promise<void> {
  // PostgreSQL does not support removing enum values
}
