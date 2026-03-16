import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('notification_channels', (t) => {
    t.boolean('is_enabled').notNullable().defaultTo(true);
    t.integer('created_by').nullable().references('id').inTable('users').onDelete('SET NULL');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('notification_channels', (t) => {
    t.dropColumn('is_enabled');
    t.dropColumn('created_by');
  });
}
