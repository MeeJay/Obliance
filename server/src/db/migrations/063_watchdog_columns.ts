import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasColumn('devices', 'watchdog_restart_count'))) {
    await knex.schema.alterTable('devices', (t) => {
      t.integer('watchdog_restart_count').notNullable().defaultTo(0);
    });
  }
  if (!(await knex.schema.hasColumn('devices', 'watchdog_last_restart_at'))) {
    await knex.schema.alterTable('devices', (t) => {
      t.timestamp('watchdog_last_restart_at', { useTz: true }).nullable();
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  if (await knex.schema.hasColumn('devices', 'watchdog_last_restart_at')) {
    await knex.schema.alterTable('devices', (t) => {
      t.dropColumn('watchdog_last_restart_at');
    });
  }
  if (await knex.schema.hasColumn('devices', 'watchdog_restart_count')) {
    await knex.schema.alterTable('devices', (t) => {
      t.dropColumn('watchdog_restart_count');
    });
  }
}
