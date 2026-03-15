import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('scripts', (t) => {
    // Expected exit code for the script (0 = success by default).
    // When the agent reports a different exit code, the execution is marked as failure.
    t.integer('expected_exit_code').notNullable().defaultTo(0);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('scripts', (t) => {
    t.dropColumn('expected_exit_code');
  });
}
