import type { Knex } from 'knex';

// Add start_service and stop_service command types for the services.msc-like UI.

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`ALTER TYPE command_type ADD VALUE IF NOT EXISTS 'start_service'`);
  await knex.raw(`ALTER TYPE command_type ADD VALUE IF NOT EXISTS 'stop_service'`);
}

// PostgreSQL does not support removing values from an ENUM type.
export async function down(_knex: Knex): Promise<void> {}
