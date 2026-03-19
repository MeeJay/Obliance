import type { Knex } from 'knex';

// Add available_in_reach column to scripts table.
// When true, this script is shown in the Oblireach desktop client for remote execution.

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('scripts', (t) => {
    t.boolean('available_in_reach').notNullable().defaultTo(false);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('scripts', (t) => {
    t.dropColumn('available_in_reach');
  });
}
