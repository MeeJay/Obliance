import type { Knex } from 'knex';

// Add new command types introduced for agent/device control:
//   restart_agent   — restart the Obliance agent process on the device
//   list_services   — retrieve the list of OS services on the device
//   restart_service — restart a specific OS service on the device

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`ALTER TYPE command_type ADD VALUE IF NOT EXISTS 'restart_agent'`);
  await knex.raw(`ALTER TYPE command_type ADD VALUE IF NOT EXISTS 'list_services'`);
  await knex.raw(`ALTER TYPE command_type ADD VALUE IF NOT EXISTS 'restart_service'`);
}

// PostgreSQL does not support removing values from an ENUM type.
// The down migration is intentionally a no-op.
export async function down(_knex: Knex): Promise<void> {}
