import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('devices', (t) => {
    t.boolean('privacy_mode_enabled').notNullable().defaultTo(false);
  });
  await knex.raw(`ALTER TYPE command_type ADD VALUE IF NOT EXISTS 'disable_privacy_mode'`);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('devices', (t) => {
    t.dropColumn('privacy_mode_enabled');
  });
}
