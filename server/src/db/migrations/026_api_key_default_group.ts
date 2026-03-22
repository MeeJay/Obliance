import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('agent_api_keys', (t) => {
    t.integer('default_group_id').unsigned().nullable()
      .references('id').inTable('device_groups').onDelete('SET NULL');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('agent_api_keys', (t) => {
    t.dropColumn('default_group_id');
  });
}
