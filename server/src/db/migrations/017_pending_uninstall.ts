import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Add the new enum value (IF NOT EXISTS requires PostgreSQL 9.3+, safe to run multiple times)
  await knex.raw(`ALTER TYPE device_status ADD VALUE IF NOT EXISTS 'pending_uninstall'`);

  // Add the uninstall_at column for the 10-minute expiry timer
  await knex.schema.alterTable('devices', (t) => {
    t.timestamp('uninstall_at', { useTz: true }).nullable();
  });
}

export async function down(_knex: Knex): Promise<void> {
  // PostgreSQL does not support removing enum values.
  // Dropping the column is safe.
  await _knex.schema.alterTable('devices', (t) => {
    t.dropColumn('uninstall_at');
  });
}
