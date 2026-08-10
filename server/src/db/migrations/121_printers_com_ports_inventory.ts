import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('device_inventory_hardware', (t) => {
    t.jsonb('printers').defaultTo('[]');
    t.jsonb('com_ports').defaultTo('[]');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('device_inventory_hardware', (t) => {
    t.dropColumn('printers');
    t.dropColumn('com_ports');
  });
}
