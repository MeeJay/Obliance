import { Knex } from 'knex';

// Run without a wrapping transaction — ALTER TYPE ADD VALUE has historical
// quirks with Postgres transactions and this way we avoid them entirely.
export const config = { transaction: false };

export async function up(knex: Knex): Promise<void> {
  // Idempotent: check whether the value already exists before altering.
  const exists = await knex.raw(`
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'command_type' AND e.enumlabel = 'sleep'
    LIMIT 1
  `);
  if (!exists.rows || exists.rows.length === 0) {
    await knex.raw(`ALTER TYPE command_type ADD VALUE 'sleep'`);
  }
}

export async function down(_knex: Knex): Promise<void> {
  // Postgres does not support removing enum values. Intentional no-op.
}
