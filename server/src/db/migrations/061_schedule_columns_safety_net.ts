import { Knex } from 'knex';

// Safety-net migration: make sure the three columns introduced in 059/060
// actually exist on script_schedules. Earlier migrations may have been
// marked as applied by knex while silently failing in edge cases — this
// one is fully idempotent and catches up.

export async function up(knex: Knex): Promise<void> {
  // notification_channels (from 059)
  if (!(await knex.schema.hasColumn('script_schedules', 'notification_channels'))) {
    await knex.schema.alterTable('script_schedules', (t) => {
      t.jsonb('notification_channels').notNullable().defaultTo('[]');
    });
  }
  if (!(await knex.schema.hasColumn('scenarios', 'notification_channels'))) {
    await knex.schema.alterTable('scenarios', (t) => {
      t.jsonb('notification_channels').notNullable().defaultTo('[]');
    });
  }
  // timeout_seconds (from 060)
  if (!(await knex.schema.hasColumn('script_schedules', 'timeout_seconds'))) {
    await knex.schema.alterTable('script_schedules', (t) => {
      t.integer('timeout_seconds').nullable();
    });
  }
  // skip_if_in_flight (from 060)
  if (!(await knex.schema.hasColumn('script_schedules', 'skip_if_in_flight'))) {
    await knex.schema.alterTable('script_schedules', (t) => {
      t.boolean('skip_if_in_flight').notNullable().defaultTo(true);
    });
  }
}

export async function down(_knex: Knex): Promise<void> {
  // no-op
}
