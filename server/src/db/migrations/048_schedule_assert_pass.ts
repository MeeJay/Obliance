import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Assert pass flag on schedules — when enabled, a non-zero exit code
  // puts the device into "Schedule Error" state and triggers a notification.
  const hasAssertPass = await knex.schema.hasColumn('script_schedules', 'assert_pass');
  if (!hasAssertPass) {
    await knex.schema.alterTable('script_schedules', (t) => {
      t.boolean('assert_pass').notNullable().defaultTo(false);
    });
  }

  // Schedule alert on devices — set when an assert_pass schedule fails,
  // cleared when the same schedule succeeds on the next run.
  // JSONB: { scheduleId, scheduleName, exitCode, stderr, failedAt }
  const hasScheduleAlert = await knex.schema.hasColumn('devices', 'schedule_alert');
  if (!hasScheduleAlert) {
    await knex.schema.alterTable('devices', (t) => {
      t.jsonb('schedule_alert').nullable();
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  const hasAssertPass = await knex.schema.hasColumn('script_schedules', 'assert_pass');
  if (hasAssertPass) {
    await knex.schema.alterTable('script_schedules', (t) => {
      t.dropColumn('assert_pass');
    });
  }
  const hasScheduleAlert = await knex.schema.hasColumn('devices', 'schedule_alert');
  if (hasScheduleAlert) {
    await knex.schema.alterTable('devices', (t) => {
      t.dropColumn('schedule_alert');
    });
  }
}
