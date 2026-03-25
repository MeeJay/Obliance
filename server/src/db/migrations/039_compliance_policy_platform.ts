import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('compliance_policies', (t) => {
    t.string('target_platform', 20).defaultTo('all'); // windows | linux | macos | all
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('compliance_policies', (t) => {
    t.dropColumn('target_platform');
  });
}
