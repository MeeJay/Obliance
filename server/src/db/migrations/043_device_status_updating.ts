import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Add 'updating' and 'update_error' to the device_status enum.
  // Also add update_started_at to track the 10-min timeout.
  await knex.raw(`ALTER TYPE device_status ADD VALUE IF NOT EXISTS 'updating'`);
  await knex.raw(`ALTER TYPE device_status ADD VALUE IF NOT EXISTS 'update_error'`);

  await knex.schema.alterTable('devices', (t) => {
    t.timestamp('update_started_at').nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('devices', (t) => {
    t.dropColumn('update_started_at');
  });
  // Enum values cannot be removed in PostgreSQL without recreating the type.
}
