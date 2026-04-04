import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const hasCol = await knex.schema.hasColumn('script_schedules', 'on_failure_scenario_id');
  if (!hasCol) {
    await knex.schema.alterTable('script_schedules', (t) => {
      t.integer('on_failure_scenario_id').references('id').inTable('scenarios').onDelete('SET NULL');
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  const hasCol = await knex.schema.hasColumn('script_schedules', 'on_failure_scenario_id');
  if (hasCol) {
    await knex.schema.alterTable('script_schedules', (t) => {
      t.dropColumn('on_failure_scenario_id');
    });
  }
}
