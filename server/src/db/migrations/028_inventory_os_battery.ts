import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('device_inventory_hardware', (t) => {
    t.jsonb('os').nullable();
    t.jsonb('battery').nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('device_inventory_hardware', (t) => {
    t.dropColumn('os');
    t.dropColumn('battery');
  });
}
