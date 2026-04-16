import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasColumn('script_schedules', 'notify_once'))) {
    await knex.schema.alterTable('script_schedules', (t) => {
      t.boolean('notify_once').notNullable().defaultTo(false);
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  if (await knex.schema.hasColumn('script_schedules', 'notify_once')) {
    await knex.schema.alterTable('script_schedules', (t) => {
      t.dropColumn('notify_once');
    });
  }
}
