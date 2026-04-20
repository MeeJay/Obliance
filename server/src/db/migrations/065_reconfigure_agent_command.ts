import { Knex } from 'knex';

// Add a new command type so the server can push a new tenant API key + URL
// to an agent as part of a cross-tenant transfer. The agent handler for it
// will land in a follow-up agent release — in the meantime the command is
// enqueued and ignored by old agents (which is fine: the admin can always
// re-register the agent manually with the new key).

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`ALTER TYPE command_type ADD VALUE IF NOT EXISTS 'reconfigure_agent'`);
}

export async function down(_knex: Knex): Promise<void> {
  // Postgres doesn't support removing values from an enum easily — no-op.
}

export const config = { transaction: false };
