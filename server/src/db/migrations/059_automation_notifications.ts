import { Knex } from 'knex';

// Adds a JSONB `notification_channels` column to both script_schedules and
// scenarios. Each entry has shape: { channelId: number, mode: 'on_error' | 'summary' }
// Simpler than a link table given the low cardinality and transactional writes.

export async function up(knex: Knex): Promise<void> {
  const hasScheduleCol = await knex.schema.hasColumn('script_schedules', 'notification_channels');
  if (!hasScheduleCol) {
    await knex.schema.alterTable('script_schedules', (t) => {
      t.jsonb('notification_channels').notNullable().defaultTo('[]');
    });
  }
  const hasScenarioCol = await knex.schema.hasColumn('scenarios', 'notification_channels');
  if (!hasScenarioCol) {
    await knex.schema.alterTable('scenarios', (t) => {
      t.jsonb('notification_channels').notNullable().defaultTo('[]');
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('script_schedules', (t) => {
    t.dropColumn('notification_channels');
  });
  await knex.schema.alterTable('scenarios', (t) => {
    t.dropColumn('notification_channels');
  });
}
