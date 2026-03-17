import type { Knex } from 'knex';

// Add latest_services JSONB column to devices table.
// Stores the most recent service list pushed by the agent (like latest_metrics).

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('devices', (t) => {
    t.jsonb('latest_services').nullable().defaultTo(null);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('devices', (t) => {
    t.dropColumn('latest_services');
  });
}
