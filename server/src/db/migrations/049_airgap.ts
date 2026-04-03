import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('devices', (t) => {
    t.boolean('airgap_enabled').notNullable().defaultTo(false);
    t.timestamp('airgap_enabled_at', { useTz: true }).nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('devices', (t) => {
    t.dropColumn('airgap_enabled_at');
    t.dropColumn('airgap_enabled');
  });
}
