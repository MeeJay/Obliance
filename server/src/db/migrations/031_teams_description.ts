import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('user_teams', (t) => {
    t.text('description').nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('user_teams', (t) => {
    t.dropColumn('description');
  });
}
