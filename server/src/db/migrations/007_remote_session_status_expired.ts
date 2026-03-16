import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`ALTER TYPE remote_session_status ADD VALUE IF NOT EXISTS 'expired'`);
}

export async function down(_knex: Knex): Promise<void> {}
