import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('devices', (t) => {
    t.string('last_logged_in_user', 255).nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('devices', (t) => {
    t.dropColumn('last_logged_in_user');
  });
}
