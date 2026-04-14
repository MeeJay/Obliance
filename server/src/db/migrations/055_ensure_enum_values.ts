import { Knex } from 'knex';

// Safety-net migration: older ALTER TYPE ADD VALUE migrations may have been
// marked "applied" by knex even though the underlying SQL silently failed
// (e.g. older Postgres rejecting it inside a transaction). This migration
// re-checks every enum value we rely on and adds any that are missing.
// Always safe to run repeatedly.

export const config = { transaction: false };

async function ensureEnumValue(knex: Knex, typeName: string, value: string): Promise<void> {
  const exists = await knex.raw(
    `SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid WHERE t.typname = ? AND e.enumlabel = ? LIMIT 1`,
    [typeName, value],
  );
  if (!exists.rows || exists.rows.length === 0) {
    await knex.raw(`ALTER TYPE ${typeName} ADD VALUE '${value}'`);
  }
}

export async function up(knex: Knex): Promise<void> {
  const required = [
    'sleep',
    'set_privacy_password',
    'change_privacy_password',
    'remove_privacy_password',
    'verify_privacy_password',
    'enable_airgap',
    'disable_airgap',
  ];
  for (const v of required) {
    await ensureEnumValue(knex, 'command_type', v);
  }
}

export async function down(_knex: Knex): Promise<void> {
  // no-op
}
