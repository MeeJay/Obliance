import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('devices', (t) => {
    t.timestamp('last_reboot_at').nullable();
    t.string('timezone', 64).nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('devices', (t) => {
    t.dropColumn('last_reboot_at');
    t.dropColumn('timezone');
  });
}
