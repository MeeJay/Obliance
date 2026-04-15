import { Knex } from 'knex';

export const config = { transaction: false };

export async function up(knex: Knex): Promise<void> {
  const exists = await knex.raw(
    `SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid WHERE t.typname = 'command_type' AND e.enumlabel = 'enable_privacy_mode' LIMIT 1`,
  );
  if (!exists.rows || exists.rows.length === 0) {
    await knex.raw(`ALTER TYPE command_type ADD VALUE 'enable_privacy_mode'`);
  }
}

export async function down(_knex: Knex): Promise<void> {
  // no-op
}
