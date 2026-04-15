import { Knex } from 'knex';

// Per-schedule timeout override. Scripts already have a default
// timeout_seconds, but a single script may be used in multiple schedules
// with different timing constraints — this column lets the schedule
// override the script default for its own runs.
//
// NULL = fall back to script.timeout_seconds.

export async function up(knex: Knex): Promise<void> {
  const hasCol = await knex.schema.hasColumn('script_schedules', 'timeout_seconds');
  if (!hasCol) {
    await knex.schema.alterTable('script_schedules', (t) => {
      t.integer('timeout_seconds').nullable();
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('script_schedules', (t) => {
    t.dropColumn('timeout_seconds');
  });
}
