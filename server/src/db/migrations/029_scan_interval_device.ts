import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('devices', (t) => {
    t.integer('scan_interval_seconds').nullable(); // null = inherit from group/global
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('devices', (t) => {
    t.dropColumn('scan_interval_seconds');
  });
}
